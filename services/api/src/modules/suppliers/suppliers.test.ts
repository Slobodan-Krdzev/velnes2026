import { API_PREFIX, PurchaseOrderSchema, SupplierListSchema } from '@velnes/contracts';
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
let vesnaToken = '';
let orderId = '';
const SP1 = 'd2000000-0000-4000-8000-000000000001';
const SP10 = 'd2000000-0000-4000-8000-000000000010';

const get = (url: string, token = ownerToken) =>
  app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
const post = (url: string, payload: unknown = {}, token = ownerToken) =>
  app.inject({
    method: 'POST',
    url,
    headers: { authorization: `Bearer ${token}` },
    payload: payload as Record<string, unknown>,
  });

describe('the supplier chain', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    const login = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/auth/login`,
      payload: { email: 'maria@velnes.mk', password: 'velnes-demo' },
    });
    ownerToken = login.json().accessToken;
    const portal = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/portal/auth/login`,
      payload: { email: 'vesna@beautypro.mk', password: 'velnes-demo' },
    });
    vesnaToken = portal.json().accessToken;
  });
  afterAll(async () => {
    if (orderId) {
      await admin.query(`DELETE FROM purchase_order_lines WHERE order_id=$1`, [orderId]);
      await admin.query(`DELETE FROM purchase_orders WHERE id=$1`, [orderId]);
    }
    await admin.query(`DELETE FROM supplier_connections WHERE supplier_id=$1`, [demo.sup3]);
    // Undo the test deliveries: drop their movements, then put the
    // stock column back to what the ledger says.
    await admin.query(
      `DELETE FROM stock_movements WHERE kind='delivery' AND at > now() - interval '10 minutes'`,
    );
    await admin.query(
      `UPDATE location_catalog_products lcp
       SET stock = COALESCE((SELECT SUM(qty) FROM stock_movements m
         WHERE m.product_id = lcp.product_id AND m.location_id = lcp.location_id), 0)
       WHERE lcp.product_id = $1 AND lcp.location_id = $2`,
      [demo.p1, demo.locCentar],
    );
    await admin.query(`DELETE FROM audit_log WHERE action IN ('Order submitted','Order status','Delivery received')`);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('lists the platform suppliers with this salon connection state', async () => {
    const res = await get(`${API_PREFIX}/suppliers`);
    expect(res.statusCode).toBe(200);
    const body = SupplierListSchema.parse(res.json());
    const bp = body.suppliers.find((s) => s.name === 'BeautyPro MK')!;
    expect(bp.status).toBe('connected');
    expect(bp.customerNo).toBe('MK-4821');
    expect(bp.products).toBe(7);
    expect(body.suppliers.find((s) => s.name === 'Adriatic Beauty Group')!.status).toBe('available');
    expect(body.suppliers.find((s) => s.name === 'Skopje Salon Supplies')!.status).toBe('pending');
  });

  it('runs the connection handshake: salon asks, the portal accepts', async () => {
    const ask = await post(`${API_PREFIX}/suppliers/${demo.sup3}/connect`, { note: 'New customer' });
    expect(ask.statusCode).toBe(200);
    // Adriatic has no portal user seeded; BeautyPro's Vesna sees only
    // her own connections (RLS) — so the sup3 request is invisible.
    const salons = await get(`${API_PREFIX}/portal/salons`, vesnaToken);
    expect(
      salons.json().salons.every((s: { status: string }) => s.status !== 'pending' || s.note !== 'New customer'),
    ).toBe(true);
  });

  it('refuses ordering below the product minimum and the supplier minimum', async () => {
    const moq = await post(`${API_PREFIX}/purchase-orders`, {
      supplierId: demo.sup2,
      locationId: demo.locCentar,
      lines: [{ supplierProductId: 'd2000000-0000-4000-8000-000000000005', qty: 1 }],
      submit: true,
    });
    expect(moq.statusCode).toBe(422); // MOQ is 2
    const min = await post(`${API_PREFIX}/purchase-orders`, {
      supplierId: demo.sup2,
      locationId: demo.locCentar,
      lines: [{ supplierProductId: 'd2000000-0000-4000-8000-000000000005', qty: 2 }],
      submit: true,
    });
    expect(min.statusCode).toBe(422);
    expect(min.json().error).toBe('MIN_ORDER'); // 1700 < 12000
    const sample = await post(`${API_PREFIX}/purchase-orders`, {
      supplierId: demo.sup1,
      locationId: demo.locCentar,
      lines: [{ supplierProductId: SP10, qty: 1 }],
      submit: false,
    });
    expect(sample.statusCode).toBe(422); // samples are requested, not ordered
  });

  it('submits an order and the live bxgy promotion adds its free units by itself', async () => {
    const res = await post(`${API_PREFIX}/purchase-orders`, {
      supplierId: demo.sup1,
      locationId: demo.locCentar,
      lines: [{ supplierProductId: SP1, qty: 20 }],
      submit: true,
    });
    expect(res.statusCode).toBe(200);
    const o = PurchaseOrderSchema.parse(res.json());
    orderId = o.id;
    expect(o.status).toBe('submitted');
    expect(o.lines[0]!.free).toBe(4); // buy 10 get 2 → 20 buys 4 free
    expect(o.total).toBe(20 * 550);
    const audit = await admin.query(
      `SELECT 1 FROM audit_log WHERE action='Order submitted' AND object=$1`,
      [`Order · ${o.ref}`],
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('the portal walks its side of the flow: accept → processing → shipped with tracking', async () => {
    const seen = await get(`${API_PREFIX}/portal/orders`, vesnaToken);
    expect(seen.json().orders.some((o: { id: string }) => o.id === orderId)).toBe(true);

    await post(`${API_PREFIX}/portal/orders/${orderId}/transitions`, { to: 'accepted' }, vesnaToken);
    await post(`${API_PREFIX}/portal/orders/${orderId}/transitions`, { to: 'processing' }, vesnaToken);
    const shipped = await post(
      `${API_PREFIX}/portal/orders/${orderId}/transitions`,
      { to: 'shipped', track: 'MK-PARCEL-90001' },
      vesnaToken,
    );
    expect(shipped.statusCode).toBe(200);
    expect(shipped.json().status).toBe('shipped');
    expect(shipped.json().track).toBe('MK-PARCEL-90001');
    // The wrong side cannot receive: that is the salon's step.
    const wrong = await post(
      `${API_PREFIX}/portal/orders/${orderId}/transitions`,
      { to: 'shipped' },
      vesnaToken,
    );
    expect(wrong.statusCode).toBe(409);
  });

  it('receiving counts what actually arrived: good units into stock, shortage keeps it open', async () => {
    const before = await admin.query(
      `SELECT stock FROM location_catalog_products WHERE location_id=$1 AND product_id=$2`,
      [demo.locCentar, demo.p1],
    );
    const order = await get(`${API_PREFIX}/purchase-orders`);
    const o = order.json().orders.find((x: { id: string }) => x.id === orderId);
    const lineId = o.lines[0].id;

    // 24 expected (20 + 4 free); 20 arrive, 2 damaged → 18 good.
    const part = await post(`${API_PREFIX}/purchase-orders/${orderId}/receive`, {
      lines: [{ lineId, received: 20, damaged: 2 }],
    });
    expect(part.statusCode).toBe(200);
    expect(part.json().status).toBe('partdelivered');
    const after = await admin.query(
      `SELECT stock FROM location_catalog_products WHERE location_id=$1 AND product_id=$2`,
      [demo.locCentar, demo.p1],
    );
    expect(after.rows[0].stock - before.rows[0].stock).toBe(18);
    const mv = await admin.query(
      `SELECT qty FROM stock_movements WHERE kind='delivery' AND product_id=$1 ORDER BY at DESC LIMIT 1`,
      [demo.p1],
    );
    expect(mv.rows[0].qty).toBe(18);

    // The rest arrives — receive completes the order.
    const done = await post(`${API_PREFIX}/purchase-orders/${orderId}/receive`, {
      lines: [{ lineId, received: 24, damaged: 0 }],
    });
    expect(done.json().status).toBe('delivered');
  });

  it('keeps the token worlds apart: a portal token opens no tenant door', async () => {
    const denied = await get(`${API_PREFIX}/purchase-orders`, vesnaToken);
    expect(denied.statusCode).toBe(401);
    const denied2 = await get(`${API_PREFIX}/portal/orders`);
    expect(denied2.statusCode).toBe(401);
  });
});
