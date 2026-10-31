// Command registry + the shared context every command receives.
//
// Adding a new command:
//   1. create src/commands/<name>.js exporting { data, execute }
//   2. add it to the `commands` array below
//   3. run: npm run deploy-commands   (registers it with Discord)

import help from './help.js';
import play from './play.js';
import skip from './skip.js';
import stop from './stop.js';
import queue from './queue.js';
import volume from './volume.js';
import settings from './settings.js';
import pause from './pause.js';
import resume from './resume.js';
import nowplaying from './nowplaying.js';
import shuffle from './shuffle.js';
import remove from './remove.js';
import clear from './clear.js';
import loop from './loop.js';

/** Every slash command, in the order Discord shows them hints for. */
export const commands = [
  help,
  play,
  skip,
  stop,
  queue,
  volume,
  settings,
  pause,
  resume,
  nowplaying,
  shuffle,
  remove,
  clear,
  loop,
];

/**
 * The one object passed to every command's execute().
 * Keeps commands decoupled from how managers are constructed (src/index.js).
 */
export function createCtx({ players, settings, config }) {
  return { players, settings, config };
}
