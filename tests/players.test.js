import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GuildPlayers } from '../src/players.js';

const METHODS = ['for', 'enqueue', 'skip', 'stop', 'setVolume', 'onVoiceUpdate', 'housekeeping'];

test('GuildPlayers exposes its public API', () => {
  assert.equal(typeof GuildPlayers, 'function');
  for (const name of METHODS) {
    assert.equal(typeof GuildPlayers.prototype[name], 'function', `${name} missing`);
  }
});
