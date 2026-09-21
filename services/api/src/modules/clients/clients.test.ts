import { randomUUID } from 'node:crypto';
import { API_PREFIX, ClientProfileSchema } from '@velnes/contracts';
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
const C = `${API_PREFIX}/client`;
const P = `${API_PREFIX}/public`;
const EMAIL = `test.client.${Date.now()}@example.com`;
const PASSWORD = 'velnes-test-12345';

/** A day far enough out that the seeded calendar is open. */
const futureTuesday = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 14 - ((d.getDay() + 5) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

async function codeFor(email: string): Promise<string> {
  const r = await admin.query(
    `SELECT body FROM mail_outbox WHERE to_email=$1 AND kind='client_email_verify' ORDER BY sent_at DESC LIMIT 1`,
    [email.toLowerCase()],
  );
  return (r.rows[0]?.body as string)?.match(/code is (\d{6})/)?.[1] ?? '';
}

describe('client users — the consumer account', () => {
  let token = '';
  let clientId = '';

  beforeAll(async () => {
    await app.ready();
    await admin.connect();
  });
  afterAll(async () => {
    await admin.query(
      `DELETE FROM appointment_history WHERE appointment_id IN (SELECT id FROM appointments WHERE client_user_id IN (SELECT id FROM client_users WHERE email=$1))`,
      [EMAIL],
    );
    await admin.query(
      `DELETE FROM appointments WHERE client_user_id IN (SELECT id FROM client_users WHERE email=$1)`,
      [EMAIL],
    );
    // The link references the customer: let it go first.
    const links = await admin.query(
      `SELECT customer_id FROM client_customer_links WHERE client_user_id IN (SELECT id FROM client_users WHERE email=$1)`,
      [EMAIL],
    );
    await admin.query(
      `DELETE FROM client_customer_links WHERE client_user_id IN (SELECT id FROM client_users WHERE email=$1)`,
      [EMAIL],
    );
    for (const row of links.rows)
      await admin.query(`DELETE FROM customers WHERE id=$1`, [row.customer_id]);
    await admin.query(`DELETE FROM mail_outbox WHERE to_email=$1`, [EMAIL.toLowerCase()]);
    await admin.query(`DELETE FROM client_users WHERE email=$1`, [EMAIL]);
    await admin.query(`DELETE FROM platform_notices WHERE kind='booking'`);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('registers, queues a real code, and refuses to sign in until it is used', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: `${C}/register`,
      payload: {
        email: EMAIL,
        password: PASSWORD,
        first: 'Test',
        last: 'Client',
        phone: '+389 70 000 111',
        dob: '1992-03-14',
        lang: 'en',
      },
    });
    expect(reg.statusCode).toBe(200);
    // The mail went to the outbox — the only place mail exists today.
    const code = await codeFor(EMAIL);
    expect(code).toMatch(/^\d{6}$/);

    const early = await app.inject({
      method: 'POST',
      url: `${C}/login`,
      payload: { email: EMAIL, password: PASSWORD },
    });
    expect(early.statusCode).toBe(400);
    expect(early.json().error).toBe('EMAIL_UNVERIFIED');
  });

  it('refuses a wrong code, then accepts the real one and opens a session', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: `${C}/verify-email`,
      payload: { email: EMAIL, code: '000000' },
    });
    expect(bad.statusCode).toBe(400);

    const res = await app.inject({
      method: 'POST',
      url: `${C}/verify-email`,
      payload: { email: EMAIL, code: await codeFor(EMAIL) },
    });
    expect(res.statusCode).toBe(200);
    token = res.json().token;
    const profile = ClientProfileSchema.parse(res.json().profile);
    clientId = profile.id;
    expect(profile.emailVerified).toBe(true);
    expect(profile.first).toBe('Test');
  });

  it('answers the same whether or not an address already has an account', async () => {
    // No oracle: registering an existing address looks like a new one.
    const again = await app.inject({
      method: 'POST',
      url: `${C}/register`,
      payload: { email: EMAIL, password: 'another-password-1', first: 'Someone', last: '', phone: '', dob: null, lang: 'en' },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ pending: true });
    // …and the existing account's password is untouched.
    const login = await app.inject({
      method: 'POST',
      url: `${C}/login`,
      payload: { email: EMAIL, password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
  });

  it('rejects the other three token shapes and its own on staff doors', async () => {
    // A client token on a tenant door.
    const staff = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/locations`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(staff.statusCode).toBe(401);
    // No token at all on a client door.
    const anon = await app.inject({ method: 'GET', url: `${C}/me` });
    expect(anon.statusCode).toBe(401);
  });

  it('books: that is what makes a person a salon customer, and both bells ring', async () => {
    const avail = await app.inject({
      method: 'GET',
      url: `${P}/availability?key=pk_live_velnes_demo&locationId=${demo.locAerodrom}&serviceId=${demo.s1}&date=${futureTuesday}`,
    });
    const slot = avail.json().slots.find((s: { free: boolean }) => s.free);
    expect(slot, 'the seeded calendar has an open slot').toBeDefined();

    const res = await app.inject({
      method: 'POST',
      url: `${C}/book`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        key: randomUUID(),
        slug: 'velnes-fizio',
        locationId: demo.locAerodrom,
        serviceId: demo.s1,
        date: futureTuesday,
        time: slot.t,
        employeeId: 'any',
      },
    });
    expect(res.statusCode).toBe(200);

    // The salon now owns a customer row for this person, linked.
    const link = await admin.query(
      `SELECT c.name, c.email FROM client_customer_links l
       JOIN customers c ON c.id = l.customer_id
       WHERE l.client_user_id = $1`,
      [clientId],
    );
    expect(link.rows).toHaveLength(1);
    expect(link.rows[0].email).toBe(EMAIL.toLowerCase());

    // The salon's own bell heard about it.
    const salonBell = await admin.query(
      `SELECT title FROM platform_notices WHERE kind='booking' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(salonBell.rows[0]?.title).toBe('New booking from Velnes');

    // And so did the client's.
    const bell = await app.inject({
      method: 'GET',
      url: `${C}/me/notifications`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(bell.json().notifications[0].title).toBe('Booking confirmed');
    expect(bell.json().unread).toBeGreaterThan(0);
  });

  it('lists my appointments across salons, with the salon’s own labels', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${C}/me/appointments`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const [a] = res.json().appointments;
    expect(a.salonName).toBe('Velnes Fizio Centar');
    expect(a.locationName).toBe('Aerodrom');
    // Resolved through the salon's own context — a client context alone
    // cannot see these tables.
    expect(a.serviceName).not.toBe('');
    expect(a.price).toBeGreaterThan(0);
  });

  it('cancels its own appointment — and only its own', async () => {
    const list = await app.inject({
      method: 'GET',
      url: `${C}/me/appointments`,
      headers: { authorization: `Bearer ${token}` },
    });
    const id = list.json().appointments[0].id;
    const ok = await app.inject({
      method: 'POST',
      url: `${C}/me/appointments/${id}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ok.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: `${C}/me/appointments`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.json().appointments[0].status).toBe('cancelled');

    // Somebody else's appointment is simply not found.
    const foreign = await admin.query(
      `SELECT id FROM appointments WHERE client_user_id IS NULL LIMIT 1`,
    );
    if (foreign.rows[0]) {
      const nope = await app.inject({
        method: 'POST',
        url: `${C}/me/appointments/${foreign.rows[0].id}/cancel`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(nope.statusCode).toBe(404);
    }
    // The salon's history records who did it.
    const hist = await admin.query(
      `SELECT what, source FROM appointment_history WHERE appointment_id=$1 ORDER BY at DESC LIMIT 1`,
      [id],
    );
    expect(hist.rows[0]).toMatchObject({ what: 'Cancelled', source: 'client' });
  });

  it('edits the profile it owns; email stays the sign-in identity', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `${C}/me`,
      headers: { authorization: `Bearer ${token}` },
      payload: { first: 'Testina', phone: '+389 70 222 333' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().first).toBe('Testina');
    expect(res.json().email).toBe(EMAIL.toLowerCase());
  });

  it('starts with personalised results on, and lets the client switch them off', async () => {
    // §5, decided: on by default. The setting governs the viewer's own
    // history, used for the viewer's own eyes — but it must be theirs to
    // turn off, and it must stick.
    const me = await app.inject({
      method: 'GET',
      url: `${C}/me`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.json().personalisedResults).toBe(true);

    const off = await app.inject({
      method: 'PATCH',
      url: `${C}/me`,
      headers: { authorization: `Bearer ${token}` },
      payload: { personalisedResults: false },
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().personalisedResults).toBe(false);

    // Read back through a fresh request, not just the patch's own echo.
    const again = await app.inject({
      method: 'GET',
      url: `${C}/me`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(again.json().personalisedResults).toBe(false);

    const on = await app.inject({
      method: 'PATCH',
      url: `${C}/me`,
      headers: { authorization: `Bearer ${token}` },
      payload: { personalisedResults: true },
    });
    expect(on.json().personalisedResults).toBe(true);
  });

  it('remembers the location decision — three states, and never a position', async () => {
    // Nobody has been asked: null, so the home page knows to ask once.
    const me = await app.inject({
      method: 'GET',
      url: `${C}/me`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.json().locationAllowed).toBeNull();

    const yes = await app.inject({
      method: 'PATCH',
      url: `${C}/me`,
      headers: { authorization: `Bearer ${token}` },
      payload: { locationAllowed: true },
    });
    expect(yes.statusCode).toBe(200);
    expect(yes.json().locationAllowed).toBe(true);

    // A no is a no, distinct from "never asked".
    const no = await app.inject({
      method: 'PATCH',
      url: `${C}/me`,
      headers: { authorization: `Bearer ${token}` },
      payload: { locationAllowed: false },
    });
    expect(no.json().locationAllowed).toBe(false);

    // An unrelated edit leaves the answer alone.
    const other = await app.inject({
      method: 'PATCH',
      url: `${C}/me`,
      headers: { authorization: `Bearer ${token}` },
      payload: { first: 'Testina' },
    });
    expect(other.json().locationAllowed).toBe(false);

    // The door takes the decision and nothing else: coordinates in the
    // body are not a field, so the contract strips them and there is
    // no column for them to land in. Where a customer stood is the one
    // thing this table must never learn.
    const coords = await app.inject({
      method: 'PATCH',
      url: `${C}/me`,
      headers: { authorization: `Bearer ${token}` },
      payload: { locationAllowed: true, lat: 41.99, lng: 21.43 },
    });
    expect(coords.statusCode).toBe(200);
    expect(coords.json().locationAllowed).toBe(true);
    expect(coords.json()).not.toHaveProperty('lat');
    expect(coords.json()).not.toHaveProperty('lng');

    // Back to "never asked" is allowed too — a reset from support.
    const reset = await app.inject({
      method: 'PATCH',
      url: `${C}/me`,
      headers: { authorization: `Bearer ${token}` },
      payload: { locationAllowed: null },
    });
    expect(reset.json().locationAllowed).toBeNull();
  });

  it('leaves the switch alone when other fields are edited', async () => {
    await app.inject({
      method: 'PATCH',
      url: `${C}/me`,
      headers: { authorization: `Bearer ${token}` },
      payload: { personalisedResults: false },
    });
    // An unrelated edit must not quietly turn personalisation back on —
    // a consent setting that resets itself is not consent.
    const res = await app.inject({
      method: 'PATCH',
      url: `${C}/me`,
      headers: { authorization: `Bearer ${token}` },
      payload: { first: 'Testina' },
    });
    expect(res.json().personalisedResults).toBe(false);
    await app.inject({
      method: 'PATCH',
      url: `${C}/me`,
      headers: { authorization: `Bearer ${token}` },
      payload: { personalisedResults: true },
    });
  });
});
