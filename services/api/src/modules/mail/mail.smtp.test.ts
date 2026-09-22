import { simpleParser, type ParsedMail } from 'mailparser';
import pg from 'pg';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Real delivery, end to end: a real SMTP server listens in this
 * process, the API is booted with MAIL_TRANSPORT=smtp pointed at it,
 * mails are queued through the real doors, the sender drains the
 * outbox, and what the server received is inspected — the Velnes
 * layout, the code, the button. Then the server goes away and the
 * sender is watched retrying with backoff until it gives up honestly.
 */

const received: ParsedMail[] = [];
const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ['STARTTLS'],
  onData(stream, _session, callback) {
    simpleParser(stream)
      .then((mail) => {
        received.push(mail);
        callback();
      })
      .catch((e: Error) => callback(e));
  },
});
await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve));
const port = (smtp.server.address() as { port: number }).port;

process.env.MAIL_TRANSPORT = 'smtp';
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = String(port);
process.env.SMTP_SECURE = 'false';
process.env.MAIL_FROM = 'Velnes <no-reply@velnes.test>';

// Imported after the env is set: `env` reads process.env at load.
const { API_PREFIX, LoginResponseSchema } = await import('@velnes/contracts');
const { closeDb } = await import('../../db/index.js');
const { DEMO_PASSWORD, demo } = await import('../../db/seed-demo.js');
const { buildServer } = await import('../../server.js');
const { MAX_ATTEMPTS, sendPending } = await import('./mail.sender.js');

const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
const CLIENT_EMAIL = 'smtp.client@velnes.test';
const CLIENT_EMAIL_2 = 'smtp.client2@velnes.test';
const STAFF_EMAIL = 'smtp.staff@velnes.test';
let staffId = '';

const outboxRow = async (to: string) =>
  (await admin.query(`SELECT status, attempts, error, message_id, meta, next_attempt_at FROM mail_outbox WHERE to_email = $1 ORDER BY created_at DESC LIMIT 1`, [to])).rows[0];

describe('mail delivery over SMTP — queued, rendered, sent; refused, retried, failed', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
  });
  afterAll(async () => {
    for (const email of [CLIENT_EMAIL, CLIENT_EMAIL_2]) {
      await admin.query(`DELETE FROM client_favourites WHERE client_user_id IN (SELECT id FROM client_users WHERE email = $1)`, [email]);
      await admin.query(`DELETE FROM client_users WHERE email = $1`, [email]);
    }
    if (staffId) {
      await admin.query(`DELETE FROM employee_locations WHERE employee_id = $1`, [staffId]);
      await admin.query(`DELETE FROM audit_log WHERE actor_employee_id = $1 OR object = 'User · Smtp Staff'`, [staffId]);
      await admin.query(`DELETE FROM employees WHERE id = $1`, [staffId]);
    }
    await admin.query(`DELETE FROM mail_outbox WHERE to_email = ANY($1)`, [[CLIENT_EMAIL, CLIENT_EMAIL_2, STAFF_EMAIL]]);
    await admin.end();
    await app.close();
    await closeDb();
    await new Promise<void>((resolve) => smtp.close(() => resolve()));
  });

  it('a verification code is queued (not mock-stamped), delivered, and arrives in the Velnes layout with the code set large', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/client/register`,
      payload: { email: CLIENT_EMAIL, password: 'smtp-pass-1234', first: 'Smtp', last: 'Client', phone: '+389 70 000 111', dob: '1990-05-05', lang: 'en' },
    });
    expect(reg.statusCode).toBe(200);
    const queued = await outboxRow(CLIENT_EMAIL);
    expect(queued.status).toBe('queued');
    const code = queued.meta.code as string;
    expect(code).toMatch(/^\d{6}$/);

    await sendPending();
    const sent = await outboxRow(CLIENT_EMAIL);
    expect(sent.status).toBe('sent');
    expect(sent.message_id).toBeTruthy();
    expect(sent.error).toBeNull();

    const mail = received.find((m) => m.to && 'value' in m.to && m.to.value.some((a) => a.address === CLIENT_EMAIL));
    expect(mail).toBeDefined();
    expect(mail!.subject).toBe('Your Velnes verification code');
    expect(mail!.from?.value[0]?.address).toBe('no-reply@velnes.test');
    expect(mail!.html).toContain('#FF8D67');
    expect(mail!.html).toContain(`>${code}<`);
    expect(mail!.text).toContain(code);
    expect(mail!.html).toContain('Sent by Velnes.');
  });

  it('an invite carries its sign-in button and speaks for the salon', async () => {
    const login = await app.inject({ method: 'POST', url: `${API_PREFIX}/auth/login`, payload: { email: 'maria@velnes.mk', password: DEMO_PASSWORD } });
    const owner = LoginResponseSchema.parse(login.json()).accessToken;
    const made = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/employees`,
      headers: { authorization: `Bearer ${owner}` },
      payload: { name: 'Smtp Staff', email: STAFF_EMAIL, roleId: null, locationIds: [demo.locCentar], twofa: false },
    });
    expect(made.statusCode).toBe(200);
    staffId = made.json().id as string;

    await sendPending();
    expect((await outboxRow(STAFF_EMAIL)).status).toBe('sent');
    const mail = received.find((m) => m.to && 'value' in m.to && m.to.value.some((a) => a.address === STAFF_EMAIL));
    expect(mail).toBeDefined();
    expect(mail!.html).toContain('>Sign in on your phone</a>');
    expect(mail!.html).toMatch(/href="http:\/\/localhost:5174\/join\/[A-Za-z0-9_-]+"/);
    expect(mail!.html).toContain('Sent by Velnes for Velnes Fizio Centar.');
    expect(mail!.text).toContain('Sign in on your phone: http://localhost:5174/join/');
  });

  it('when the provider is unreachable the row retries with backoff and finally reads failed, with the reason', async () => {
    await new Promise<void>((resolve) => smtp.close(() => resolve()));
    const reg = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/client/register`,
      payload: { email: CLIENT_EMAIL_2, password: 'smtp-pass-1234', first: 'Second', last: 'Client', phone: '+389 70 000 222', dob: '1991-06-06', lang: 'en' },
    });
    expect(reg.statusCode).toBe(200);

    await sendPending();
    const first = await outboxRow(CLIENT_EMAIL_2);
    expect(first.status).toBe('queued');
    expect(first.attempts).toBeGreaterThanOrEqual(1);
    expect(first.error).toMatch(/ECONNREFUSED|connect|refused/i);
    expect(new Date(first.next_attempt_at).getTime()).toBeGreaterThan(Date.now());

    // Not due yet: the sender leaves it alone.
    const before = (await outboxRow(CLIENT_EMAIL_2)).attempts;
    await sendPending();
    expect((await outboxRow(CLIENT_EMAIL_2)).attempts).toBe(before);

    // Every retry refused: it gives up at MAX_ATTEMPTS, honestly.
    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) {
      await admin.query(`UPDATE mail_outbox SET next_attempt_at = now() - interval '1 second' WHERE to_email = $1 AND status = 'queued'`, [CLIENT_EMAIL_2]);
      await sendPending();
    }
    const last = await outboxRow(CLIENT_EMAIL_2);
    expect(last.status).toBe('failed');
    expect(last.attempts).toBe(MAX_ATTEMPTS);
    expect(last.error).toBeTruthy();
    expect(received.some((m) => m.to && 'value' in m.to && m.to.value.some((a) => a.address === CLIENT_EMAIL_2))).toBe(false);
  });
});
