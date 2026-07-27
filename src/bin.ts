/**
 * Executable entrypoint for the `pylon` binary. Kept separate from `cli.ts` so
 * the CLI module stays side-effect-free and safe to import from tests.
 */

import { run } from './cli.js';

run().then((code) => {
  process.exitCode = code;
});
