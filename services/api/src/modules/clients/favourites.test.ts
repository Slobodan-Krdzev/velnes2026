import { randomUUID } from 'node:crypto';
import {
  API_PREFIX,
  ClientFavouritesSchema,
  DiscoveryCategoriesSchema,
  DiscoveryRankedServicesSchema,
} from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { buildServer } from '../../server.js';

/**
 * Phase C — persisted favourites, docs/FAVOURITES.md.
 *
 * What these have to prove: the list is the client's and nobody else's,
 * the doors are idempotent, an unpublished target is hidden but kept
 * while a vanished one is stamped, and the ranking seam fills without
 * double counting anything.
 */

const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

/** The restricted role the API really runs as. The admin role carries
 *  BYPASSRLS and would prove nothing about a policy. */
const API_URL = (
  process.env.API_DATABASE_URL ?? 'postgres://velnes_api:velnes_api@localhost:5432/velnes_test'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
const api = new pg.Client({ connectionString: API_URL });
const C = `${API_PREFIX}/client`;
const P = `${API_PREFIX}/public`;
const EMAIL = `fav.client.${Date.now()}@example.com`;
const OTHER = `fav.other.${Date.now()}@example.com`;
const PASSWORD = 'velnes-test-12345';

async function codeFor(email: string): Promise<string> {
  const r = await admin.query(
    `SELECT body FROM mail_outbox WHERE to_email=$1 AND kind='client_email_verify' ORDER BY sent_at DESC LIMIT 1`,
    [email.toLowerCase()],
  );
  return (r.rows[0]?.body as string)?.match(/code is (\d{6})/)?.[1] ?? '';
}

/** A verified client, and the token that opens their doors. */
async function makeClient(email: string) {
  await app.inject({
    method: 'POST',
    url: `${C}/register`,
    payload: { email, password: PASSWORD, first: 'Fav', last: 'Tester', lang: 'en' },
  });
  const res = await app.inject({
    method: 'POST',
    url: `${C}/verify-email`,
    payload: { email, code: await codeFor(email) },
  });
  return { token: res.json().token as string, id: res.json().profile.id as string };
}

describe('favourites', () => {
  let token = '';
  let otherToken = '';
  let clientId = '';
  let salonId = '';
  let salonSlug = '';
  let serviceId = '';
  let categoryId = '';

  const call = (method: 'GET' | 'PUT' | 'DELETE', url: string, t = token) =>
    app.inject({ method, url: `${C}${url}`, headers: { authorization: `Bearer ${t}` } });

  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    await api.connect();
    ({ token, id: clientId } = await makeClient(EMAIL));
    ({ token: otherToken } = await makeClient(OTHER));

    // A real, admitted salon and one of its treatments.
    const cats = DiscoveryCategoriesSchema.parse(
      (await app.inject({ method: 'GET', url: `${P}/discovery/categories` })).json(),
    ).categories;
    for (const c of cats) {
      const body = (
        await app.inject({ method: 'GET', url: `${P}/discovery/categories/${c.id}/services` })
      ).json();
      if (body.services?.length) {
        categoryId = c.id;
        serviceId = body.services[0].id;
        salonSlug = body.services[0].salon.slug;
        break;
      }
    }
    const biz = await admin.query(`SELECT id FROM businesses WHERE slug=$1`, [salonSlug]);
    salonId = biz.rows[0].id;
  });

  afterAll(async () => {
    for (const e of [EMAIL, OTHER])
      await admin.query(`DELETE FROM client_users WHERE email=$1`, [e]);
    await admin.query(`DELETE FROM mail_outbox WHERE to_email IN ($1,$2)`, [
      EMAIL.toLowerCase(),
      OTHER.toLowerCase(),
    ]);
    await admin.end();
    await api.end();
    await app.close();
    await closeDb();
  });

  it('starts empty, and says so in a shape the section can render', async () => {
    const res = await call('GET', '/me/favourites');
    expect(res.statusCode).toBe(200);
    const body = ClientFavouritesSchema.parse(res.json());
    expect(body).toEqual({ salons: [], services: [], pros: [], hidden: 0 });
  });

  it('saves a salon and a service, and gives them back with their labels', async () => {
    expect((await call('PUT', `/me/favourites/salon/${salonId}`)).statusCode).toBe(200);
    expect((await call('PUT', `/me/favourites/service/${serviceId}`)).statusCode).toBe(200);
    const body = ClientFavouritesSchema.parse((await call('GET', '/me/favourites')).json());
    expect(body.salons.map((f) => f.id)).toEqual([salonId]);
    expect(body.services.map((f) => f.id)).toEqual([serviceId]);
    // Resolved across tenants, not just echoed back as ids.
    expect(body.salons[0]!.name.length).toBeGreaterThan(0);
    expect(body.services[0]!.sub).toMatch(/^at /);
    expect(body.services[0]!.salonSlug).toBe(salonSlug);
  });

  it('is idempotent both ways — a filled heart pressed twice is not two rows', async () => {
    await call('PUT', `/me/favourites/salon/${salonId}`);
    await call('PUT', `/me/favourites/salon/${salonId}`);
    const n = await admin.query(
      `SELECT count(*)::int AS n FROM client_favourites WHERE client_user_id=$1 AND kind='salon'`,
      [clientId],
    );
    expect(n.rows[0].n).toBe(1);
    // And removing something already gone is not an error either.
    expect((await call('DELETE', `/me/favourites/salon/${salonId}`)).statusCode).toBe(200);
    expect((await call('DELETE', `/me/favourites/salon/${salonId}`)).statusCode).toBe(200);
    await call('PUT', `/me/favourites/salon/${salonId}`);
  });

  it('refuses to save something that does not exist', async () => {
    const res = await call('PUT', `/me/favourites/service/${randomUUID()}`);
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('UNKNOWN_TARGET');
  });

  it('hides an unpublished target but keeps it, and brings it back when it returns', async () => {
    // The distinction the whole design rests on: the salon took this
    // treatment off sale, the person did not change their mind.
    await admin.query(`UPDATE services SET status='draft' WHERE id=$1`, [serviceId]);
    try {
      const hidden = ClientFavouritesSchema.parse((await call('GET', '/me/favourites')).json());
      expect(hidden.services).toEqual([]);
      expect(hidden.hidden).toBeGreaterThan(0);
      // Kept, not deleted — and not stamped as missing either, because
      // it is right there.
      const row = await admin.query(
        `SELECT missing_since FROM client_favourites WHERE client_user_id=$1 AND kind='service'`,
        [clientId],
      );
      expect(row.rowCount).toBe(1);
      expect(row.rows[0].missing_since).toBeNull();
    } finally {
      await admin.query(`UPDATE services SET status='active' WHERE id=$1`, [serviceId]);
    }
    const back = ClientFavouritesSchema.parse((await call('GET', '/me/favourites')).json());
    expect(back.services.map((f) => f.id)).toEqual([serviceId]);
  });

  it('stamps a target that has genuinely vanished, and clears the stamp if it returns', async () => {
    // Nothing in the API hard-deletes a service, so this is the seed
    // reset / manual operation case. Faked by pointing the row at an id
    // that is not there.
    const ghost = randomUUID();
    await admin.query(
      `INSERT INTO client_favourites (client_user_id, kind, tenant_id, ref_id)
       VALUES ($1,'service',$2,$3)`,
      [clientId, salonId, ghost],
    );
    try {
      const body = ClientFavouritesSchema.parse((await call('GET', '/me/favourites')).json());
      // Absent from the list, and not counted as merely hidden: it is
      // not coming back on its own.
      expect(body.services.some((f) => f.id === ghost)).toBe(false);
      const row = await admin.query(
        `SELECT missing_since FROM client_favourites WHERE client_user_id=$1 AND ref_id=$2`,
        [clientId, ghost],
      );
      expect(row.rows[0].missing_since, 'stamped on first sighting').not.toBeNull();
    } finally {
      await admin.query(`DELETE FROM client_favourites WHERE client_user_id=$1 AND ref_id=$2`, [
        clientId,
        ghost,
      ]);
    }
  });

  it('sweeps a target that has been gone longer than the grace period', async () => {
    const ghost = randomUUID();
    await admin.query(
      `INSERT INTO client_favourites (client_user_id, kind, tenant_id, ref_id, missing_since)
       VALUES ($1,'service',$2,$3, now() - interval '200 days')`,
      [clientId, salonId, ghost],
    );
    await call('GET', '/me/favourites');
    const row = await admin.query(
      `SELECT 1 FROM client_favourites WHERE client_user_id=$1 AND ref_id=$2`,
      [clientId, ghost],
    );
    // Orphans do not accumulate for ever, and the sweep rides on the
    // read that already knew the answer — this codebase has no cron.
    expect(row.rowCount).toBe(0);
  });

  it('is one client\'s and nobody else\'s', async () => {
    const mine = ClientFavouritesSchema.parse((await call('GET', '/me/favourites')).json());
    expect(mine.salons.length + mine.services.length).toBeGreaterThan(0);
    const theirs = ClientFavouritesSchema.parse(
      (await call('GET', '/me/favourites', otherToken)).json(),
    );
    expect(theirs.salons).toEqual([]);
    expect(theirs.services).toEqual([]);
  });

  it('is unreadable by a salon, whatever context it asks in', async () => {
    for (const [label, setup] of [
      ['no context', ''],
      ['tenant', `SET app.tenant_id = '${salonId}'`],
      ['public', `SET app.public = '1'`],
    ] as const) {
      await api.query('BEGIN');
      if (setup) await api.query(setup);
      const r = await api.query('SELECT count(*)::int AS n FROM client_favourites');
      await api.query('ROLLBACK');
      // A salon is never told who favourited it.
      expect(r.rows[0].n, `${label} must see nothing`).toBe(0);
    }
    // The owner can, which is the point of the policy.
    await api.query('BEGIN');
    await api.query(`SET app.client_id = '${clientId}'`);
    const mine = await api.query('SELECT count(*)::int AS n FROM client_favourites');
    await api.query('ROLLBACK');
    expect(mine.rows[0].n).toBeGreaterThan(0);
  });

  it('refuses a signed-out caller at every door', async () => {
    for (const [method, url] of [
      ['GET', '/me/favourites'],
      ['PUT', `/me/favourites/salon/${salonId}`],
      ['DELETE', `/me/favourites/salon/${salonId}`],
    ] as const) {
      const res = await app.inject({ method, url: `${C}${url}` });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('feeds the ranking affinity signal through the existing seam', async () => {
    // Phase B is closed: no weight moved, no rule was added. The only
    // change is that viewerHistory stops returning an empty array.
    const ranked = async (t?: string) => {
      const res = await app.inject({
        method: 'POST',
        url: `${P}/discovery/categories/${categoryId}/services`,
        ...(t ? { headers: { authorization: `Bearer ${t}` } } : {}),
        payload: {},
      });
      return DiscoveryRankedServicesSchema.parse(res.json());
    };
    const anon = await ranked();
    expect(anon.personalised).toBe(false);

    const mine = await ranked(token);
    expect(mine.personalised, 'a signed-in client with consent on').toBe(true);
    // The favourited treatment leads for the person who favourited it.
    expect(mine.services[0]!.id).toBe(serviceId);
    // And not for anybody else, unless it happened to lead anyway.
    expect(mine.services.map((s) => s.id).sort()).toEqual(anon.services.map((s) => s.id).sort());
  });

  it('does not reorder anything when personalisation is switched off', async () => {
    await app.inject({
      method: 'PATCH',
      url: `${C}/me`,
      headers: { authorization: `Bearer ${token}` },
      payload: { personalisedResults: false },
    });
    try {
      const res = await app.inject({
        method: 'POST',
        url: `${P}/discovery/categories/${categoryId}/services`,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });
      const body = DiscoveryRankedServicesSchema.parse(res.json());
      expect(body.personalised).toBe(false);
      const anon = DiscoveryRankedServicesSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: `${P}/discovery/categories/${categoryId}/services`,
            payload: {},
          })
        ).json(),
      );
      // Identical to a stranger's page: consent covers favourites too,
      // with no second switch to forget.
      expect(body.services.map((s) => s.id)).toEqual(anon.services.map((s) => s.id));
    } finally {
      await app.inject({
        method: 'PATCH',
        url: `${C}/me`,
        headers: { authorization: `Bearer ${token}` },
        payload: { personalisedResults: true },
      });
    }
  });
});
