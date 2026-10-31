import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GuildPlayer } from '../src/players.js';
import { YtDlpError } from '../src/ytdlp.js';

// ── fakes ─────────────────────────────────────────────────────────────
// GuildPlayer takes its voice/yt-dlp seams as optional deps so the playback
// loop can be pinned without a real Discord connection.

function makeDeps(overrides = {}) {
  const sent = [];
  const idleHandlers = [];

  const fakeChannel = {
    id: 'voice-channel-1',
    guild: { id: 'guild-1', voiceAdapterCreator: () => ({}) },
    members: new Map(), // no humans
  };
  const fakePlayer = {
    on: (event, handler) => {
      if (event === 'idle') idleHandlers.push(handler);
    },
    playCalledWith: [],
    play(resource) {
      this.playCalledWith.push(resource);
    },
    stop() {},
    removeAllListeners() {},
    subscribePlain() {},
  };
  const fakeResource = {
    volumeTransformer: {
      setVolumeCalls: [],
      setVolume(v) {
        this.setVolumeCalls.push(v);
      },
    },
  };
  const madeResource = [];

  const deps = {
    joinVoiceChannel: () => ({
      on() {},
      subscribe() {},
      destroy() {},
    }),
    createAudioPlayer: () => fakePlayer,
    waitReady: async () => {}, // the fake connection is ready immediately
    /**
     * New seam: one call builds the whole native ffmpeg pipeline for a track.
     * Fakes record what they were asked for.
     */
    makeAudioResource: async (streamUrl, volumePct) => {
      const record = { streamUrl, volumePct, resource: fakeResource, killCalled: false };
      record.kill = () => {
        record.killCalled = true;
      };
      madeResource.push(record);
      return { resource: fakeResource, kill: record.kill };
    },
    madeResource() {
      return madeResource.at(-1);
    },
    eventPlayer: fakePlayer,
    sent,
    idleHandlers,
    invokeIdle(...args) {
      for (const handler of idleHandlers) handler(...args);
    },
    ...overrides,
  };

  fakePlayer.onStreamError = (err) => {
    // mirror @discordjs/voice: 'error' fires, THEN the state goes Idle
    playerErrorHandler?.(err);
    deps.invokeIdle();
  };
  let playerErrorHandler = null;
  fakePlayer.on('error', (h) => {
    playerErrorHandler = h;
  });

  const fakeClient = { user: { id: 'bot-user-1' }, channels: { cache: fakeChannel.members } };
  const fakeInteraction = {
    guildId: 'guild-1',
    member: { voice: { channel: fakeChannel }, id: 'user-1' },
    channel: { async send(content) { sent.push(content); } },
  };

  return { deps, fakeClient, fakeInteraction, fakeChannel, fakePlayer, fakeResource };
}

function makePlayer({ deps, fakeClient }, configOverrides = {}) {
  // Minimal in-memory settings: constructor args mirror production wiring.
  return new GuildPlayer(
    'guild-1',
    fakeClient,
    {
      get: (id) => ({ autoLeaveOn: true, silenceTimeoutMin: 5, volume: 100, guildId: id }),
      set: () => {},
    },
    { cookiesFile: null, ytDlpPath: 'yt-dlp', ...configOverrides },
    deps,
  );
}

const track = (title, url) => ({ title, url: url ?? `https://youtu.be/${title}`, durationSec: 0, requesterTag: 'u' });

// ── RED: these failed before the guard fixes ──────────────────────────

test('a track whose audio cannot be downloaded is skipped and announced', async () => {
  const env = makeDeps({
    makeAudioResource: async () => {
      throw new YtDlpError('yt-dlp exited with code 1');
    },
  });
  const player = makePlayer(env);

  await player.enqueue(env.fakeInteraction, [track('t1'), track('t2')]);
  // wait for the async resolution chain to settle
  await new Promise((r) => setImmediate(r));

  assert.ok(env.deps.sent.some((msg) => msg.includes("Couldn't play")), 'notify users about skipped track');
  assert.equal(player.nowPlaying, null, 'queue fully drained, none left playing');
});

test('a stream error mid-play advances exactly one track (no double-advance)', async () => {
  const env = makeDeps();
  const player = makePlayer(env);

  await player.enqueue(env.fakeInteraction, [track('t1'), track('t2')]);
  assert.equal(player.nowPlaying?.title, 't1');

  // the library emits 'error' then transitions to Idle (handler mirrors it)
  env.deps.eventPlayer.onStreamError(new Error('stream died'));

  assert.equal(player.nowPlaying?.title, 't2', 'advances exactly once per failure');
  assert.equal(player.queue.length, 0);
});

test('playback uses ffmpeg-native volume (no JS opus encoder in the loop)', async () => {
  const env = makeDeps();
  const player = makePlayer(env);

  await player.enqueue(env.fakeInteraction, [track('t1')]);
  await new Promise((r) => setImmediate(r)); // playNext resolves async

  const made = env.deps.madeResource();
  // The page URL goes straight to yt-dlp's own downloader: YouTube throttles
  // plain HTTP reads of the media URL below realtime (seen live: 0.65x), so
  // songs cut out after 1-2 s. yt-dlp's chunked download runs ~38x realtime.
  assert.equal(made.streamUrl, 'https://youtu.be/t1');
  assert.equal(made.volumePct, 100, 'ffmpeg receives the guild volume as a filter value');
});

test('the audio player tolerates short network stalls instead of ending the song', () => {
  let options;
  const env = makeDeps({
    createAudioPlayer(opts) {
      options = opts;
      return env.deps.eventPlayer;
    },
  });
  const player = makePlayer(env);
  return player.enqueue(env.fakeInteraction, [track('t1')]).then(() => {
    // library default is 5 frames = 100 ms of no data before "song over"
    assert.ok(options?.behaviors?.maxMissedFrames >= 250, 'at least 5 s of tolerance');
  });
});

test('leaving voice (kick / auto-leave) never drains the queue into a dead connection', async () => {
  const env = makeDeps();
  const player = makePlayer(env);

  await player.enqueue(env.fakeInteraction, [track('t1'), track('t2')]);
  assert.equal(player.nowPlaying?.title, 't1');

  // the bot is kicked from voice: bot member with channelId === null
  player.onVoiceUpdate(
    { memberId: 'x', channelId: 'voice-channel-1' },
    { member: { id: 'bot-user-1' }, guild: { id: 'guild-1' }, channelId: null },
  );

  assert.equal(player.nowPlaying, null);
  assert.equal(player.channelId, null, 'connection torn down');

  // a stray Idle from the dead player must NOT restart playback
  env.deps.invokeIdle();
  await new Promise((r) => setImmediate(r));

  assert.equal(player.nowPlaying, null, 'no headless advance after leaving');
});

test('teardown kills the native ffmpeg process on leave', async () => {
  const env = makeDeps();
  const player = makePlayer(env);

  await player.enqueue(env.fakeInteraction, [track('t1')]);
  await new Promise((r) => setImmediate(r));
  assert.equal(env.deps.madeResource().killCalled, false);

  // the bot is kicked from voice
  player.onVoiceUpdate(
    { memberId: 'x', channelId: 'voice-channel-1' },
    { member: { id: 'bot-user-1' }, guild: { id: 'guild-1' }, channelId: null },
  );

  assert.equal(env.deps.madeResource().killCalled, true, 'ffmpeg process is killed');
});
