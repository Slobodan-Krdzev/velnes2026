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
let ownerToken = '';
let anaToken = '';
let roleId = '';

async function token(email: string) {
  const res = await app.inject({
    method: 'POST',
    url: `${API_PREFIX}/auth/login`,
    payload: { email, password: 'velnes-demo' },
  });
  return res.json().accessToken as string;
}

const call = (method: 'POST' | 'PATCH', url: string, payload: unknown, t = ownerToken) =>
  app.inject({
    method,
    url: `${API_PREFIX}${url}`,
    headers: { authorization: `Bearer ${t}` },
    payload: payload as Record<string, unknown>,
  });

const sale = (extra: Record<string, unknown>) => ({
  key: 'test-discount-gate',
  locationId: demo.locAerodrom,
  method: 'Cash',
  lines: [{ kind: 'product', productId: demo.p1, qty: 1, lineDiscount: 0 }],
  ...extra,
});

describe('pos.discount guards the sale door', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    ownerToken = await token('maria@velnes.mk');
    // A till role that may check out but not discount — then Ana
    // logs in AFTER the switch so her claims carry the new role.
    const created = await call('POST', '/roles', {
      name: 'Till no-discount (test)',
      description: 'Checkout without discounts.',
      perms: { 'pos.checkout': 'location' },
    });
    roleId = (created.json() as { id: string }).id;
    await call('PATCH', `/employees/${demo.empAna}`, { roleId });
    anaToken = await token('ana@velnes.mk');
  });
  afterAll(async () => {
    await admin.query(`UPDATE employees SET role_id=$2 WHERE id=$1`, [
      demo.empAna,
      demo.roleEmployee,
    ]);
    await admin.query(`DELETE FROM roles WHERE id=$1`, [roleId]);
    await admin.query(
      `DELETE FROM audit_log WHERE action IN ('Role created','Role changed','Role removed')`,
    );
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('refuses a discounted sale without the right, on the line and on the cart', async () => {
    const line = await call(
      'POST',
      '/sales',
      sale({ lines: [{ kind: 'product', productId: demo.p1, qty: 1, lineDiscount: 100 }] }),
      anaToken,
    );
    expect(line.statusCode).toBe(403);
    expect((line.json() as { message: string }).message).toContain('pos.discount');

    const cart = await call('POST', '/sales', sale({ cartDiscount: 100 }), anaToken);
    expect(cart.statusCode).toBe(403);
    expect((cart.json() as { message: string }).message).toContain('pos.discount');
  });

  it('a sale without discounts passes the gate for the same role', async () => {
    // An unknown product past the gate: whatever the door answers,
    // it is not the discount refusal — no invoice is minted, so the
    // seeded counters the other suites read stay untouched.
    const res = await call(
      'POST',
      '/sales',
      sale({ lines: [{ kind: 'product', productId: '70000000-0000-4000-8000-00000000dead', qty: 1, lineDiscount: 0 }] }),
      anaToken,
    );
    expect(res.statusCode).not.toBe(403);
  });

  it('the owner, whose role carries pos.discount, is not stopped by the gate', async () => {
    const res = await call(
      'POST',
      '/sales',
      sale({
        lines: [{ kind: 'product', productId: '70000000-0000-4000-8000-00000000dead', qty: 1, lineDiscount: 100 }],
      }),
    );
    expect(res.statusCode).not.toBe(403);
  });
});
