// Text and buttons the bot shows for playback: the Now-playing message, its
// Controls, and Queue pages.
//
// Everything here is pure (no Discord connection, no player state), so the
// exact wording and button layout are pinned by tests/controls.test.js.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/** Button IDs; src/buttons.js routes presses by these. */
export const CONTROL_IDS = Object.freeze({
  pause: 'ctl:pause',
  skip: 'ctl:skip',
  stop: 'ctl:stop',
  loop: 'ctl:loop',
  queue: 'ctl:queue',
});

const LOOP_ORDER = ['off', 'track', 'queue'];

/** 83 → "1:23", 3725 → "1:02:05". */
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * "1:36 ━━━━━●──── 3:12". Tracks without a known duration (live streams)
 * show the elapsed time only.
 */
export function progressBar(elapsedSec, durationSec, width = 10) {
  if (!durationSec || durationSec <= 0) return formatDuration(elapsedSec);

  const elapsed = Math.min(Math.max(0, elapsedSec), durationSec);
  const marker = Math.round((elapsed / durationSec) * (width - 1));
  const bar = '━'.repeat(marker) + '●' + '─'.repeat(width - 1 - marker);
  return `${formatDuration(elapsed)} ${bar} ${formatDuration(durationSec)}`;
}

/** The Loop mode the 🔁 button switches to: off → track → queue → off. */
export function nextLoopMode(mode) {
  return LOOP_ORDER[(LOOP_ORDER.indexOf(mode) + 1) % LOOP_ORDER.length];
}

/**
 * The Controls row under a Now-playing message.
 *
 * @param {{paused: boolean, loopMode: string, disabled?: boolean}} state
 * @returns {ActionRowBuilder[]}
 */
export function buildControls({ paused, loopMode, disabled = false }) {
  const button = (id, emoji, label, style = ButtonStyle.Secondary) =>
    new ButtonBuilder()
      .setCustomId(id)
      .setEmoji(emoji)
      .setLabel(label)
      .setStyle(style)
      .setDisabled(disabled);

  return [
    new ActionRowBuilder().addComponents(
      paused
        ? button(CONTROL_IDS.pause, '▶️', 'Resume', ButtonStyle.Success)
        : button(CONTROL_IDS.pause, '⏸️', 'Pause'),
      button(CONTROL_IDS.skip, '⏭️', 'Skip'),
      button(CONTROL_IDS.stop, '⏹️', 'Stop', ButtonStyle.Danger),
      button(
        CONTROL_IDS.loop,
        '🔁',
        `Loop: ${loopMode}`,
        loopMode === 'off' ? ButtonStyle.Secondary : ButtonStyle.Primary,
      ),
      button(CONTROL_IDS.queue, '📜', 'Queue'),
    ),
  ];
}

/** Body of the Now-playing message. */
export function nowPlayingContent({ track, elapsedSec, paused, pausedBy, loopMode, next }) {
  const lines = [
    paused
      ? `⏸️ Paused by **${pausedBy ?? 'someone'}**: **${track.title}**`
      : `▶️ Now playing: **${track.title}**`,
    progressBar(elapsedSec, track.durationSec),
    `Requested by ${track.requesterTag}`,
    next ? `Up next: **${next.title}**` : 'Up next: nothing',
  ];
  if (loopMode && loopMode !== 'off') lines.push(`🔁 Loop: ${loopMode}`);
  return lines.join('\n');
}

/**
 * One page of /queue (and the 📜 button). Positions match /remove.
 *
 * @param {{current: object|null, queue: import('./queue.js').Queue, page: number}} args
 */
export function queuePageContent({ current, queue, page }) {
  if (!current && queue.length === 0) {
    return 'The queue is empty. Add something with /play! 🎵';
  }

  const { pages, items } = queue.page(page);
  if (queue.length > 0 && items.length === 0) {
    return `Page ${page} is empty — the queue has ${pages} page(s).`;
  }

  const lines = [];
  if (current) lines.push(`▶️ **${current.title}** *(now)*`);
  if (queue.length === 0) {
    lines.push('Nothing else is queued.');
  } else {
    for (const { position, track } of items) lines.push(`${position}. **${track.title}**`);
    lines.push(`Page ${page}/${pages} · ${queue.length} track(s) waiting`);
  }
  return lines.join('\n');
}
