import { API_PREFIX } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { buildServer } from '../../server.js';

/** A profile photo (Alex, 2026-10-01): optional at sign-up, changeable
 *  and removable in the account, bounded by the contract's cap. */
const ADMIN_URL = (process.env.TEST_ADMIN_DATABASE_URL ?? process.env.TEST_SEED_DATABASE_URL ?? 'postgres://velnes:velnes@localhost:5432/velnes').replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');
const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
const C = `${API_PREFIX}/client`;
const EMAIL = `avatar.${Date.now()}@example.test`;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
let token = '';
let id = '';

describe('the profile photo', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
  });
  afterAll(async () => {
    if (id) {
      await admin.query(`DELETE FROM client_notifications WHERE client_user_id = $1`, [id]);
      await admin.query(`DELETE FROM client_users WHERE id = $1`, [id]);
    }
    await admin.query(`DELETE FROM mail_outbox WHERE to_email = $1`, [EMAIL.toLowerCase()]);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('comes along at sign-up and is on the profile once verified', async () => {
    const reg = await app.inject({ method: 'POST', url: `${C}/register`, payload: { email: EMAIL, password: 'velnes-test-12345', first: 'Photo', last: 'Tester', phone: '', dob: null, lang: 'en', avatar: PNG } });
    expect(reg.statusCode).toBe(200);
    const code = (await admin.query(`SELECT body FROM mail_outbox WHERE to_email=$1 AND kind='client_email_verify' ORDER BY sent_at DESC LIMIT 1`, [EMAIL.toLowerCase()])).rows[0].body.match(/code is (\d{6})/)![1];
    const v = await app.inject({ method: 'POST', url: `${C}/verify-email`, payload: { email: EMAIL, code } });
    expect(v.statusCode).toBe(200);
    token = v.json().token;
    id = v.json().profile.id;
    expect(v.json().profile.avatar).toBe(PNG);
  });

  it('can be changed and removed in the account; an oversized one is refused', async () => {
    const other = PNG.replace('iVBOR', 'iVBOS');
    const put = await app.inject({ method: 'PATCH', url: `${C}/me`, headers: { authorization: `Bearer ${token}` }, payload: { avatar: other } });
    expect(put.statusCode).toBe(200);
    expect(put.json().avatar).toBe(other);
    const gone = await app.inject({ method: 'PATCH', url: `${C}/me`, headers: { authorization: `Bearer ${token}` }, payload: { avatar: null } });
    expect(gone.json().avatar).toBeNull();
    const huge = await app.inject({ method: 'PATCH', url: `${C}/me`, headers: { authorization: `Bearer ${token}` }, payload: { avatar: 'data:image/jpeg;base64,' + 'A'.repeat(300_001) } });
    expect(huge.statusCode).toBe(400);
    const hugeReg = await app.inject({ method: 'POST', url: `${C}/register`, payload: { email: `x${EMAIL}`, password: 'velnes-test-12345', first: 'P', avatar: 'data:image/jpeg;base64,' + 'A'.repeat(300_001) } });
    expect(hugeReg.statusCode).toBe(400);
  });
});
