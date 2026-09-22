import { API_PREFIX, DiscoveryNewestSchema, NEWEST_SALON_DAYS } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../db/index.js';
import { demo } from '../db/seed-demo.js';
import { buildServer } from '../server.js';

const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
const P = `${API_PREFIX}/public`;
let originalCreatedAt: Date | null = null;

describe('newest to Velnes — the salons that joined within the last 30 days, newest first', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    const row = await admin.query(`SELECT created_at FROM businesses WHERE id = $1`, [demo.business]);
    originalCreatedAt = row.rows[0].created_at;
  });
  afterAll(async () => {
    if (originalCreatedAt) await admin.query(`UPDATE businesses SET created_at = $2 WHERE id = $1`, [demo.business, originalCreatedAt]);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('a salon that joined this week is in the row, newest first, saying when it joined', async () => {
    await admin.query(`UPDATE businesses SET created_at = now() - interval '3 days' WHERE id = $1`, [demo.business]);
    const res = await app.inject({ method: 'GET', url: `${P}/discovery/newest` });
    expect(res.statusCode).toBe(200);
    const out = DiscoveryNewestSchema.parse(res.json());
    expect(out.days).toBe(NEWEST_SALON_DAYS);
    const demoSalon = out.salons.find((s) => s.slug === 'velnes-fizio');
    expect(demoSalon).toBeDefined();
    const ageDays = (Date.now() - new Date(demoSalon!.joinedAt).getTime()) / 86_400_000;
    expect(ageDays).toBeGreaterThan(2.9);
    expect(ageDays).toBeLessThan(3.1);
    // Newest first.
    const times = out.salons.map((s) => new Date(s.joinedAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(out.salons.length).toBeLessThanOrEqual(8);
  });

  it('a salon that joined before the window is not new any more', async () => {
    await admin.query(`UPDATE businesses SET created_at = now() - interval '${NEWEST_SALON_DAYS + 10} days' WHERE id = $1`, [demo.business]);
    const res = await app.inject({ method: 'GET', url: `${P}/discovery/newest` });
    const out = DiscoveryNewestSchema.parse(res.json());
    expect(out.salons.find((s) => s.slug === 'velnes-fizio')).toBeUndefined();
    // And nothing in the row is older than the window.
    const since = Date.now() - NEWEST_SALON_DAYS * 86_400_000;
    expect(out.salons.every((s) => new Date(s.joinedAt).getTime() >= since)).toBe(true);
  });
});
