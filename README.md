# ClickNow-Discord-Bot — a self-hosted Discord music bot for YouTube

**ClickNow-Discord-Bot is a free, open-source Discord music bot that plays YouTube songs
and playlists in your server's voice channels.** You type `/play` and a song name or a
YouTube link, and the bot joins your voice channel and plays it. You host it yourself on
any small Linux server with Docker, so there are no premium tiers, ads or usage limits.

🇮🇩 [Baca dalam Bahasa Indonesia](README.id.md)

![Node.js 24](https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white)
![discord.js 14](https://img.shields.io/badge/discord.js-14-5865F2?logo=discord&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

---

## What it does

- 🎵 **Plays music from YouTube** using a song name, a video link or a whole playlist.
- ⏯️ **Interactive playback buttons & controls** on the Now-playing message: Pause/Resume, Skip, Stop, Loop mode, and quick Queue lookup.
- 🔂 **Looping & Queue management.** Loop the current song, loop the whole queue, shuffle, remove individual tracks by position, or clear the queue.
- 📜 **Keeps a queue** of up to 100 songs per server, so everyone can add songs.
- 📋 **Imports playlists.** Paste a playlist link and choose 20, 50 or 100 songs.
- 🔊 **Remembers volume and settings** separately for each server, even after a restart.
- 👋 **Leaves by itself** when everyone has left the voice channel or nothing has played
  for a while, so it doesn't sit idle in your channel.
- 🔒 **Works with Discord's end-to-end encrypted voice** (DAVE), which all voice
  channels have required since March 2026.
- 🛠️ **Needs little maintenance.** The YouTube downloader (yt-dlp) updates itself every
  time the bot starts.

## Commands

Type `/` in any channel of a server where the bot is installed to see these commands.

| Command | What it does |
|---|---|
| `/play <song name or link>` | Plays a song, or adds it to the queue if something is already playing. Accepts search words, a YouTube video link or a playlist link. |
| `/play <playlist link> grab_limit:50` | Takes the first 20 (default), 50 or 100 songs from a playlist. |
| `/pause` | Pauses playback of the current track. |
| `/resume` | Resumes playback of the paused track. |
| `/skip` | Skips to the next song in the queue. |
| `/stop` | Stops the music, clears the queue and leaves the voice channel. |
| `/loop <off\|track\|queue>` | Sets loop mode: `track` repeats current song, `queue` rotates the queue, `off` plays normally. |
| `/queue [page]` | Shows what's playing now and upcoming songs (10 songs per page). |
| `/nowplaying` | Posts a fresh Now-playing message with interactive control buttons. |
| `/shuffle` | Shuffles the waiting songs in the queue. |
| `/remove <position>` | Removes a waiting song by its position number in `/queue`. |
| `/clear` | Clears all waiting songs from the queue while keeping the current song playing. |
| `/volume <1–100>` | Sets the volume for this server. It is saved and takes effect from the next song. |
| `/settings` | Shows or changes the auto-leave setting (on/off) and the idle timeout (1–30 minutes). |
| `/help` | Lists all commands. |

> 💡 You must be **in a voice channel** before using `/play` or playback controls. The bot joins the channel you are in.
> To change how loud the bot is **for you only**, right-click the bot in the voice channel
> and use **User Volume**.

## Interactive Controls

Every time a song starts playing (or when you use `/nowplaying`), the bot posts a Now-playing message with interactive buttons:

- ⏯️ **Pause / Resume:** Toggles playback. While paused, the idle leave timer counts down so the bot won't sit idle forever.
- ⏭️ **Skip:** Skips immediately to the next song in the queue.
- ⏹️ **Stop:** Stops playback, clears the queue, disables the buttons, and leaves voice.
- 🔁 **Loop:** Cycles loop mode (`off` → `track` → `queue` → `off`). The button label updates to reflect the active mode.
- 📜 **Queue:** Displays page 1 of the queue in a private (ephemeral) message only you can see.

> 👥 **No DJ role needed:** Everyone in the bot's voice channel can click the buttons or use control commands.

---

## FAQ

### Is this bot free?
Yes. The code is MIT-licensed. You only pay for the server it runs on, and a small one
is enough.

### What do I need to host my own Discord music bot?
You need a computer or VPS that stays on 24/7 and can run Docker, plus a free Discord
bot token. The bot only makes **outbound** connections, so you don't have to open any
ports.

### How much RAM and CPU does it need?
Very little. The container is limited to **0.25 vCPU and 512 MB RAM**. It uses about
85 MB when idle. Audio is encoded by native ffmpeg (libopus), so one stream uses only a
few percent of a CPU core.

### Can I run it on Cloudflare Workers, Vercel or other serverless platforms?
No. Discord voice needs a long-running process that sends audio over **UDP** every
20 ms, and serverless platforms can't do that. Use a VPS, a home server or a Raspberry
Pi instead.

### Does it need YouTube cookies or a YouTube account?
Usually not. If YouTube blocks your server's IP (the logs will say *"Sign in to confirm
you're not a bot"*), you can give it cookies from your browser. See
[YouTube cookies](#youtube-cookies-only-if-needed).

### Can it play Spotify or SoundCloud?
Not yet. Version 1 supports YouTube only.

### The bot joins and shows the green speaking ring, but nobody hears anything. Why?
Since March 2026, Discord requires end-to-end encrypted voice (DAVE). This bot uses
`@discordjs/voice` 0.19 with `@snazzah/davey`, which supports it. If you still hear
nothing, set `VOICE_DEBUG=1` in `.env`, restart the bot and check
`docker compose logs -f`.

---

## Setup guide

You will need about **15 minutes**, a Linux server with
[Docker](https://docs.docker.com/engine/install/), and a Discord account.

### Step 1: Create the bot on Discord

1. Open the [Discord Developer Portal](https://discord.com/developers/applications), click
   **New Application**, enter a name and click **Create**.
2. Go to **Installation** and set **Install behavior** to **Guild Install** only. Leave
   **User Install** off, because a music bot has to be in a server to join voice.
3. Go to **Bot**, click **Reset Token**, then **Copy**. This is your `DISCORD_TOKEN`. It
   is shown only once.
   ⚠️ The token is a password for your bot, so never share it. A real token is about 70
   characters long and contains **two dots**. A shorter value without dots is the
   *Client Secret*, which is the wrong one.
4. Go to **General Information** and copy the **Application ID**. This is your `CLIENT_ID`.
5. Go to **OAuth2 → URL Generator**:
   - Scopes: ✅ `bot` and ✅ `applications.commands`.
   - Bot permissions: **View Channels**, **Send Messages**, **Embed Links**, **Connect**
     and **Speak**. The permission integer is `3165184`.
   - Open the generated link and add the bot to your server.

### Step 2: Run it on your server

```bash
git clone https://github.com/CloudStriker/clicknow-discord-bot.git
cd clicknow-discord-bot
cp .env.example .env
nano .env                      # paste DISCORD_TOKEN and CLIENT_ID (no quotes)
docker compose up -d --build   # build and start; restarts automatically after reboots
docker compose logs -f         # watch it start (Ctrl+C stops watching, the bot keeps running)
```

When the logs show `✅ Logged in as …` and `✅ 14 slash command(s) registered`, go to
Discord, join a voice channel and type `/play never gonna give you up` 🎉

The slash commands register automatically every time the bot starts. The very first
time, Discord can take a few minutes to show them.

### Everyday commands

```bash
docker compose logs -f                      # live logs
docker compose restart                      # restart the bot
docker compose down                         # stop the bot
git pull && docker compose up -d --build    # update to the latest version
```

### Does the bot start again by itself?

Yes. `docker-compose.yaml` uses `restart: unless-stopped`, so the bot always comes back
**unless you stopped it yourself**.

| What happens | Bot comes back automatically? |
|---|---|
| The bot crashes | ✅ Yes |
| The server reboots or loses power | ✅ Yes, as long as Docker starts at boot (`sudo systemctl enable docker`) |
| Docker is restarted or updated | ✅ Yes |
| You ran `docker compose stop` or `docker compose down` | ❌ No, it stays off (even after a reboot) until you run `docker compose up -d` |

### YouTube cookies (only if needed)

1. Export your YouTube cookies with a browser extension (for example
   "Get cookies.txt LOCALLY") and save the file as `cookies.txt` next to
   `docker-compose.yaml`.
2. In `docker-compose.yaml`, uncomment the line `- ./cookies.txt:/app/cookies.txt:ro`.
3. In `.env`, set `YT_DLP_COOKIES=/app/cookies.txt`.
4. Run `docker compose up -d`.

Use a secondary Google account, because cookies give the bot access to that account.

### Configuration (`.env`)

| Variable | Required | Meaning |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | Bot token (Developer Portal → Bot) |
| `CLIENT_ID` | ✅ | Application ID (Developer Portal → General Information) |
| `YT_DLP_COOKIES` | – | Path to a cookies file, only if YouTube blocks your IP |
| `VOICE_DEBUG` | – | Set to `1` to log the voice connection in detail (for troubleshooting) |

Per-server settings (volume, auto-leave, timeout) are saved in `data/settings.json`.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Logs show `TokenInvalid` | You pasted the wrong value. Reset the token in the **Bot** tab and paste it again, without quotes. |
| `/play` doesn't appear in Discord | Wait a few minutes after the first start. If it still doesn't appear, invite the bot again with the `applications.commands` scope. |
| "Join a voice channel first" | Join a voice channel, then use `/play`. |
| 🔒 "I don't have permission to play in …" (private channels) | Open the voice channel's settings → **Permissions** → add the bot (or its role) and allow **View Channel**, **Connect** and **Speak**. |
| A song is skipped with "Couldn't play" | Run `docker compose restart` to update yt-dlp. If the logs mention signing in, see [YouTube cookies](#youtube-cookies-only-if-needed). |
| The bot is in voice but silent | Set `VOICE_DEBUG=1` in `.env`, run `docker compose up -d` and check the logs. |
| The bot shows as offline | Run `docker compose ps`, then `docker compose logs --tail 50`. |

---

## For developers

**Stack:** Node.js 24 (plain JavaScript, ESM) · discord.js 14 · @discordjs/voice 0.19
(DAVE) · yt-dlp · ffmpeg (libopus) · Docker. Tests use the built-in `node:test`.

```
/play ──► src/commands/play.js ──► src/ytdlp.js (find the video)
                                        │
                                        ▼
                    src/players.js  (one player per server: queue, timers)
                                        │
             yt-dlp (download) ──► ffmpeg (volume + Opus) ──► Discord voice (UDP, E2EE)
```

```bash
nvm use 24
pip install yt-dlp       # ffmpeg with libopus must also be installed
npm install
npm test                 # unit tests (node:test)
npm run dev              # run locally with auto-restart
```

| Path | Purpose |
|---|---|
| `src/index.js` | Starts the bot, registers commands, routes events |
| `src/commands/` | One file per slash command |
| `src/players.js` | Voice engine: queue, playback, auto-leave |
| `src/ytdlp.js` | YouTube search and stream lookup through yt-dlp |
| `src/settings.js` | Per-server settings saved to disk |
| `GLOSSARY.md` | Project vocabulary (Track, Queue, Player…) |
| `docs/` | Original design spec and implementation plan |

## Disclaimer

This project is not affiliated with Discord or YouTube. Use it on your own servers and
follow YouTube's Terms of Service and the copyright rules in your country.

## License

[MIT](LICENSE) © 2026 CloudStriker / ClickNow
