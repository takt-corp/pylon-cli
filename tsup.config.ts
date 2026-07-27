import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    pylon: 'src/bin.ts',
    index: 'src/index.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  dts: true,
  sourcemap: true,
  // Emit a shebang so the published bin is directly executable.
  banner: {
    js: '#!/usr/bin/env node',
  },
});
