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

  it('falls back to the first location when none is given', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/flightdeck`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
