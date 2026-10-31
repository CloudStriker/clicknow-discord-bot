// Everything that talks to the yt-dlp binary lives here.
//
// yt-dlp does the YouTube-specific heavy lifting (searching, reading
// playlists, getting playable audio URLs). It is updated automatically in the
// Docker container at every start, so YouTube changes over the months are
// handled by the yt-dlp community — not by editing this file.
//
// All subprocess calls use argv arrays (execFile), never shell strings, so
// search text can never be interpreted as shell commands.

import { execFile } from 'node:child_process';

export class YtDlpError extends Error {
  constructor(message, details = '') {
    super(message);
    this.name = 'YtDlpError';
    this.details = details;
  }
}

/**
 * Decide what a `/play` input is.
 *
 * @param {string} text  everything the user typed after /play
 * @returns {{kind: 'search'} | {kind: 'track', url: string} | {kind: 'playlist', url: string}}
 */
export function classifyInput(text) {
  const trimmed = text.trim();

  if (!/^https?:\/\//i.test(trimmed)) return { kind: 'search' };

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return { kind: 'search' };
  }

  const host = url.hostname.replace(/^www\./, '').replace(/^music\./, '');
  if (!/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) {
    // v1 is YouTube-only: a foreign URL is treated as words to search for.
    return { kind: 'search' };
  }

  if (url.pathname.startsWith('/watch') && url.searchParams.has('list')) {
    return { kind: 'playlist', url: trimmed };
  }
  if (url.pathname.startsWith('/playlist')) {
    return { kind: 'playlist', url: trimmed };
  }
  return { kind: 'track', url: trimmed };
}

/**
 * yt-dlp prints one JSON object per line (for search results). This parses
 * those lines and silently skips blanks/warnings. Pure — exported for tests.
 */
export function parseYtDlpLines(stdout) {
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// ── subprocess plumbing ────────────────────────────────────────────────

function run(config, args) {
  const allArgs = ['--no-warnings'];
  if (config.cookiesFile) allArgs.push('--cookies', config.cookiesFile);
  allArgs.push(...args);

  return new Promise((resolve, reject) => {
    execFile(
      config.ytDlpPath,
      allArgs,
      { timeout: 30_000, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new YtDlpError(
              `yt-dlp exited with code ${err.code ?? 'error'}`,
              String(stderr).slice(-2000),
            ),
          );
          return;
        }
        resolve(String(stdout));
      },
    );
  });
}

/** URL of the video's own page (flat playlist entries sometimes give only an id). */
function watchUrl(entry) {
  return entry.webpage_url ?? entry.url ?? `https://www.youtube.com/watch?v=${entry.id}`;
}

function toTrack(video, requesterTag) {
  return {
    url: watchUrl(video),
    title: video.title ?? '(untitled)',
    durationSec: typeof video.duration === 'number' ? video.duration : null,
    requesterTag,
  };
}

/**
 * Look up what the user asked for and return ready-to-queue Tracks.
 *
 * @param {{kind: 'search'|'track'|'playlist', url?: string}} classified  from classifyInput()
 * @param {{text?: string, grabLimit?: number, requesterTag: string, cookiesFile?: string|null, ytDlpPath?: string}} cfg
 */
export async function discover(classified, cfg) {
  const runConfig = { cookiesFile: cfg.cookiesFile, ytDlpPath: cfg.ytDlpPath };
  const grabLimit = Math.max(1, Math.min(100, cfg.grabLimit ?? 20));

  if (classified.kind === 'search') {
    const stdout = await run(runConfig, [
      '-j',
      '--no-playlist',
      `ytsearch1:${cfg.text}`,
    ]);
    const [video] = parseYtDlpLines(stdout);
    if (!video) throw new YtDlpError('No results found');
    return [toTrack(video, cfg.requesterTag)];
  }

  if (classified.kind === 'track') {
    const stdout = await run(runConfig, [
      '-j',
      '--no-playlist',
      classified.url,
    ]);
    const [video] = parseYtDlpLines(stdout);
    if (!video) throw new YtDlpError('Video information not found');
    return [toTrack(video, cfg.requesterTag)];
  }

  // playlist: flat listings are much faster (and enough: the audio URL is
  // fetched per Track right before it plays, in players.js)
  const stdout = await run(runConfig, [
    '-J',
    '--flat-playlist',
    '--playlist-end',
    String(grabLimit),
    classified.url,
  ]);
  const listing = JSON.parse(stdout);
  const entries = Array.isArray(listing.entries) ? listing.entries : [];
  const tracks = entries.map((e) => toTrack(e, cfg.requesterTag));
  if (tracks.length === 0) throw new YtDlpError('Playlist is empty');
  return tracks;
}

/**
 * Get a directly playable audio URL for one Track, moments before it plays
 * (these URLs expire, so we never cache them).
 *
 * @param {string} webpageUrl  the Track's page URL
 * @param {{cookiesFile?: string|null, ytDlpPath?: string}} cfg
 * @returns {Promise<{streamUrl: string, title: string}>}
 */
export async function getStreamUrl(webpageUrl, cfg) {
  const stdout = await run(
    { cookiesFile: cfg.cookiesFile, ytDlpPath: cfg.ytDlpPath },
    ['-j', '--no-playlist', '-f', 'bestaudio/best', webpageUrl],
  );
  const [video] = parseYtDlpLines(stdout);
  if (!video?.url) throw new YtDlpError('No playable audio found');
  return { streamUrl: video.url, title: video.title ?? '(untitled)' };
}
