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

test('clear empties the queue', () => {
  const q = new Queue();
  q.push(track(1));
  q.push(track(2));
  q.clear();
  assert.equal(q.length, 0);
  assert.equal(q.shift(), null);
});
