// Per-guild settings that survive restarts.
//
// One JSON file on disk ({ data: { <guildId>: {...} } }); every guild that
// never changed anything still gets the defaults (see DEFAULTS). Writes are
// debounced and atomic (write to a temp file, then rename), so a crash or
// power cut can never leave a half-written file behind.

import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { dirname } from 'node:path';

/**
 * Values a brand-new guild gets. Change these here and in the README if you
 * want different bot-wide defaults.
 */
export const DEFAULTS = Object.freeze({
  /** Leave the voice channel when it has no humans left? (see /settings) */
  autoLeaveOn: true,
  /** Minutes of empty queue/silence before the bot leaves (1–30). */
  silenceTimeoutMin: 5,
  /** Playback volume in percent, 1–100 (100 = full source loudness). */
  volume: 100,
});

export class SettingsStore {
  constructor(path) {
    this.path = path;
    this.#data = this.#load();
    this.#saveTimer = null;
  }

  /** Merged settings for one guild, never null. */
  get(guildId) {
    const saved = this.#data[guildId] ?? {};
    return { ...DEFAULTS, ...saved, guildId };
  }

  /**
   * Validate + merge `partial` into a guild's settings and persist it.
   * Values are clamped into legal ranges instead of erroring — friendly
   * for a small personal bot.
   */
  set(guildId, partial) {
    const merged = { ...this.get(guildId), ...partial };
    delete merged.guildId;

    if ('silenceTimeoutMin' in partial) {
      // clamp: integer minutes between 1 and 30
      const min = Math.round(Number(partial.silenceTimeoutMin));
      merged.silenceTimeoutMin = Math.min(30, Math.max(1, Number.isNaN(min) ? DEFAULTS.silenceTimeoutMin : min));
    }
    if ('volume' in partial) {
      const vol = Math.round(Number(partial.volume));
      merged.volume = Math.min(100, Math.max(1, Number.isNaN(vol) ? DEFAULTS.volume : vol));
    }
    if ('autoLeaveOn' in partial) {
      merged.autoLeaveOn = Boolean(partial.autoLeaveOn);
    }

    this.#data[guildId] = merged;
    this.#debounceSave();
    return merged;
  }

  /** Immediately write the file (tests use this; production is debounced). */
  _flush() {
    if (this.#saveTimer) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }
    this.#write();
  }

  // ── internals ────────────────────────────────────────────────────────

  #data;
  #saveTimer;

  #load() {
    // Missing or corrupt file must never stop the bot: fall back to {}.
    try {
      if (!existsSync(this.path)) return {};
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      console.warn(
        `[settings] could not read ${this.path} (${err.message}); starting with defaults`,
      );
      return {};
    }
  }

  #debounceSave() {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      this.#write();
    }, 300);
  }

  #write() {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.#data, null, 2));
      renameSync(tmp, this.path); // atomic on same filesystem
    } catch (err) {
      console.error(`[settings] failed to save ${this.path}: ${err.message}`);
    }
  }
}
