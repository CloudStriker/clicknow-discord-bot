# GLOSSARY

**Track** — a single YouTube video (or its audio) selected to be played. Has a title, URL, duration, and requested-by user.

**Queue** — the ordered list of Tracks *waiting* to be played in one server. There is exactly one Queue per server (guild). The Current Track is not part of the Queue: position 1 of the Queue is the *next* Track.

**Current Track** — the Track the Player is playing (or holding Paused) right now. Separate from the Queue.

**Player** — the thing that takes the Track at the head of the Queue and turns it into audio packets sent to a Discord voice channel. One Player per server.

**Voice connection** — the bot's live link to a voice channel (gateway + UDP). Joining a channel creates one; leaving destroys it.

**Play (command)** — adds a Track to the end of the Queue and joins a voice channel if the bot is not already in one. It never means "play immediately, interrupting the current Track."

**Skip** — ends the Current Track and starts position 1 of the Queue. Skip always moves on, even in Loop mode *track*, and it ends a Pause.

**Stop** — clears the Queue, ends the Current Track and leaves the voice channel.

**Clear** — empties the Queue only; the Current Track keeps playing and the bot stays in voice.

**Pause** — the Current Track is held mid-song; Resume continues it. A Pause counts as silence for the auto-leave timeout. Adding Tracks does not end a Pause.

**Loop mode** — per-Guild, not saved, resets to *off* when the bot leaves voice. *off*: play each Track once. *track*: replay the Current Track. *queue*: a finished Track goes back to the end of the Queue. A Track that fails to play is never looped.

**Shuffle** — randomizes the order of the Queue; the Current Track is untouched.

**Now-playing message** — the message the bot posts when a Track starts, carrying the Controls. Only the newest one has working Controls; older ones are disabled.

**Controls** — the buttons on the Now-playing message: Pause/Resume, Skip, Stop, Loop mode, Queue. Usable only by people in the bot's voice channel.

**Stream source** — where Track audio comes from: YouTube only, in v1.

**Guild** — one Discord server. Nearly everything in the bot is scoped per Guild: its Queue, its Player, its Settings.

**Settings** — per-Guild configuration that persists across restarts, changeable by commands (v1: auto-leave behavior, Volume). Lives on the bot's own disk; one entry per Guild.

**Playlist** — a YouTube playlist URL pasted to Play. It expands into up to **Grab limit** the user chooses (default 20, options 20/50/100); those Tracks join the Queue. The Playlist itself is never stored.

**Grab limit** — how many Tracks to take from a Playlist. Keyword for Q2 of round 3; the user-facing word in commands may be different.

**Volume** — the per-Guild gain applied while streaming: 1–100 %, where 100 means full loudness of the source. Anything above 100 is digital amplification (distorts) and is out of scope in v1.
