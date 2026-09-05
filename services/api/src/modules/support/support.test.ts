import { API_PREFIX } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { buildServer } from '../../server.js';

const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
let mariaToken = '';
let bojanToken = '';
let hqToken = '';

async function login(url: string, email: string) {
  const res = await app.inject({ method: 'POST', url: `${API_PREFIX}${url}`, payload: { email, password: 'velnes-demo' } });
  return (res.json() as { accessToken: string }).accessToken;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe('support tickets: salon and supplier reach HQ, in the apps and the outbox', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    mariaToken = await login('/auth/login', 'maria@velnes.mk');
    bojanToken = await login('/portal/auth/login', 'bojan@beautypro.mk');
    hqToken = await login('/hq/auth/login', 'ivana@revelapps.com');
  });
  afterAll(async () => {
    await admin.query(`DELETE FROM support_tickets WHERE subject LIKE '%(test)%'`);
    await admin.query(`DELETE FROM mail_outbox WHERE kind IN ('support_ticket','support_reply')`);
    await admin.query(`DELETE FROM platform_notices WHERE kind='support'`);
    await admin.query(`DELETE FROM supplier_notifications WHERE kind='ticket'`);
    await app.close();
    await closeDb();
  });

  it('a salon opens a ticket; HQ sees it, the count rises, HQ answers, the salon reads the reply', async () => {
    const opened = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/support/tickets`,
      headers: auth(mariaToken),
      payload: { subject: 'Widget shows no times (test)', category: 'technical', body: 'Our booking page is empty.' },
    });
    expect(opened.statusCode).toBe(200);
    const id = (opened.json() as { id: string }).id;

    // The salon sees its own ticket with the first message.
    const mine = await app.inject({ method: 'GET', url: `${API_PREFIX}/support/tickets`, headers: auth(mariaToken) });
    const t1 = (mine.json() as { tickets: { id: string; status: string; messages: unknown[] }[] }).tickets.find((x) => x.id === id)!;
    expect(t1.status).toBe('open');
    expect(t1.messages.length).toBe(1);

    // The open ticket rang HQ's inbox (mock_sent) and HQ's bell.
    const toHq = await admin.query(`SELECT status FROM mail_outbox WHERE kind='support_ticket' AND ref_id=$1`, [id]);
    expect(toHq.rows[0]?.status).toBe('mock_sent');
    const hqBell = await admin.query(
      `SELECT audience FROM platform_notices WHERE kind='support' AND ref_id=$1`,
      [id],
    );
    expect(hqBell.rows[0]?.audience).toBe('hq');

    // HQ sees it in the queue and the dashboard count reflects it.
    const hqList = await app.inject({ method: 'GET', url: `${API_PREFIX}/hq/tickets`, headers: auth(hqToken) });
    const seen = (hqList.json() as { tickets: { id: string; origin: string; originName: string }[] }).tickets.find((x) => x.id === id)!;
    expect(seen.origin).toBe('tenant');
    expect(seen.originName.length).toBeGreaterThan(0);
    const dash = await app.inject({ method: 'GET', url: `${API_PREFIX}/hq/businesses`, headers: auth(hqToken) });
    expect((dash.json() as { stats: { openTickets: number } }).stats.openTickets).toBeGreaterThan(0);

    // HQ answers and moves the ticket; the reply mails the opener.
    const answered = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/tickets/${id}/reply`,
      headers: auth(hqToken),
      payload: { body: 'Re-publish the widget key and it will fill.', status: 'in_progress' },
    });
    expect(answered.statusCode).toBe(200);
    const back = await admin.query(`SELECT to_email, status FROM mail_outbox WHERE kind='support_reply' AND ref_id=$1`, [id]);
    expect(back.rows[0]?.to_email).toBe('maria@velnes.mk');
    expect(back.rows[0]?.status).toBe('mock_sent');
    // HQ's reply also rang the salon's bell, targeted to its tenant.
    const salonBell = await admin.query(
      `SELECT audience, tenant_id FROM platform_notices WHERE kind='support' AND audience='salons' AND ref_id=$1`,
      [id],
    );
    expect(salonBell.rows[0]?.tenant_id).toBeTruthy();

    // The salon now reads HQ's reply and the moved status.
    const after = await app.inject({ method: 'GET', url: `${API_PREFIX}/support/tickets`, headers: auth(mariaToken) });
    const t2 = (after.json() as { tickets: { id: string; status: string; lastActor: string; messages: unknown[] }[] }).tickets.find((x) => x.id === id)!;
    expect(t2.status).toBe('in_progress');
    expect(t2.lastActor).toBe('hq');
    expect(t2.messages.length).toBe(2);
  });

  it('a supplier opens a ticket that HQ sees but the salon cannot', async () => {
    const opened = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/portal/support/tickets`,
      headers: auth(bojanToken),
      payload: { subject: 'Payout report question (test)', category: 'billing', body: 'Where is last month’s statement?' },
    });
    expect(opened.statusCode).toBe(200);
    const id = (opened.json() as { id: string }).id;

    const supplierList = await app.inject({ method: 'GET', url: `${API_PREFIX}/portal/support/tickets`, headers: auth(bojanToken) });
    expect((supplierList.json() as { tickets: { id: string }[] }).tickets.some((x) => x.id === id)).toBe(true);

    // HQ sees the supplier-origin ticket.
    const hqList = await app.inject({ method: 'GET', url: `${API_PREFIX}/hq/tickets`, headers: auth(hqToken) });
    const seen = (hqList.json() as { tickets: { id: string; origin: string }[] }).tickets.find((x) => x.id === id)!;
    expect(seen.origin).toBe('supplier');

    // The salon's own list never contains the supplier's ticket (RLS).
    const salonList = await app.inject({ method: 'GET', url: `${API_PREFIX}/support/tickets`, headers: auth(mariaToken) });
    expect((salonList.json() as { tickets: { id: string }[] }).tickets.some((x) => x.id === id)).toBe(false);

    // HQ answers; the supplier's own bell rings (supplier_notifications).
    const answered = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/tickets/${id}/reply`,
      headers: auth(hqToken),
      payload: { body: 'The statement is under Reports → Payouts.' },
    });
    expect(answered.statusCode).toBe(200);
    const supBell = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/portal/notifications`,
      headers: auth(bojanToken),
    });
    expect(
      (supBell.json() as { notifications: { kind: string; refId: string | null }[] }).notifications.some(
        (n) => n.kind === 'ticket' && n.refId === id,
      ),
    ).toBe(true);
  });
});
