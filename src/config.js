// Central configuration, loaded once from the environment.
// Copy .env.example to .env and fill in your values — see README.

import 'dotenv/config';

export const config = {
  /** Discord bot token — from the Developer Portal, `DISCORD_TOKEN` in .env */
  token: process.env.DISCORD_TOKEN ?? null,

  /** Discord application (client) ID — `CLIENT_ID` in .env */
  clientId: process.env.CLIENT_ID ?? null,

  /** Where per-guild settings live on disk (see src/settings.js). */
  settingsPath: process.env.SETTINGS_PATH ?? 'data/settings.json',

  /** Where the yt-dlp binary is. Docker installs/updates it automatically. */
  ytDlpPath: process.env.YTDLP_PATH ?? 'yt-dlp',

  /**
   * Optional path to a cookies.txt file passed to yt-dlp.
   * Leave unset unless YouTube starts demanding a login for this server's IP
   * (see README FAQ).
   */
  cookiesFile: process.env.YT_DLP_COOKIES || null,
};

if (!config.token) {
  throw new Error(
    'DISCORD_TOKEN is missing. Copy .env.example to .env and set your bot token.',
  );
}

if (!config.clientId) {
  throw new Error(
    'CLIENT_ID is missing. Copy .env.example to .env and set your Application ID.',
  );
}
