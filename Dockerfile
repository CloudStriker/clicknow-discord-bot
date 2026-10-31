# Runtime image: Node 24 + ffmpeg + a pip-installed, auto-updating yt-dlp.
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3-pip \
      ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install npm deps first so source edits don't re-install them
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Baseline yt-dlp baked into the image, so the bot can play even if the
# startup auto-update has a transient network failure.
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp

ENV NODE_ENV=production
ENTRYPOINT ["docker-entrypoint.sh"]
