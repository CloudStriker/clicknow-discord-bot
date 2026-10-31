import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Queue } from '../src/queue.js';

const track = (n) => ({ title: `track ${n}` });

test('queue keeps FIFO order', () => {
  const q = new Queue();
  assert.equal(q.push(track(1)), 1);
  assert.equal(q.push(track(2)), 1);

  assert.equal(q.shift().title, 'track 1');
  assert.equal(q.shift().title, 'track 2');
  assert.equal(q.shift(), null);
});

test('queue is capped at maxSize (default 100): 105 fits only 100', () => {
  const q = new Queue();
  for (let i = 0; i < 105; i++) q.push(track(i));

  assert.equal(q.length, 100);
});

test('push returns the number of tracks actually added', () => {
  const q = new Queue(2);
  assert.equal(q.push(track(1)), 1);
  assert.equal(q.push(track(2)), 1);
  assert.equal(q.push(track(3)), 0); // full — nothing added
  assert.equal(q.length, 2);
});

test('shift on an empty queue is null', () => {
  assert.equal(new Queue().shift(), null);
});

const titles = (q) => q.toArray().map((t) => t.title);

function queueOf(n) {
  const q = new Queue();
  for (let i = 1; i <= n; i++) q.push(track(i));
  return q;
}

test('shuffle is a Fisher–Yates permutation driven by the given random source', () => {
  const q = queueOf(4);
  q.shuffle(() => 0); // always pick index 0: deterministic result
  assert.deepEqual(titles(q), ['track 2', 'track 3', 'track 4', 'track 1']);
});

test('shuffle keeps every track exactly once', () => {
  const q = queueOf(20);
  q.shuffle();
  assert.deepEqual([...titles(q)].sort(), [...titles(queueOf(20))].sort());
});

test('removeAt uses 1-based positions (1 = next track)', () => {
  const q = queueOf(3);
  assert.equal(q.removeAt(2).title, 'track 2');
  assert.deepEqual(titles(q), ['track 1', 'track 3']);
});

test('removeAt out of range returns null and leaves the queue alone', () => {
  const q = queueOf(3);
  assert.equal(q.removeAt(0), null);
  assert.equal(q.removeAt(4), null);
  assert.equal(q.removeAt(1.5), null);
  assert.equal(q.length, 3);
});

test('page splits the queue into pages of 10 with absolute positions', () => {
  const q = queueOf(23);
  const third = q.page(3);
  assert.equal(third.pages, 3);
  assert.deepEqual(third.items.map((i) => i.position), [21, 22, 23]);
  assert.equal(third.items[0].track.title, 'track 21');
  assert.deepEqual(q.page(4).items, []);
});

test('page on an empty queue reports one empty page', () => {
  const p = new Queue().page(1);
  assert.equal(p.pages, 1);
  assert.deepEqual(p.items, []);
});

test('toArray returns a copy', () => {
  const q = queueOf(2);
  q.toArray().pop();
  assert.equal(q.length, 2);
});

test('clear empties the queue', () => {
  const q = new Queue();
  q.push(track(1));
  q.push(track(2));
  q.clear();
  assert.equal(q.length, 0);
  assert.equal(q.shift(), null);
});
