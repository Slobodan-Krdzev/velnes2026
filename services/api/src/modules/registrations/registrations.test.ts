import { randomUUID } from 'node:crypto';
import { API_PREFIX } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { resetAdmittedCache } from '../../public/discovery.routes.js';
import { buildServer } from '../../server.js';

const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });

const day = (closed = false) => ({
  open: '09:00',
  close: '19:00',
  closed,
  split: false,
  open2: '15:00',
  close2: '19:00',
});
const draft = (email: string, salon = 'Studio Nova') => ({
  acct: { name: 'Petra Novak', email, pass: 'super-secret' },
  salon: { name: salon, type: 'Physiotherapy', phone: '+389 70 123 456', langs: 'MK, EN' },
  legal: { name: 'Nova Health DOO', taxId: 'MK4032011501234', vat: '', currency: 'MKD' },
  loc: { street: 'Partizanska', no: '12', city: 'Bitola', zip: '7000', lat: 41.03, lng: 21.33 },
  services: [
    { name: 'Physiotherapy session', category: 'Manual therapy', durationMin: 45, price: 1800 },
    { name: 'Sports massage', category: 'Recovery', durationMin: 45, price: 1900 },
  ],
  products: [{ name: 'Kinesiology tape', category: 'Recovery aids', price: 550 }],
  gallery: [{ name: 'Front room', img: 'data:image/png;base64,AAAA' }],
  team: [
    { name: 'Ana Trajkovska', email: 'ana@studionova.test' },
    { name: 'Marko Ilievski', email: 'marko@studionova.test' },
  ],
  hours: {
    mon: day(), tue: day(), wed: day(), thu: day(), fri: day(), sat: day(), sun: day(true),
  },
});

let regId = '';
let regToken = '';
let emailToken = ''; // the token in the latest verification mail
let declinedId = '';
let hqToken = '';
let supportToken = '';
let newBusinessId = '';
let createdBusinessId = '';
const submittedLoc = randomUUID();
const pendingEntity = randomUUID();

async function hqLogin(email: string) {
  const res = await app.inject({
    method: 'POST',
    url: `${API_PREFIX}/hq/auth/login`,
    payload: { email, password: 'velnes-demo' },
  });
  return res.json().accessToken as string;
}

describe('registrations and the HQ intake table', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    hqToken = await hqLogin('damjan@revelapps.com');
    supportToken = await hqLogin('tea@revelapps.com');
    // A location waiting for verification, with a new (pending) legal
    // entity — the compound-review case.
    await admin.query(
      `INSERT INTO locations (id, tenant_id, name, city, address, hours, lifecycle, inv_prefix)
       VALUES ($1,$2,'Debar Maalo','Skopje','Orce Nikolov 55','{"1":[["09:00","20:00"]]}','SUBMITTED','DEB-')`,
      [submittedLoc, demo.business],
    );
    await admin.query(
      `INSERT INTO legal_entities (id, tenant_id, owner_type, name, tax_id, status)
       VALUES ($1,$2,'salon','Debar Maalo Fizio DOOEL','MK4080009900112','pending')`,
      [pendingEntity, demo.business],
    );
    await admin.query(
      `INSERT INTO legal_entity_locations (tenant_id, legal_entity_id, location_id) VALUES ($1,$2,$3)`,
      [demo.business, pendingEntity, submittedLoc],
    );
  });

  afterAll(async () => {
    // The registration references the business — release it first.
    // Its tenant-less mails (verification, HQ's decisions) go with it.
    await admin.query(`DELETE FROM mail_outbox WHERE ref_id = ANY($1)`, [[regId, declinedId]]);
    await admin.query(`DELETE FROM registrations WHERE id = ANY($1)`, [[regId, declinedId]]);
    if (createdBusinessId) {
      const b = createdBusinessId;
      await admin.query(`UPDATE businesses SET owner_employee_id=NULL WHERE id=$1`, [b]);
      for (const t of ['audit_log', 'mail_outbox', 'locations', 'employees', 'roles'])
        await admin.query(`DELETE FROM ${t} WHERE tenant_id=$1`, [b]);
      await admin.query(`DELETE FROM businesses WHERE id=$1`, [b]);
    }
    if (newBusinessId) {
      const b = newBusinessId;
      await admin.query(`UPDATE businesses SET owner_employee_id=NULL WHERE id=$1`, [b]);
      // service_categories are the global Velnes taxonomy now — a
      // tenant teardown never touches them.
      for (const t of [
        'audit_log', 'mail_outbox', 'refresh_tokens', 'user_credentials', 'employee_skills',
        'employee_locations', 'legal_entity_locations', 'legal_entities',
        'location_catalog_products', 'products', 'location_lifecycle_log',
        'widgets', 'locations', 'services', 'employees', 'roles',
      ])
        await admin.query(`DELETE FROM ${t} WHERE tenant_id=$1`, [b]);
      await admin.query(`DELETE FROM businesses WHERE id=$1`, [b]);
    }
    await admin.query(`DELETE FROM location_lifecycle_log WHERE location_id=$1`, [submittedLoc]);
    await admin.query(`DELETE FROM legal_entity_locations WHERE location_id=$1`, [submittedLoc]);
    await admin.query(`DELETE FROM legal_entities WHERE id=$1`, [pendingEntity]);
    await admin.query(`DELETE FROM locations WHERE id=$1`, [submittedLoc]);
    await admin.query(
      `DELETE FROM audit_log WHERE object IN ('Registration · Studio Nova','Location · Debar Maalo')`,
    );
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('takes an application at the anonymous door and hands back the token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/registrations`,
      payload: draft('petra@studionova.mk'),
    });
    expect(res.statusCode).toBe(200);
    regId = res.json().id;
    regToken = res.json().resubmitToken;
    expect(res.json().status).toBe('pending_review');

    // The verification mail is queued in the same act — tenant-less
    // (no salon exists yet), its button the status page unlocked by
    // the e-mail token.
    const mail = await admin.query(
      `SELECT to_email, subject, meta FROM mail_outbox WHERE ref_id=$1 AND kind='registration_verify'`,
      [regId],
    );
    expect(mail.rows).toHaveLength(1);
    expect(mail.rows[0].to_email).toBe('petra@studionova.mk');
    expect(mail.rows[0].subject).toContain('Studio Nova');
    const url = new URL(mail.rows[0].meta.cta.url);
    expect(url.pathname).toBe(`/registration/${regId}`);
    emailToken = url.searchParams.get('token') ?? '';
    expect(emailToken).toMatch(/^[0-9a-f-]{36}$/);
    const stamped = await admin.query(`SELECT email_sent_at, email_verified_at FROM registrations WHERE id=$1`, [regId]);
    expect(stamped.rows[0].email_sent_at).not.toBeNull();
    expect(stamped.rows[0].email_verified_at).toBeNull();

    // The applicant sees their own row — never the password back out.
    const mine = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/registrations/${regId}?token=${regToken}`,
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().draft.acct.pass).toBeUndefined();
    // A wrong token sees nothing at all (RLS, not an if-statement).
    const wrong = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/registrations/${regId}?token=${randomUUID()}`,
    });
    expect(wrong.statusCode).toBe(404);
  });

  it('the e-mail link confirms the address once and hands back the way into the wizard', async () => {
    // A wrong token sees nothing — RLS on the e-mail token, not an if.
    const wrong = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/registrations/${regId}/verify-email?token=${randomUUID()}`,
    });
    expect(wrong.statusCode).toBe(404);
    // The resubmit token opens no verification door either.
    const cross = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/registrations/${regId}/verify-email?token=${regToken}`,
    });
    expect(cross.statusCode).toBe(404);

    const ok = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/registrations/${regId}/verify-email?token=${emailToken}`,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe('pending_review');
    expect(ok.json().salonName).toBe('Studio Nova');
    expect(ok.json().email).toBe('petra@studionova.mk');
    expect(ok.json().resubmitToken).toBe(regToken);
    const first = ok.json().verifiedAt as string;

    // A second click keeps the first stamp.
    const again = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/registrations/${regId}/verify-email?token=${emailToken}`,
    });
    expect(again.json().verifiedAt).toBe(first);

    // HQ sees the address as verified.
    const queue = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/hq/registrations`,
      headers: { authorization: `Bearer ${hqToken}` },
    });
    const row = queue.json().registrations.find((x: { id: string }) => x.id === regId);
    expect(row.emailVerifiedAt).toBe(first);
  });

  it('refuses an email that already has an account', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/registrations`,
      payload: draft('maria@velnes.mk'),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('EMAIL_TAKEN');
  });

  it('keeps the token shapes apart: HQ tokens open no tenant door and vice versa', async () => {
    const tenantDoor = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/employees`,
      headers: { authorization: `Bearer ${hqToken}` },
    });
    expect(tenantDoor.statusCode).toBe(401);
    const login = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/auth/login`,
      payload: { email: 'maria@velnes.mk', password: 'velnes-demo' },
    });
    const hqDoor = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/hq/registrations`,
      headers: { authorization: `Bearer ${login.json().accessToken}` },
    });
    expect(hqDoor.statusCode).toBe(401);
  });

  it('walks the machine: request changes (reason mandatory) → resubmit', async () => {
    const noReason = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/registrations/${regId}/request-changes`,
      headers: { authorization: `Bearer ${hqToken}` },
      payload: { reason: '  ' },
    });
    expect(noReason.statusCode).toBe(422);

    const support = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/registrations/${regId}/request-changes`,
      headers: { authorization: `Bearer ${supportToken}` },
      payload: { reason: 'Tax id looks off' },
    });
    expect(support.statusCode).toBe(403); // hq_support does not decide intake

    const sent = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/registrations/${regId}/request-changes`,
      headers: { authorization: `Bearer ${hqToken}` },
      payload: { reason: 'The tax number is missing a digit' },
    });
    expect(sent.json().status).toBe('changes_required');
    // The decision reaches the applicant by mail, reason included, with
    // the same link the verification mail carried.
    const changesMail = await admin.query(
      `SELECT to_email, body, meta FROM mail_outbox WHERE ref_id=$1 AND kind='registration_changes'`,
      [regId],
    );
    expect(changesMail.rows).toHaveLength(1);
    expect(changesMail.rows[0].to_email).toBe('petra@studionova.mk');
    expect(changesMail.rows[0].body).toContain('The tax number is missing a digit');
    expect(changesMail.rows[0].meta.cta.url).toContain(`/registration/${regId}?token=${emailToken}`);

    // Resubmitting under a different address makes it unconfirmed again:
    // fresh token, fresh mail, the old link dead.
    const moved = draft('petra.moved@studionova.mk');
    moved.legal.taxId = 'MK4032011509999';
    const movedRes = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/registrations/${regId}/resubmit?token=${regToken}`,
      payload: moved,
    });
    expect(movedRes.statusCode).toBe(200);
    expect(movedRes.json().status).toBe('resubmitted');
    const verifyMails = async () =>
      (
        await admin.query(
          `SELECT to_email, meta FROM mail_outbox WHERE ref_id=$1 AND kind='registration_verify' ORDER BY created_at`,
          [regId],
        )
      ).rows as { to_email: string; meta: { cta: { url: string } } }[];
    let mails = await verifyMails();
    expect(mails.map((m) => m.to_email)).toEqual(['petra@studionova.mk', 'petra.moved@studionova.mk']);
    const oldLink = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/registrations/${regId}/verify-email?token=${emailToken}`,
    });
    expect(oldLink.statusCode).toBe(404);
    const reset = await admin.query(`SELECT email_verified_at FROM registrations WHERE id=$1`, [regId]);
    expect(reset.rows[0].email_verified_at).toBeNull();
    emailToken = new URL(mails[1]!.meta.cta.url).searchParams.get('token') ?? '';
    const newLink = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/registrations/${regId}/verify-email?token=${emailToken}`,
    });
    expect(newLink.statusCode).toBe(200);
    expect(newLink.json().status).toBe('resubmitted');
    expect(newLink.json().email).toBe('petra.moved@studionova.mk');

    // Back to the address the story signs in with — a change is a change.
    const sentAgain = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/registrations/${regId}/request-changes`,
      headers: { authorization: `Bearer ${hqToken}` },
      payload: { reason: 'Use the address you registered with' },
    });
    expect(sentAgain.json().status).toBe('changes_required');
    const fixed = draft('petra@studionova.mk');
    fixed.legal.taxId = 'MK4032011509999';
    const back = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/registrations/${regId}/resubmit?token=${regToken}`,
      payload: fixed,
    });
    expect(back.statusCode).toBe(200);
    expect(back.json().status).toBe('resubmitted');
    mails = await verifyMails();
    expect(mails).toHaveLength(3);
    emailToken = new URL(mails[2]!.meta.cta.url).searchParams.get('token') ?? '';

    const queue = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/hq/registrations`,
      headers: { authorization: `Bearer ${hqToken}` },
    });
    const row = queue.json().registrations.find((x: { id: string }) => x.id === regId);
    expect(row.status).toBe('resubmitted');
    expect(row.taxId).toBe('MK4032011509999');
  });

  it('approve provisions the tenant world — and the new owner can sign straight in', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/registrations/${regId}/approve`,
      headers: { authorization: `Bearer ${hqToken}` },
    });
    expect(res.statusCode).toBe(200);
    newBusinessId = res.json().businessId;
    expect(res.json().ownerEmail).toBe('petra@studionova.mk');

    // Approving twice returns the same world, never a double.
    const again = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/registrations/${regId}/approve`,
      headers: { authorization: `Bearer ${hqToken}` },
    });
    expect(again.json().businessId).toBe(newBusinessId);

    const login = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/auth/login`,
      payload: { email: 'petra@studionova.mk', password: 'super-secret' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().employee.access).toBe('owner');
    const meRes = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/auth/me`,
      headers: { authorization: `Bearer ${login.json().accessToken}` },
    });
    expect(meRes.json().tenantId).toBe(newBusinessId);

    // Their world: one location already ACTIVE — an approved salon is
    // bookable the same minute — the picked starter services, and RLS
    // keeping the demo salon out.
    const locs = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/locations`,
      headers: { authorization: `Bearer ${login.json().accessToken}` },
    });
    expect(locs.json().locations).toHaveLength(1);
    expect(locs.json().locations[0].lifecycle).toBe('ACTIVE');
    expect(locs.json().locations[0].online).toBe(true);
    const step = await admin.query(
      `SELECT from_state, to_state, reason FROM location_lifecycle_log WHERE tenant_id=$1`,
      [newBusinessId],
    );
    expect(step.rows).toEqual([{ from_state: 'APPROVED', to_state: 'ACTIVE', reason: 'Registration approved' }]);
    const svc = await admin.query(`SELECT name FROM services WHERE tenant_id=$1 ORDER BY sort`, [
      newBusinessId,
    ]);
    expect(svc.rows.map((r: { name: string }) => r.name)).toEqual([
      'Physiotherapy session',
      'Sports massage',
    ]);
    // Every wizard service is online, and the owner is skilled in all
    // of them — the readiness gate's two catalog requirements.
    const online = await admin.query(
      `SELECT count(*)::int AS n FROM services WHERE tenant_id=$1 AND online AND status='active'`,
      [newBusinessId],
    );
    expect(online.rows[0].n).toBe(2);
    const skills = await admin.query(
      `SELECT count(*)::int AS n FROM employee_skills sk
         JOIN employees e ON e.id = sk.employee_id
        WHERE sk.tenant_id=$1 AND e.access='owner'`,
      [newBusinessId],
    );
    expect(skills.rows[0].n).toBe(2);
    // No website widget is made: that is the salon's separate product,
    // and the consumer app does not need one.
    const widget = await admin.query(`SELECT id FROM widgets WHERE tenant_id=$1`, [newBusinessId]);
    expect(widget.rows).toHaveLength(0);
    // The salon's own product, stocked at 0 at the created location.
    const prod = await admin.query(
      `SELECT p.name, lcp.stock FROM products p
       JOIN location_catalog_products lcp ON lcp.product_id = p.id
       WHERE p.tenant_id=$1`,
      [newBusinessId],
    );
    expect(prod.rows[0]?.name).toBe('Kinesiology tape');
    expect(Number(prod.rows[0]?.stock)).toBe(0);
    // The business carries the city and a booking slug (the lost-city fix).
    const biz = await admin.query(`SELECT city, slug, gallery FROM businesses WHERE id=$1`, [newBusinessId]);
    expect(biz.rows[0].city).toBe('Bitola');
    expect(biz.rows[0].slug).toBeTruthy();
    // The wizard's photo lands in the business gallery, id-stamped.
    const gal = biz.rows[0].gallery as { name: string; img: string; id: string }[];
    expect(gal).toHaveLength(1);
    expect(gal[0]!.name).toBe('Front room');
    expect(gal[0]!.img).toBe('data:image/png;base64,AAAA');
    expect(gal[0]!.id).toBeTruthy();
    const entity = await admin.query(
      `SELECT status FROM legal_entities WHERE tenant_id=$1`,
      [newBusinessId],
    );
    expect(entity.rows[0].status).toBe('verified');

    // The two colleagues from the wizard are provisioned as invited,
    // non-bookable staff, linked to the location and mailed an invite.
    const team = await admin.query(
      `SELECT e.name, e.access, e.status, e.bookable,
              (SELECT count(*) FROM employee_locations el WHERE el.employee_id=e.id) AS locs
         FROM employees e
        WHERE e.tenant_id=$1 AND e.access='staff'
        ORDER BY e.name`,
      [newBusinessId],
    );
    expect(team.rows.map((r) => r.name)).toEqual(['Ana Trajkovska', 'Marko Ilievski']);
    expect(team.rows.every((r) => r.status === 'invited' && r.bookable === false)).toBe(true);
    expect(team.rows.every((r) => Number(r.locs) === 1)).toBe(true);
    // Two standard roles, and both colleagues hold the basic Employee
    // one: book appointments, take payments, nothing else.
    const roles = await admin.query(
      `SELECT name, std, locked FROM roles WHERE tenant_id=$1 ORDER BY name`,
      [newBusinessId],
    );
    expect(roles.rows).toEqual([
      { name: 'Employee', std: true, locked: false },
      { name: 'Owner', std: true, locked: true },
    ]);
    const held = await admin.query(
      `SELECT r.name, r.perms FROM employees e JOIN roles r ON r.id = e.role_id
        WHERE e.tenant_id=$1 AND e.access='staff'`,
      [newBusinessId],
    );
    expect(held.rows.map((r) => r.name)).toEqual(['Employee', 'Employee']);
    const perms = held.rows[0].perms as Record<string, string>;
    expect(perms['appointments.create']).toBe('location');
    expect(perms['pos.checkout']).toBe('location');
    expect(perms['catalog.view']).toBe('none');
    expect(perms['customers.view_assigned']).toBe('none');
    expect(perms['reports.view_own']).toBe('none');
    expect(perms['users.manage']).toBe('none');
    const invites = await admin.query(
      `SELECT count(*)::int AS n FROM mail_outbox WHERE tenant_id=$1 AND kind='employee_invite'`,
      [newBusinessId],
    );
    expect(invites.rows[0].n).toBe(2);

    // The owner hears it by mail — a tenant mail now, the button the
    // same link, which the status page turns into sign-in.
    const live = await admin.query(
      `SELECT to_email, subject, meta FROM mail_outbox WHERE tenant_id=$1 AND kind='registration_approved'`,
      [newBusinessId],
    );
    expect(live.rows).toHaveLength(1);
    expect(live.rows[0].to_email).toBe('petra@studionova.mk');
    expect(live.rows[0].subject).toBe('Studio Nova is live on Velnes');
    expect(live.rows[0].meta.cta.url).toContain(`/registration/${regId}?token=${emailToken}`);
    const door = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/registrations/${regId}/verify-email?token=${emailToken}`,
    });
    expect(door.json().status).toBe('active');
  });

  it('a decline reaches the applicant by mail too', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/registrations`,
      payload: draft('nikola@studioduo.test', 'Studio Duo'),
    });
    expect(res.statusCode).toBe(200);
    declinedId = res.json().id;
    const declined = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/registrations/${declinedId}/decline`,
      headers: { authorization: `Bearer ${hqToken}` },
    });
    expect(declined.json().status).toBe('declined');
    const mail = await admin.query(
      `SELECT kind, to_email, meta FROM mail_outbox WHERE ref_id=$1 ORDER BY created_at`,
      [declinedId],
    );
    expect(mail.rows.map((m: { kind: string }) => m.kind)).toEqual(['registration_verify', 'registration_declined']);
    expect(mail.rows[1].to_email).toBe('nikola@studioduo.test');
    expect(mail.rows[1].meta.cta).toBeUndefined(); // nowhere to go
  });

  it('the approved salon is on the consumer app at once, bookable, services on offer', async () => {
    resetAdmittedCache();
    const biz = await admin.query(`SELECT slug FROM businesses WHERE id=$1`, [newBusinessId]);
    const salon = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/public/discovery/salons/${biz.rows[0].slug}`,
    });
    expect(salon.statusCode).toBe(200);
    expect(salon.json().bookable).toBe(true);
    expect(salon.json().locations).toHaveLength(1);
    // The consumer key opens the booking doors without any widget.
    const key = salon.json().publishableKey as string;
    expect(key).toBe(`salon:${biz.rows[0].slug}`);
    const services = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/public/services?key=${encodeURIComponent(key)}&locationId=${salon.json().locations[0].id}`,
    });
    expect(services.statusCode).toBe(200);
    expect(services.json().services.map((s: { name: string }) => s.name)).toEqual([
      'Physiotherapy session',
      'Sports massage',
    ]);
    // The widget's own configuration door is not a consumer thing.
    const cfg = await app.inject({ method: 'GET', url: `${API_PREFIX}/public/widget?key=${encodeURIComponent(key)}` });
    expect(cfg.statusCode).toBe(404);
    const cards = await app.inject({ method: 'GET', url: `${API_PREFIX}/public/discovery/salons` });
    const card = cards.json().salons.find((x: { id: string }) => x.id === newBusinessId);
    expect(card?.bookable).toBe(true);
    // The wizard's services are searchable the same minute.
    const found = await admin.query(
      `SELECT display FROM search_documents WHERE tenant_id=$1 AND kind='service' ORDER BY display`,
      [newBusinessId],
    );
    expect(found.rows.map((r) => r.display)).toEqual(['Physiotherapy session', 'Sports massage']);
  });

  it('runs the New-locations queue: compound review verifies the entity in the same act', async () => {
    const queue = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/hq/locations`,
      headers: { authorization: `Bearer ${hqToken}` },
    });
    const row = queue.json().locations.find((x: { id: string }) => x.id === submittedLoc);
    expect(row).toBeDefined();
    expect(row.legalStatus).toBe('pending');

    const review = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/hq/locations/${submittedLoc}`,
      headers: { authorization: `Bearer ${hqToken}` },
    });
    expect(review.json().compound).toBe(true);

    const noReason = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/locations/${submittedLoc}/decision`,
      headers: { authorization: `Bearer ${hqToken}` },
      payload: { action: 'request_changes' },
    });
    expect(noReason.statusCode).toBe(422);

    const approved = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/locations/${submittedLoc}/decision`,
      headers: { authorization: `Bearer ${hqToken}` },
      payload: { action: 'approve' },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().lifecycle).toBe('APPROVED');

    const entity = await admin.query(`SELECT status FROM legal_entities WHERE id=$1`, [
      pendingEntity,
    ]);
    expect(entity.rows[0].status).toBe('verified');
    const log = await admin.query(
      `SELECT reason FROM location_lifecycle_log WHERE location_id=$1 AND to_state='APPROVED'`,
      [submittedLoc],
    );
    expect(log.rows).toHaveLength(1);
    const audit = await admin.query(
      `SELECT actor_name FROM audit_log WHERE object='Location · Debar Maalo' AND action='Location lifecycle' ORDER BY ts DESC LIMIT 1`,
    );
    expect(audit.rows[0].actor_name).toBe('HQ · Damjan Kostov');
  });

  it('serves the cross-tenant platform views: businesses and the platform log', async () => {
    const biz = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/hq/businesses`,
      headers: { authorization: `Bearer ${hqToken}` },
    });
    const names = biz.json().businesses.map((b: { name: string }) => b.name);
    expect(names).toContain('Velnes Fizio Centar');
    expect(names).toContain('Studio Nova');

    const audit = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/hq/audit?limit=50`,
      headers: { authorization: `Bearer ${supportToken}` },
    });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().entries.length).toBeGreaterThan(0);
    expect(audit.json().entries[0].tenantName).toBeDefined();
  });

  it('derives the dashboard truthfully: status, onboarding steps, plan revenue', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/hq/businesses`,
      headers: { authorization: `Bearer ${hqToken}` },
    });
    const { businesses, stats } = res.json();
    const velnes = businesses.find((b: { name: string }) => b.name === 'Velnes Fizio Centar');
    // Fully set-up demo world: every step derived true, live, Business plan.
    expect(velnes.status).toBe('live');
    expect(Object.values(velnes.steps).every(Boolean)).toBe(true);
    expect(velnes.mrr).toBe(139);
    const vita = businesses.find((b: { name: string }) => b.name === 'Vita Fizio');
    expect(vita.status).toBe('onboarding');
    expect(vita.steps).toMatchObject({ catalog: false, payments: false, widget: false });
    expect(vita.mrr).toBe(49);
    const spa = businesses.find((b: { name: string }) => b.name === 'Spa Ohrid');
    // Invited owner: one draft location counts, the step does not, and
    // nothing is billed yet.
    expect(spa.status).toBe('invited');
    expect(spa.locations).toBe(1);
    expect(spa.steps.locations).toBe(false);
    expect(spa.mrr).toBe(0);
    // Support isn't built: the numbers say so instead of pretending.
    expect(spa.openTickets).toBe(0);
    expect(spa.lastSupportAccess).toBeNull();
    expect(stats.businesses).toBe(businesses.length);
    expect(stats.monthlyRevenue).toBe(
      businesses.reduce((s: number, b: { mrr: number }) => s + b.mrr, 0),
    );
  });

  it('creates a business account behind the HQ door: invited owner, no password, queued invite', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/businesses`,
      headers: { authorization: `Bearer ${hqToken}` },
      payload: {
        name: 'Studio Ki',
        city: 'Tetovo',
        plan: 'Starter',
        ownerName: 'Lira Osmani',
        ownerEmail: 'lira@studioki.mk',
        firstLocation: 'Centar',
      },
    });
    expect(res.statusCode).toBe(200);
    createdBusinessId = res.json().id;

    const owner = await admin.query(
      `SELECT e.status, e.access,
              (SELECT count(*) FROM user_credentials c WHERE c.employee_id=e.id) AS creds
       FROM businesses b JOIN employees e ON e.id=b.owner_employee_id WHERE b.id=$1`,
      [createdBusinessId],
    );
    expect(owner.rows[0]).toMatchObject({ status: 'invited', access: 'owner', creds: '0' });
    const loc = await admin.query(`SELECT name, lifecycle FROM locations WHERE tenant_id=$1`, [
      createdBusinessId,
    ]);
    expect(loc.rows[0]).toMatchObject({ name: 'Centar', lifecycle: 'APPROVED' });
    const mail = await admin.query(
      `SELECT kind, status FROM mail_outbox WHERE tenant_id=$1 AND kind='owner_invite'`,
      [createdBusinessId],
    );
    expect(mail.rows).toHaveLength(1);
    const audit = await admin.query(
      `SELECT action FROM audit_log WHERE tenant_id=$1 AND action='Business created'`,
      [createdBusinessId],
    );
    expect(audit.rows).toHaveLength(1);

    // The new row derives as the prototype's invited account.
    const list = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/hq/businesses`,
      headers: { authorization: `Bearer ${hqToken}` },
    });
    const ki = list.json().businesses.find((b: { name: string }) => b.name === 'Studio Ki');
    expect(ki).toMatchObject({ status: 'invited', mrr: 0 });
    expect(ki.steps).toMatchObject({ account: true, locations: true, catalog: false });

    // The owner's email is now taken, platform-wide.
    const dupe = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/businesses`,
      headers: { authorization: `Bearer ${hqToken}` },
      payload: { name: 'X', city: 'Y', plan: 'Starter', ownerName: 'Z', ownerEmail: 'lira@studioki.mk' },
    });
    expect(dupe.statusCode).toBe(409);

    // Support agents don't create accounts.
    const forbidden = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/businesses`,
      headers: { authorization: `Bearer ${supportToken}` },
      payload: { name: 'X', city: 'Y', plan: 'Starter', ownerName: 'Z', ownerEmail: 'no@x.mk' },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it('sends the onboarding reminder through the outbox, never a toast alone', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/businesses/${createdBusinessId}/reminder`,
      headers: { authorization: `Bearer ${supportToken}` },
    });
    expect(res.statusCode).toBe(200);
    const mail = await admin.query(
      `SELECT to_email FROM mail_outbox WHERE tenant_id=$1 AND kind='onboarding_reminder'`,
      [createdBusinessId],
    );
    expect(mail.rows).toEqual([{ to_email: 'lira@studioki.mk' }]);
  });
});
