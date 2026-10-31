import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTROL_IDS,
  buildControls,
  formatDuration,
  nextLoopMode,
  nowPlayingContent,
  progressBar,
  queuePageContent,
} from '../src/controls.js';
import { Queue } from '../src/queue.js';

const track = (title, durationSec = 192) => ({
  title,
  url: `https://youtu.be/${title}`,
  durationSec,
  requesterTag: 'cinnamon.wool',
});

test('formatDuration: m:ss under an hour, h:mm:ss above', () => {
  assert.equal(formatDuration(83), '1:23');
  assert.equal(formatDuration(3725), '1:02:05');
  assert.equal(formatDuration(0), '0:00');
});

test('progressBar: marker sits at the played fraction', () => {
  assert.equal(progressBar(96, 192), '1:36 ━━━━━●──── 3:12');
  assert.equal(progressBar(0, 192), '0:00 ●───────── 3:12');
  assert.equal(progressBar(500, 192), '3:12 ━━━━━━━━━● 3:12', 'clamped at the end');
});

test('progressBar: unknown duration (live) shows elapsed time only', () => {
  assert.equal(progressBar(83, null), '1:23');
  assert.equal(progressBar(83, 0), '1:23');
});

test('nextLoopMode cycles off → track → queue → off', () => {
  assert.equal(nextLoopMode('off'), 'track');
  assert.equal(nextLoopMode('track'), 'queue');
  assert.equal(nextLoopMode('queue'), 'off');
});

test('buildControls: one row of five buttons in the agreed order', () => {
  const [row] = buildControls({ paused: false, loopMode: 'off' }).map((r) => r.toJSON());
  assert.deepEqual(
    row.components.map((b) => b.custom_id),
    [CONTROL_IDS.pause, CONTROL_IDS.skip, CONTROL_IDS.stop, CONTROL_IDS.loop, CONTROL_IDS.queue],
  );
  assert.deepEqual(
    row.components.map((b) => b.label),
    ['Pause', 'Skip', 'Stop', 'Loop: off', 'Queue'],
  );
  assert.ok(row.components.every((b) => !b.disabled));
});

test('buildControls: labels follow pause and loop state; disabled disables all', () => {
  const [row] = buildControls({ paused: true, loopMode: 'queue' }).map((r) => r.toJSON());
  assert.equal(row.components[0].label, 'Resume');
  assert.equal(row.components[3].label, 'Loop: queue');

  const [off] = buildControls({ paused: false, loopMode: 'off', disabled: true }).map((r) =>
    r.toJSON(),
  );
  assert.ok(off.components.every((b) => b.disabled === true));
});

test('nowPlayingContent: playing, with requester, progress and next track', () => {
  const text = nowPlayingContent({
    track: track('I SEE U'),
    elapsedSec: 96,
    paused: false,
    pausedBy: null,
    loopMode: 'off',
    next: track('Second'),
  });
  assert.equal(
    text,
    [
      '▶️ Now playing: **I SEE U**',
      '1:36 ━━━━━●──── 3:12',
      'Requested by cinnamon.wool',
      'Up next: **Second**',
    ].join('\n'),
  );
});

test('nowPlayingContent: paused, loop on, nothing next', () => {
  const text = nowPlayingContent({
    track: track('I SEE U'),
    elapsedSec: 0,
    paused: true,
    pausedBy: 'clicknow',
    loopMode: 'track',
    next: null,
  });
  assert.match(text, /^⏸️ Paused by \*\*clicknow\*\*: \*\*I SEE U\*\*/);
  assert.match(text, /Up next: nothing/);
  assert.match(text, /🔁 Loop: track/);
});

function queueOf(n) {
  const q = new Queue();
  for (let i = 1; i <= n; i++) q.push(track(`t${i}`));
  return q;
}

test('queuePageContent: current track, numbered page and footer', () => {
  const text = queuePageContent({ current: track('now'), queue: queueOf(12), page: 2 });
  assert.equal(
    text,
    ['▶️ **now** *(now)*', '11. **t11**', '12. **t12**', 'Page 2/2 · 12 track(s) waiting'].join('\n'),
  );
});

test('queuePageContent: empty page and empty queue get friendly text', () => {
  assert.equal(
    queuePageContent({ current: track('now'), queue: queueOf(3), page: 5 }),
    'Page 5 is empty — the queue has 1 page(s).',
  );
  assert.equal(
    queuePageContent({ current: null, queue: new Queue(), page: 1 }),
    'The queue is empty. Add something with /play! 🎵',
  );
  assert.equal(
    queuePageContent({ current: track('now'), queue: new Queue(), page: 1 }),
    '▶️ **now** *(now)*\nNothing else is queued.',
  );
});
