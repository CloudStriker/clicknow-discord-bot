import test from 'node:test';
import assert from 'node:assert/strict';

import { handleControlButton } from '../src/buttons.js';
import { CONTROL_IDS } from '../src/controls.js';
import { Queue } from '../src/queue.js';

function fakePlayer(overrides = {}) {
  const calls = [];
  const queue = new Queue();
  let paused = false;
  let loopMode = 'off';
  let nowPlaying = { title: 'Track 1', durationSec: 100, requesterTag: 'alice' };

  const player = {
    calls,
    queue,
    channelId: 'vc-1',
    get paused() {
      return paused;
    },
    get loopMode() {
      return loopMode;
    },
    get nowPlaying() {
      return nowPlaying;
    },
    set nowPlaying(t) {
      nowPlaying = t;
    },
    elapsedSec: 10,
    pause: (tag) => {
      paused = true;
      calls.push(['pause', tag]);
      return 'paused';
    },
    resume: () => {
      paused = false;
      calls.push(['resume']);
      return 'resumed';
    },
    cycleLoopMode: () => {
      loopMode = loopMode === 'off' ? 'track' : loopMode === 'track' ? 'queue' : 'off';
      calls.push(['cycleLoopMode', loopMode]);
      return loopMode;
    },
    stop: () => {
      player.channelId = null;
      calls.push(['stop']);
    },
    skip: () => {
      calls.push(['skip']);
      return true;
    },
    nowPlayingPayload: ({ disabled = false } = {}) => {
      return {
        content: `Now playing: ${nowPlaying.title}`,
        components: [
          {
            components: [
              { custom_id: CONTROL_IDS.pause, label: paused ? 'Resume' : 'Pause', disabled },
              { custom_id: CONTROL_IDS.skip, label: 'Skip', disabled },
              { custom_id: CONTROL_IDS.stop, label: 'Stop', disabled },
              { custom_id: CONTROL_IDS.loop, label: `Loop: ${loopMode}`, disabled },
              { custom_id: CONTROL_IDS.queue, label: 'Queue', disabled },
            ],
          },
        ],
      };
    },
    ...overrides,
  };
  return player;
}

function fakeInteraction({
  customId = CONTROL_IDS.pause,
  voiceChannelId = 'vc-1',
  userTag = 'cinnamon.wool',
} = {}) {
  const replies = [];
  const updates = [];
  let deferred = false;

  return {
    customId,
    guildId: 'guild-1',
    user: { tag: userTag },
    member: { voice: { channelId: voiceChannelId } },
    replies,
    updates,
    get deferred() {
      return deferred;
    },
    async reply(r) {
      replies.push(r);
    },
    async update(u) {
      updates.push(u);
    },
    async deferUpdate() {
      deferred = true;
    },
  };
}

function ctxWith(player) {
  return {
    players: {
      for: () => player,
      skip: () => player.skip(),
      stop: () => player.stop(),
    },
  };
}

test('user outside voice → ephemeral reply, player untouched', async () => {
  const player = fakePlayer();
  const i = fakeInteraction({ voiceChannelId: 'other-vc' });
  await handleControlButton(i, ctxWith(player));
  assert.deepEqual(i.replies, [
    { content: "You're not in the bot's voice channel 🙂", ephemeral: true },
  ]);
  assert.equal(i.updates.length, 0);
  assert.deepEqual(player.calls, []);
});

test('⏯️ twice → paused then resumed, update called with label Resume then Pause', async () => {
  const player = fakePlayer();
  const ctx = ctxWith(player);

  const i1 = fakeInteraction({ customId: CONTROL_IDS.pause });
  await handleControlButton(i1, ctx);
  assert.equal(player.paused, true);
  const label1 = i1.updates[0].components[0].components[0].label;
  assert.equal(label1, 'Resume');

  const i2 = fakeInteraction({ customId: CONTROL_IDS.pause });
  await handleControlButton(i2, ctx);
  assert.equal(player.paused, false);
  const label2 = i2.updates[0].components[0].components[0].label;
  assert.equal(label2, 'Pause');
});

test('⏯️ on a stale message while a newer Track plays toggles the current Track', async () => {
  const player = fakePlayer();
  const ctx = ctxWith(player);

  player.nowPlaying = { title: 'Track 2 (Newer)', durationSec: 120, requesterTag: 'bob' };
  const i = fakeInteraction({ customId: CONTROL_IDS.pause });
  await handleControlButton(i, ctx);
  assert.equal(player.paused, true);
  assert.match(i.updates[0].content, /Track 2 \(Newer\)/);
});

test('🔁 three times → track, queue, off', async () => {
  const player = fakePlayer();
  const ctx = ctxWith(player);

  for (const expectedMode of ['track', 'queue', 'off']) {
    const i = fakeInteraction({ customId: CONTROL_IDS.loop });
    await handleControlButton(i, ctx);
    assert.equal(player.loopMode, expectedMode);
    assert.equal(
      i.updates[0].components[0].components[3].label,
      `Loop: ${expectedMode}`,
    );
  }
});

test('⏹️ → player left and update got disabled controls', async () => {
  const player = fakePlayer();
  const ctx = ctxWith(player);

  const i = fakeInteraction({ customId: CONTROL_IDS.stop });
  await handleControlButton(i, ctx);
  assert.equal(player.channelId, null);
  assert.match(i.updates[0].content, /⏹️ Stopped by cinnamon\.wool/);
  const [row] = i.updates[0].components.map((r) => (r.toJSON ? r.toJSON() : r));
  assert.ok(row.components.every((b) => b.disabled === true));
});

test('📜 → ephemeral reply listing position 1', async () => {
  const player = fakePlayer();
  player.queue.push({ title: 'Next Song' });
  const ctx = ctxWith(player);

  const i = fakeInteraction({ customId: CONTROL_IDS.queue });
  await handleControlButton(i, ctx);
  assert.equal(i.replies.length, 1);
  assert.equal(i.replies[0].ephemeral, true);
  assert.match(i.replies[0].content, /1\. \*\*Next Song\*\*/);
});

test('any button after the bot left → "Nothing is playing right now." ephemeral', async () => {
  const player = fakePlayer({ channelId: null });
  const ctx = ctxWith(player);

  for (const customId of Object.values(CONTROL_IDS)) {
    const i = fakeInteraction({ customId });
    await handleControlButton(i, ctx);
    assert.deepEqual(i.replies, [
      { content: 'Nothing is playing right now.', ephemeral: true },
    ]);
  }
});

test('⏭️ defers update and skips', async () => {
  const player = fakePlayer();
  const ctx = ctxWith(player);

  const i = fakeInteraction({ customId: CONTROL_IDS.skip });
  await handleControlButton(i, ctx);
  assert.equal(i.deferred, true);
  assert.deepEqual(player.calls, [['skip']]);
});
