import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** Migrate + seed the demo world before the journeys run. */
export default async function globalSetup() {
  const root = path.join(__dirname, '..');
  try {
    process.loadEnvFile(path.join(root, '.env'));
  } catch {
    /* CI provides env vars */
  }
  // Locally the journeys live in their OWN database: reseeding must
  // never clobber the dev world someone has open in a browser tab —
  // that is how ghost appointments ("Unknown appointment") are born.
  // The dev .env sets DATABASE_URL to the dev world, so that variable
  // only counts on CI (throwaway postgres); locally use E2E_DATABASE_URL
  // or the velnes_e2e default.
  let adminUrl =
    process.env.E2E_DATABASE_URL ??
    (process.env.CI ? process.env.DATABASE_URL : undefined) ??
    'postgres://velnes:velnes@localhost:5432/velnes_e2e';
  if (!adminUrl.includes('sslmode')) adminUrl += (adminUrl.includes('?') ? '&' : '?') + 'sslmode=disable';
  execFileSync(
    path.join(root, 'node_modules/.bin/dbmate'),
    ['-u', adminUrl, '-d', path.join(root, 'db/migrations'), '--no-dump-schema', 'up'],
    { stdio: 'inherit' },
  );
  // tsx through pnpm: the root node_modules/.bin/tsx link does not
  // exist in CI's pnpm layout (only the declaring package gets it).
  execFileSync(
    'pnpm',
    ['--filter', '@velnes/api', 'exec', 'tsx', 'src/db/seed-cli.ts'],
    // The seed must land in the SAME database the migrations ran on —
    // never in whatever DATABASE_URL the dev .env points at.
    { stdio: 'inherit', env: { ...process.env, SEED_DATABASE_URL: adminUrl }, cwd: root },
  );
}
