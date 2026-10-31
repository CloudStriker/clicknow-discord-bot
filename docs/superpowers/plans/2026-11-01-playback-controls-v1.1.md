# Playback Controls v1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pause/resume, loop, shuffle, remove, clear, paged queue, `/nowplaying`, and button Controls on the Now-playing message, plus three maintenance fixes.

**Architecture:** Pure helpers stay testable without Discord: `src/queue.js` gains shuffle/remove/page; new `src/controls.js` builds message text and button rows; `src/audio.js` takes the yt-dlp→ffmpeg pipeline out of the 628-line `src/players.js`. `GuildPlayer` gains pause, loop and Now-playing message state. A new `src/buttons.js` handles button presses; `src/index.js` routes them.

**Tech Stack:** Node 24 ESM · discord.js 14 (`ButtonBuilder`, `ActionRowBuilder`, `InteractionContextType`) · @discordjs/voice 0.19 (`AudioPlayer.pause/unpause`, `resource.playbackDuration`) · node:test.

**Spec:** `docs/superpowers/specs/2026-11-01-playback-controls-v1.1.md`

## Global Constraints

- Plain JavaScript, ESM, JSDoc comments in the style of the existing files. No new runtime dependencies.
- English user-facing text. Glossary words (Queue, Current Track, Pause, Loop mode…) in code names and comments.
- Every control action (slash command or button) except `/queue`, `/nowplaying` and `/help` requires the user to be in the bot's voice channel.
- Queue positions are 1-based and identical in `/queue`, `/remove` and the 📜 button. Page size 10.
- Loop mode values: `'off' | 'track' | 'queue'`. In memory only; reset to `'off'` on leave.
- Custom button IDs: `ctl:pause`, `ctl:skip`, `ctl:stop`, `ctl:loop`, `ctl:queue`.
- All tests: `npm test` (currently 38 passing; must stay green after every task).

## Review Focus

1. **Stale button on an old message** after a new Track started: must act on the *current* player state, never on what the old message showed (e.g. ⏯️ on an old message toggles the current Pause correctly). Pinned in Task 6.
2. **Pause then leave/auto-leave**: silence timer fires while paused → bot leaves cleanly, Controls disabled, Loop mode reset. Pinned in Task 3/4.
3. **Loop *track* + `/skip`** must not replay the skipped Track; **loop + failing Track** must not retry forever. Pinned in Task 3.
4. **Button pressed after the bot left** (message still visible): friendly reply, no crash. Pinned in Task 6.
5. **Discord edit failures** (message deleted by a moderator): disabling/editing old messages must swallow errors. Pinned in Task 4.

## File Structure

| File | Change |
|---|---|
| `src/queue.js` | + `shuffle(random)`, `removeAt(position)`, `page(n, size)`, `toArray()` |
| `src/audio.js` | **new**: `makeAudioResource`, `MAX_MISSED_FRAMES` (moved from players.js, unchanged behavior) |
| `src/controls.js` | **new** (pure): `formatDuration`, `progressBar`, `nextLoopMode`, `buildControls`, `nowPlayingContent`, `queuePageContent`, `CONTROL_IDS` |
| `src/players.js` | pause/resume, loop, shuffle/remove/clear, elapsed time, Now-playing message lifecycle |
| `src/buttons.js` | **new**: `handleControlButton(interaction, ctx)` |
| `src/commands/guard.js` | **new**: `botChannelProblem(interaction, player)` shared voice-channel check |
| `src/commands/{pause,resume,nowplaying,shuffle,remove,clear,loop}.js` | **new** commands |
| `src/commands/{queue,skip,stop,play,index}.js` | page option, shared guard, paused reminder, registry |
| `src/index.js` | route buttons; refuse DM use |
| `src/config.js` | readable `CLIENT_ID` error |
| `.dockerignore` | **new** |
| `README.md`, `README.id.md` | command tables |

**Track shape** (unchanged): `{ url, title, durationSec: number|null, requesterTag }`.

---

### Task 1: Queue operations

**Files:** Modify `src/queue.js`; Test `tests/queue.test.js`

**Produces:** `shuffle(random = Math.random) -> void` (Fisher–Yates over the waiting Tracks) · `removeAt(position: number) -> Track|null` (1-based; null when out of range) · `page(n: number, size = 10) -> { page: number, pages: number, items: {position: number, track: Track}[] }` (pages ≥ 1 even when empty; out-of-range n → `items: []`) · `toArray() -> Track[]` (copy).

- [ ] Write failing tests: shuffle with a seeded fake `random` gives a deterministic permutation and keeps all items; `removeAt(2)` on [a,b,c] returns b and leaves [a,c]; `removeAt(0)` / `removeAt(4)` → null and queue unchanged; 23 items → `page(3)` has positions 21–23 and `pages === 3`; `page(4).items` empty; empty queue → `pages === 1`.
- [ ] Run `npm test` → FAIL (methods missing)
- [ ] Implement
- [ ] Run `npm test` → PASS
- [ ] Commit `feat: queue shuffle, remove and paging`

### Task 2: Extract audio pipeline + pure control helpers

**Files:** Create `src/audio.js`, `src/controls.js`; Modify `src/players.js` (import from them, remove moved code); Test `tests/controls.test.js`

**Produces (`src/controls.js`):**
- `CONTROL_IDS = { pause: 'ctl:pause', skip: 'ctl:skip', stop: 'ctl:stop', loop: 'ctl:loop', queue: 'ctl:queue' }`
- `formatDuration(sec) -> 'm:ss' | 'h:mm:ss'` (moved from players.js)
- `progressBar(elapsedSec, durationSec, width = 10) -> string` → `'1:23 ━━━●────── 3:12'`; when `durationSec` is null/0 → `'1:23'`
- `nextLoopMode(mode) -> mode` (off→track→queue→off)
- `buildControls({ paused, loopMode, disabled = false }) -> ActionRowBuilder[]` — one row, 5 buttons with the IDs above; ⏯️ label `Pause` or `Resume`; loop label `Loop: off|track|queue`; all disabled when `disabled`
- `nowPlayingContent({ track, elapsedSec, paused, pausedBy, loopMode, next }) -> string` — lines: `▶️ Now playing: **title**` (or `⏸️ Paused by **x**: **title**`), progress bar, `Requested by x`, `Up next: **title**` or `Up next: nothing`, plus `🔁 Loop: track|queue` when not off
- `queuePageContent({ current, queue, page }) -> string` — uses `queue.page(page)`; empty page → `"Page N is empty — the queue has M page(s)."`; empty queue and no current → the existing empty-queue text

**Produces (`src/audio.js`):** `makeAudioResource(pageUrl, volumePct, cfg)` and `MAX_MISSED_FRAMES` exactly as now in players.js; `defaultDeps.makeAudioResource` imports it.

- [ ] Write failing tests for every helper above with the spec's exact strings (progress bar at 50 % of 3:12 puts `●` in the middle; unknown duration shows elapsed only; `buildControls({paused:true, loopMode:'queue'})` → labels `Resume` and `Loop: queue`, IDs in order pause, skip, stop, loop, queue; `disabled:true` disables all 5)
- [ ] Run `npm test` → FAIL
- [ ] Implement `src/controls.js`; move audio code to `src/audio.js` (no behavior change)
- [ ] Run `npm test` → PASS (all 38 existing tests still green)
- [ ] Commit `refactor: split audio pipeline and control helpers out of players.js`

### Task 3: Player state — pause, loop, queue management

**Files:** Modify `src/players.js`; Test `tests/players-controls.test.js` (reuse the fake-deps style of `tests/players-flow.test.js`; fake audio player records `pause()`/`unpause()` calls and exposes an `idle()` trigger)

**Consumes:** Queue (Task 1). **Produces on `GuildPlayer`:**
- `get paused -> boolean`, `get pausedBy -> string|null`
- `pause(byTag) -> 'paused' | 'already-paused' | 'nothing-playing'` — calls `audio.pause(true)`, starts the silence timer
- `resume() -> 'resumed' | 'not-paused' | 'nothing-playing'` — `audio.unpause()`, clears the silence timer
- `get loopMode`, `setLoopMode(mode)`, `cycleLoopMode() -> mode`
- `shuffle() -> number` (Tracks shuffled), `removeAt(position) -> Track|null`, `clearQueue() -> number` (Tracks removed)
- `get elapsedSec -> number` (`resource.playbackDuration / 1000`, 0 when idle)
- `skip()` unchanged signature; now also ends a Pause and marks the Track as skipped for the loop logic

Advance rules (in `#playNext`, triggered by Idle): finished Track not skipped + mode `track` → play it again; mode `queue` → push the finished Track (skipped or not) to the end, then take the next; a Track whose download failed is never replayed or re-queued. Pause/loop state resets in `#leave()`.

- [ ] Write failing tests: pause → `paused === true`, fake `pause` called, second pause → `'already-paused'`; resume → `unpause` called; pause with nothing playing → `'nothing-playing'`; pause starts the silence timer and the timer firing leaves voice (inject a short timeout via settings fake `silenceTimeoutMin` and a fake clock or `mock.timers` from node:test); resume clears it; loop *track*: Idle replays t1; loop *track* + `skip()` → t2 plays; loop *queue*: after t1 ends, queue is [t2, t1]; failing Track with loop *track* → next Track plays and the failed one is not requeued; leave resets loop to off and paused to false; `clearQueue()` keeps `nowPlaying`; `removeAt`/`shuffle` delegate to the Queue
- [ ] Run `npm test` → FAIL
- [ ] Implement
- [ ] Run `npm test` → PASS
- [ ] Commit `feat: pause/resume, loop modes and queue management in the player`

### Task 4: Now-playing message lifecycle

**Files:** Modify `src/players.js`; Test `tests/players-controls.test.js`

**Consumes:** `buildControls`, `nowPlayingContent` (Task 2). **Produces on `GuildPlayer`:**
- `#announceNowPlaying` sends `{ content: nowPlayingContent(...), components: buildControls(...) }` and keeps the returned message
- `async refreshNowPlaying()` — edits the kept message with current state (used after pause/resume/loop)
- `async postNowPlaying(channel) -> boolean` — sends a fresh message to `channel` (for `/nowplaying`), disables the previous one; false when nothing is playing
- Disabling an old message = `message.edit({ components: buildControls({...state, disabled: true}) })`; every edit/send swallows rejections (Review Focus #5)
- `#leave()` disables the last message

- [ ] Write failing tests with a fake text channel whose `send` returns fake messages recording `edit` calls: second Track → first message edited with all buttons disabled; `postNowPlaying` → new message, old disabled; leave → last message disabled; `edit` that rejects does not throw or stop playback
- [ ] Run `npm test` → FAIL
- [ ] Implement
- [ ] Run `npm test` → PASS
- [ ] Commit `feat: now-playing message with controls; stale controls disabled`

### Task 5: Slash commands

**Files:** Create `src/commands/guard.js`, `pause.js`, `resume.js`, `nowplaying.js`, `shuffle.js`, `remove.js`, `clear.js`, `loop.js`; Modify `queue.js`, `skip.js`, `stop.js`, `play.js`, `index.js`; Test `tests/commands.test.js`

**Consumes:** player API (Tasks 3–4), `queuePageContent`, `progressBar`. **Produces:** `botChannelProblem(interaction, player) -> string|null` — `"Nothing is playing right now."` when the bot is not in voice, `"You're not in the bot's voice channel 🙂"` when the user is elsewhere, else null. `skip.js`/`stop.js` switch to it (same texts as today).

Command specs: `/pause`, `/resume`, `/shuffle`, `/clear` — no options; `/remove position:<int ≥1, required>`; `/loop mode:<choice off|track|queue, required>`; `/queue page:<int ≥1, optional>`; `/nowplaying` — calls `postNowPlaying(interaction.channel)` and replies ephemerally `"Posted below 👇"` (or `"Nothing is playing right now."`). `/play` appends `"\n⏸️ Playback is paused — press ▶️ to resume."` when the player is paused.

- [ ] Write failing tests: registry has exactly help, play, skip, stop, queue, volume, settings, pause, resume, nowplaying, shuffle, remove, clear, loop; `remove.position` min 1 and required; `loop.mode` choices exactly `['off','track','queue']`; `queue.page` min 1 optional; `botChannelProblem` returns the three outcomes for fake interaction/player pairs
- [ ] Run `npm test` → FAIL
- [ ] Implement
- [ ] Run `npm test` → PASS
- [ ] Commit `feat: pause, resume, nowplaying, shuffle, remove, clear, loop, queue pages`

### Task 6: Button handling

**Files:** Create `src/buttons.js`; Modify `src/index.js`; Test `tests/buttons.test.js`

**Consumes:** `CONTROL_IDS`, `botChannelProblem`, player API. **Produces:** `handleControlButton(interaction, ctx) -> Promise<void>`; `index.js` routes `interaction.isButton() && customId.startsWith('ctl:')` to it inside the same try/catch + log line as commands.

Behavior: guard fails → `reply({ content: problem, ephemeral: true })`. `ctl:pause` toggles pause/resume, then `interaction.update(...)` with the current Now-playing content/controls. `ctl:loop` cycles, then `update`. `ctl:skip` → `deferUpdate()` + `skip()`. `ctl:stop` → `update` with disabled controls and `"⏹️ Stopped by x"`, then `stop()`. `ctl:queue` → ephemeral `queuePageContent(page 1)`. All actions read the **current** player state (Review Focus #1).

- [ ] Write failing tests with fake interactions: user outside voice → ephemeral reply, player untouched; ⏯️ twice → paused then resumed, `update` called with label `Resume` then `Pause`; ⏯️ on a stale message while a newer Track plays toggles the current Track; 🔁 three times → track, queue, off; ⏹️ → player left and `update` got disabled controls; 📜 → ephemeral reply listing position 1; any button after the bot left → `"Nothing is playing right now."` ephemeral
- [ ] Run `npm test` → FAIL
- [ ] Implement
- [ ] Run `npm test` → PASS
- [ ] Commit `feat: control buttons on the now-playing message`

### Task 7: Maintenance fixes

**Files:** Modify every `src/commands/*.js` builder (`.setContexts(InteractionContextType.Guild)`), `src/index.js` (refuse `!interaction.inGuild()` with an ephemeral `"I only work inside servers."`), `src/config.js`; Create `.dockerignore`; Test `tests/commands.test.js`, `tests/config.test.js`

- [ ] Write failing tests: every command's `toJSON().contexts` deep-equals `[0]` (Guild); importing config with `CLIENT_ID` unset throws `CLIENT_ID is missing. Copy .env.example to .env and set your Application ID.` (run the import in a child process via `node --input-type=module -e` so the module cache of the other config test is untouched)
- [ ] Run `npm test` → FAIL
- [ ] Implement; `.dockerignore` lists `.env`, `cookies.txt`, `data`, `node_modules`, `.git`, `.superpowers`, `tests`, `docs`
- [ ] Run `npm test` → PASS; `docker build -t clicknow-discord-bot .` succeeds
- [ ] Commit `chore: guild-only commands, .dockerignore, readable CLIENT_ID error`

### Task 8: Docs, deploy, live check

**Files:** Modify `README.md`, `README.id.md` (command tables + "Controls" paragraph), `GLOSSARY.md` only if a term changed during implementation

- [ ] Verify: both READMEs mention every command name from the registry (`grep` each name)
- [ ] `docker compose up -d --build`; logs show `✅ 14 slash command(s) registered`
- [ ] Commit `docs: controls and new commands`; push
- [ ] Ask the owner to try ⏯️, 🔁, `/nowplaying`, `/queue page:2` in Discord (live voice cannot be tested from the server)
