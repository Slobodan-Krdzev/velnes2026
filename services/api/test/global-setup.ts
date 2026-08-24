import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { seedDemo } from '../src/db/seed-demo.js';

/**
 * Once per vitest run: make sure velnes_test exists, migrate it,
 * seed the demo world. Needs an RLS-exempt admin connection
 * (locally the Homebrew superuser; in CI the service superuser).
 */

// Local runs keep their URLs in the repo-root .env (not exported to
// the shell); CI sets real env vars, which win.
try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  /* no .env — rely on real env vars (CI) */
}

const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes';
const TEST_DB = 'velnes_test';

function testUrl(base: string) {
  const u = new URL(base);
  u.pathname = `/${TEST_DB}`;
  return u.toString();
}

export default async function setup() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [TEST_DB]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  // The dbmate binary installed at the workspace root.
  const dbmate = fileURLToPath(new URL('../../../node_modules/.bin/dbmate', import.meta.url));
  const migrationsDir = fileURLToPath(new URL('../../../db/migrations', import.meta.url));
  execFileSync(dbmate, ['-u', `${testUrl(ADMIN_URL)}?sslmode=disable`, '-d', migrationsDir, '--no-dump-schema', 'up'], {
    stdio: 'inherit',
  });

  await seedDemo(testUrl(ADMIN_URL));
}
