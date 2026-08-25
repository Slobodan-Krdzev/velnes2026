import { API_PREFIX, AdminWidgetSchema, WidgetListResponseSchema } from '@velnes/contracts';
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

let ownerToken = '';
let staffToken = '';
let createdId = '';

async function token(email: string) {
  const res = await app.inject({
    method: 'POST',
    url: `${API_PREFIX}/auth/login`,
    payload: { email, password: 'velnes-demo' },
  });
  return res.json().accessToken as string;
}

describe('the widgets management doors', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    ownerToken = await token('maria@velnes.mk');
    staffToken = await token('ana@velnes.mk');
  });
  afterAll(async () => {
    if (createdId) await admin.query(`DELETE FROM widgets WHERE id=$1`, [createdId]);
    await admin.query(
      `DELETE FROM audit_log WHERE object LIKE 'Widget ·%' AND action IN ('Widget created','Widget set live','Online booking / Regenerate widget key')`,
    );
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('lists the widgets with the booking-link slug — behind widget.manage', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/widgets`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = WidgetListResponseSchema.parse(res.json());
    expect(body.slug).toBe('velnes-fizio');
    expect(body.widgets.some((w) => w.publishableKey === 'pk_live_velnes_demo')).toBe(true);

    const denied = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/widgets`,
      headers: { authorization: `Bearer ${staffToken}` },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('creates a draft widget with a fresh key and audits it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/widgets`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: 'Second site' },
    });
    expect(res.statusCode).toBe(200);
    const w = AdminWidgetSchema.parse(res.json());
    createdId = w.id;
    expect(w.status).toBe('draft');
    expect(w.publishableKey).toMatch(/^pk_live_/);
    expect(w.publishableKey).not.toBe('pk_live_velnes_demo');
    const audit = await admin.query(
      `SELECT 1 FROM audit_log WHERE action='Widget created' AND object='Widget · Second site'`,
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('patches settings, audits the live switch, and a draft stays invisible publicly', async () => {
    // Draft → the public door does not know this key.
    const w0 = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/widgets`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const created = w0.json().widgets.find((x: { id: string }) => x.id === createdId);
    const publicTry = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/public/widget?key=${created.publishableKey}`,
    });
    expect(publicTry.statusCode).toBe(404);

    const res = await app.inject({
      method: 'PATCH',
      url: `${API_PREFIX}/widgets/${createdId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { accent: '#1a73e8', domains: ['mysalon.mk'], status: 'live' },
    });
    expect(res.statusCode).toBe(200);
    const w = AdminWidgetSchema.parse(res.json());
    expect(w.accent).toBe('#1a73e8');
    expect(w.domains).toEqual(['mysalon.mk']);
    expect(w.status).toBe('live');
    const audit = await admin.query(
      `SELECT 1 FROM audit_log WHERE action='Widget set live' AND object='Widget · Second site'`,
    );
    expect(audit.rows).toHaveLength(1);

    // Live → now the public door answers.
    const publicNow = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/public/widget?key=${w.publishableKey}`,
    });
    expect(publicNow.statusCode).toBe(200);
  });

  it('regenerates the key: the old one dies this second, audited — behind integrations.manage', async () => {
    const before = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/widgets`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const oldKey = before.json().widgets.find((x: { id: string }) => x.id === createdId)
      .publishableKey as string;

    const denied = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/widgets/${createdId}/regenerate-key`,
      headers: { authorization: `Bearer ${staffToken}` },
    });
    expect(denied.statusCode).toBe(403);

    const res = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/widgets/${createdId}/regenerate-key`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const w = AdminWidgetSchema.parse(res.json());
    expect(w.publishableKey).not.toBe(oldKey);

    const dead = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/public/widget?key=${oldKey}`,
    });
    expect(dead.statusCode).toBe(404);
    const audit = await admin.query(
      `SELECT 1 FROM audit_log WHERE action='Online booking / Regenerate widget key'`,
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('serves the integration event feed to integrations.manage only', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/integration-events`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().events)).toBe(true);
    const denied = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/integration-events`,
      headers: { authorization: `Bearer ${staffToken}` },
    });
    expect(denied.statusCode).toBe(403);
  });
});
