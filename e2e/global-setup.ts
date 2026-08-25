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
  execFileSync(
    path.join(root, 'node_modules/.bin/tsx'),
    [path.join(root, 'services/api/src/db/seed-cli.ts')],
    { stdio: 'inherit', env: process.env },
  );
}
