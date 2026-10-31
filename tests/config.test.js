import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

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

test('importing config with CLIENT_ID unset throws readable error', async () => {
  const code = `
    process.env.DOTENV_CONFIG_PATH = '/dev/null';
    delete process.env.CLIENT_ID;
    process.env.DISCORD_TOKEN = 'token';
    await import('./src/config.js');
  `;
  await assert.rejects(
    exec(process.execPath, ['--input-type=module', '-e', code]),
    (err) => {
      assert.match(
        err.stderr,
        /CLIENT_ID is missing\. Copy \.env\.example to \.env and set your Application ID\./,
      );
      return true;
    },
  );
});
