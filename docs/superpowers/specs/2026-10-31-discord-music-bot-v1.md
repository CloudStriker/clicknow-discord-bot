# Spec: Discord Music Bot v1

Confirmed by the user after a full grilling session (2026-10-31). Source of truth for
the implementation plan.

## What it is

A **private** Discord music bot for the owner's servers. Plays **YouTube** audio into
voice channels via slash commands. Runs 24/7 on the owner's own VPS (this machine:
Ubuntu 22.04, 4 cores, 5.8 GB RAM), containerized with Docker. No Cloudflare, no PaaS.

## Decisions (user-confirmed)

| # | Area | Decision |
|---|---|---|
| 1 | Runtime | Docker + `docker-compose.yaml`; limits: `0.25 vCPU / 512 MB RAM / 1 GB memswap`; `restart: unless-stopped` |
| 2 | Language | Node **24** (Docker image `node:24-bookworm-slim`), **plain JavaScript (ESM, no TypeScript)**, commented for a new coder; host NVM Node 24.22 for local dev |
| 3 | Discord libs | discord.js ^14 + @discordjs/voice; ffmpeg (host has it; image installs it) |
| 4 | YouTube engine | **yt-dlp binary**, `pip install -U yt-dlp` at every container start (auto-update). **No cookies by default**; optional `YT_DLP_COOKIES` env var pointing at a cookies file, only used if YouTube flags the VPS IP |
| 5 | Source | YouTube only |
| 6 | Commands | `/play query [grab_limit: 20\|50\|100, default 20]`, `/skip`, `/stop`, `/queue`, `/volume (1–100)`, `/settings` (auto-leave on/off, silence timeout minutes). English UI |
| 7 | Queue | per-guild, in-memory, **max 100 tracks**, FIFO; `/play` appends, never interrupts |
| 8 | Playlists | playlist URL expands to the first **grab_limit** tracks (default 20) |
| 9 | Per-guild settings | stored in `settings.json` on disk (one entry per guild, survives restarts); defaults: auto-leave **on**, silence timeout **5 min**, volume **100** |
| 10 | Auto-leave | when on: leave immediately if the voice channel has no humans; leave after silence-timeout minutes when the queue goes empty |
| 11 | Volume | 1–100 %, applied at stream start; also adjustable live. Above 100 % explicitly out of scope (distortion); listeners can mix via Discord's per-user volume slider |
| 12 | Secrets | `.env` file only (`DISCORD_TOKEN`, `CLIENT_ID`, optional `YT_DLP_COOKIES`); never committed |
| 13 | Portal setup | **Guild Install only** (no User Install); scopes **bot** + **applications.commands**; permissions **3165184** (View Channels, Send Messages, Embed Links, Connect, Speak) |
| 14 | VCS | git repo here; pushed to `https://github.com/CloudStriker/discord-music-bot` (user creates the empty repo; no `gh` CLI) |
| 15 | Maintenance | target: low-touch ≥ 6 months. yt-dlp auto-updates; docs cover `git pull && docker compose up -d --build` update path |

## Out of scope for v1

SoundCloud/files/radio sources · seek · buttons/controls · queue persistence across restarts · stage channels · >100 % volume.

## Vocabulary

See `GLOSSARY.md` (Track, Queue, Player, Guild, Settings, Playlist, Grab limit, Volume).
