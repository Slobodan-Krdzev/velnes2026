import { API_PREFIX, SupplierJoinPreviewSchema, SupplierLoginResponseSchema } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { buildServer } from '../../server.js';

/**
 * Supplier join links (2026-10-07) — docs/SUPPLIERS.md. The invite mail
 * carries a personal one-time link; opening it asks for a password (and
 * the company details for the first owner), activates the user and
 * signs them in. Before this, an invited supplier could never log in.
 */
const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
let hq = '';
const NAME = 'Krdzev Supply (join test)';
const NAME2 = 'Second Supply (join test)';

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown, token?: string) =>
  app.inject({
    method,
    url: `${API_PREFIX}${url}`,
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
/** The newest invite mail to an address, and the join token its button carries. */
const tokenMailedTo = async (email: string) => {
  const r = await admin.query(
    `SELECT meta FROM mail_outbox WHERE to_email=$1 AND kind='supplier_invite' ORDER BY created_at DESC LIMIT 1`,
    [email],
  );
  const url = (r.rows[0]?.meta as { cta?: { url: string } } | undefined)?.cta?.url ?? '';
  return { url, token: /\/join\/([^/?#]+)$/.exec(url)?.[1] ?? '' };
};
const cleanup = async () => {
  await admin.query(
    `DELETE FROM supplier_users WHERE supplier_id IN (SELECT id FROM suppliers WHERE name IN ($1,$2))`,
    [NAME, NAME2],
  );
  await admin.query(`DELETE FROM suppliers WHERE name IN ($1,$2)`, [NAME, NAME2]);
  await admin.query(`DELETE FROM mail_outbox WHERE to_email LIKE '%@join-test.velnes'`);
};

describe('supplier join links', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    await cleanup();
    hq = (await call('POST', '/hq/auth/login', { email: 'ivana@revelapps.com', password: 'velnes-demo' })).json().accessToken as string;
  });
  afterAll(async () => {
    await cleanup();
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('HQ invites the first owner: the mail carries a join link, the claim sets the password and the company, signs them in, and the link is spent', async () => {
    const created = await call('POST', '/hq/suppliers', { name: NAME, type: 'Distributor', territory: 'North Macedonia', contact: '' }, hq);
    expect(created.statusCode, created.body).toBe(200);
    const supId = (created.json() as { id: string }).id;
    const invited = await call('POST', `/hq/suppliers/${supId}/invite`, { name: 'Slobodan K.', email: 'owner@join-test.velnes' }, hq);
    expect(invited.statusCode, invited.body).toBe(200);
    const { url, token } = await tokenMailedTo('owner@join-test.velnes');
    expect(url).toMatch(/\/join\//);
    expect(token.length).toBeGreaterThan(20);
    // Before claiming: the login door still refuses, whatever is typed.
    expect((await call('POST', '/portal/auth/login', { email: 'owner@join-test.velnes', password: 'anything-at-all' })).statusCode).toBe(401);
    // The claim page knows who is invited and that the company is theirs to complete.
    const peek = await call('GET', `/portal/join/${token}`);
    expect(peek.statusCode, peek.body).toBe(200);
    const preview = SupplierJoinPreviewSchema.parse(peek.json());
    expect(preview).toMatchObject({ name: 'Slobodan K.', email: 'owner@join-test.velnes', role: 'sr_owner', supplierName: NAME, firstOwner: true });
    // Too short a password is refused by the contract.
    expect((await call('POST', `/portal/join/${token}`, { name: 'Slobodan Krdzev', password: 'short' })).statusCode).toBe(400);
    const claimed = await call('POST', `/portal/join/${token}`, {
      name: 'Slobodan Krdzev',
      password: 'a-real-password-1',
      company: { contact: '+389 70 000 000 · sales@krdzev.mk', territory: 'Skopje region', lead: '2 business days', terms: '15 days invoice', minOrder: 3000 },
    });
    expect(claimed.statusCode, claimed.body).toBe(200);
    const session = SupplierLoginResponseSchema.parse(claimed.json());
    expect(session.user).toMatchObject({ name: 'Slobodan Krdzev', email: 'owner@join-test.velnes', role: 'sr_owner', supplierId: supId, supplierName: NAME });
    // Signed in: the token works and the company reads what they typed.
    const company = await call('GET', '/portal/company', undefined, session.accessToken);
    expect(company.statusCode).toBe(200);
    expect(company.json()).toMatchObject({ name: NAME, contact: '+389 70 000 000 · sales@krdzev.mk', territory: 'Skopje region', lead: '2 business days', terms: '15 days invoice', minOrder: 3000 });
    // From now on the ordinary login works with that password.
    const login = await call('POST', '/portal/auth/login', { email: 'owner@join-test.velnes', password: 'a-real-password-1' });
    expect(login.statusCode, login.body).toBe(200);
    expect((await call('POST', '/portal/auth/login', { email: 'owner@join-test.velnes', password: 'wrong' })).statusCode).toBe(401);
    // The link is spent.
    expect((await call('GET', `/portal/join/${token}`)).statusCode).toBe(401);
    expect((await call('POST', `/portal/join/${token}`, { name: 'X', password: 'another-password-1' })).statusCode).toBe(401);
    // HQ sees the owner as active and can no longer re-invite.
    const list = (await call('GET', '/hq/suppliers', undefined, hq)).json() as { suppliers: { id: string; ownerStatus: string }[] };
    expect(list.suppliers.find((s) => s.id === supId)?.ownerStatus).toBe('active');
    expect((await call('POST', `/hq/suppliers/${supId}/invite`, { name: 'Other', email: 'other@join-test.velnes' }, hq)).statusCode).toBe(409);

    // The owner invites a team member: the same link, but the company is not theirs to edit.
    const member = await call('POST', '/portal/team', { name: 'Elena', email: 'elena@join-test.velnes', role: 'sr_order' }, session.accessToken);
    expect(member.statusCode, member.body).toBe(200);
    const m = await tokenMailedTo('elena@join-test.velnes');
    const mPeek = SupplierJoinPreviewSchema.parse((await call('GET', `/portal/join/${m.token}`)).json());
    expect(mPeek.firstOwner).toBe(false);
    const mClaim = await call('POST', `/portal/join/${m.token}`, {
      name: 'Elena S.',
      password: 'elena-password-1',
      company: { contact: 'hijack', territory: 'x', lead: 'x', terms: 'x', minOrder: 1 },
    });
    expect(mClaim.statusCode, mClaim.body).toBe(200);
    expect((await call('GET', '/portal/company', undefined, session.accessToken)).json()).toMatchObject({ contact: '+389 70 000 000 · sales@krdzev.mk', minOrder: 3000 });
    expect((await call('POST', '/portal/auth/login', { email: 'elena@join-test.velnes', password: 'elena-password-1' })).statusCode).toBe(200);
  });

  it('an unclaimed bootstrap invite can be re-sent by HQ with a corrected address; the old link stops working', async () => {
    const supId = ((await call('POST', '/hq/suppliers', { name: NAME2 }, hq)).json() as { id: string }).id;
    expect((await call('POST', `/hq/suppliers/${supId}/invite`, { name: 'Typo Owner', email: 'typo@join-test.velnes' }, hq)).statusCode).toBe(200);
    const first = await tokenMailedTo('typo@join-test.velnes');
    expect((await call('GET', `/portal/join/${first.token}`)).statusCode).toBe(200);
    const again = await call('POST', `/hq/suppliers/${supId}/invite`, { name: 'Right Owner', email: 'right@join-test.velnes' }, hq);
    expect(again.statusCode, again.body).toBe(200);
    expect((await call('GET', `/portal/join/${first.token}`)).statusCode).toBe(401);
    const second = await tokenMailedTo('right@join-test.velnes');
    const peek = SupplierJoinPreviewSchema.parse((await call('GET', `/portal/join/${second.token}`)).json());
    expect(peek).toMatchObject({ name: 'Right Owner', email: 'right@join-test.velnes', firstOwner: true });
    const users = await admin.query(`SELECT email, status FROM supplier_users WHERE supplier_id=$1`, [supId]);
    expect(users.rows).toEqual([{ email: 'right@join-test.velnes', status: 'invited' }]);
    // A nonsense token is simply refused.
    expect((await call('GET', `/portal/join/${'x'.repeat(40)}`)).statusCode).toBe(401);
  });
});
