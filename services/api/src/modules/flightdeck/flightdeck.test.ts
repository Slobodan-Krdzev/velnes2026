import { API_PREFIX, FlightdeckSchema } from '@velnes/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';

const app = await buildServer();
let token = '';

describe('flightdeck — the salon home composed from live data', () => {
  beforeAll(async () => {
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/auth/login`,
      payload: { email: 'maria@velnes.mk', password: 'velnes-demo' },
    });
    token = (res.json() as { accessToken: string }).accessToken;
  });
  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('is closed to the basic Employee kit — no location figures, no flightdeck', async () => {
    const login = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/auth/login`,
      payload: { email: 'ana@velnes.mk', password: 'velnes-demo' },
    });
    const res = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/flightdeck`,
      headers: { authorization: `Bearer ${(login.json() as { accessToken: string }).accessToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns a valid, provider-tagged payload for the seeded salon', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/flightdeck?locationId=${demo.locCentar}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const fd = FlightdeckSchema.parse(res.json());
    // Rules provider by default — real, not faked.
    expect(fd.provider).toBe('rules');
    expect(typeof fd.pulse.capacityPct).toBe('number');
    expect(fd.pulse.totalSlots).toBeGreaterThanOrEqual(fd.pulse.bookedToday);
    expect(['capacity', 'quiet']).toContain(fd.hero.kind);
    // The seeded catalog has a sold-out posture brace at Centar — it
    // surfaces as a decision that cannot wait.
    expect(fd.inventory.some((p) => p.soldOut)).toBe(true);
    // Opportunities are real signals: each carries a nav target.
    for (const o of fd.opportunities)
      expect(['customers', 'reports', 'catalog', 'suppliers', 'marketing']).toContain(o.actionTarget);
  });

  it('shows no members-first hero when the salon has no Velnes Premium members', async () => {
    const { default: pg } = await import('pg');
    const admin = new pg.Client({
      connectionString: (process.env.TEST_ADMIN_DATABASE_URL ?? process.env.TEST_SEED_DATABASE_URL ?? 'postgres://velnes:velnes@localhost:5432/velnes').replace(
        /\/[^/?]+(\?|$)/,
        '/velnes_test$1',
      ),
    });
    await admin.connect();
    const saved = await admin.query(`SELECT id, premium FROM customers WHERE tenant_id = $1 AND premium IS NOT NULL`, [demo.business]);
    try {
      await admin.query(`UPDATE customers SET premium = NULL WHERE tenant_id = $1`, [demo.business]);
      const res = await app.inject({ method: 'GET', url: `${API_PREFIX}/flightdeck`, headers: { authorization: `Bearer ${token}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().hero.kind).toBe('quiet');
    } finally {
      for (const r of saved.rows) await admin.query(`UPDATE customers SET premium = $2 WHERE id = $1`, [r.id, r.premium]);
      await admin.end();
    }
  });

  it('falls back to the first location when none is given', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/flightdeck`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
