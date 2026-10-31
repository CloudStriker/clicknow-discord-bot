// The voice engine: one GuildPlayer per guild, owned by the GuildPlayers
// manager. A GuildPlayer owns:
//   - its own Queue (src/queue.js)
//   - the VoiceConnection to the guild's voice channel
//   - an AudioPlayer that streams Opus audio into that channel
//   - the leave timers (people left / queue went silent)
//
// Two invariants this file protects (pinned in tests/players-flow.test.js):
//   1. The ONLY thing that pulls the next Track is the player reaching Idle
//      (or a track failing to resolve). `#leave()` bumps a session number
//      and detaches the audio player, so a kick / auto-leave can never
//      drain the queued tracks into a dead connection, and a stream error
//      advances exactly once.
//   2. A YouTube/yt-dlp failure is always contained: log it, tell the
//      users, keep the queue moving.
//
// Test seam: the voice/yt-dlp functions are injectable via the 5th
// constructor argument (tests use fakes; production passes nothing and
// gets the real ones).

import {
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  AudioPlayerStatus,
  VoiceConnectionStatus,
} from '@discordjs/voice';

import { Queue } from './queue.js';
import { YtDlpError } from './ytdlp.js';

const REAL_DEPS = {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  // getStreamUrl is configured per-call inside #playNext/#deps — see below
};

export class GuildPlayer {
  constructor(guildId, client, settingsStore, globalConfig, deps) {
    this.guildId = guildId;
    this.queue = new Queue(100);

    this.#client = client;
    this.#settings = settingsStore;
    this.#config = globalConfig;
    this.#deps = deps ?? { ...REAL_DEPS, getStreamUrl: null };
    if (this.#deps.getStreamUrl === null) {
      // lazy import avoidance: real resolver set once, here
      import('./ytdlp.js').then((m) => {
        this.#deps.getStreamUrl = m.getStreamUrl;
      });
    }

    this.#voiceChannelId = null;
    this.#connection = null;
    this.#audio = null;
    this.#current = null; // Track playing right now
    this.#resource = null; // carries the live volume transformer
    this.#notifyChannel = null; // last interaction's text channel
    this.#manualStop = false;
    this.#silenceTimer = null;
    this.#session = 0; // bumped on every leave; invalidates in-flight work
  }

  /** Track doing the playing right now, or null when idle. */
  get nowPlaying() {
    return this.#current;
  }

  /** The voice channel the bot sits in, or null when not in voice. */
  get channelId() {
    return this.#voiceChannelId;
  }

  /**
   * Add Tracks and start playing if the bot was idle.
   * Returns { added, joinedHere, queueLength } for the command reply.
   */
  async enqueue(interaction, tracks) {
    const memberChannel = interaction.member?.voice?.channel;
    if (!memberChannel) {
      throw new Error('NOT_IN_VOICE'); // commands turn this into a friendly reply
    }

    this.#notifyChannel = interaction.channel;
    this.#clearSilenceTimer();

    const joinedHere = await this.#ensureVoice(memberChannel);
    const wasIdle = !this.#current;
    const added = this.queue.pushAll(tracks);

    if (wasIdle && added > 0) {
      this.#playNext(); // resolves stream URLs (a few seconds), un-awaited
    }

    return { added, joinedHere, queueLength: this.queue.length };
  }

  /** Short human reply describing what enqueue did (commands use this). */
  describeEnqueueResult(tracks, { added }) {
    if (added === 0) {
      return 'The queue is full (100 tracks). Use /skip or /stop first.';
    }
    if (added === 1) return `Queued **${tracks[0].title}**`;
    return `Queued **${added}** tracks`;
  }

  /**
   * Skip the current Track. Returns false when there is nothing to skip.
   */
  skip() {
    if (!this.#audio) return false;
    const hadSomething = Boolean(this.#current || this.queue.length > 0);
    this.#manualStop = false; // skipping means "advance to the next Track"
    this.#audio.stop(); // Idle fires → #playNext() — exactly one advance
    return hadSomething;
  }

  /** Clear the queue and leave the voice channel. */
  stop() {
    this.#leave();
  }

  /** Set volume for this guild (1–100); applies live when music is playing. */
  setVolume(percent) {
    this.#settings.set(this.guildId, { volume: percent });
    if (this.#resource?.volumeTransformer) {
      this.#resource.volumeTransformer.setVolume(percent / 100);
    }
  }

  /** Called by src/index.js on every voice-state update in this guild. */
  onVoiceUpdate(oldState, newState) {
    // Our own bot was kicked or disconnected?
    if (newState.member?.id === this.#client.user.id) {
      if (!newState.channelId) {
        this.#leave(); // clears the queue — nothing to hear, nothing to keep
        return;
      }
      if (newState.channelId !== this.#voiceChannelId) {
        this.#voiceChannelId = newState.channelId;
      }
      return;
    }

    if (!this.#settings.get(this.guildId).autoLeaveOn) return;
    if (!this.#connection || !this.#voiceChannelId) return;

    if (this.#countHumans(this.#voiceChannelId) === 0) {
      console.log(`[${this.guildId}] auto-leave: everybody left the channel`);
      this.#leave();
    }
  }

  /** Called every 60 s; safety net for the "channel empty" check. */
  housekeeping() {
    if (!this.#connection || !this.#voiceChannelId) return;
    if (!this.#settings.get(this.guildId).autoLeaveOn) return;

    if (this.#countHumans(this.#voiceChannelId) === 0) {
      console.log(`[${this.guildId}] auto-leave: nobody left in voice`);
      this.#leave();
    }
  }

  // ── voice connection ──────────────────────────────────────────────────

  async #ensureVoice(channel) {
    if (this.#connection && this.#voiceChannelId === channel.id) return false;

    // The bot is moving to a different channel in this guild: drop the old
    // connection but KEEP the queue — the next /play picks it back up.
    if (this.#connection) this.#teardown();

    this.#voiceChannelId = channel.id;

    this.#connection = this.#deps.joinVoiceChannel({
      channelId: channel.id,
      guildId: this.guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });

    // Discord sometimes drops us (router change, server migration):
    // try to rejoin once, then give up cleanly.
    this.#connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(this.#connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(this.#connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        this.#leave();
      }
    });

    this.#audio = this.#deps.createAudioPlayer();
    this.#connection.subscribe(this.#audio);

    // Track ended naturally → play the next one.
    this.#audio.on(AudioPlayerStatus.Idle, () => {
      if (this.#manualStop) {
        this.#manualStop = false;
        return;
      }
      this.#playNext();
    });

    // Unrecoverable streaming error (corrupt stream, expired URL mid-song…):
    // only report here. The library then transitions to Idle, which is the
    // single place that advances the queue.
    this.#audio.on('error', (err) => {
      console.error(`[${this.guildId}] audio error: ${err.message}`);
      this.#notify('⚠️ Playback hiccup — skipping the current track.');
    });

    return true;
  }

  // ── playback loop ─────────────────────────────────────────────────────

  async #playNext() {
    this.#clearSilenceTimer();

    const session = this.#session;

    const next = this.queue.shift();
    if (!next) {
      this.#current = null;
      this.#resource = null;
      this.#startSilenceTimer(); // queue went silent — respect /settings
      return;
    }

    this.#current = next;
    try {
      const { streamUrl, title } = await this.#deps.getStreamUrl(next.url, this.#config);
      if (session !== this.#session) return; // we left while resolving — drop it

      const resource = this.#deps.createAudioResource(streamUrl, { inlineVolume: true });
      const volumePct = this.#settings.get(this.guildId).volume;
      resource.volumeTransformer.setVolume(volumePct / 100);

      this.#resource = resource;
      this.#audio?.play(resource);
      this.#announceNowPlaying(next, title);
    } catch (err) {
      if (session !== this.#session) return; // left while resolving — drop it

      // Contained failure (invariant #2): the failed Track is already out of
      // the queue; this recursion is what keeps one bad link from stalling
      // a playlist.
      if (err instanceof YtDlpError) {
        console.warn(`[${this.guildId}] yt-dlp failed on "${next.url}": ${err.message}`);
      } else {
        console.error(`[${this.guildId}] unexpected play error: ${err}`);
      }
      this.#notify(`⚠️ Couldn't play **${next.title}** — skipping.`);
      this.#playNext();
    }
  }

  #announceNowPlaying(track, resolvedTitle) {
    const duration =
      typeof track.durationSec === 'number' && track.durationSec > 0
        ? ` (${formatDuration(track.durationSec)})`
        : '';
    this.#notify(`▶️ Now playing: **${resolvedTitle}**${duration}`);
  }

  // ── leaving ───────────────────────────────────────────────────────────

  /**
   * Full leave: clear timers + queue, tear down the dead player so its
   * events can no longer advance anything. Guarded by synonyms below —
   * this is the ONLY teardown path.
   */
  #leave() {
    this.#clearSilenceTimer();
    this.queue.clear();
    this.#teardown();
  }

  /**
   * Drop the connection + audio player without touching the queue/current.
   * Used when the bot is moving between channels in the same guild.
   */
  #teardown() {
    this.#current = null;
    this.#resource = null;
    this.#session += 1; // abandon any in-flight stream resolution
    this.#manualStop = true; // if an Idle slips out of stop(), ignore it

    const audio = this.#audio;
    const connection = this.#connection;
    this.#audio = null;
    this.#connection = null;
    this.#voiceChannelId = null;

    audio?.removeAllListeners();
    audio?.stop(true);

    if (connection) {
      try {
        connection.destroy();
      } catch {
        /* already gone */
      }
    }
  }

  // ── timers / helpers ──────────────────────────────────────────────────

  #startSilenceTimer() {
    const { silenceTimeoutMin } = this.#settings.get(this.guildId);
    this.#silenceTimer = setTimeout(() => {
      console.log(`[${this.guildId}] auto-leave: queue silent for ${silenceTimeoutMin} min`);
      this.#leave();
    }, silenceTimeoutMin * 60_000);
    // An idling bot shouldn't hold the process open on this timer alone;
    // in the Docker runtime the process has plenty of other work.
    this.#silenceTimer.unref?.();
  }

  #clearSilenceTimer() {
    if (this.#silenceTimer) {
      clearTimeout(this.#silenceTimer);
      this.#silenceTimer = null;
    }
  }

  #countHumans(channelId) {
    const channel = this.#client.channels.cache.get(channelId);
    if (!channel) return 1; // unknown → be safe, do not leave
    return channel.members.filter((m) => !m.user.bot).size;
  }

  #notify(content) {
    this.#notifyChannel?.send?.(content)?.catch?.(() => {});
  }

  // private fields
  #client;
  #settings;
  #config;
  #deps;
  #voiceChannelId;
  #connection;
  #audio;
  #current;
  #resource;
  #notifyChannel;
  #manualStop;
  #silenceTimer;
  #session;
}

function formatDuration(totalSeconds) {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/**
 * One GuildPlayer per guild; the manager is what src/index.js talks to.
 */
export class GuildPlayers {
  constructor(client, settingsStore, globalConfig) {
    this.#client = client;
    this.#settings = settingsStore;
    this.#config = globalConfig;
    this.#players = new Map();
  }

  for(guildId) {
    let player = this.#players.get(guildId);
    if (!player) {
      player = new GuildPlayer(guildId, this.#client, this.#settings, this.#config);
      this.#players.set(guildId, player);
    }
    return player;
  }

  async enqueue(interaction, tracks) {
    return this.for(interaction.guildId).enqueue(interaction, tracks);
  }

  skip(guildId) {
    return this.for(guildId).skip();
  }

  stop(guildId) {
    this.for(guildId).stop();
  }

  setVolume(guildId, percent) {
    this.for(guildId).setVolume(percent);
  }

  onVoiceUpdate(oldState, newState) {
    const guildPlayer = this.#players.get(newState.guild.id);
    guildPlayer?.onVoiceUpdate(oldState, newState);
  }

  /** Called on a 60-second timer from src/index.js. */
  housekeeping() {
    for (const player of this.#players.values()) player.housekeeping();
  }

  #client;
  #settings;
  #config;
  #players;
}
