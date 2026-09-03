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
let staffToken = '';

async function token(email: string) {
  const res = await app.inject({
    method: 'POST',
    url: `${API_PREFIX}/auth/login`,
    payload: { email, password: 'velnes-demo' },
  });
  return res.json().accessToken as string;
}

const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', url: string, payload?: unknown, t = ownerToken) =>
  app.inject({
    method,
    url: `${API_PREFIX}${url}`,
    headers: { authorization: `Bearer ${t}` },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });

describe('role duplicate and remove doors', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    ownerToken = await token('maria@velnes.mk');
    staffToken = await token('ana@velnes.mk');
  });
  afterAll(async () => {
    // The seeded world goes back exactly as the other suites read it.
    await admin.query(`UPDATE employees SET role_id=$2 WHERE id=$1`, [
      demo.empAna,
      demo.roleEmployee,
    ]);
    await admin.query(`DELETE FROM roles WHERE name LIKE '%(copy)%'`);
    await admin.query(
      `DELETE FROM audit_log WHERE action IN ('Role created','Role removed','Locations changed')`,
    );
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('clones a role, refuses the acts to staff, removes only unused custom roles', async () => {
    // Staff cannot create roles.
    const denied = await call('POST', '/roles', { name: 'X', description: '', perms: {} }, staffToken);
    expect(denied.statusCode).toBe(403);

    // The owner duplicates Employee: same perms, its own life.
    const src = ((await call('GET', '/roles')).json() as {
      roles: { id: string; name: string; std: boolean; perms: Record<string, string> }[];
    }).roles;
    const employee = src.find((r) => r.name === 'Employee')!;
    const created = await call('POST', '/roles', {
      name: 'Employee (copy)',
      description: 'Copy of Employee. Narrow it down before use.',
      perms: employee.perms,
    });
    expect(created.statusCode).toBe(200);
    const copyId = (created.json() as { id: string }).id;

    // A standard role never leaves.
    const std = await call('DELETE', `/roles/${employee.id}`);
    expect(std.statusCode).toBe(409);
    expect((std.json() as { error: string }).error).toBe('STANDARD');

    // A role with people on it stays until they are moved.
    await call('PATCH', `/employees/${demo.empAna}`, { roleId: copyId });
    const inUse = await call('DELETE', `/roles/${copyId}`);
    expect(inUse.statusCode).toBe(409);
    expect((inUse.json() as { error: string }).error).toBe('IN_USE');

    // Moved back — now the unused copy can go, on the record.
    await call('PATCH', `/employees/${demo.empAna}`, { roleId: demo.roleEmployee });
    const gone = await call('DELETE', `/roles/${copyId}`);
    expect(gone.statusCode).toBe(200);
    const audit = (await call('GET', '/audit?limit=20')).json() as {
      entries: { action: string; object: string }[];
    };
    expect(
      audit.entries.some((a) => a.action === 'Role removed' && a.object.includes('Employee (copy)')),
    ).toBe(true);
    expect(
      audit.entries.some((a) => a.action === 'Role created' && a.object.includes('Employee (copy)')),
    ).toBe(true);
  });
});
