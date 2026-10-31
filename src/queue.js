// A simple FIFO queue for Tracks with a hard cap.
//
// Everything Discord-specific lives in src/players.js; this class stays pure
// so it can be tested on its own.

/**
 * Ordered list of Tracks waiting to play, capped at maxSize.
 * (Spec: 100 tracks max per guild.)
 */
export class Queue {
  constructor(maxSize = 100) {
    this.#maxSize = maxSize;
    this.#items = [];
  }

  /** Add Tracks at the end; returns how many were actually added. */
  push(track) {
    if (this.#items.length >= this.#maxSize) return 0;
    this.#items.push(track);
    return 1;
  }

  /** Add several at once (used for playlist grabs); returns the count added. */
  pushAll(tracks) {
    let added = 0;
    for (const track of tracks) {
      added += this.push(track);
      if (this.#items.length >= this.#maxSize) break;
    }
    return added;
  }

  /** Take the next Track (FIFO), or null when empty. */
  shift() {
    return this.#items.shift() ?? null;
  }

  /** Drop everything. */
  clear() {
    this.#items = [];
  }

  get length() {
    return this.#items.length;
  }

  /** The next Track without removing it, or null when empty. */
  peek(index = 0) {
    return this.#items[index] ?? null;
  }

  #maxSize;
  #items;
}
