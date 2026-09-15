import { API_PREFIX } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';

/**
 * The AI Assistant spike, end to end against the real doors. The planner is
 * the deterministic stub (ASSISTANT_PROVIDER defaults to 'stub'), so every
 * turn is reproducible. These tests exercise the whole architecture:
 * intent → resolution → validation → draft → structured preview → explicit
 * approval → concurrency check → canonical door → audit → real result.
 */

const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
let owner = '';
let bareToken = '';
let bareRoleId = '';

async function token(email: string) {
  const res = await app.inject({
    method: 'POST',
    url: `${API_PREFIX}/auth/login`,
    payload: { email, password: 'velnes-demo' },
  });
  return res.json().accessToken as string;
}

const msg = (message: string, draftId: string | undefined, t = owner) =>
  app.inject({
    method: 'POST',
    url: `${API_PREFIX}/assistant/message`,
    headers: { authorization: `Bearer ${t}` },
    payload: draftId ? { message, draftId } : { message },
  });

const exec = (draftId: string, t = owner) =>
  app.inject({
    method: 'POST',
    url: `${API_PREFIX}/assistant/execute`,
    headers: { authorization: `Bearer ${t}` },
    payload: { draftId },
  });

const priceOf = async (id: string) =>
  Number((await admin.query(`SELECT price FROM services WHERE id=$1`, [id])).rows[0].price);

describe('the AI Assistant: plans, previews, approves, executes, audits', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    owner = await token('maria@velnes.mk');
    // A permissionless role, worn by Ana for the refusal test.
    const r = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/roles`,
      headers: { authorization: `Bearer ${owner}` },
      payload: { name: 'Assistant-bare (test)', description: 'Nothing.', perms: {} },
    });
    bareRoleId = (r.json() as { id: string }).id;
    await app.inject({
      method: 'PATCH',
      url: `${API_PREFIX}/employees/${demo.empAna}`,
      headers: { authorization: `Bearer ${owner}` },
      payload: { roleId: bareRoleId },
    });
    bareToken = await token('ana@velnes.mk');
  });

  afterAll(async () => {
    await admin.query(`UPDATE services SET price=1200 WHERE id=$1`, [demo.s3]);
    await admin.query(`UPDATE services SET price=1500 WHERE id=$1`, [demo.s4]);
    await admin.query(`DELETE FROM services WHERE tenant_id=$1 AND name='Womens Hair Colouring'`, [demo.business]);
    await admin.query(
      `DELETE FROM schedule_exceptions WHERE tenant_id=$1 AND start_date='2026-12-25'`,
      [demo.business],
    );
    await admin.query(`DELETE FROM assistant_actions WHERE tenant_id=$1`, [demo.business]);
    await admin.query(`DELETE FROM assistant_drafts WHERE tenant_id=$1`, [demo.business]);
    await admin.query(`UPDATE employees SET role_id=$2 WHERE id=$1`, [demo.empAna, demo.roleEmployee]);
    await admin.query(`DELETE FROM roles WHERE id=$1`, [bareRoleId]);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('reads a service price without any draft or mutation', async () => {
    const res = await msg("What's the price of Follow-up session?", undefined);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.reply).toContain('1,200 MKD');
    expect(body.draft.kind).toBe('read');
    expect(body.draft.status).toBe('COMPLETED');
  });

  it('update: previews a structured change, then executes on explicit approval', async () => {
    const prep = await msg('Change Follow-up session to 1300', undefined);
    const d = prep.json().draft;
    expect(d.status).toBe('READY_FOR_REVIEW');
    expect(d.preview.ops[0]).toMatchObject({ kind: 'update', before: { price: 1200 }, after: { price: 1300 } });
    expect(prep.json().reply.toLowerCase()).toContain('review');

    // Nothing changed yet — preview must not mutate.
    expect(await priceOf(demo.s3)).toBe(1200);

    const done = await exec(d.id);
    const out = done.json();
    expect(out.status).toBe('COMPLETED');
    expect(out.message).toContain('Updated');
    expect(await priceOf(demo.s3)).toBe(1300);

    // Both audit trails were written.
    const human = await admin.query(
      `SELECT action, source FROM audit_log WHERE tenant_id=$1 AND source='ai_assistant' ORDER BY ts DESC LIMIT 1`,
      [demo.business],
    );
    expect(human.rows[0].action).toContain('Edit a service');
    const structured = await admin.query(
      `SELECT action_id, result FROM assistant_actions WHERE tenant_id=$1 ORDER BY ts DESC LIMIT 1`,
      [demo.business],
    );
    expect(structured.rows[0]).toMatchObject({ action_id: 'edit_service', result: 'success' });
  });

  it('refuses when the user lacks the permission — no draft, no collection', async () => {
    const res = await msg('Change Follow-up session to 1500', undefined, bareToken);
    const body = res.json();
    expect(body.draft).toBeNull();
    expect(body.reply.toLowerCase()).toContain('permission');
  });

  it('surfaces a not-found service as a collecting error, never a guess', async () => {
    const res = await msg('Change Nonexistent widget to 999', undefined);
    const d = res.json().draft;
    expect(d.status).toBe('COLLECTING');
    expect(d.errors[0].code).toBe('NOT_FOUND');
  });

  it('continues an unfinished draft across turns without losing progress', async () => {
    const t1 = await msg('Change the price to 1400', undefined);
    const d1 = t1.json().draft;
    expect(d1.status).toBe('COLLECTING');
    expect(d1.missing).toContain('serviceName');
    expect(d1.requiredCount).toBe(1);

    const t2 = await msg('Follow-up session', d1.id);
    const d2 = t2.json().draft;
    expect(d2.id).toBe(d1.id); // same draft, continued
    expect(d2.status).toBe('READY_FOR_REVIEW');
    expect(d2.preview.ops[0].after).toMatchObject({ price: 1400 });
  });

  it('lists the salon services on request', async () => {
    const res = await msg('What are my services?', undefined);
    const body = res.json();
    expect(body.draft.kind).toBe('read');
    expect(body.reply.toLowerCase()).toContain('service');
    expect(body.reply).toContain('Rehab training');
  });

  it('creates a service: requires a category, then previews → approves → real filed row', async () => {
    // Name + price + duration given, but no category → must ask for it.
    const t1 = await msg('Add a new service called Womens Hair Colouring for 1500 30 min', undefined);
    const d1 = t1.json().draft;
    expect(d1.status).toBe('COLLECTING');
    expect(d1.missing).toContain('category');
    expect(t1.json().reply.toLowerCase()).toContain('category');

    const prep = await msg('Rehab', d1.id); // an existing category
    const d = prep.json().draft;
    expect(d.status).toBe('READY_FOR_REVIEW');
    expect(d.preview.ops[0]).toMatchObject({
      kind: 'create',
      after: { name: 'Womens Hair Colouring', price: 1500, durationMin: 30, category: 'Rehab' },
    });
    // Nothing written on preview.
    const pre = await admin.query(`SELECT id FROM services WHERE tenant_id=$1 AND name='Womens Hair Colouring'`, [
      demo.business,
    ]);
    expect(pre.rowCount).toBe(0);

    const done = await exec(d.id);
    expect(done.json().status).toBe('COMPLETED');
    // The real row exists AND is filed under the category (so it shows in the catalog).
    const post = await admin.query(
      `SELECT s.price, s.duration_min, c.name AS category
         FROM services s JOIN service_categories c ON c.id = s.category_id
        WHERE s.tenant_id=$1 AND s.name='Womens Hair Colouring'`,
      [demo.business],
    );
    expect(post.rowCount).toBe(1);
    expect(Number(post.rows[0].price)).toBe(1500);
    expect(Number(post.rows[0].duration_min)).toBe(30);
    expect(post.rows[0].category).toBe('Rehab');
  });

  it('closes a location on a date across two turns, then writes the closure', async () => {
    const t1 = await msg('Close the salon on 2026-12-25', undefined);
    const d1 = t1.json().draft;
    expect(d1.status).toBe('COLLECTING'); // two locations → asks which
    expect(d1.errors.some((e: { field: string }) => e.field === 'location')).toBe(true);

    const t2 = await msg('Centar', d1.id);
    const d2 = t2.json().draft;
    expect(d2.status).toBe('READY_FOR_REVIEW');
    expect(d2.preview.ops[0].kind).toBe('create');

    const done = await exec(d2.id);
    expect(done.json().status).toBe('COMPLETED');
    const ex = await admin.query(
      `SELECT type FROM schedule_exceptions WHERE location_id=$1 AND start_date='2026-12-25'`,
      [demo.locCentar],
    );
    expect(ex.rowCount).toBe(1);
    expect(ex.rows[0].type).toBe('CLOSED');
  });

  it('treats "delete a service" as navigate-only — explains and deep-links, never executes', async () => {
    const res = await msg('Delete the Rehab training service', undefined);
    const body = res.json();
    expect(body.draft.kind).toBe('navigate');
    expect(body.draft.navigate).toMatchObject({ screen: '/catalog', entityId: demo.s4 });
    expect(body.reply.toLowerCase()).toMatch(/catalog|won.t|permanent/);
    // The service is untouched.
    const still = await admin.query(`SELECT id FROM services WHERE id=$1`, [demo.s4]);
    expect(still.rowCount).toBe(1);
  });

  it('refuses every assistant call when HQ has the salon switched off', async () => {
    await admin.query(`UPDATE businesses SET assistant_enabled=false WHERE id=$1`, [demo.business]);
    try {
      const res = await msg("What's the price of Follow-up session?", undefined);
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('FORBIDDEN');
    } finally {
      await admin.query(`UPDATE businesses SET assistant_enabled=true WHERE id=$1`, [demo.business]);
    }
  });

  it('catches a stale price at execute, re-baselines, then succeeds on re-approval', async () => {
    const prep = await msg('Change Rehab training to 1600', undefined);
    const d = prep.json().draft;
    expect(d.status).toBe('READY_FOR_REVIEW');

    // Someone else edits the price after the preview was built.
    await admin.query(`UPDATE services SET price=1550 WHERE id=$1`, [demo.s4]);

    const stale = await exec(d.id);
    const conflict = stale.json();
    expect(conflict.status).toBe('READY_FOR_REVIEW');
    expect(conflict.conflict).toMatchObject({ field: 'price', now: '1,550 MKD', proposed: '1,600 MKD' });
    expect(await priceOf(demo.s4)).toBe(1550); // still not mutated

    // Re-approval now compares against the fresh baseline and goes through.
    const done = await exec(d.id);
    expect(done.json().status).toBe('COMPLETED');
    expect(await priceOf(demo.s4)).toBe(1600);
  });
});
