import { test } from 'node:test';
import assert from 'node:assert/strict';

import { commands, createCtx } from '../src/commands/index.js';
import play from '../src/commands/play.js';
import help from '../src/commands/help.js';
import { botChannelProblem } from '../src/commands/guard.js';
import { Queue } from '../src/queue.js';

const COMMAND_NAMES = [
  'help', 'play', 'skip', 'stop', 'queue', 'volume', 'settings',
  'pause', 'resume', 'nowplaying', 'shuffle', 'remove', 'clear', 'loop',
];

test('every command module exports data + execute and is registered', () => {
  assert.deepEqual(commands.map((c) => c.data.name).sort(), [...COMMAND_NAMES].sort());
  for (const c of commands) {
    assert.equal(typeof c.execute, 'function', `${c.data.name} has no execute`);
  }
});

test('help describes the real command set', async () => {
  // whatever is registered must show up in /help's reply
  const registered = commands.map((c) => c.data.name).sort();
  const replies = [];
  const interaction = {
    async reply(msg) { replies.push(msg); },
  };
  await help.execute(interaction);
  const reply = replies.join(' ');
  for (const name of registered) {
    assert.ok(reply.includes(name), `help mentions /${name}`);
  }
});

test('play: query is required; grab_limit offers 20/50/100', () => {
  const json = play.data.toJSON();
  const query = json.options.find((o) => o.name === 'query');
  assert.equal(query.required, true);

  const grab = json.options.find((o) => o.name === 'grab_limit');
  assert.deepEqual(grab.choices.map((c) => c.value), [20, 50, 100]);
});

test('volume: level is required and bounded 1–100', () => {
  const json = commands.find((c) => c.data.name === 'volume').data.toJSON();
  const level = json.options.find((o) => o.name === 'level');
  assert.equal(level.required, true);
  assert.equal(level.min_value, 1);
  assert.equal(level.max_value, 100);
});

test('settings: timeout is bounded 1–30; leave is on/off', () => {
  const json = commands.find((c) => c.data.name === 'settings').data.toJSON();
  const timeout = json.options.find((o) => o.name === 'timeout');
  assert.equal(timeout.min_value, 1);
  assert.equal(timeout.max_value, 30);
  const leave = json.options.find((o) => o.name === 'leave');
  assert.deepEqual(leave.choices.map((c) => c.value), ['on', 'off']);
});

test('default deps are wired synchronously (no async wiring race)', async () => {
  const { defaultDeps } = await import('../src/players.js');
  assert.equal(typeof defaultDeps.makeAudioResource, 'function');
  assert.equal(typeof defaultDeps.waitReady, 'function');
});

// ── v1.1 commands ─────────────────────────────────────────────────────

const command = (name) => commands.find((c) => c.data.name === name);
const option = (name, opt) => command(name).data.toJSON().options.find((o) => o.name === opt);

test('remove: position is required, at least 1', () => {
  assert.equal(option('remove', 'position').required, true);
  assert.equal(option('remove', 'position').min_value, 1);
});

test('loop: mode is required with choices off/track/queue', () => {
  assert.equal(option('loop', 'mode').required, true);
  assert.deepEqual(option('loop', 'mode').choices.map((c) => c.value), ['off', 'track', 'queue']);
});

test('queue: page is optional, at least 1', () => {
  assert.notEqual(option('queue', 'page').required, true);
  assert.equal(option('queue', 'page').min_value, 1);
});

/** A fake player recording what commands do to it. */
function fakePlayer(overrides = {}) {
  const calls = [];
  const queue = new Queue();
  return {
    calls,
    queue,
    channelId: 'vc-1',
    nowPlaying: { title: 'now' },
    paused: false,
    pause: (tag) => (calls.push(['pause', tag]), 'paused'),
    resume: () => (calls.push(['resume']), 'resumed'),
    shuffle: () => (calls.push(['shuffle']), 3),
    removeAt: (p) => (calls.push(['removeAt', p]), null),
    clearQueue: () => (calls.push(['clearQueue']), 2),
    setLoopMode: (m) => (calls.push(['setLoopMode', m]), m),
    refreshNowPlaying: async () => calls.push(['refresh']),
    postNowPlaying: async () => (calls.push(['post']), true),
    ...overrides,
  };
}

function fakeInteraction({ voiceChannelId = 'vc-1', options = {} } = {}) {
  const replies = [];
  return {
    replies,
    guildId: 'guild-1',
    user: { tag: 'cinnamon.wool' },
    member: { voice: { channelId: voiceChannelId } },
    channel: { send: async () => ({}) },
    options: {
      getInteger: (n) => options[n] ?? null,
      getString: (n) => options[n] ?? null,
    },
    async reply(r) {
      replies.push(r);
    },
  };
}

const ctxWith = (player) => ({ players: { for: () => player } });
const replyText = (i) => {
  const r = i.replies.at(-1);
  return typeof r === 'string' ? r : r.content;
};

test('botChannelProblem: not in voice, elsewhere, or fine', () => {
  const inVoice = fakeInteraction();
  assert.equal(botChannelProblem(inVoice, fakePlayer({ channelId: null })), 'Nothing is playing right now.');
  assert.equal(
    botChannelProblem(fakeInteraction({ voiceChannelId: 'other' }), fakePlayer()),
    "You're not in the bot's voice channel 🙂",
  );
  assert.equal(botChannelProblem(inVoice, fakePlayer()), null);
});

test('/pause outside the bot’s voice channel does nothing', async () => {
  const player = fakePlayer();
  const i = fakeInteraction({ voiceChannelId: 'other' });
  await command('pause').execute(i, ctxWith(player));
  assert.equal(replyText(i), "You're not in the bot's voice channel 🙂");
  assert.deepEqual(player.calls, []);
});

test('/pause pauses as the user and refreshes the Now-playing message', async () => {
  const player = fakePlayer();
  const i = fakeInteraction();
  await command('pause').execute(i, ctxWith(player));
  assert.equal(replyText(i), '⏸️ Paused.');
  assert.deepEqual(player.calls, [['pause', 'cinnamon.wool'], ['refresh']]);
});

test('/resume when not paused gets a friendly reply', async () => {
  const player = fakePlayer({ resume: () => 'not-paused' });
  const i = fakeInteraction();
  await command('resume').execute(i, ctxWith(player));
  assert.equal(replyText(i), "It's not paused 🙂");
});

test('/remove with a position that does not exist', async () => {
  const player = fakePlayer();
  player.queue.push({ title: 'a' });
  const i = fakeInteraction({ options: { position: 9 } });
  await command('remove').execute(i, ctxWith(player));
  assert.equal(replyText(i), 'There is no track #9 — the queue has 1 track(s). See /queue.');
});

test('/clear keeps the Current Track', async () => {
  const player = fakePlayer();
  const i = fakeInteraction();
  await command('clear').execute(i, ctxWith(player));
  assert.equal(replyText(i), '🧹 Cleared 2 track(s). The current track keeps playing.');
});

test('/loop sets the mode', async () => {
  const player = fakePlayer();
  const i = fakeInteraction({ options: { mode: 'track' } });
  await command('loop').execute(i, ctxWith(player));
  assert.deepEqual(player.calls[0], ['setLoopMode', 'track']);
  assert.equal(replyText(i), '🔂 Loop: **track** — repeating the current track.');
});

test('/queue page:2 shows positions 11+', async () => {
  const player = fakePlayer();
  for (let n = 1; n <= 12; n++) player.queue.push({ title: `t${n}` });
  const i = fakeInteraction({ voiceChannelId: null, options: { page: 2 } }); // no voice needed
  await command('queue').execute(i, ctxWith(player));
  assert.match(replyText(i), /^▶️ \*\*now\*\* \*\(now\)\*\n11\. \*\*t11\*\*/);
});

test('/nowplaying posts the message and answers privately', async () => {
  const player = fakePlayer();
  const i = fakeInteraction({ voiceChannelId: null });
  await command('nowplaying').execute(i, ctxWith(player));
  assert.deepEqual(player.calls, [['post']]);
  assert.deepEqual(i.replies.at(-1), { content: 'Posted below 👇', ephemeral: true });
});

test('createCtx bundles the manager context', () => {
  const ctx = createCtx({ players: 'P', settings: 'S', config: 'C' });
  assert.equal(ctx.players, 'P');
  assert.equal(ctx.settings, 'S');
  assert.equal(ctx.config, 'C');
});
