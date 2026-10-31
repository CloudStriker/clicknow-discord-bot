#!/usr/bin/env sh
# Container start-up: refresh yt-dlp, then run the bot.
#
# YouTube changes its site every few weeks; yt-dlp releases fixes almost
# weekly. Auto-updating at every container start keeps the bot low-touch
# for months (spec: maintenance target 6+ months).

echo "[entrypoint] updating yt-dlp…"
# --break-system-packages: on Debian 12 pip refuses system-wide installs otherwise.
pip3 install --no-cache-dir --upgrade --break-system-packages yt-dlp \
  >/dev/null 2>&1 \
  || echo "[entrypoint] yt-dlp update failed — continuing with the version in the image"

echo "[entrypoint] yt-dlp version: $(yt-dlp --version 2>/dev/null || echo 'unknown')"

exec node src/index.js
