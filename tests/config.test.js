import { test } from 'node:test';
import assert from 'node:assert/strict';

test('config reads env values and sensible defaults', async () => {
  process.env.DISCORD_TOKEN = 'test-token';
  process.env.CLIENT_ID = '1234567890';
  delete process.env.YT_DLP_COOKIES;
  delete process.env.YTDLP_PATH;

  const { config } = await import('../src/config.js');

  assert.equal(config.token, 'test-token');
  assert.equal(config.clientId, '1234567890');
  assert.equal(config.settingsPath, 'data/settings.json');
  assert.equal(config.ytDlpPath, 'yt-dlp');
  assert.equal(config.cookiesFile, null);
});
