# Spec: Playback controls (v1.1)

Agreed with the owner in a grilling session on 2026-11-01. Vocabulary follows
`GLOSSARY.md` (Queue, Current Track, Pause, Loop mode, Shuffle, Clear,
Now-playing message, Controls).

## Why

The bot is used in two servers by several people. Today the only controls are
`/skip`, `/stop` and `/queue` (first 9 entries), there is no pause, and nothing
can be managed inside the Queue. The goal is everyday control without typing,
plus basic Queue management.

## Decisions

| # | Area | Decision |
|---|---|---|
| 1 | Who may control | Everyone. No DJ role. Controls and control commands require being in the bot's voice channel (same rule as `/skip` today). |
| 2 | Controls | Discord **buttons** (not reactions) on the Now-playing message, one row: ⏯️ Pause/Resume, ⏭️ Skip, ⏹️ Stop, 🔁 Loop (cycles off → track → queue; label shows the active mode), 📜 Queue. |
| 3 | Stale controls | Only the newest Now-playing message has working Controls; posting a new one disables the previous one. When the bot leaves voice (stop, auto-leave, kicked), the last one is disabled too. |
| 4 | Button feedback | Pressing a button edits the same Now-playing message (e.g. "⏸️ Paused by cinnamon.wool"); no new chat message. 📜 replies privately (ephemeral). Someone not in the bot's voice channel gets a private "join the bot's voice channel" reply. |
| 5 | `/pause`, `/resume` | Added. Pause counts as silence: the auto-leave silence timeout runs while paused and Resume cancels it. `/resume` when not paused gets a friendly reply. |
| 6 | `/nowplaying` | Posts a new Now-playing message at the bottom of the chat with live Controls (old one disabled): title, requester, progress bar `1:23 ━━━●──── 3:12`, next Track. Tracks without a duration show elapsed time only. |
| 7 | `/shuffle` | Shuffles the Queue only; the Current Track is untouched. |
| 8 | `/remove <position>` | Position numbering is the same as `/queue` (1 = next Track). Out-of-range positions get a friendly reply. |
| 9 | `/queue page:<n>` | 10 Tracks per page; an empty page gets a friendly reply. |
| 10 | `/clear` | Empties the Queue; the Current Track keeps playing and the bot stays in voice. `/stop` is unchanged. |
| 11 | `/loop <off\|track\|queue>` | Per Guild, in memory, resets to off when the bot leaves voice. *track* replays the Current Track; *queue* puts each finished Track back at the end of the Queue. `/skip` always moves on (in *queue* mode the skipped Track stays in the rotation). |
| 12 | Loop + failures | A Track that fails to download is never looped: in *track* mode playback moves on with "Couldn't play"; in *queue* mode it is dropped from the rotation. |
| 13 | Loop gap | Each repetition re-downloads through yt-dlp (≈5–15 s of silence between repeats). Accepted for v1.1. |
| 14 | `/play` while paused | Adds the Track, stays paused, and the reply says "⏸️ Playback is paused — press ▶️ to resume". |
| 15 | `/skip` while paused | Plays the next Track (Pause ends). |
| 16 | Maintenance | Commands are guild-only (DM use is refused, so no junk `settings.json` entries); add `.dockerignore`; missing `CLIENT_ID` gives a readable startup error. |
| 17 | UI language | English, like the existing commands. `/help` and README (EN + ID) list the new commands. |

## Out of scope

`/play` autocomplete · live volume · `/seek` · Spotify links · saved playlists ·
24/7 mode · DJ role · vote skip.

## Constraints carried over from v1

Node 24 plain JavaScript (ESM) · discord.js 14 · @discordjs/voice 0.19 (DAVE) ·
Docker limits 0.25 vCPU / 512 MB · Queue max 100 · tests with `node:test`.
