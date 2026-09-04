import { API_PREFIX } from '@velnes/contracts';
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
let superToken = '';
let supportToken = '';

async function hqToken(email: string) {
  const res = await app.inject({
    method: 'POST',
    url: `${API_PREFIX}/hq/auth/login`,
    payload: { email, password: 'velnes-demo' },
  });
  return (res.json() as { accessToken: string }).accessToken;
}
const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
  t = superToken,
) =>
  app.inject({
    method,
    url: `${API_PREFIX}${url}`,
    headers: { authorization: `Bearer ${t}` },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });

describe('HQ team, supplier intelligence and the mail outbox', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    superToken = await hqToken('ivana@revelapps.com');
    supportToken = await hqToken('tea@revelapps.com');
  });
  afterAll(async () => {
    await admin.query(`DELETE FROM hq_users WHERE email='petra@revelapps.com'`);
    await admin.query(`DELETE FROM mail_outbox`);
    await admin.query(`DELETE FROM suppliers WHERE name='GlowLine Skopje (test)'`);
    await admin.query(`DELETE FROM supplier_brands WHERE brand_id IN (SELECT id FROM brands WHERE name='OrthoFlex (test)')`);
    await admin.query(`DELETE FROM brands WHERE name='OrthoFlex (test)'`);
    await admin.query(`DELETE FROM hq_roles WHERE std = false`);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('invites a teammate: super-only, invited status, mock mail in the outbox, login refused', async () => {
    const denied = await call(
      'POST',
      '/hq/team',
      { name: 'Petra', email: 'petra@revelapps.com', role: 'hq_support' },
      supportToken,
    );
    expect(denied.statusCode).toBe(403);

    const invited = await call('POST', '/hq/team', {
      name: 'Petra Stankovska',
      email: 'petra@revelapps.com',
      role: 'hq_support',
    });
    expect(invited.statusCode).toBe(200);

    const team = (await call('GET', '/hq/team')).json() as {
      members: { email: string; status: string }[];
    };
    expect(team.members.find((m) => m.email === 'petra@revelapps.com')?.status).toBe('invited');

    // The invite sits in the outbox, honestly stamped mock_sent.
    const outbox = (await call('GET', '/hq/outbox')).json() as {
      mails: { to: string; kind: string; status: string }[];
    };
    expect(
      outbox.mails.some(
        (m) => m.to === 'petra@revelapps.com' && m.kind === 'hq_invite' && m.status === 'mock_sent',
      ),
    ).toBe(true);

    // Invited people cannot sign in until the invite flow completes.
    const login = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/auth/login`,
      payload: { email: 'petra@revelapps.com', password: 'velnes-demo' },
    });
    expect(login.statusCode).toBe(401);
  });

  it('the last super keeps the keys: no demotion, no removal, no self-removal', async () => {
    const team = (await call('GET', '/hq/team')).json() as {
      members: { id: string; email: string; role: string }[];
    };
    const ivana = team.members.find((m) => m.email === 'ivana@revelapps.com')!;
    const demote = await call('PATCH', `/hq/team/${ivana.id}`, { role: 'hq_support' });
    expect(demote.statusCode).toBe(409);
    const selfRemove = await call('DELETE', `/hq/team/${ivana.id}`);
    expect(selfRemove.statusCode).toBe(409);
  });

  it('supplier intelligence: cross-tenant counts, create starts unverified, verify flips', async () => {
    const list = (await call('GET', '/hq/suppliers')).json() as {
      suppliers: {
        id: string; name: string; verified: boolean;
        products: number; connectedSalons: number; orders: number; orderValue: number;
      }[];
    };
    const beauty = list.suppliers.find((s) => s.name === 'BeautyPro MK')!;
    expect(beauty.verified).toBe(true);
    expect(beauty.products).toBeGreaterThan(0);
    expect(beauty.connectedSalons).toBeGreaterThan(0);

    const created = await call('POST', '/hq/suppliers', { name: 'GlowLine Skopje (test)' });
    expect(created.statusCode).toBe(200);
    const id = (created.json() as { id: string }).id;
    let again = (await call('GET', '/hq/suppliers')).json() as {
      suppliers: { id: string; verified: boolean }[];
    };
    expect(again.suppliers.find((s) => s.id === id)?.verified).toBe(false);

    const verify = await call('PATCH', `/hq/suppliers/${id}`, { verified: true });
    expect(verify.statusCode).toBe(200);
    again = (await call('GET', '/hq/suppliers')).json() as {
      suppliers: { id: string; verified: boolean }[];
    };
    expect(again.suppliers.find((s) => s.id === id)?.verified).toBe(true);

    // Support reads the intelligence but cannot create.
    const deniedCreate = await call('POST', '/hq/suppliers', { name: 'Nope' }, supportToken);
    expect(deniedCreate.statusCode).toBe(403);
  });

  it('a salon invite and an email change also land in the outbox', async () => {
    const maria = (
      await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/auth/login`,
        payload: { email: 'maria@velnes.mk', password: 'velnes-demo' },
      })
    ).json() as { accessToken: string };
    // The customer email change queues the verification mail.
    const patch = await app.inject({
      method: 'PATCH',
      url: `${API_PREFIX}/customers/${demo.c6}`,
      headers: { authorization: `Bearer ${maria.accessToken}` },
      payload: { email: 'elena.outbox@example.com' },
    });
    expect(patch.statusCode).toBe(200);
    const outbox = (await call('GET', '/hq/outbox')).json() as {
      mails: { to: string; kind: string; status: string }[];
    };
    expect(
      outbox.mails.some(
        (m) => m.to === 'elena.outbox@example.com' && m.kind === 'email_verify' && m.status === 'mock_sent',
      ),
    ).toBe(true);
    // Put the seeded address back.
    await admin.query(
      `UPDATE customers SET email='elena.t@example.com', email_verified_at=now() WHERE id=$1`,
      [demo.c6],
    );
    await admin.query(`DELETE FROM customer_activity WHERE type='contact_changed'`);
  });

  it('the role kit: six standard roles, custom creation from a base, guarded removal', async () => {
    const roles = (await call('GET', '/hq/roles')).json() as {
      roles: { id: string; std: boolean; locked: boolean; users: number; customerAccess: string }[];
    };
    expect(roles.roles.filter((r) => r.std).map((r) => r.id).sort()).toEqual([
      'hq_audit', 'hq_finance', 'hq_onboard', 'hq_super', 'hq_support', 'hq_tech',
    ]);
    expect(roles.roles.find((r) => r.id === 'hq_super')).toMatchObject({ locked: true, users: 1 });

    const created = await call('POST', '/hq/roles', {
      name: 'Balkans Onboarding (test)',
      descr: '',
      base: 'hq_onboard',
    });
    expect(created.statusCode).toBe(200);
    const id = (created.json() as { id: string }).id;
    const after = (await call('GET', '/hq/roles')).json() as {
      roles: { id: string; std: boolean; customerAccess: string }[];
    };
    expect(after.roles.find((r) => r.id === id)).toMatchObject({ std: false, customerAccess: 'write' });

    // A standard role never leaves; an unused custom one does.
    expect((await call('DELETE', '/hq/roles/hq_support')).statusCode).toBe(409);
    expect((await call('DELETE', `/hq/roles/${id}`)).statusCode).toBe(200);
  });

  it('roles carry their permission scopes; the drawer moves them one select at a time', async () => {
    const roles = (await call('GET', '/hq/roles')).json() as {
      roles: { id: string; perms: Record<string, string> }[];
    };
    // The migration's matrix (the prototype's seedHqRolePerms).
    expect(roles.roles.find((r) => r.id === 'hq_support')?.perms).toMatchObject({
      'hq.customers': 'read',
      'hq.enter': 'read',
      'hq.audit': 'read',
      'hq.team': 'none',
    });
    expect(roles.roles.find((r) => r.id === 'hq_super')?.perms['hq.team']).toBe('write');

    // A custom role copies its base's perms — any base, not only std.
    const created = await call('POST', '/hq/roles', {
      name: 'Perms Copy (test)',
      descr: '',
      base: 'hq_tech',
    });
    const id = (created.json() as { id: string }).id;
    const copy = (await call('GET', '/hq/roles')).json() as {
      roles: { id: string; perms: Record<string, string> }[];
    };
    expect(copy.roles.find((r) => r.id === id)?.perms).toMatchObject({
      'hq.settings': 'write',
      'hq.customers': 'read',
    });

    // Scope moves merge; unknown keys and the locked keyholder refuse.
    expect(
      (await call('PATCH', `/hq/roles/${id}`, { perms: { 'hq.finance': 'read' } })).statusCode,
    ).toBe(200);
    const moved = (await call('GET', '/hq/roles')).json() as {
      roles: { id: string; perms: Record<string, string> }[];
    };
    expect(moved.roles.find((r) => r.id === id)?.perms).toMatchObject({
      'hq.finance': 'read',
      'hq.settings': 'write',
    });
    expect(
      (await call('PATCH', `/hq/roles/${id}`, { perms: { 'hq.nonsense': 'read' } })).statusCode,
    ).toBe(409);
    expect(
      (await call('PATCH', '/hq/roles/hq_super', { perms: { 'hq.team': 'read' } })).statusCode,
    ).toBe(409);
    expect(
      (await call('PATCH', `/hq/roles/${id}`, { name: 'Renamed (test)' }, supportToken)).statusCode,
    ).toBe(403);

    expect((await call('DELETE', `/hq/roles/${id}`)).statusCode).toBe(200);
  });

  it('brands and carriage: the registry reads, a brand lands under its supplier', async () => {
    const before = (await call('GET', '/hq/brands')).json() as {
      brands: { name: string }[];
      carriage: { supplierName: string; brands: string[] }[];
    };
    expect(before.brands.map((b) => b.name)).toContain('Thera-Band');
    expect(
      before.carriage.find((c) => c.supplierName === 'BeautyPro MK')?.brands.sort(),
    ).toEqual(['CureTape', 'Thera-Band']);

    const sup = ((await call('GET', '/hq/suppliers')).json() as {
      suppliers: { name: string; id: string; brands: string[]; merchant: { ready: boolean } | null }[];
    }).suppliers;
    const beauty = sup.find((s2) => s2.name === 'BeautyPro MK')!;
    expect(beauty.brands.sort()).toEqual(['CureTape', 'Thera-Band']);
    expect(beauty.merchant?.ready).toBe(true);
    const aroma = sup.find((s2) => s2.name === 'Aroma Nordic Direct')!;
    expect(aroma.merchant?.ready).toBe(false);

    const brand = await call('POST', '/hq/brands', {
      name: 'OrthoFlex (test)',
      owner: 'OrthoFlex GmbH',
      country: 'Germany',
      supplierId: beauty.id,
    });
    expect(brand.statusCode).toBe(200);
    const now = (await call('GET', '/hq/brands')).json() as {
      carriage: { supplierName: string; brands: string[] }[];
    };
    expect(now.carriage.find((c) => c.supplierName === 'BeautyPro MK')?.brands).toContain(
      'OrthoFlex (test)',
    );
  });
});
