import argon2 from 'argon2';
import pg from 'pg';

/**
 * The first Revelapps HQ user on a production database.
 *
 * HQ users are otherwise only created by another HQ user's invite, and
 * the demo seed refuses production — so a fresh database has no way
 * in. This one-off creates an active HQ user directly, under the HQ
 * policy (`app.hq`), the way the HQ app itself writes:
 *
 *   node --env-file=.env create-hq-user.js "Ivana Petrova" ivana@revelapps.com hq_super
 *
 * It reads the password from HQ_BOOTSTRAP_PASSWORD (never an argument,
 * so it stays out of shell history), hashes it with argon2 like every
 * other credential, and refuses if the email already exists. Uses
 * DATABASE_URL (the migration role, which owns the table) or
 * API_DATABASE_URL.
 */
const [name, email, role = 'hq_support'] = process.argv.slice(2);
const password = process.env.HQ_BOOTSTRAP_PASSWORD ?? '';
const ROLES = ['hq_super', 'hq_onboard', 'hq_support', 'hq_finance', 'hq_tech', 'hq_audit'];
const url = process.env.DATABASE_URL ?? process.env.API_DATABASE_URL ?? '';

function fail(msg: string): never {
  console.error(msg);
  console.error('Usage: HQ_BOOTSTRAP_PASSWORD=... node --env-file=.env create-hq-user.js "Full Name" email@example.com [hq_super|hq_onboard|hq_support|hq_finance|hq_tech|hq_audit]');
  process.exit(1);
}
if (!name || !email || !email.includes('@')) fail('A name and an email address are required.');
if (!ROLES.includes(role)) fail(`Unknown role '${role}'.`);
if (password.length < 10) fail('HQ_BOOTSTRAP_PASSWORD must be set (at least 10 characters).');
if (!url) fail('DATABASE_URL (or API_DATABASE_URL) must be set.');

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query(`SELECT set_config('app.hq', '1', true)`);
  const exists = await client.query(`SELECT id FROM hq_users WHERE lower(email) = lower($1)`, [email]);
  if (exists.rowCount) {
    await client.query('ROLLBACK');
    fail(`An HQ user with the email ${email} already exists — invite others from HQ › Team.`);
  }
  const hash = await argon2.hash(password);
  const row = await client.query(
    `INSERT INTO hq_users (name, email, role, password_hash, status) VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
    [name, email, role, hash],
  );
  await client.query('COMMIT');
  console.log(`Created HQ user ${email} (${role}) — id ${row.rows[0].id}. Sign in at the HQ app; two-factor is set up at first sign-in.`);
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  throw e;
} finally {
  await client.end();
}
