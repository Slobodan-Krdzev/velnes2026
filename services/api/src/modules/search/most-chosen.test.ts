import { API_PREFIX, MostChosenSchema } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { resetAdmittedCache } from '../../public/discovery.routes.js';
import { buildServer } from '../../server.js';
import {
  MOST_CHOSEN_MIN_PER_CATEGORY,
  MOST_CHOSEN_MIN_TOTAL,
  MOST_CHOSEN_WINDOW_DAYS,
  mostChosenCategoryIds,
} from './search.service.js';

/**
 * Step 9 of the Search phase — docs/SEARCH.md, decision 2.
 *
 * The label was decoration, and Alex chose to make it real rather than
 * remove it. What makes it real is not that it shows something — it is
 * that it counts the right visits, and can refuse to claim anything.
 *
 * The seeded world genuinely supports the claim: one salon with ~180
 * completed visits spread over the window. So the counting is checked
 * against an independent implementation in SQL rather than against
 * numbers typed into this file, which would only be the same mistake
 * written twice.
 */

const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
const P = `${API_PREFIX}/public`;

/** Midnight today, so "completed" never straddles the current hour and
 *  the SQL below can say `date < current_date` and mean the same thing. */
const NOW = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

let tenantId = '';
/** Rows this suite inserted, deleted again afterwards: every other
 *  suite reads this same seeded world. */
const mine: string[] = [];

async function door() {
  resetAdmittedCache();
  const res = await app.inject({ method: 'GET', url: `${P}/discovery/most-chosen` });
  expect(res.statusCode).toBe(200);
  return MostChosenSchema.parse(res.json());
}

/**
 * The same question, asked in SQL.
 *
 * Deliberately a second implementation: if both agree, the window, the
 * status rule, the ordering and both floors are right for a reason
 * rather than by coincidence.
 */
async function expectedOrder(): Promise<string[]> {
  const r = await admin.query(
    `SELECT s.category_id AS id, count(*)::int AS n
       FROM appointments a
       JOIN services s ON s.id = a.service_id
      WHERE a.tenant_id = $1
        AND a.status IN ('booked', 'confirmed')
        AND a.kind = 'appointment'
        AND a.service_id IS NOT NULL
        AND s.category_id IS NOT NULL
        AND a.date >= current_date - $2::int
        AND a.date < current_date
      GROUP BY s.category_id`,
    [tenantId, MOST_CHOSEN_WINDOW_DAYS],
  );
  const rows = r.rows as { id: string; n: number }[];
  const total = rows.reduce((n, x) => n + x.n, 0);
  if (total < MOST_CHOSEN_MIN_TOTAL) return [];
  return rows
    .filter((x) => x.n >= MOST_CHOSEN_MIN_PER_CATEGORY)
    .sort((a, b) => b.n - a.n || a.id.localeCompare(b.id))
    .map((x) => x.id);
}

describe('"most chosen"', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    const b = await admin.query(`SELECT id FROM businesses WHERE slug = 'velnes-fizio'`);
    tenantId = b.rows[0].id;
  });
  afterAll(async () => {
    if (mine.length)
      await admin.query(`DELETE FROM appointments WHERE id = ANY($1::uuid[])`, [mine]);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('counts the same visits a second implementation counts', async () => {
    const expected = await expectedOrder();
    expect(expected.length, 'the seeded world really does book enough to say this').toBeGreaterThan(
      0,
    );
    expect(await mostChosenCategoryIds([tenantId], NOW)).toEqual(expected);
  });

  it('is served in that order, and only for categories still on offer', async () => {
    const r = await door();
    const expected = await expectedOrder();
    // The door additionally drops anything nobody publishes in any more:
    // popular once is still a dead end today.
    expect(r.categories.map((c) => c.id)).toEqual(
      expected.filter((id) => r.categories.some((c) => c.id === id)),
    );
    expect(r.categories.length).toBeGreaterThan(0);
  });

  it('counts nothing when no salon is admitted', async () => {
    expect(await mostChosenCategoryIds([], NOW)).toEqual([]);
  });

  it('says nothing rather than something misleading, below the floor', async () => {
    // A week into the seeded history only a handful of visits have
    // happened. "Most chosen" out of fourteen bookings is a claim about
    // nothing, and the honest answer is silence.
    const early = await admin.query(`SELECT min(date)::text AS d FROM appointments`);
    const week = new Date(`${early.rows[0].d}T00:00:00Z`);
    week.setUTCDate(week.getUTCDate() + 7);
    expect(await mostChosenCategoryIds([tenantId], week)).toEqual([]);
  });

  it('is about now, not about the platform’s whole life', async () => {
    // Every seeded visit is older than the window from here.
    const later = new Date(NOW);
    later.setUTCDate(later.getUTCDate() + MOST_CHOSEN_WINDOW_DAYS * 2);
    expect(await mostChosenCategoryIds([tenantId], later)).toEqual([]);
  });

  it('ignores cancellations and no-shows', async () => {
    const before = await mostChosenCategoryIds([tenantId], NOW);
    // Enough of them to reorder the list outright, if they counted.
    const svc = await leastBookedService();
    for (let i = 0; i < MOST_CHOSEN_MIN_TOTAL; i += 1) await visit(svc, 3, 'cancelled');
    for (let i = 0; i < MOST_CHOSEN_MIN_TOTAL; i += 1) await visit(svc, 3, 'no_show');
    // Nobody chose these. A cancellation is the opposite of a choice.
    expect(await mostChosenCategoryIds([tenantId], NOW)).toEqual(before);
  });

  it('ignores visits that have not happened yet', async () => {
    const before = await mostChosenCategoryIds([tenantId], NOW);
    const svc = await leastBookedService();
    for (let i = 0; i < MOST_CHOSEN_MIN_TOTAL; i += 1) await visit(svc, -5, 'confirmed');
    // A booking for next week is an intention, not a visit.
    expect(await mostChosenCategoryIds([tenantId], NOW)).toEqual(before);
  });

  it('does count a completed visit, so the tests above prove something', async () => {
    // The two tests above assert that nothing moved. They would pass
    // just as well if nothing could ever move them, so: the quietest
    // category that still clears the floor, lifted to the front by
    // completed visits alone.
    const before = await mostChosenCategoryIds([tenantId], NOW);
    const quietest = before[before.length - 1]!;
    expect(quietest, 'and it was not already first').not.toBe(before[0]);
    const svc = await serviceInCategory(quietest);
    for (let i = 0; i < MOST_CHOSEN_MIN_TOTAL * 4; i += 1) await visit(svc, 3, 'confirmed');
    expect((await mostChosenCategoryIds([tenantId], NOW))[0]).toBe(quietest);
  });

  it('publishes an order and never the counts', async () => {
    // A key-free door that carried volumes would let one salon read
    // another salon's trade straight out of it.
    const raw = (await app.inject({ method: 'GET', url: `${P}/discovery/most-chosen` })).json();
    expect(JSON.stringify(raw)).not.toMatch(/"count"|"total"|"bookings"|"n"/);
  });

  /** Any service in a given category — somewhere to attach visits. */
  async function serviceInCategory(categoryId: string): Promise<string> {
    const r = await admin.query(
      `SELECT id FROM services WHERE tenant_id = $1 AND category_id = $2 ORDER BY id LIMIT 1`,
      [tenantId, categoryId],
    );
    return r.rows[0].id;
  }
  /** A service in the quietest category, for the rows that must not
   *  count: attaching them where they would do the most damage. */
  async function leastBookedService(): Promise<string> {
    const order = await mostChosenCategoryIds([tenantId], NOW);
    return serviceInCategory(order[order.length - 1]!);
  }
  async function visit(serviceId: string, daysAgo: number, status: string) {
    const r = await admin.query(
      `INSERT INTO appointments
         (tenant_id, location_id, date, start_min, duration_min, kind, status, title, service_id)
       SELECT $1, l.id, (current_date - $2::int), 540, 60, 'appointment', $4::appointment_status,
              'most-chosen test', $3
         FROM locations l WHERE l.tenant_id = $1 LIMIT 1
       RETURNING id`,
      [tenantId, daysAgo, serviceId, status],
    );
    mine.push(r.rows[0].id);
  }
});
