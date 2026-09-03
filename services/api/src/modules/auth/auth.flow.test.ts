import {
  API_PREFIX,
  LoginResponseSchema,
  MeResponseSchema,
  PreviewResponseSchema,
  RefreshResponseSchema,
} from '@velnes/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { buildServer } from '../../server.js';

const app = await buildServer();

describe('auth flow', () => {
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  const login = (email: string, password: string) =>
    app.inject({ method: 'POST', url: `${API_PREFIX}/auth/login`, payload: { email, password } });

  it('rejects a wrong password', async () => {
    const res = await login('maria@velnes.mk', 'wrong');
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('INVALID_CREDENTIALS');
  });

  it('rejects an unknown email identically', async () => {
    const res = await login('nobody@velnes.mk', 'velnes-demo');
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('INVALID_CREDENTIALS');
  });

  it('rejects an invited (not yet active) employee', async () => {
    const res = await login('nikola@velnes.mk', 'velnes-demo');
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('NOT_ACTIVE');
  });

  it('logs Maria in, serves /me, rotates refresh tokens, and revokes the family on reuse', async () => {
    const res = await login('maria@velnes.mk', 'velnes-demo');
    expect(res.statusCode).toBe(200);
    const body = LoginResponseSchema.parse(res.json());
    expect(body.employee.access).toBe('owner');
    expect(body.employee.locationIds).toHaveLength(2);

    const meRes = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/auth/me`,
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    expect(meRes.statusCode).toBe(200);
    const me = MeResponseSchema.parse(meRes.json());
    expect(me.email).toBe('maria@velnes.mk');

    // Rotate.
    const r1 = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/auth/refresh`,
      payload: { refreshToken: body.refreshToken },
    });
    expect(r1.statusCode).toBe(200);
    const rotated = RefreshResponseSchema.parse(r1.json());
    expect(rotated.refreshToken).not.toBe(body.refreshToken);

    // Reusing the OLD token is theft: 401, and the family dies.
    const reuse = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/auth/refresh`,
      payload: { refreshToken: body.refreshToken },
    });
    expect(reuse.statusCode).toBe(401);
    const afterTheft = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/auth/refresh`,
      payload: { refreshToken: rotated.refreshToken },
    });
    expect(afterTheft.statusCode).toBe(401);
  });

  it('rejects /me without a token', async () => {
    const res = await app.inject({ method: 'GET', url: `${API_PREFIX}/auth/me` });
    expect(res.statusCode).toBe(401);
  });

  it('preview access: a user manager becomes the target for real, audited; staff and self are refused', async () => {
    const maria = LoginResponseSchema.parse((await login('maria@velnes.mk', 'velnes-demo')).json());
    const auth = { authorization: `Bearer ${maria.accessToken}` };
    const emps = (await app.inject({ method: 'GET', url: `${API_PREFIX}/employees`, headers: auth }))
      .json() as { employees: { id: string; name: string }[] };
    const ana = emps.employees.find((e) => e.name === 'Ana Dimitrova')!;

    // Previewing yourself is refused.
    const self = await app.inject({
      method: 'POST', url: `${API_PREFIX}/auth/preview`, headers: auth,
      payload: { employeeId: maria.employee.id },
    });
    expect(self.statusCode).toBe(400);

    // The owner previews Ana: the token really IS Ana's session.
    const pv = await app.inject({
      method: 'POST', url: `${API_PREFIX}/auth/preview`, headers: auth,
      payload: { employeeId: ana.id },
    });
    expect(pv.statusCode).toBe(200);
    const body = PreviewResponseSchema.parse(pv.json());
    expect(body.employee.id).toBe(ana.id);
    const asAna = MeResponseSchema.parse(
      (await app.inject({
        method: 'GET', url: `${API_PREFIX}/auth/me`,
        headers: { authorization: `Bearer ${body.accessToken}` },
      })).json(),
    );
    expect(asAna.id).toBe(ana.id);
    expect(asAna.perms['users.manage'] ?? 'none').toBe('none');
    expect(asAna.roleName).toBe('Employee');

    // The borrowed session cannot preview onward.
    const onward = await app.inject({
      method: 'POST', url: `${API_PREFIX}/auth/preview`,
      headers: { authorization: `Bearer ${body.accessToken}` },
      payload: { employeeId: maria.employee.id },
    });
    expect(onward.statusCode).toBe(403);

    // The start is on the record.
    const audit = (await app.inject({
      method: 'GET', url: `${API_PREFIX}/audit?limit=20`, headers: auth,
    })).json() as { entries: { action: string; object: string }[] };
    expect(
      audit.entries.some(
        (a) => a.action === 'Preview access' && a.object.includes('Ana Dimitrova'),
      ),
    ).toBe(true);

    // A renewal issues a token without a second audit entry.
    const renew = await app.inject({
      method: 'POST', url: `${API_PREFIX}/auth/preview`, headers: auth,
      payload: { employeeId: ana.id, renew: true },
    });
    expect(renew.statusCode).toBe(200);
    const audit2 = (await app.inject({
      method: 'GET', url: `${API_PREFIX}/audit?limit=20`, headers: auth,
    })).json() as { entries: { action: string }[] };
    expect(audit2.entries.filter((a) => a.action === 'Preview access').length).toBe(
      audit.entries.filter((a) => a.action === 'Preview access').length,
    );
  });
});
