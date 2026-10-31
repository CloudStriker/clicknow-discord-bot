import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

import { GuildPlayer } from '../src/players.js';
import { YtDlpError } from '../src/ytdlp.js';

// Fakes in the style of tests/players-flow.test.js. The fake audio player
// mirrors @discordjs/voice where it matters: stop() reaches Idle, which is
// what advances the Queue.

function setup({ failUrls = [], silenceTimeoutMin = 1 } = {}) {
  const made = [];
  const sent = [];
  const audio = {
    handlers: {},
    pauseCalls: 0,
    unpauseCalls: 0,
    on(event, fn) {
      (this.handlers[event] ??= []).push(fn);
    },
    removeAllListeners() {
      this.handlers = {};
    },
    play() {},
    pause() {
      this.pauseCalls += 1;
      return true;
    },
    unpause() {
      this.unpauseCalls += 1;
      return true;
    },
    stop() {
      this.idle();
      return true;
    },
    idle() {
      for (const fn of this.handlers.idle ?? []) fn();
    },
  };
  const deps = {
    joinVoiceChannel: () => ({ on() {}, subscribe() {}, destroy() {} }),
    createAudioPlayer: () => audio,
    waitReady: async () => {},
    makeAudioResource: async (url) => {
      if (failUrls.includes(url)) throw new YtDlpError('yt-dlp exited with code 1');
      const resource = { playbackDuration: 0 };
      made.push({ url, resource });
      return { resource, kill() {} };
    },
  };
  const channel = {
    id: 'vc-1',
    guild: { id: 'guild-1', voiceAdapterCreator: () => ({}) },
    members: new Map(),
  };
  const player = new GuildPlayer(
    'guild-1',
    { user: { id: 'bot' }, channels: { cache: new Map() } },
    {
      get: (id) => ({ autoLeaveOn: true, silenceTimeoutMin, volume: 100, guildId: id }),
      set() {},
    },
    { cookiesFile: null, ytDlpPath: 'yt-dlp' },
    deps,
  );
  const interaction = {
    guildId: 'guild-1',
    member: { voice: { channel } },
    channel: { send: async (m) => sent.push(m) },
  };
  return { player, audio, made, sent, interaction };
}

const t = (name) => ({ title: name, url: `https://youtu.be/${name}`, durationSec: 100, requesterTag: 'u' });
const settle = () => new Promise((r) => setImmediate(r));
const titles = (player) => player.queue.toArray().map((x) => x.title);

async function playing(env, tracks) {
  await env.player.enqueue(env.interaction, tracks);
  await settle();
}

// ── pause / resume ────────────────────────────────────────────────────

test('pause holds the Current Track and remembers who paused', async () => {
  const env = setup();
  await playing(env, [t('t1')]);

  assert.equal(env.player.pause('cinnamon.wool'), 'paused');
  assert.equal(env.player.paused, true);
  assert.equal(env.player.pausedBy, 'cinnamon.wool');
  assert.equal(env.audio.pauseCalls, 1);
  assert.equal(env.player.pause('x'), 'already-paused');
  assert.equal(env.audio.pauseCalls, 1);
});

test('resume continues; resuming when not paused is reported', async () => {
  const env = setup();
  await playing(env, [t('t1')]);
  env.player.pause('a');

  assert.equal(env.player.resume(), 'resumed');
  assert.equal(env.player.paused, false);
  assert.equal(env.player.pausedBy, null);
  assert.equal(env.audio.unpauseCalls, 1);
  assert.equal(env.player.resume(), 'not-paused');
});

test('pause and resume with nothing playing', () => {
  const env = setup();
  assert.equal(env.player.pause('a'), 'nothing-playing');
  assert.equal(env.player.resume(), 'nothing-playing');
});

test('a Pause counts as silence: the bot leaves after the timeout', async (ctx) => {
  const env = setup({ silenceTimeoutMin: 1 });
  await playing(env, [t('t1')]);
  ctx.mock.timers.enable({ apis: ['setTimeout'] });

  env.player.pause('a');
  ctx.mock.timers.tick(60_000);

  assert.equal(env.player.channelId, null, 'left voice');
  assert.equal(env.player.paused, false, 'pause state reset on leave');
});

test('resume cancels the silence timeout', async (ctx) => {
  const env = setup({ silenceTimeoutMin: 1 });
  await playing(env, [t('t1')]);
  ctx.mock.timers.enable({ apis: ['setTimeout'] });

  env.player.pause('a');
  env.player.resume();
  ctx.mock.timers.tick(60_000);

  assert.equal(env.player.channelId, 'vc-1', 'still in voice');
});

test('/play while paused keeps the Pause and its timeout', async (ctx) => {
  const env = setup({ silenceTimeoutMin: 1 });
  await playing(env, [t('t1')]);
  ctx.mock.timers.enable({ apis: ['setTimeout'] });

  env.player.pause('a');
  await env.player.enqueue(env.interaction, [t('t2')]);
  assert.equal(env.player.paused, true);
  assert.deepEqual(titles(env.player), ['t2']);

  ctx.mock.timers.tick(60_000);
  assert.equal(env.player.channelId, null, 'the paused bot still leaves');
});

test('skip while paused plays the next Track and ends the Pause', async () => {
  const env = setup();
  await playing(env, [t('t1'), t('t2')]);
  env.player.pause('a');

  env.player.skip();
  await settle();

  assert.equal(env.player.nowPlaying.title, 't2');
  assert.equal(env.player.paused, false);
});

// ── loop modes ────────────────────────────────────────────────────────

test('loop track replays the Current Track when it ends', async () => {
  const env = setup();
  await playing(env, [t('t1'), t('t2')]);
  env.player.setLoopMode('track');

  env.audio.idle();
  await settle();

  assert.equal(env.player.nowPlaying.title, 't1');
  assert.deepEqual(env.made.map((m) => m.url), ['https://youtu.be/t1', 'https://youtu.be/t1']);
  assert.deepEqual(titles(env.player), ['t2']);
});

test('loop track: /skip still moves on', async () => {
  const env = setup();
  await playing(env, [t('t1'), t('t2')]);
  env.player.setLoopMode('track');

  env.player.skip();
  await settle();

  assert.equal(env.player.nowPlaying.title, 't2');
});

test('loop queue puts the finished Track back at the end', async () => {
  const env = setup();
  await playing(env, [t('t1'), t('t2')]);
  env.player.setLoopMode('queue');

  env.audio.idle();
  await settle();

  assert.equal(env.player.nowPlaying.title, 't2');
  assert.deepEqual(titles(env.player), ['t1']);
});

test('loop queue: a skipped Track stays in the rotation', async () => {
  const env = setup();
  await playing(env, [t('t1'), t('t2')]);
  env.player.setLoopMode('queue');

  env.player.skip();
  await settle();

  assert.equal(env.player.nowPlaying.title, 't2');
  assert.deepEqual(titles(env.player), ['t1']);
});

test('loop track never replays a Track that failed to download', async () => {
  const env = setup({ failUrls: ['https://youtu.be/bad'] });
  env.player.setLoopMode('track');
  await playing(env, [t('bad'), t('t2')]);

  assert.equal(env.player.nowPlaying.title, 't2');
  assert.ok(env.sent.some((m) => String(m).includes("Couldn't play")));
});

test('loop queue drops a failing Track from the rotation', async () => {
  const env = setup({ failUrls: ['https://youtu.be/bad'] });
  env.player.setLoopMode('queue');
  await playing(env, [t('bad'), t('t2')]);

  assert.equal(env.player.nowPlaying.title, 't2');
  assert.deepEqual(titles(env.player), [], 'bad is not re-queued');

  env.audio.idle(); // t2 ends → goes back to the end → plays again
  await settle();
  assert.equal(env.player.nowPlaying.title, 't2');
});

test('cycleLoopMode goes off → track → queue → off; unknown modes are ignored', () => {
  const { player } = setup();
  assert.equal(player.loopMode, 'off');
  assert.equal(player.cycleLoopMode(), 'track');
  assert.equal(player.cycleLoopMode(), 'queue');
  assert.equal(player.cycleLoopMode(), 'off');
  player.setLoopMode('sideways');
  assert.equal(player.loopMode, 'off');
});

test('leaving voice resets Loop mode and Pause', async () => {
  const env = setup();
  await playing(env, [t('t1')]);
  env.player.setLoopMode('queue');
  env.player.pause('a');

  env.player.stop();

  assert.equal(env.player.loopMode, 'off');
  assert.equal(env.player.paused, false);
});

// ── queue management ──────────────────────────────────────────────────

test('clearQueue empties the Queue but keeps the Current Track', async () => {
  const env = setup();
  await playing(env, [t('t1'), t('t2'), t('t3')]);

  assert.equal(env.player.clearQueue(), 2);
  assert.equal(env.player.nowPlaying.title, 't1');
  assert.equal(env.player.queue.length, 0);
  assert.equal(env.player.channelId, 'vc-1');
});

test('removeAt and shuffle work on the waiting Tracks only', async () => {
  const env = setup();
  await playing(env, [t('t1'), t('t2'), t('t3')]);

  assert.equal(env.player.removeAt(1).title, 't2');
  assert.equal(env.player.removeAt(5), null);
  assert.equal(env.player.shuffle(), 1);
  assert.equal(env.player.nowPlaying.title, 't1');
});

test('elapsedSec reads the resource playback duration', async () => {
  const env = setup();
  assert.equal(env.player.elapsedSec, 0);
  await playing(env, [t('t1')]);
  env.made[0].resource.playbackDuration = 5_000;
  assert.equal(env.player.elapsedSec, 5);
});

mock.reset();
