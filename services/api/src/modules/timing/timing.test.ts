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
let maria = '';
const v60 = '61000000-0000-4000-8000-000000000802';

const quote = (payload: object) =>
  app.inject({
    method: 'POST',
    url: `${API_PREFIX}/catalog/line-quote`,
    headers: { authorization: `Bearer ${maria}` },
    payload,
  });

describe('timing engine', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    maria = (
      await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/auth/login`,
        payload: { email: 'maria@velnes.mk', password: 'velnes-demo' },
      })
    ).json().accessToken;
  });
  afterAll(async () => {
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('effTreatment: pace applies for Maria (18 obs ≥ 12), never touching the price', async () => {
    const r = await quote({
      serviceId: demo.s1,
      locationId: demo.locCentar,
      modifierOptionIds: [],
      employeeId: demo.empMaria,
    });
    expect(r.json()).toMatchObject({ treatmentMin: 50, basis: 'employee-pace', price: 1800 });
    // Without an employee: the catalog speaks.
    const plain = await quote({
      serviceId: demo.s1,
      locationId: demo.locCentar,
      modifierOptionIds: [],
    });
    expect(plain.json()).toMatchObject({ treatmentMin: 45, basis: 'catalog' });
  });

  it('effTreatment: an approved service time is inherited by variants BY RATIO', async () => {
    // Elena s8 approved 40 (std variant is 45 min): v60 → round5(60·40/45)=55.
    const r = await quote({
      serviceId: demo.s8,
      locationId: demo.locCentar,
      variantId: v60,
      modifierOptionIds: [],
      employeeId: demo.empElena,
    });
    expect(r.json()).toMatchObject({ treatmentMin: 55, basis: 'employee-approved' });
    const std = await quote({
      serviceId: demo.s8,
      locationId: demo.locCentar,
      modifierOptionIds: [],
      employeeId: demo.empElena,
    });
    expect(std.json()).toMatchObject({ treatmentMin: 40, basis: 'employee-approved' });
  });

  it('ingest → recompute → suggest → approve, with audit', async () => {
    // Craft 12 finished treatments for Ana·s4: promised 60, measured 49.
    for (let i = 0; i < 12; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (i + 3));
      const iso = d.toISOString().slice(0, 10);
      const a = await admin.query(
        `INSERT INTO appointments (tenant_id, location_id, date, start_min, duration_min, kind, status, title, service_id, employee_id, customer_id, price, quoted, source)
         VALUES ($1,$2,$3,600,60,'appointment','confirmed','Obs',$4,$5,$6,1500,'{"treatmentMin":60}','staff') RETURNING id`,
        [demo.business, demo.locAerodrom, iso, demo.s4, demo.empAna, demo.c1],
      );
      const start = new Date(d);
      start.setHours(10, 0, 0, 0);
      const end = new Date(start.getTime() + 49 * 60000);
      await admin.query(
        `INSERT INTO appointment_history (tenant_id, appointment_id, what, at, source) VALUES
         ($1,$2,'Treatment started',$3,'employee'), ($1,$2,'Treatment finished',$4,'employee')`,
        [demo.business, a.rows[0].id, start, end],
      );
    }
    const rec = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/timings/recompute`,
      headers: { authorization: `Bearer ${maria}` },
    });
    expect(rec.statusCode).toBe(200);
    expect(rec.json().pairs).toBeGreaterThanOrEqual(1);

    const sug = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/timings/suggestions`,
      headers: { authorization: `Bearer ${maria}` },
    });
    const anaS4 = sug
      .json()
      .suggestions.find(
        (s: { employeeId: string; serviceId: string }) =>
          s.employeeId === demo.empAna && s.serviceId === demo.s4,
      );
    // 49/60 ≈ 0.82 → round5(60·0.82)=50 against the approved 60.
    expect(anaS4).toMatchObject({ recommendedMin: 50, currentMin: 60, observedN: 12 });

    const ok = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/timings/${anaS4.id}/approve`,
      headers: { authorization: `Bearer ${maria}` },
    });
    expect(ok.statusCode).toBe(200);
    const audit = await admin.query(
      `SELECT before, after FROM audit_log WHERE action='Timing approved' ORDER BY ts DESC LIMIT 1`,
    );
    expect(audit.rows[0]).toMatchObject({ before: '60 min', after: '50 min' });

    const after = await quote({
      serviceId: demo.s4,
      locationId: demo.locAerodrom,
      modifierOptionIds: [],
      employeeId: demo.empAna,
    });
    expect(after.json()).toMatchObject({ treatmentMin: 50, basis: 'employee-approved' });
  });

  it('dismiss holds until the sample regrows 25%', async () => {
    const et1 = await admin.query(`SELECT id, observed_n FROM emp_timings WHERE id=$1`, [
      demo.et1,
    ]);
    const dis = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/timings/${demo.et1}/dismiss`,
      headers: { authorization: `Bearer ${maria}` },
    });
    expect(dis.statusCode).toBe(200);
    const row = await admin.query(`SELECT status, dismissed_at_n FROM emp_timings WHERE id=$1`, [
      demo.et1,
    ]);
    expect(row.rows[0]).toMatchObject({
      status: 'dismissed',
      dismissed_at_n: et1.rows[0].observed_n,
    });
  });
});
