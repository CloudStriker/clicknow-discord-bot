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

  /** Randomize the order (Fisher–Yates). `random` is injectable for tests. */
  shuffle(random = Math.random) {
    const items = this.#items;
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
  }

  /**
   * Remove the Track at a 1-based position (1 = next Track, same numbers
   * as /queue). Returns it, or null when the position doesn't exist.
   */
  removeAt(position) {
    if (!Number.isInteger(position) || position < 1 || position > this.#items.length) {
      return null;
    }
    return this.#items.splice(position - 1, 1)[0];
  }

  /**
   * One page of the Queue for display. Positions are absolute and 1-based.
   * There is always at least one page, even when the Queue is empty.
   *
   * @returns {{page: number, pages: number, items: {position: number, track: object}[]}}
   */
  page(n, size = 10) {
    const pages = Math.max(1, Math.ceil(this.#items.length / size));
    const start = (n - 1) * size;
    const items = this.#items
      .slice(Math.max(0, start), Math.max(0, start + size))
      .map((track, i) => ({ position: start + i + 1, track }));
    return { page: n, pages, items: n >= 1 ? items : [] };
  }

  /** A copy of the waiting Tracks, in order. */
  toArray() {
    return [...this.#items];
  }

  #maxSize;
  #items;
}
