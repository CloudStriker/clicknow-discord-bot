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
  entersState,
  joinVoiceChannel,
  AudioPlayerStatus,
  VoiceConnectionStatus,
} from '@discordjs/voice';

import { PermissionFlagsBits } from 'discord.js';

import { MAX_MISSED_FRAMES, makeAudioResource } from './audio.js';
import { formatDuration, nextLoopMode } from './controls.js';
import { Queue } from './queue.js';
import { YtDlpError } from './ytdlp.js';

/** Set VOICE_DEBUG=1 in .env to log the voice handshake and player states. */
const VOICE_DEBUG = process.env.VOICE_DEBUG === '1';

/** How long a voice connection may take to become ready before we give up. */
const VOICE_READY_TIMEOUT_MS = 20_000;

/** A join that cannot work; `message` is shown to the user as-is. */
export class VoiceJoinError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VoiceJoinError';
  }
}

const REQUIRED_VOICE_PERMISSIONS = [
  [PermissionFlagsBits.ViewChannel, 'View Channel'],
  [PermissionFlagsBits.Connect, 'Connect'],
  [PermissionFlagsBits.Speak, 'Speak'],
];

/**
 * Why the bot cannot play in this voice channel, or null if it can.
 *
 * Discord does not report a failed join: without these permissions (typical
 * for private channels) the connection just never comes up. So we check
 * first and tell the user exactly what to fix.
 */
export function voicePermissionProblem(channel) {
  const me = channel.guild?.members?.me;
  const perms = me ? channel.permissionsFor?.(me) : null;
  if (!perms) return null; // cannot tell — let the join (and its timeout) decide

  const missing = REQUIRED_VOICE_PERMISSIONS.filter(([flag]) => !perms.has(flag)).map(
    ([, name]) => name,
  );
  if (missing.length > 0) {
    return (
      `I don't have permission to play in **${channel.name ?? 'this channel'}** ` +
      `(missing: ${missing.join(', ')}). Ask an admin to open the channel's ` +
      'settings → Permissions → add the bot (or its role) and allow ' +
      'View Channel, Connect and Speak.'
    );
  }
  if (channel.full && !perms.has(PermissionFlagsBits.MoveMembers)) {
    return `**${channel.name ?? 'This channel'}** is full. Make room or raise its user limit.`;
  }
  return null;
}

/**
 * The real voice/yt-dlp seams (tests inject fakes via the 5th constructor arg).
 * All of them must be ready synchronously — a lazy import() here caused a
 * race where /play ran before the resolver existed ("getStreamUrl is not
 * a function", seen live in production).
 */
export const defaultDeps = {
  joinVoiceChannel,
  createAudioPlayer,
  makeAudioResource,
  waitReady: (connection) =>
    entersState(connection, VoiceConnectionStatus.Ready, VOICE_READY_TIMEOUT_MS),
};

const REAL_DEPS = defaultDeps;

export class GuildPlayer {
  constructor(guildId, client, settingsStore, globalConfig, deps) {
    this.guildId = guildId;
    this.queue = new Queue(100);

    this.#client = client;
    this.#settings = settingsStore;
    this.#config = globalConfig;
    this.#deps = deps ?? REAL_DEPS;

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

  /** Is the Current Track held by a Pause? */
  get paused() {
    return this.#paused;
  }

  /** Who paused (user tag), or null. */
  get pausedBy() {
    return this.#pausedBy;
  }

  /** 'off' | 'track' | 'queue' — see GLOSSARY "Loop mode". */
  get loopMode() {
    return this.#loopMode;
  }

  /** Seconds of the Current Track played so far (0 when idle). */
  get elapsedSec() {
    return (this.#resource?.playbackDuration ?? 0) / 1000;
  }

  /**
   * Hold the Current Track. A Pause counts as silence: the auto-leave
   * timeout starts now and Resume cancels it.
   *
   * @returns {'paused'|'already-paused'|'nothing-playing'}
   */
  pause(byTag) {
    if (!this.#current || !this.#audio) return 'nothing-playing';
    if (this.#paused) return 'already-paused';
    this.#audio.pause(true);
    this.#paused = true;
    this.#pausedBy = byTag;
    this.#clearSilenceTimer();
    this.#startSilenceTimer();
    return 'paused';
  }

  /** @returns {'resumed'|'not-paused'|'nothing-playing'} */
  resume() {
    if (!this.#current || !this.#audio) return 'nothing-playing';
    if (!this.#paused) return 'not-paused';
    this.#audio.unpause();
    this.#endPause();
    return 'resumed';
  }

  /** Set the Loop mode; anything but off/track/queue is ignored. */
  setLoopMode(mode) {
    if (LOOP_MODES.includes(mode)) this.#loopMode = mode;
    return this.#loopMode;
  }

  /** off → track → queue → off (the 🔁 button). */
  cycleLoopMode() {
    return this.setLoopMode(nextLoopMode(this.#loopMode));
  }

  /** Shuffle the waiting Tracks; returns how many there are. */
  shuffle() {
    this.queue.shuffle();
    return this.queue.length;
  }

  /** Remove a waiting Track by its /queue position (1 = next). */
  removeAt(position) {
    return this.queue.removeAt(position);
  }

  /** Empty the Queue; the Current Track keeps playing. Returns how many were removed. */
  clearQueue() {
    const removed = this.queue.length;
    this.queue.clear();
    return removed;
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

    const problem = voicePermissionProblem(memberChannel);
    if (problem) throw new VoiceJoinError(problem);

    this.#notifyChannel = interaction.channel;
    // A Pause keeps counting as silence even when Tracks are added.
    if (!this.#paused) this.#clearSilenceTimer();

    const joinedHere = await this.#ensureVoice(memberChannel);
    if (joinedHere) {
      try {
        await this.#deps.waitReady(this.#connection);
      } catch {
        console.warn(`[${this.guildId}] voice connection to ${memberChannel.id} never became ready`);
        this.#teardown();
        throw new VoiceJoinError(
          "I couldn't connect to your voice channel within 20 seconds. " +
            'Check that I can View Channel, Connect and Speak there, then try again.',
        );
      }
    }
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
    this.#skipRequested = true; // Loop mode track must not replay it
    if (this.#paused) this.#endPause();
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
    // Volume is an ffmpeg filter (see makeAudioResource): the saved value
    // takes effect from the next Track.
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
      debug: VOICE_DEBUG,
    });

    if (VOICE_DEBUG) {
      // Diagnostics for "bot shows the green ring but nobody hears it":
      // logs the voice handshake (incl. DAVE/E2EE) and player state changes.
      const tag = `[${this.guildId}][voice]`;
      this.#connection.on('debug', (m) => console.log(`${tag} ${m}`));
      this.#connection.on('stateChange', (a, b) => console.log(`${tag} ${a.status} -> ${b.status}`));
      this.#connection.on('error', (e) => console.error(`${tag} error: ${e.message}`));
    }

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

    this.#audio = this.#deps.createAudioPlayer({
      debug: VOICE_DEBUG,
      behaviors: { maxMissedFrames: MAX_MISSED_FRAMES },
    });
    this.#connection.subscribe(this.#audio);

    if (VOICE_DEBUG) {
      const tag = `[${this.guildId}][player]`;
      this.#audio.on('debug', (m) => console.log(`${tag} ${m}`));
    }

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

    // Pick the next Track, honoring the Loop mode. `finished` is the Track
    // that just ended; it is null on the first play and after a failed
    // download, so a failing Track is never looped (spec #12).
    const finished = this.#current;
    const skipped = this.#skipRequested;
    this.#skipRequested = false;
    this.#endPause();

    let next;
    if (finished && this.#loopMode === 'track' && !skipped) {
      next = finished;
    } else {
      if (finished && this.#loopMode === 'queue') this.queue.push(finished);
      next = this.queue.shift();
    }

    if (!next) {
      this.#killFfmpeg();
      this.#current = null;
      this.#resource = null;
      this.#startSilenceTimer(); // queue went silent — respect /settings
      return;
    }

    this.#current = next;
    try {
      const volumePct = this.#settings.get(this.guildId).volume;
      const { resource, kill } = await this.#deps.makeAudioResource(
        next.url,
        volumePct,
        this.#config,
      );
      if (session !== this.#session) {
        // we left while the download was starting — drop it
        kill();
        return;
      }

      this.#killFfmpeg(); // the previous Track's process, if still alive
      this.#killCurrent = kill;
      this.#resource = resource;
      this.#audio?.play(resource);
      this.#announceNowPlaying(next, next.title);
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
      this.#current = null; // never loop or re-queue a failed Track
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
    this.#loopMode = 'off'; // Loop mode is per visit, not saved
    this.#teardown();
  }

  /**
   * Drop the connection + audio player without touching the queue/current.
   * Used when the bot is moving between channels in the same guild.
   */
  #teardown() {
    this.#killFfmpeg();
    this.#paused = false;
    this.#pausedBy = null;
    this.#skipRequested = false;
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

  /** Forget the Pause (and its silence timeout). */
  #endPause() {
    if (!this.#paused) return;
    this.#paused = false;
    this.#pausedBy = null;
    this.#clearSilenceTimer();
  }

  #killFfmpeg() {
    this.#killCurrent?.();
    this.#killCurrent = null;
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
  #killCurrent = null; // stops the current Track's ffmpeg process
  #paused = false;
  #pausedBy = null;
  #loopMode = 'off';
  #skipRequested = false; // set by skip(); stops Loop mode track replaying
}

const LOOP_MODES = ['off', 'track', 'queue'];

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
