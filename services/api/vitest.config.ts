import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./test/env-setup.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Suites share one seeded database; keep them sequential.
    fileParallelism: false,
  },
});
