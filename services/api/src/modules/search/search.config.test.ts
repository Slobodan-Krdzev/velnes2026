import { DEFAULT_SEARCH_CONFIG, SearchConfigPayloadSchema } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { activeSearchConfig, SearchConfigError } from './search.service.js';

/**
 * Step 1 of Phase B: the config document exists, exactly one version is
 * in force, only HQ can read it, and the two inert components are
 * really inert.
 */

const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

/** The restricted role the API really runs as — the only connection
 *  that proves a policy, since the admin role carries BYPASSRLS. */
const API_URL = (process.env.API_DATABASE_URL ??
  'postgres://velnes_api:velnes_api@localhost:5432/velnes_test'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

describe('the Search lab config', () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  const api = new pg.Client({ connectionString: API_URL });

  beforeAll(async () => {
    await admin.connect();
    await api.connect();
  });
  afterAll(async () => {
    await admin.end();
    await api.end();
    await closeDb();
  });

  it('ships one active version, and it matches the contract', async () => {
    const cfg = await activeSearchConfig();
    expect(cfg.version).toBeGreaterThan(0);
    // Parsed, not merely present: a config that has drifted from the
    // contract would rank everybody wrong, quietly.
    expect(() => SearchConfigPayloadSchema.parse(cfg.payload)).not.toThrow();
    expect(cfg.payload.proximity.decayKm).toBeGreaterThan(0);
    expect(cfg.payload.affinity.recencyHalfLifeDays).toBeGreaterThan(0);
    expect(cfg.payload.diversity.maxPerBusinessInWindow).toBeGreaterThan(0);
  });

  it('keeps quality and exposure inert until their inputs exist', async () => {
    const { weights } = (await activeSearchConfig()).payload;
    // Reviews do not exist; neither does an impressions counter. Their
    // slots are declared so turning them on is a data change, but they
    // must contribute nothing until then — and must never be faked with
    // a proxy that looks like a signal.
    expect(weights.quality, 'quality is inert until reviews exist').toBe(0);
    expect(weights.exposure, 'exposure is inert until impressions exist').toBe(0);
    // The live four are actually live, or v1 ranks on nothing at all.
    expect(weights.proximity + weights.affinity + weights.availability + weights.value)
      .toBeGreaterThan(0);
  });

  it('refuses a second active version', async () => {
    // The invariant the whole document rests on: "the config in force"
    // has to mean exactly one row. Inside a transaction, so a probe that
    // unexpectedly succeeds cannot leave the database ranking on it.
    await admin.query('BEGIN');
    try {
      await expect(
        admin.query(
          `INSERT INTO search_config (version, active, payload) VALUES (9001, true, '{}'::jsonb)`,
        ),
      ).rejects.toThrow(/search_config_one_active/);
    } finally {
      await admin.query('ROLLBACK');
    }
    const still = await activeSearchConfig();
    expect(still.version).toBe(1);
  });

  it('allows a swap when the old version steps down in the same transaction', async () => {
    await admin.query('BEGIN');
    try {
      await admin.query(`UPDATE search_config SET active = false WHERE active`);
      await admin.query(
        `INSERT INTO search_config (version, active, payload, note)
         VALUES (9002, true, $1::jsonb, 'probe')`,
        [JSON.stringify(DEFAULT_SEARCH_CONFIG)],
      );
      const n = await admin.query(`SELECT count(*)::int AS n FROM search_config WHERE active`);
      expect(n.rows[0].n, 'still exactly one in force').toBe(1);
    } finally {
      await admin.query('ROLLBACK');
    }
    const after = await activeSearchConfig();
    expect(after.version).toBe(1);
  });

  it('is unreadable by a tenant, by the public, and with no context at all', async () => {
    for (const [label, setup] of [
      ['no context', ''],
      ['tenant', `SET app.tenant_id = '00000000-0000-4000-8000-000000000001'`],
      ['public', `SET app.public = '1'`],
      ['client', `SET app.client_id = '00000000-0000-4000-8000-000000000002'`],
    ] as const) {
      await api.query('BEGIN');
      if (setup) await api.query(setup);
      const r = await api.query('SELECT count(*)::int AS n FROM search_config');
      await api.query('ROLLBACK');
      // A salon that can read the weights is a salon that can game them.
      expect(r.rows[0].n, `${label} must see nothing`).toBe(0);
    }
    await api.query('BEGIN');
    await api.query(`SET app.hq = '1'`);
    const hq = await api.query('SELECT count(*)::int AS n FROM search_config');
    await api.query('ROLLBACK');
    expect(hq.rows[0].n, 'HQ can').toBeGreaterThan(0);
  });

  it('raises rather than ranking on a payload that has drifted', async () => {
    // The config has to be visibly broken to the reader, so this one
    // commits — and puts it back in a finally that cannot be skipped.
    await admin.query(
      `UPDATE search_config SET payload = payload #- '{proximity,decayKm}' WHERE active`,
    );
    try {
      await expect(activeSearchConfig()).rejects.toBeInstanceOf(SearchConfigError);
    } finally {
      await admin.query(`UPDATE search_config SET payload = $1::jsonb WHERE active`, [
        JSON.stringify(DEFAULT_SEARCH_CONFIG),
      ]);
    }
    const restored = await activeSearchConfig();
    expect(restored.payload.proximity.decayKm).toBe(5);
  });

  it('seeds exactly the defaults the contract declares', async () => {
    // Two copies of the same numbers exist on purpose: this constant,
    // and the SQL in the migration that a fresh production database
    // comes up on. If they ever drift, production and development rank
    // differently — invisible until somebody compares two screens.
    const cfg = await activeSearchConfig();
    expect(cfg.payload).toEqual(DEFAULT_SEARCH_CONFIG);
  });
});
