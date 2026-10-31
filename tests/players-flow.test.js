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
  let resourceInput;

  const deps = {
    joinVoiceChannel: () => ({
      on() {},
      subscribe() {},
      destroy() {},
    }),
    createAudioPlayer: () => fakePlayer,
    createAudioResource(input) {
      resourceInput = input;
      return fakeResource;
    },
    fetchStream: async () => ({ marker: 'stream-body' }), // non-string input
    recordedResourceInput() {
      return resourceInput;
    },
    fakeResource,
    getStreamUrl: async () => ({ streamUrl: 'https://stream', title: 'resolved' }),
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

test('a track whose stream URL cannot be resolved is skipped and announced', async () => {
  const env = makeDeps({
    getStreamUrl: async () => {
      throw new YtDlpError('No playable audio found');
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

test('volume is applied through a fetched stream, not a URL string', async () => {
  const env = makeDeps();
  const player = makePlayer(env);

  await player.enqueue(env.fakeInteraction, [track('t1')]);
  await new Promise((r) => setImmediate(r)); // playNext resolves async

  // With ffmpeg optimizations enabled (@discordjs/voice >= 0.16), a STRING
  // input gets routed down the FFmpeg→OggOpus pipeline, which has NO
  // volume transformer — that made /volume crash in production
  // ("Cannot read properties of undefined (reading 'setVolume')").
  const input = env.deps.recordedResourceInput();
  assert.ok(typeof input !== 'string', 'resource input must not be a raw URL');
  assert.deepEqual(env.deps.fakeResource.volumeTransformer.setVolumeCalls, [1]);
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
