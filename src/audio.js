// The audio pipeline for one Track: yt-dlp (download) → ffmpeg (volume +
// libopus → Ogg) → @discordjs/voice. Split out of players.js, which manages
// the per-Guild state around it.

import { spawn } from 'node:child_process';

import { createAudioResource, StreamType } from '@discordjs/voice';

import { YtDlpError } from './ytdlp.js';

/** Give up on a Track if no audio has arrived after this long. */
const FIRST_AUDIO_TIMEOUT_MS = 45_000;

/**
 * Build a playable resource for one Track:
 *
 *   yt-dlp (downloads the audio) → ffmpeg (volume + libopus → Ogg) → voice
 *
 * yt-dlp does the downloading because YouTube throttles plain HTTP reads of
 * the media URL to below realtime for many videos (measured 0.65x), which
 * made songs stop after 1–2 s. yt-dlp's chunked downloader ran ~38x realtime
 * on the same video. ffmpeg encodes Opus natively, so no JavaScript encoder
 * runs in the realtime loop (opusscript was too slow at 0.25 vCPU).
 *
 * Resolves once the first audio bytes arrive, so "Now playing" is only
 * announced for audio that really plays. Rejects with a YtDlpError if
 * yt-dlp fails first. Volume is baked into the ffmpeg filter, so /volume
 * applies from the next Track on.
 *
 * @param {string} pageUrl  the Track's YouTube page URL
 * @param {number} volumePct  1–100
 * @param {{cookiesFile?: string|null, ytDlpPath?: string}} cfg
 * @returns {Promise<{resource: import('@discordjs/voice').AudioResource, kill: () => void}>}
 */
export async function makeAudioResource(pageUrl, volumePct, cfg = {}) {
  const ytArgs = ['--quiet', '--no-warnings', '--no-playlist', '-f', 'bestaudio/best', '-o', '-'];
  if (cfg.cookiesFile) ytArgs.push('--cookies', cfg.cookiesFile);
  ytArgs.push(pageUrl);
  const ytdlp = spawn(cfg.ytDlpPath ?? 'yt-dlp', ytArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  const ffmpeg = spawn(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      '-vn',
      '-af', `volume=${(volumePct / 100).toFixed(2)}`,
      '-c:a', 'libopus', '-b:a', '128k', '-ar', '48000', '-ac', '2',
      '-f', 'ogg', 'pipe:1',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  ytdlp.stdout.pipe(ffmpeg.stdin);
  ffmpeg.stdin.on('error', () => {}); // EPIPE when the Track is skipped

  let ytdlpStderr = '';
  ytdlp.stderr.on('data', (d) => {
    ytdlpStderr = (ytdlpStderr + d).slice(-2000);
  });
  ffmpeg.stderr.on('data', (d) => console.warn(`[ffmpeg] ${String(d).trim()}`));
  for (const [name, proc] of [['yt-dlp', ytdlp], ['ffmpeg', ffmpeg]]) {
    proc.on('error', (err) => console.error(`[${name}] failed to start: ${err.message}`));
  }
  const startedAt = Date.now();
  ffmpeg.on('close', (code, signal) => {
    const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[ffmpeg] exited code=${code} signal=${signal ?? '-'} after ${secs}s`);
  });
  ytdlp.on('close', (code) => {
    if (code) console.warn(`[yt-dlp] exited code=${code}: ${ytdlpStderr.trim().slice(-300)}`);
  });

  const kill = () => {
    ytdlp.kill('SIGKILL');
    ffmpeg.kill('SIGKILL');
  };

  try {
    await new Promise((resolve, reject) => {
      const done = (fn, value) => {
        clearTimeout(timer);
        ffmpeg.stdout.off('readable', onAudio);
        ytdlp.off('close', onYtdlpClose);
        fn(value);
      };
      const onAudio = () => done(resolve);
      const onYtdlpClose = (code) => {
        if (code !== 0) {
          done(reject, new YtDlpError(`yt-dlp exited with code ${code}`, ytdlpStderr));
        }
      };
      const timer = setTimeout(
        () => done(reject, new YtDlpError('No audio arrived in time', ytdlpStderr)),
        FIRST_AUDIO_TIMEOUT_MS,
      );
      ffmpeg.stdout.once('readable', onAudio);
      ytdlp.once('close', onYtdlpClose);
    });
  } catch (err) {
    kill();
    throw err;
  }

  const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.OggOpus });
  return { resource, kill };
}

/**
 * How many 20 ms frames may come up empty before the voice library treats a
 * song as finished. The library default (5 = 100 ms) ended songs on every
 * small network stall; 250 frames = 5 s of patience.
 */
export const MAX_MISSED_FRAMES = 250;
