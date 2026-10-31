# GLOSSARY

**Track** — a single YouTube video (or its audio) selected to be played. Has a title, URL, duration, and requested-by user.

**Queue** — the ordered list of Tracks waiting to be played in one server. There is exactly one Queue per server (guild). The currently playing Track is the head of the Queue; it is not a separate concept from the Queue.

**Player** — the thing that takes the Track at the head of the Queue and turns it into audio packets sent to a Discord voice channel. One Player per server.

**Voice connection** — the bot's live link to a voice channel (gateway + UDP). Joining a channel creates one; leaving destroys it.

**Play (command)** — adds a Track to the end of the Queue and joins a voice channel if the bot is not already in one. It never means "play immediately, interrupting the current Track."

**Skip** — discards the Track currently at the head of the Queue and starts the next one.

**Stop** — clears the Queue and leaves the voice channel.

**Stream source** — where Track audio comes from: YouTube only, in v1.

**Guild** — one Discord server. Nearly everything in the bot is scoped per Guild: its Queue, its Player, its Settings.

**Settings** — per-Guild configuration that persists across restarts, changeable by commands (v1: auto-leave behavior, Volume). Lives on the bot's own disk; one entry per Guild.

**Playlist** — a YouTube playlist URL pasted to Play. It expands into up to **Grab limit** the user chooses (default 20, options 20/50/100); those Tracks join the Queue. The Playlist itself is never stored.

**Grab limit** — how many Tracks to take from a Playlist. Keyword for Q2 of round 3; the user-facing word in commands may be different.

**Volume** — the per-Guild gain applied while streaming: 1–100 %, where 100 means full loudness of the source. Anything above 100 is digital amplification (distorts) and is out of scope in v1.
