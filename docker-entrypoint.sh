#!/usr/bin/env sh
# Container start-up: refresh yt-dlp, then run the bot.
#
# YouTube changes its site every few weeks; yt-dlp releases fixes almost
# weekly. Auto-updating at every container start keeps the bot low-touch
# for months (spec: maintenance target 6+ months).

echo "[entrypoint] updating yt-dlp…"
if pip3 install --no-cache-dir --upgrade --break-system-packages yt-dlp > /tmp/yt-dlp-install.log 2>&1; then
  echo "[entrypoint] yt-dlp ready: $(yt-dlp --version 2>/dev/null || echo 'unknown version')"
else
  echo "[entrypoint] ⚠️ yt-dlp auto-update FAILED — using the version baked into the image. Install log tail:"
  tail -5 /tmp/yt-dlp-install.log
fi

exec node src/index.js
