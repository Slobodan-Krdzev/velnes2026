import { defineConfig } from '@playwright/test';

/**
 * End-to-end journeys against the real stack: Postgres (seeded demo
 * world) + the API + the built workspace app. globalSetup migrates
 * and seeds; webServer boots both processes.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      // Through pnpm so the bin resolves the same on every machine —
      // the root node_modules/.bin/tsx link is not guaranteed in CI.
      command: 'pnpm --filter @velnes/api exec tsx src/index.ts',
      port: 3001,
      reuseExistingServer: false,
      env: {
        API_DATABASE_URL:
          process.env.E2E_API_DATABASE_URL ??
          'postgres://velnes_api:velnes_api@localhost:5432/velnes',
        JWT_SECRET: 'velnes-e2e-secret',
        NODE_ENV: 'test',
      },
    },
    {
      command: 'pnpm --filter @velnes/workspace exec vite preview --port 4173',
      port: 4173,
      reuseExistingServer: false,
    },
    {
      command: 'pnpm --filter @velnes/booking exec vite preview --port 4175',
      port: 4175,
      reuseExistingServer: false,
    },
  ],
});
