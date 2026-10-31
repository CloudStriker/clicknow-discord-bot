import { test } from 'node:test';
import assert from 'node:assert/strict';

import { commands, createCtx } from '../src/commands/index.js';
import play from '../src/commands/play.js';

test('every command module exports data + execute and is registered', () => {
  const names = ['play', 'skip', 'stop', 'queue', 'volume', 'settings'];
  assert.deepEqual(commands.map((c) => c.data.name).sort(), [...names].sort());
  for (const c of commands) {
    assert.equal(typeof c.execute, 'function', `${c.data.name} has no execute`);
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

test('createCtx bundles the manager context', () => {
  const ctx = createCtx({ players: 'P', settings: 'S', config: 'C' });
  assert.equal(ctx.players, 'P');
  assert.equal(ctx.settings, 'S');
  assert.equal(ctx.config, 'C');
});
