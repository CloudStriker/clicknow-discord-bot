import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// The audio pipeline ends with an OpusEncoder from prism-media, which tries
// @discordjs/opus -> node-opus -> opusscript. At least ONE must be present,
// otherwise /play dies mid-stream (seen live: "Cannot find module
// '@discordjs/opus'"). This pins the dependency without a real connection.

const require = createRequire(import.meta.url);

test('an Opus encoder is available for the voice pipeline', async () => {
  const prism = require('prism-media');
  const encoder = new prism.opus.Encoder({ rate: 48000, channels: 2, frameSize: 960 });

  const packet = await new Promise((resolve, reject) => {
    encoder.on('data', (chunk) => resolve(chunk)); // readable object mode
    encoder.on('error', reject);
    // two 20 ms frames of silence, 48 kHz stereo
    encoder.write(Buffer.alloc(480 * 2 * 2 * 2));
    setTimeout(() => reject(new Error('no Opus packets within 5 s')), 5_000);
  });

  assert.ok(packet && packet.length > 0, 'encoder produced an Opus packet');
});
