import { API_PREFIX, BusinessCategoryListSchema } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { buildServer } from '../../server.js';

const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
let hqToken = '';

describe('business categories — HQ curates, the wizard reads', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    const res = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/auth/login`,
      payload: { email: 'ivana@revelapps.com', password: 'velnes-demo' },
    });
    hqToken = (res.json() as { accessToken: string }).accessToken;
  });
  afterAll(async () => {
    await admin.query(`DELETE FROM business_categories WHERE name LIKE '%(test)%'`);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('serves the enabled list anonymously, and HQ can add/disable', async () => {
    // Anonymous read (the registration wizard has no session).
    const pub = await app.inject({ method: 'GET', url: `${API_PREFIX}/business-categories` });
    expect(pub.statusCode).toBe(200);
    const seeded = BusinessCategoryListSchema.parse(pub.json());
    expect(seeded.categories.some((c) => c.name === 'Physiotherapy')).toBe(true);
    expect(seeded.categories.every((c) => c.enabled)).toBe(true);

    const hq = (t: string) => ({ authorization: `Bearer ${t}` });
    const made = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/business-categories`,
      headers: hq(hqToken),
      payload: { name: 'Tattoo studio (test)' },
    });
    expect(made.statusCode).toBe(200);
    const id = (made.json() as { id: string }).id;

    // A disabled category drops out of the anonymous (wizard) list.
    await app.inject({
      method: 'PATCH',
      url: `${API_PREFIX}/hq/business-categories/${id}`,
      headers: hq(hqToken),
      payload: { enabled: false },
    });
    const pub2 = await app.inject({ method: 'GET', url: `${API_PREFIX}/business-categories` });
    expect((pub2.json() as { categories: { id: string }[] }).categories.some((c) => c.id === id)).toBe(false);
    // But HQ still sees it in the full list.
    const hqList = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/hq/business-categories`,
      headers: hq(hqToken),
    });
    expect((hqList.json() as { categories: { id: string; enabled: boolean }[] }).categories.find((c) => c.id === id)?.enabled).toBe(false);
  });
});
