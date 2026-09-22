import {
  API_PREFIX,
  LoginResponseSchema,
  MeResponseSchema,
  SIGN_IN_LINK_DAYS,
  SignInLinkRedeemResponseSchema,
  SignInLinkResponseSchema,
} from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { DEMO_PASSWORD, demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';

const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
const A = `${API_PREFIX}/auth`;
const EMAIL = 'link.tester@velnes.test';
let owner = '';
let newId = '';

const tokenOf = (url: string) => url.slice(url.lastIndexOf('/') + 1);
const redeem = (token: string) => app.inject({ method: 'POST', url: `${A}/sign-in-link`, payload: { token } });
const mint = (id: string, bearer = owner) =>
  app.inject({ method: 'POST', url: `${API_PREFIX}/employees/${id}/sign-in-link`, headers: { authorization: `Bearer ${bearer}` } });

describe('personal sign-in links — a team member joins their own salon on the phone, once, in time', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    const login = await app.inject({ method: 'POST', url: `${A}/login`, payload: { email: 'maria@velnes.mk', password: DEMO_PASSWORD } });
    owner = LoginResponseSchema.parse(login.json()).accessToken;
    // A brand-new team member: invited, no password, nothing to sign in with.
    const made = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/employees`,
      headers: { authorization: `Bearer ${owner}` },
      payload: { name: 'Link Tester', email: EMAIL, roleId: null, locationIds: [demo.locCentar], twofa: false },
    });
    expect(made.statusCode).toBe(200);
    newId = made.json().id as string;
  });
  afterAll(async () => {
    if (newId) {
      for (const table of ['employee_sign_in_links', 'refresh_tokens', 'user_credentials', 'employee_locations', 'employee_skills'])
        await admin.query(`DELETE FROM ${table} WHERE employee_id = $1`, [newId]);
      await admin.query(`DELETE FROM audit_log WHERE actor_employee_id = $1 OR object = 'User · Link Tester'`, [newId]);
      await admin.query(`DELETE FROM mail_outbox WHERE to_email = $1`, [EMAIL]);
      await admin.query(`DELETE FROM employees WHERE id = $1`, [newId]);
    }
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('the invite mail already carries a link, and the old link dies when the owner mints a new one', async () => {
    const mail = await admin.query(`SELECT body FROM mail_outbox WHERE to_email = $1 AND kind = 'employee_invite'`, [EMAIL]);
    expect(mail.rows[0].body).toContain('/join/');
    const fromMail = tokenOf(mail.rows[0].body.match(/\/join\/([A-Za-z0-9_-]+)/)![0]);

    const res = await mint(newId);
    expect(res.statusCode).toBe(200);
    const link = SignInLinkResponseSchema.parse(res.json());
    expect(link.url).toContain('/join/');
    const ttl = (new Date(link.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(ttl).toBeGreaterThan(SIGN_IN_LINK_DAYS - 0.01);
    expect(ttl).toBeLessThanOrEqual(SIGN_IN_LINK_DAYS);

    const dead = await redeem(fromMail);
    expect(dead.statusCode).toBe(401);
    expect(dead.json().error).toBe('INVALID_LINK');
  });

  it('opening the link signs the person into their salon, activates them, asks for a password — and works once', async () => {
    const link = SignInLinkResponseSchema.parse((await mint(newId)).json());
    const token = tokenOf(link.url);
    const res = await redeem(token);
    expect(res.statusCode).toBe(200);
    const out = SignInLinkRedeemResponseSchema.parse(res.json());
    expect(out.employee.id).toBe(newId);

    expect(out.needsPassword).toBe(true);
    expect(out.salonName).toBe('Velnes Fizio Centar');
    const me = await app.inject({ method: 'GET', url: `${A}/me`, headers: { authorization: `Bearer ${out.accessToken}` } });
    const meOut = MeResponseSchema.parse(me.json());
    expect(meOut.id).toBe(newId);
    expect(meOut.tenantId).toBe(demo.business);
    const status = await admin.query(`SELECT status FROM employees WHERE id = $1`, [newId]);
    expect(status.rows[0].status).toBe('active');

    const again = await redeem(token);
    expect(again.statusCode).toBe(401);
    expect(again.json().error).toBe('INVALID_LINK');

    // The password they choose is the one email login and tap-your-name use from now on.
    const set = await app.inject({ method: 'POST', url: `${A}/password`, headers: { authorization: `Bearer ${out.accessToken}` }, payload: { password: 'first-pass-123' } });
    expect(set.statusCode).toBe(200);
    const login = await app.inject({ method: 'POST', url: `${A}/login`, payload: { email: EMAIL, password: 'first-pass-123' } });
    expect(login.statusCode).toBe(200);
    const byId = await app.inject({ method: 'POST', url: `${A}/login-id`, payload: { employeeId: newId, password: 'first-pass-123' } });
    expect(byId.statusCode).toBe(200);

    // Changing it later needs the current one.
    const noCurrent = await app.inject({ method: 'POST', url: `${A}/password`, headers: { authorization: `Bearer ${out.accessToken}` }, payload: { password: 'second-pass-123' } });
    expect(noCurrent.statusCode).toBe(401);
    const withCurrent = await app.inject({ method: 'POST', url: `${A}/password`, headers: { authorization: `Bearer ${out.accessToken}` }, payload: { password: 'second-pass-123', current: 'first-pass-123' } });
    expect(withCurrent.statusCode).toBe(200);
    const relogin = await app.inject({ method: 'POST', url: `${A}/login`, payload: { email: EMAIL, password: 'second-pass-123' } });
    expect(relogin.statusCode).toBe(200);
  });

  it('a link past its seven days is refused as expired, and a person with a password is not asked for one again', async () => {
    const link = SignInLinkResponseSchema.parse((await mint(newId)).json());
    await admin.query(`UPDATE employee_sign_in_links SET expires_at = now() - interval '1 minute' WHERE employee_id = $1 AND used_at IS NULL AND revoked_at IS NULL`, [newId]);
    const late = await redeem(tokenOf(link.url));
    expect(late.statusCode).toBe(401);
    expect(late.json().error).toBe('LINK_EXPIRED');

    const fresh = SignInLinkResponseSchema.parse((await mint(newId)).json());
    const ok = SignInLinkRedeemResponseSchema.parse((await redeem(tokenOf(fresh.url))).json());
    expect(ok.needsPassword).toBe(false);
  });

  it('anyone may mint their own link; minting for another takes users.manage; an unknown member is a 404', async () => {
    const ana = await app.inject({ method: 'POST', url: `${A}/login`, payload: { email: 'ana@velnes.mk', password: DEMO_PASSWORD } });
    const anaToken = LoginResponseSchema.parse(ana.json()).accessToken;
    const own = await mint(demo.empAna, anaToken);
    expect(own.statusCode).toBe(200);
    expect(SignInLinkResponseSchema.parse(own.json()).employeeId).toBe(demo.empAna);
    await admin.query(`DELETE FROM employee_sign_in_links WHERE employee_id = $1`, [demo.empAna]);
    const forbidden = await mint(newId, anaToken);
    expect(forbidden.statusCode).toBe(403);
    const missing = await mint('00000000-0000-4000-8000-00000000dead');
    expect(missing.statusCode).toBe(404);
    const garbage = await redeem('not-a-real-token-at-all');
    expect(garbage.statusCode).toBe(401);
  });
});
