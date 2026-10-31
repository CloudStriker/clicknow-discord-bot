import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULTS, SettingsStore } from '../src/settings.js';

function tempStorePath() {
  return join(mkdtempSync(join(tmpdir(), 'settings-test-')), 'settings.json');
}

test('fresh store returns defaults for an unknown guild', () => {
  const store = new SettingsStore(tempStorePath());
  assert.deepEqual(store.get('123'), { ...DEFAULTS, guildId: '123' });
});

test('set() persists and a new instance reads the saved value', () => {
  const path = tempStorePath();
  const store = new SettingsStore(path);
  store.set('123', { volume: 60 });
  store._flush(); // force the debounced write for this test

  const reopened = new SettingsStore(path);
  assert.equal(reopened.get('123').volume, 60);
  assert.equal(reopened.get('123').autoLeaveOn, DEFAULTS.autoLeaveOn);
});

test('corrupt settings file falls back to defaults, then a set() rewrites valid JSON', () => {
  const path = tempStorePath();
  writeFileSync(path, 'not json at all {{{');

  const store = new SettingsStore(path);
  assert.deepEqual(store.get('999'), { ...DEFAULTS, guildId: '999' });

  store.set('999', { volume: 33 });
  store._flush();
  const onDisk = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(onDisk['999'].volume, 33);
});

test('invalid values are clamped, not stored', () => {
  const store = new SettingsStore(tempStorePath());
  store.set('555', { silenceTimeoutMin: 99, volume: 0 });

  const guild = store.get('555');
  assert.equal(guild.silenceTimeoutMin, 30);
  assert.equal(guild.volume, 1);
});
