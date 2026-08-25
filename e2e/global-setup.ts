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
  let adminUrl =
    process.env.DATABASE_URL ?? 'postgres://velnes:velnes@localhost:5432/velnes';
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
    { stdio: 'inherit', env: process.env, cwd: root },
  );
}
