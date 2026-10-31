import { test } from 'node:test';
import assert from 'node:assert/strict';

import { YtDlpError, classifyInput, parseYtDlpLines } from '../src/ytdlp.js';

test('classifyInput: plain words are a search', () => {
  assert.deepEqual(classifyInput('never gonna give you up'), { kind: 'search' });
});

test('classifyInput: a single video URL is a track', () => {
  const input = classifyInput('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(input.kind, 'track');
  assert.equal(input.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('classifyInput: youtu.be short link is a track', () => {
  assert.equal(classifyInput('https://youtu.be/dQw4w9WgXcQ').kind, 'track');
});

test('classifyInput: a watch URL with a list is a playlist', () => {
  const input = classifyInput(
    'https://www.youtube.com/watch?v=x&list=PLabc123',
  );
  assert.equal(input.kind, 'playlist');
  assert.equal(input.url, 'https://www.youtube.com/watch?v=x&list=PLabc123');
});

test('classifyInput: a playlist page is a playlist', () => {
  assert.equal(
    classifyInput('https://www.youtube.com/playlist?list=PLabc123').kind,
    'playlist',
  );
});

test('classifyInput: non-YouTube URL falls back to search', () => {
  assert.deepEqual(classifyInput('https://example.com/video'), { kind: 'search' });
});

test('parseYtDlpLines: parses good lines, skips blank and garbage lines', () => {
  const stdout = [
    '{"title":"first","duration":10}',
    '',
    'some warning text',
    '{"title":"second"}',
  ].join('\n');

  const parsed = parseYtDlpLines(stdout);
  assert.deepEqual(parsed, [{ title: 'first', duration: 10 }, { title: 'second' }]);
});

test('YtDlpError is an Error the player can catch by type', () => {
  const err = new YtDlpError('boom', 'yt-dlp stderr details');
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'YtDlpError');
  assert.equal(err.details, 'yt-dlp stderr details');
});
