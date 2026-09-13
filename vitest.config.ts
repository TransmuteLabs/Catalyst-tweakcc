import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    // The guard runs in the main process and only watches; the pin runs in
    // every worker and must be imported before any module that reads
    // TWEAKCC_CONFIG_DIR, because config.ts resolves the home once at import.
    globalSetup: ['./src/tests/setup/liveHomeGuard.ts'],
    // noNetwork must also run in every worker, and before the module graph:
    // the download it traps is reached at test time, not at import time, but a
    // file that stubs fetch itself must be able to overwrite the trap rather
    // than race it.
    setupFiles: [
      './src/tests/setup/pinConfigHome.ts',
      './src/tests/setup/noNetwork.ts',
    ],
  },
});
