import { API_PREFIX, LoginResponseSchema, MeResponseSchema, RefreshResponseSchema } from '@velnes/contracts';
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
});
