# Discord Music Bot v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private Discord bot that plays YouTube audio in voice channels via slash commands, with per-guild settings, deployed on the owner's VPS through Docker.

**Architecture:** Node 24 ESM app. `src/index.js` boots a discord.js client; `src/players.js` keeps one `GuildPlayer` per guild (queue + VoiceConnection + AudioPlayer + leave timers); `src/ytdlp.js` shells out to the yt-dlp binary for YouTube discovery and audio-URL resolution; `src/settings.js` persists per-guild settings to one JSON file.

**Tech Stack:** JavaScript (ESM, no TS) · discord.js ^14 · @discordjs/voice ^0.18 · yt-dlp binary (pip-installed inside the container, auto-updated at start) · ffmpeg · node:test (built in) · Docker (node:24-bookworm-slim + ffmpeg).

**Spec:** `docs/superpowers/specs/2026-10-31-discord-music-bot-v1.md`

## Global Constraints

- Node `>=24`, `"type": "module"`, plain JavaScript with JSDoc comments for a new coder. No TypeScript, no build step.
- Runtime deps only: `discord.js`, `@discordjs/voice`, `dotenv` (add `@noble/hashes`/`@noble/ciphers` only if @discordjs/voice at install time requires an encryption fallback).
- Tests use `node --test tests/` (node:test, built in — no test deps).
- Queue max **100** tracks. Playlist grab default **20**, choices **20/50/100**. Volume **1–100**, default **100**. Auto-leave default **on**, silence timeout default **5 min**.
- Secrets only in `.env`; `.env`, `data/settings.json`, `cookies.txt`, `node_modules/` are git-ignored.
- docker-compose limits exactly: `cpus: "0.25"`, `mem_limit: 512m`, `memswap_limit: 1g`, `restart: unless-stopped`.
- yt-dlp is auto-updated at every container start (`pip install -U yt-dlp`). No cookies by default.
- All user-facing strings in English.

## Review Focus

Failure modes the spec implies but no unit test fully exercises; each gets the closest pinning test in its owning task:

1. **yt-dlp can't resolve/serve a stream URL** (YouTube changes, expiry): the bot logs it, tells users in the command channel, advances to the next Track — the container and Queue must never die. Pinned in Task 5 step-flow: `playNext` catches resolution errors and calls `advance()` (unit: queue advances when `resolve` throws — mock-styled).
2. **Empty search / unreachable URL in `/play`**: friendly "Nothing found" reply, no crash. Pinned in Task 3 test: `discover` rejects with a typed `YtDlpError` for exit!=0.
3. **Corrupt `settings.json`**: startup falls back to defaults, keeps running. Pinned in Task 2 test.
4. **Voice channel has zero humans** while auto-leave on → bot leaves within ~1 min, not only on events. Pinned in Task 5: housekeeping interval calls `maybeLeaveEmpty`.

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | scripts (`start`, `dev`, `deploy-commands`, `test`), engines >=24 |
| `.gitignore`, `.env.example` | secrets hygiene, env template |
| `src/config.js` | loads `.env`; exports `{ token, clientId, settingsPath, ytDlpPath, cookiesFile }`; throws a readable error if `DISCORD_TOKEN` missing |
| `src/settings.js` | `SettingsStore` class: per-guild merged settings, atomic debounced save, corrupt-file fallback |
| `src/ytdlp.js` | yt-dlp wrapper: `classifyInput`, `discover`, `getStreamUrl`; typed `YtDlpError`; pure helpers exported for tests |
| `src/queue.js` | `Queue` class (pure): capped FIFO, `push/shift/clear/peek` |
| `src/players.js` | `GuildPlayers` manager: join/play/skip/stop/volume, silence & empty-channel timers, error-advance flow |
| `src/commands/*.js` | one module per slash command, exports `{ data: SlashCommandBuilder, execute(interaction, ctx) }` |
| `src/commands/index.js` | command registry + shared reply helpers |
| `src/deploy-commands.js` | global slash-command registration (REST) |
| `src/index.js` | bootstrap: client + intents + event wiring + housekeeping interval |
| `Dockerfile`, `docker-entrypoint.sh`, `docker-compose.yaml` | runtime container; yt-dlp auto-update at start |
| `README.md` | portal walkthrough (Guild Install, scopes, `permissions=3165184`), local dev, VPS deploy, update path, cookies FAQ |
| `tests/*.test.js` | node:test suites per pure unit |

**Track shape** (consumed across tasks): `{ url: string /* webpage URL */, title: string, durationSec: number|null, requesterTag: string }`

---

### Task 1: Scaffold + config

**Files:** Create `package.json`, `.gitignore`, `.env.example`, `src/config.js`; Test `tests/config.test.js`

**Interfaces (produces):** `import config from '../src/config.js'` → `{ token: string, clientId: string, settingsPath: string /* default 'data/settings.json' */, ytDlpPath: string /* default 'yt-dlp' */, cookiesFile: string|null }`

- [ ] Write the failing test: with `DISCORD_TOKEN=x`, `CLIENT_ID=y` set, config exposes those values, `settingsPath === 'data/settings.json'`, `ytDlpPath === 'yt-dlp'`, `cookiesFile === null` (from `YT_DLP_COOKIES` unset)
- [ ] Run `npm test` → FAIL (module not found)
- [ ] Write `src/config.js` per interface; throw `new Error('DISCORD_TOKEN is missing. Copy .env.example to .env and set your bot token.')` when absent
- [ ] Run `npm test` → PASS
- [ ] git: `git init`, local repo config `user.name=CloudStriker`, `user.email=CloudStriker@users.noreply.github.com`, add remote `https://github.com/CloudStriker/discord-music-bot.git`, commit `chore: scaffold project and config`

### Task 2: Settings store

**Files:** Create `src/settings.js`; Test `tests/settings.test.js`

**Interfaces (produces):** `new SettingsStore(path)`; `get(guildId) -> { autoLeaveOn: boolean, silenceTimeoutMin: number, volume: number, guildId: string }`; `set(guildId, partial)` (validates volume 1–100 int, silenceTimeoutMin 1–30 int). `DEFAULTS = { autoLeaveOn: true, silenceTimeoutMin: 5, volume: 100 }`

- [ ] Write failing tests in a temp dir: (a) fresh store → defaults; (b) `set(g,{volume:60})` then **new** store instance reads 60 (persistence); (c) file pre-filled with `"not json"` → `get` returns defaults and a later `set` rewrites valid JSON; (d) clamps invalid `silenceTimeoutMin: 99` to 30 and `volume: 0` to 1
- [ ] Run `npm test` → FAIL
- [ ] Implement: merge DEFAULTS, tail hook via `process.on('exit')`. Inline override for tests: `store._flush()` writes {tmp, rename} synchronously
- [ ] Run `npm test` → PASS
- [ ] Commit `feat: per-guild settings store`

### Task 3: yt-dlp wrapper

**Files:** Create `src/ytdlp.js`; Test `tests/ytdlp.test.js`

**Interfaces (produces):**
- `classifyInput(text) -> { kind: 'search' } | { kind: 'track', url } | { kind: 'playlist', url }` — YouTube URL regex covers `youtube.com/watch?v=`, `youtu.be/<id>`, `music.youtube.com`, `/playlist?list=`; `list=` → playlist; any non-YouTube URL → search
- `parseYtDlpLines(stdout) -> object[]` (one JSON per line, skip blank/garbage lines) — pure, exported for tests
- `async discover(classified, { grabLimit = 20, requesterTag, cookiesFile }) -> Track[]` — search: `yt-dlp -j --no-warnings "ytsearch1:<text>"` (1 line = 1 track); track: `-j --no-warnings --no-playlist <url>`; playlist: `-J --flat-playlist --playlist-end <grabLimit> <url>`, entries → webpage URLs (`entry.url` or `https://www.youtube.com/watch?v=` + `entry.id`)
- `async getStreamUrl(webpageUrl, cookiesFile) -> { streamUrl: string, title: string }` — `-j --no-warnings --no-playlist -f bestaudio/best`
- `YtDlpError` (subclass of Error) thrown on non-zero exit
- [ ] Write failing tests: classifyInput over the 6 input classes above; parseYtDlpLines over 2 good lines + 1 garbage line; YtDlpError instanceof Error
- [ ] Run `npm test` → FAIL
- [ ] Implement (execFile wrapper with 30 s timeout; argv arrays only — never interpolate into a shell string)
- [ ] Run `npm test` → PASS
- [ ] Commit `feat: yt-dlp wrapper for discovery and stream URLs`

### Task 4: Queue (pure)

**Files:** Create `src/queue.js`; Test `tests/queue.test.js`

**Interfaces (produces):** `new Queue(maxSize = 100)`; `push(track) -> number added` (pushes until cap, never partial-adds silently — returns count); `shift() -> Track|null`; `clear()`; `length`; `head -> Track|null`

- [ ] Write failing tests: FIFO order; pushing 105 into empty (max 100) adds exactly 100 and returns 100; `shift` on empty → null; `clear` empties
- [ ] Run `npm test` → FAIL
- [ ] Implement
- [ ] Run `npm test` → PASS
- [ ] Commit `feat: capped FIFO queue`

### Task 5: GuildPlayers (voice engine)

**Files:** Create `src/players.js`; Test `tests/players.test.js`

**Interfaces (consumes):** `Queue` (Task 4), `SettingsStore` (Task 2), `getStreamUrl` (Task 3). **Produces:** `new GuildPlayers(client, settings, config)`; `for(guild) -> GuildPlayer`; `async enqueue(interaction, tracks) -> { nowPlaying: string|null, added: number }`; `async skip(guildId) -> boolean`; `stop(guildId)` (clears queue, leaves); `async setVolume(guildId, percent)`; `onVoiceUpdate(oldState, newState)`.

`GuildPlayer` internals (spec-pinned): join requester's channel on first enqueue via `VoiceConnection.join(channel, { selfDeaf: true })`, subscribe an `AudioPlayer`; play = `getStreamUrl` → `createAudioResource(streamUrl, { inlineVolume: true })`, volume = settings/100; **on resolve/play error: reply to the store's `lastNotificationChannelId` and advance** (Review Focus #1); on `'idle'` + empty queue → start silence timer (`silenceTimeoutMin`); 60 s housekeeping: `maybeLeaveEmpty` (no humans → leave) when auto-leave on.

- [ ] Write a smoke test: module exports `GuildPlayers` as a class with the six methods on its prototype
- [ ] Run `npm test` → FAIL
- [ ] Implement (single file, ~300 lines, sectioned comments: state / connection / playback / timers / voice events)
- [ ] Run `npm test` → PASS and `node --check src/players.js`
- [ ] Commit `feat: per-guild voice player with queue, timers, error-advance`

### Task 6: Slash commands + registration + bootstrap

**Files:** Create `src/commands/play.js`, `skip.js`, `stop.js`, `queue.js`, `volume.js`, `settings.js`, `index.js`, `src/deploy-commands.js`, `src/index.js`; Test `tests/commands.test.js`

**Interfaces (consumes):** `config` (1), `SettingsStore` (2), `GuildPlayers` (5), command ctx `{ players, settings, config }` built in `src/commands/index.js`.

Command specs: `play` opts `query` (string, required), `grab_limit` (int, choices 20/50/100, default 20) — rejects when the invoker is not in a voice channel; `volume` opt `level` int 1–100; `settings` opts `leave` choice on/off, `timeout` int 1–30, optional, shows current values when none given; `queue` lists head + up to 9 more; `/skip`, `/stop` require being in the bot's voice channel.

- [ ] Write failing tests: every command module exports `data` (name set correctly) and `execute`; `play.grab_limit` choices are exactly [20,50,100] with default 20; `volume` min 1 max 100; `settings.timeout` min 1 max 30
- [ ] Run `npm test` → FAIL
- [ ] Implement command modules, registry (`REST` `Routes.applicationCommands(clientId)` PUT), and `src/index.js` (intents `Guilds` + `GuildVoiceStates`; `interactionCreate` dispatch with try/catch reply; `voiceStateUpdate` → `players.onVoiceUpdate`; 60 s `setInterval` housekeeping kept on the manager; `uncaughtException`/`unhandledRejection` → log, don't exit)
- [ ] Run `npm test` → PASS; `node --check src/index.js src/deploy-commands.js`
- [ ] Commit `feat: slash commands and client bootstrap`

### Task 7: Docker

**Files:** Create `Dockerfile`, `docker-entrypoint.sh` (executable), `docker-compose.yaml`

`Dockerfile`: `node:24-bookworm-slim` → apt `ffmpeg python3 pipx` → `npm ci --omit=dev` → copy `src/`. `entrypoint`: pip install -U yt-dlp (via pipx, matching Debian 12 PEP 668) → `exec node src/index.js`. Compose per Global Constraints + volume `./data:/app/data`; commented-out optional cookies mount (`./cookies.txt:/app/cookies.txt:ro`, then `YT_DLP_COOKIES=/app/cookies.txt`).

- [ ] `docker compose config` exits 0
- [ ] `docker build -t discord-music-bot .` succeeds
- [ ] Commit `build: dockerized runtime with yt-dlp auto-update`

### Task 8: README + final pull

**Files:** Modify none; Create `README.md`

Sections: Overview (what it does / what it needs) · **Create the Discord app** (Developer Portal → New Application → Bot → reset+copy token; **Installation: Guild Install only, enable "User Install" stays off**; OAuth2 URL generator: scopes `bot` + `applications.commands`, permission integer `3165184`, open the URL once) · Local dev (nvm use 24, `pip install yt-dlp` for the host, then `npm install`, `npm run deploy-commands`, `npm start`) · VPS deploy (`cp .env.example .env`, fill in, `docker compose up -d --build`, `docker compose logs -f`) · Update path (`git pull && docker compose up -d --build`) · yt-dlp auto-update & the optional cookies explainer (when YouTube flags the VPS IP) · Command list table · Settings persistence (`data/settings.json`) · Architecture ASCII diagram (client → interactions → GuildPlayer → yt-dlp/ffmpeg → voice UDP).

- [ ] Verify: README contains the exact strings `3165184`, `Guild Install`, `docker compose up -d --build`, `YT_DLP_COOKIES`
- [ ] Commit `docs: README with portal, local dev, VPS deploy`
- [ ] Push instructions (user creates empty repo at github.com/CloudStriker → `git push -u origin main` — credentials via HTTPS token or SSH; cannot be done from this session)
