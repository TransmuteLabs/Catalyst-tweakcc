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
    setupFiles: ['./src/tests/setup/pinConfigHome.ts'],
  },
});
