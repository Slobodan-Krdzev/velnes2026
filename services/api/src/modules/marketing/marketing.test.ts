import { API_PREFIX, CapacityResponseSchema, MemberRecListSchema } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';

const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
let ownerToken = '';
let offerId = '';
let slotId = '';
let recId = '';
let pmoId = '';

const iso = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Tomorrow, but never a Sunday (the demo world closes then) — and if
// tomorrow is Sunday, Monday works for both capacity and the scan.
const tomorrow = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.getDay() === 0 ? iso(2) : iso(1);
})();

const get = (url: string) =>
  app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${ownerToken}` } });
const post = (url: string, payload: unknown = {}) =>
  app.inject({
    method: 'POST',
    url,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: payload as Record<string, unknown>,
  });

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const nowM = () => new Date().getHours() * 60 + new Date().getMinutes();

describe('last-minute offers and the Premium pipeline', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    const res = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/auth/login`,
      payload: { email: 'maria@velnes.mk', password: 'velnes-demo' },
    });
    ownerToken = res.json().accessToken;
  });
  afterAll(async () => {
    await admin.query(`DELETE FROM premium_offers WHERE tenant_id=$1`, [demo.business]);
    await admin.query(`DELETE FROM member_recs WHERE tenant_id=$1`, [demo.business]);
    await admin.query(`DELETE FROM last_minute_offers WHERE tenant_id=$1`, [demo.business]);
    await admin.query(`DELETE FROM customer_activity WHERE tenant_id=$1`, [demo.business]);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('reads open capacity from the one source: gaps with the best fill and real prices', async () => {
    const res = await get(`${API_PREFIX}/capacity?locationId=${demo.locCentar}&date=${tomorrow}`);
    expect(res.statusCode).toBe(200);
    const body = CapacityResponseSchema.parse(res.json());
    expect(body.slots.length).toBeGreaterThan(0);
    expect(body.value).toBe(body.slots.reduce((n, s) => n + s.price, 0));
    // Every slot's whole block fits its gap — prep + treatment + reset.
    for (const s of body.slots) expect(s.operationalMin).toBeLessThanOrEqual(s.gap);
    slotId = body.slots[0]!.id;
  });

  it('creates one offer with two phases: members first, then everyone', async () => {
    const res = await post(`${API_PREFIX}/offers`, {
      locationId: demo.locCentar,
      date: tomorrow,
      pickedSlotIds: [slotId],
      vipPct: 40,
      vipFrom: hhmm(Math.max(0, nowM() - 10)),
      vipUntil: hhmm(Math.min(1439, nowM() + 60)),
      publicOn: true,
      publicPct: 25,
    });
    expect(res.statusCode).toBe(200);
    offerId = res.json().id;
    const list = await get(`${API_PREFIX}/offers`);
    const o = list.json().offers.find((x: { id: string }) => x.id === offerId);
    expect(o.phases).toHaveLength(2);
    expect(o.phases[0].audience).toBe('PREMIUM_MEMBERS');
    expect(o.phases[1].audience).toBe('PUBLIC');
    expect(o.slots[slotId].price).toBeGreaterThan(0);
  });

  it('prices through the same door: a member sees the VIP phase, a stranger does not — nothing stacks', async () => {
    const list = await get(`${API_PREFIX}/offers`);
    const o = list.json().offers.find((x: { id: string }) => x.id === offerId);
    const cap = o.slots[slotId];

    // Katerina is Premium: 40% off the price that applies here & now.
    const member = await get(
      `${API_PREFIX}/price?serviceId=${cap.serviceId}&locationId=${demo.locCentar}${cap.variantId ? `&variantId=${cap.variantId}` : ''}&customerId=${demo.c1}&slotId=${encodeURIComponent(slotId)}&date=${tomorrow}`,
    );
    expect(member.statusCode).toBe(200);
    expect(member.json().best.kind).toBe('offer');
    expect(member.json().effective).toBe(Math.round(cap.price * 0.6));

    // Anonymous: the VIP phase is invisible; the list price stands
    // (the public phase has not started yet).
    const anon = await get(
      `${API_PREFIX}/price?serviceId=${cap.serviceId}&locationId=${demo.locCentar}${cap.variantId ? `&variantId=${cap.variantId}` : ''}&slotId=${encodeURIComponent(slotId)}&date=${tomorrow}`,
    );
    expect(anon.json().best.kind).toBe('list');
    expect(anon.json().discounted).toBe(false);
  });

  it('scans tomorrow for one member recommendation with transparent scoring', async () => {
    const res = await get(`${API_PREFIX}/premium/recommendations?locationId=${demo.locCentar}`);
    expect(res.statusCode).toBe(200);
    const body = MemberRecListSchema.parse(res.json());
    expect(body.recommendations).toHaveLength(1);
    const rec = body.recommendations[0]!;
    recId = rec.id;
    expect(rec.status).toBe('pending');
    expect(rec.recPct).toBeLessThanOrEqual(50); // never past the HQ cap
    expect(rec.candidates.length).toBeGreaterThan(0);
    // Only Premium members are candidates; the scoring names its why.
    const names = rec.candidates.map((c) => c.name);
    expect(names).not.toContain('Elena Todorova'); // expired membership
    // Reading again does not scan a second truth.
    const again = await get(`${API_PREFIX}/premium/recommendations?locationId=${demo.locCentar}`);
    expect(again.json().recommendations).toHaveLength(1);
  });

  it('approve opens the staged member window; the demo clock advances it to public', async () => {
    const res = await post(`${API_PREFIX}/premium/recommendations/${recId}/approve`);
    expect(res.statusCode).toBe(200);
    pmoId = res.json().offerId;

    const offers = await get(`${API_PREFIX}/premium/offers`);
    const o = offers.json().offers[0];
    expect(o.stage).toBe(1);

    // Stage 1: only the best member sees the price — asked with the
    // offer's own variant, so it is like for like.
    const vq = o.variantId ? `&variantId=${o.variantId}` : '';
    const best = o.candidates[0].cid;
    const seen = await get(
      `${API_PREFIX}/price?serviceId=${o.serviceId}&locationId=${demo.locCentar}${vq}&customerId=${best}&date=${o.date}`,
    );
    expect(seen.json().best.kind).toBe('member');
    expect(seen.json().effective).toBe(o.price);
    const anon = await get(
      `${API_PREFIX}/price?serviceId=${o.serviceId}&locationId=${demo.locCentar}${vq}&date=${o.date}`,
    );
    expect(anon.json().best.kind).toBe('list');

    // stage 2 (member group) → stage 3 (public, HQ rule allows it).
    await post(`${API_PREFIX}/premium/offers/${pmoId}/advance`);
    const s3 = await post(`${API_PREFIX}/premium/offers/${pmoId}/advance`);
    expect(s3.json().stage).toBe(3);
    const pub = await get(
      `${API_PREFIX}/price?serviceId=${o.serviceId}&locationId=${demo.locCentar}${vq}&date=${o.date}`,
    );
    expect(pub.json().best.kind).toBe('member');
    expect(pub.json().best.label).toBe('Special offer');
  });

  it('gates the doors: staff without marketing.personal_offers cannot decide', async () => {
    const ana = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/auth/login`,
      payload: { email: 'ana@velnes.mk', password: 'velnes-demo' },
    });
    const denied = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/premium/offers/${pmoId}/advance`,
      headers: { authorization: `Bearer ${ana.json().accessToken}` },
      payload: {},
    });
    expect(denied.statusCode).toBe(403);
  });
});
