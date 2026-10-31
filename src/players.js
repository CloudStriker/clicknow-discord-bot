// The voice engine: one GuildPlayer per guild, owned by the GuildPlayers
// manager. A GuildPlayer owns:
//   - its own Queue (src/queue.js)
//   - the VoiceConnection to the guild's voice channel
//   - an AudioPlayer that streams Opus audio into that channel
//   - the leave timers (people left / queue went silent)
//
// Why a class per guild: Discord bots can be in many servers at once, and
// each server must hear its own music. Everything here is per-guild state —
// nothing is shared, so one guild's bot cannot break another's.
//
// NOTE (Ruling from the pre-flight scan): the plan said `VoiceConnection.join()`
// but the real @discordjs/voice API is joinVoiceChannel() — used below.

import {
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  AudioPlayerStatus,
  VoiceConnectionStatus,
} from '@discordjs/voice';

import { Queue } from './queue.js';
import { getStreamUrl, YtDlpError } from './ytdlp.js';

export class GuildPlayer {
  constructor(guildId, client, settingsStore, globalConfig) {
    this.guildId = guildId;
    this.#client = client;
    this.#settings = settingsStore;
    this.#config = globalConfig;

    this.queue = new Queue(100);

    this.#voiceChannelId = null;
    this.#connection = null;
    this.#audio = null;
    this.#current = null; // Track playing right now
    this.#resource = null; // live volume transformer lives here
    this.#notifyChannel = null; // last interaction's text channel
    this.#manualStop = false; // set by stop(), so Idle doesn't auto-advance
    this.#silenceTimer = null;
  }

  /**
   * Add Tracks and start playing if the bot was idle.
   * Returns what the command should tell the user.
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

    // Start immediately only for the user's own channel move/join;
    // playNext() resolves stream URLs (a few seconds), so it runs un-awaited.
    if (wasIdle && added > 0) this.#playNext();

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
   * Stop-message is handled by the caller (commands/skip.js).
   */
  skip() {
    if (!this.#audio) return false;
    const hadSomething = Boolean(this.#current || this.queue.length > 0);
    this.#manualStop = false; // skipping advances to the next Track
    this.#audio.stop(); // AudioPlayerStatus.Idle fires → #playNext()
    return hadSomething;
  }

  /** Clear the queue and leave the voice channel. */
  stop() {
    this.queue.clear();
    this.#manualStop = true;
    if (this.#audio?.state.status !== AudioPlayerStatus.Idle) {
      this.#audio?.stop();
    }
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
    // Our own bot was move/disconnected by someone else?
    if (newState.member?.id === this.#client.user.id) {
      if (!newState.channelId) {
        // kicked from voice — clean up so /play can start fresh later
        this.#leave();
      } else if (newState.channelId !== this.#voiceChannelId) {
        this.#voiceChannelId = newState.channelId;
      }
    }

    if (!this.#settings.get(this.guildId).autoLeaveOn) return;
    if (!this.#connection || !this.#voiceChannelId) return;

    const humans = this.#countHumans(this.#voiceChannelId);
    if (humans === 0) this.#leave();
  }

  /** Called every 60 s; safety net for the "channel empty" check. */
  housekeeping() {
    if (!this.#connection || !this.#voiceChannelId) return;
    if (!this.#settings.get(this.guildId).autoLeaveOn) return;

    const humans = this.#countHumans(this.#voiceChannelId);
    if (humans === 0) {
      console.log(`[${this.guildId}] auto-leave: nobody left in voice`);
      this.#leave();
    }
  }

  // ── voice connection ──────────────────────────────────────────────────

  async #ensureVoice(channel) {
    if (this.#connection && this.#voiceChannelId === channel.id) return false;

    // if the bot sits in a different channel in this guild, move over
    if (this.#connection && this.#voiceChannelId !== channel.id) {
      this.#leave(false);
    }

    this.#voiceChannelId = channel.id;

    this.#connection = joinVoiceChannel({
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
        this.#leave(false);
      }
    });

    this.#audio = createAudioPlayer();
    this.#connection.subscribe(this.#audio);

    // Track ended naturally → play the next one.
    this.#audio.on(AudioPlayerStatus.Idle, () => {
      if (this.#manualStop) {
        this.#manualStop = false;
        return;
      }
      this.#playNext();
    });
    // Unrecoverable audio error (corrupt stream, OS audio issues…):
    this.#audio.on('error', (err) => {
      console.error(`[${this.guildId}] audio error: ${err.message}`);
      this.#notify('⚠️ Playback hiccup — skipping the current track.');
      this.#manualStop = false;
      this.#playNext();
    });

    return true;
  }

  // ── playback loop ─────────────────────────────────────────────────────

  async #playNext() {
    this.#clearSilenceTimer();

    const next = this.queue.shift();
    if (!next) {
      this.#current = null;
      this.#resource = null;
      this.#startSilenceTimer(); // maybe last person heard — see /settings
      return;
    }

    this.#current = next;
    try {
      const { streamUrl, title } = await getStreamUrl(next.url, this.#config);
      const resource = createAudioResource(streamUrl, { inlineVolume: true });

      const volumePct = this.#settings.get(this.guildId).volume;
      resource.volumeTransformer.setVolume(volumePct / 100);

      this.#resource = resource;
      this.#audio.play(resource);
      this.#announceNowPlaying(next, title);
    } catch (err) {
      // Review-focus #1: a dead YouTube link or a yt-dlp failure may NEVER
      // take the bot down — log it, tell the room, keep the queue moving.
      if (err instanceof YtDlpError) {
        console.warn(`[${this.guildId}] yt-dlp failed on "${next.url}": ${err.message}`);
      } else {
        console.error(`[${this.guildId}] unexpected play error: ${err}`);
      }
      this.#notify(`⚠️ Couldn't play **${next.title}** — skipping.`);
      // The failed Track is already out of the queue; sounds simple, but this
      // recursion is what keeps one bad link from stalling a playlist.
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

  // ── leave timers ──────────────────────────────────────────────────────

  #startSilenceTimer() {
    const { silenceTimeoutMin } = this.#settings.get(this.guildId);
    this.#silenceTimer = setTimeout(() => {
      console.log(`[${this.guildId}] auto-leave: queue silent for ${silenceTimeoutMin} min`);
      this.stop();
    }, silenceTimeoutMin * 60_000);
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

  #leave(notify = false) {
    this.#clearSilenceTimer();
    this.#current = null;
    this.#resource = null;
    this.#audio?.stop(true);

    const conn = this.#connection;
    const channelId = this.#voiceChannelId;
    this.#connection = null;
    this.#voiceChannelId = null;

    if (conn) {
      try {
        conn.destroy();
      } catch {
        /* already gone */
      }
    }
    if (channelId) {
      // nothing else to clean; voice state cleanup happens from events
    }
  }

  #notify(content) {
    this.#notifyChannel?.send?.(content).catch?.(() => {});
  }

  // private fields
  #client;
  #settings;
  #config;
  #voiceChannelId;
  #connection;
  #audio;
  #current;
  #resource;
  #notifyChannel;
  #manualStop;
  #silenceTimer;
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
