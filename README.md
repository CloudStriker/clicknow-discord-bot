# ClickNow-Discord-Bot

A private Discord bot that plays **YouTube** audio in voice channels from slash commands.
Designed to run 24/7 on your own VPS in Docker, with per-guild settings and an
auto-updating yt-dlp so it stays low-maintenance for months.

> **Spec / decisions:** `docs/superpowers/specs/2026-10-31-discord-music-bot-v1.md`
> **Terms** (Track, Queue, Player, …): `GLOSSARY.md`

---

## What it needs to run

| Requirement | Why |
|---|---|
| A Docker-capable server (this repo was built on Ubuntu 22.04) | the bot must stay online 24/7 and open **outbound UDP** (Discord's voice servers) |
| A Discord bot token | from the [Developer Portal](https://discord.com/developers/applications) — walkthrough below |
| Outbound HTTPS + UDP | everything the bot does is outbound; **no ports need to be opened** |

Not possible on **Cloudflare/Worker-style serverless**: voice audio needs real
UDP sockets and steady CPU — a long-running process is required.

---

## Create the Discord app (5 minutes)

1. Go to <https://discord.com/developers/applications> → **New Application** → name it → **Create**.
2. **Configuration → Installation**:
   - **Install behavior for your app:** `Guild Install` (guilds = servers — the only kind that can join voice).
   - Leave **`User Install` OFF** — user-installed commands can't join voice channels.
3. **Bot tab**: click **Reset Token** → **Copy** (you only see it once — paste it in `.env` below).
   - Keep *Public Bot* off if you want only you to invite it.
4. **OAuth2 tab → OAuth2 URL Generator**:
   - Scopes: ✅ `bot` ✅ `applications.commands`
   - Bot Permissions: tick **View Channels**, **Send Messages**, **Embed Links**, **Connect**, **Speak**
     (this is permission integer **3165184**).
   - Copy the generated URL, open it in a browser, add the bot to your server.
5. Copy the **Application ID** (General Information → Application ID) — that's `CLIENT_ID`.

---

## Deploy on the VPS

```bash
cp .env.example .env         # then paste DISCORD_TOKEN and CLIENT_ID into .env
docker compose up -d --build # build + start, stays up across reboots
docker compose logs -f       # watch startup; Ctrl+C leaves it running
```

The container auto-updates **yt-dlp** at every start, then runs the bot and registers
the slash commands. First launch logs `✅ Logged in as <name>` — then `/play` works in Discord
(commands can take a few minutes to appear the very first time).

**Useful commands**

```bash
docker compose logs -f            # live logs
docker compose restart            # bounce the bot
docker compose down               # stop
git pull && docker compose up -d --build   # update the code
```

**Resource limits** (set in `docker-compose.yaml`): `0.25 vCPU / 512 MB RAM / 1 GB swap`
— sized for one bot streaming to a couple of channels on this 4-core/5.8 GB host.

## Run locally for development

```bash
nvm use 24            # Node 24
pip install yt-dlp    # the host needs the same yt-dlp the container gets
npm install
npm run deploy-commands
npm start             # or: npm run dev (auto-restart on edits)
npm test              # unit tests (node:test)
```

---

## Commands

| Command | What it does |
|---|---|
| `/play <query> [grab_limit]` | Play search text, a video URL, or a playlist URL. Playlists grab `20/50/100` (default 20) tracks |
| `/skip` | Skip the current track |
| `/stop` | Clear the queue and leave voice |
| `/queue` | Show what's playing and what's next |
| `/volume <1–100>` | Volume for this server (saved; 100 = full clean loudness). Listeners can also mix per-user: right-click the bot in voice → *User Volume* |
| `/settings [leave:<on/off>] [timeout:<1–30>]` | Auto-leave behavior for this server (saved) |

**Auto-leave (default on, 5 min):** the bot leaves when everyone leaves the channel,
or when the queue has been silent for the timeout.

**Per-guild settings** (auto-leave, silence timeout, volume) persist in `data/settings.json`
— one entry per server, survives restarts, never committed.

---

## yt-dlp & cookies (FAQ)

- The bot never stores YouTube audio; it resolves a stream URL with **yt-dlp** right before each track.
- yt-dlp **auto-updates at every container start**, so YouTube's constant changes stay handled by the yt-dlp community.
- If you ever see *"Sign in to confirm you're not a bot"* in the logs, YouTube is
  challenging this server's IP:
  1. Export cookies from your browser with a cookies extension → save as `cookies.txt` next to `docker-compose.yaml`
  2. Uncomment the cookies line in `docker-compose.yaml`
  3. In `.env`, set `YT_DLP_COOKIES=/app/cookies.txt`
  4. `docker compose up -d --restart`

## Architecture

```
Discord slash commands
        │  (interactions over HTTPS, via the Gateway WebSocket)
        ▼
src/index.js ──src/commands/*.js──► src/players.js  (one GuildPlayer per guild)
                                        │           queue → yt-dlp → ffmpeg → Opus
                                        ▼             packets every 20 ms
                              data/settings.json     (voice WebSocket + UDP, outbound)
                              (per-guild, saved)
```

The container is limited to `0.25 vCPU / 512 MB RAM / 1 GB swap`; a single audio stream
uses ~0.1–0.3 vCPU, so one channel plays comfortably and 2–4 streams fit in bursts.

## Troubleshooting

- **Bot online but `/play` missing** → run `npm run deploy-commands` again (inside the repo) or wait; Discord can be slow.
- **"Join a voice channel first"** → expected: the bot joins the channel the command-sender is in.
- **Playback failures mentioning yt-dlp** → check `docker compose logs -f`; if it says the `YT_DLP_COOKIES` story above, set cookies. Otherwise a quick `docker compose restart` re-runs the auto-update, which usually fixes new YouTube changes.
- **Bot tag shows offline** → `docker compose ps` then `docker compose logs --tail 50`.

## License

MIT — private bot, use freely.
