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
let bojanToken = '';
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
    const owner = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/portal/auth/login`,
      payload: { email: 'bojan@beautypro.mk', password: 'velnes-demo' },
    });
    bojanToken = owner.json().accessToken;
  });
  afterAll(async () => {
    if (orderId) {
      await admin.query(`DELETE FROM supplier_notifications WHERE ref_id=$1`, [orderId]);
      await admin.query(`DELETE FROM platform_notices WHERE ref_id=$1`, [orderId]);
      await admin.query(`DELETE FROM mail_outbox WHERE ref_id=$1`, [orderId]);
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
    await admin.query(`UPDATE suppliers SET avatar=NULL WHERE id=$1`, [demo.sup1]);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('a supplier owner sets its logo; the salon sees it on the suppliers screen', async () => {
    const avatar = 'data:image/png;base64,iVBORw0KGgo=';
    // The owner (sr_owner) can; the salon then sees it in the directory.
    const set = await app.inject({
      method: 'PATCH',
      url: `${API_PREFIX}/portal/company`,
      headers: { authorization: `Bearer ${bojanToken}` },
      payload: { avatar },
    });
    expect(set.statusCode).toBe(200);
    const list = await get(`${API_PREFIX}/suppliers`);
    const bp = list.json().suppliers.find((s: { id: string }) => s.id === demo.sup1);
    expect(bp.avatar).toBe(avatar);
    // The portal reads its own logo back.
    const company = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/portal/company`,
      headers: { authorization: `Bearer ${bojanToken}` },
    });
    expect(company.json().avatar).toBe(avatar);
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
    // The supplier hears it: a row in its bell, kind `connection`,
    // pointing at the salon (2026-10-06).
    const heard = await admin.query(
      `SELECT title, kind FROM supplier_notifications WHERE supplier_id=$1 AND ref_id=$2 ORDER BY created_at DESC LIMIT 1`,
      [demo.sup3, demo.business],
    );
    expect(heard.rows[0]).toMatchObject({ kind: 'connection' });
    expect(heard.rows[0].title).toContain('Connection request');
    // Adriatic has no portal user seeded; BeautyPro's Vesna sees only
    // her own connections (RLS) — so the sup3 request is invisible.
    const salons = await get(`${API_PREFIX}/portal/salons`, vesnaToken);
    expect(
      salons.json().salons.every((s: { status: string; note: string }) => s.status !== 'pending' || s.note !== 'New customer'),
    ).toBe(true);
  });

  it('the portal\'s answer rings the salon\'s bell and mails its owner — accepted here, declined the same way', async () => {
    // Another salon asks BeautyPro; Bojan accepts from the portal.
    const other = (
      await admin.query(
        `SELECT b.id, o.email FROM businesses b JOIN employees o ON o.id = b.owner_employee_id
         WHERE b.id <> $1 AND NOT EXISTS (SELECT 1 FROM supplier_connections c WHERE c.tenant_id = b.id AND c.supplier_id = $2) LIMIT 1`,
        [demo.business, demo.sup1],
      )
    ).rows[0] as { id: string; email: string };
    expect(other).toBeDefined();
    await admin.query(`INSERT INTO supplier_connections (tenant_id, supplier_id, status) VALUES ($1, $2, 'pending')`, [other.id, demo.sup1]);
    try {
      const ok = await post(`${API_PREFIX}/portal/connections/${other.id}/accept`, {}, bojanToken);
      expect(ok.statusCode, ok.body).toBe(200);
      const bell = await admin.query(
        `SELECT kind, title FROM platform_notices WHERE audience='salons' AND tenant_id=$1 AND ref_id=$2 ORDER BY created_at DESC LIMIT 1`,
        [other.id, demo.sup1],
      );
      expect(bell.rows[0]).toMatchObject({ kind: 'supplier_connection' });
      expect(bell.rows[0].title).toContain('accepted your connection');
      const mail = await admin.query(`SELECT kind, to_email FROM mail_outbox WHERE ref_id=$1 AND tenant_id=$2 ORDER BY sent_at DESC LIMIT 1`, [demo.sup1, other.id]);
      expect(mail.rows[0]).toMatchObject({ kind: 'connection_accepted', to_email: other.email });
    } finally {
      await admin.query(`DELETE FROM platform_notices WHERE tenant_id=$1 AND ref_id=$2`, [other.id, demo.sup1]);
      await admin.query(`DELETE FROM mail_outbox WHERE ref_id=$1 AND tenant_id=$2`, [demo.sup1, other.id]);
      await admin.query(`DELETE FROM supplier_connections WHERE tenant_id=$1 AND supplier_id=$2`, [other.id, demo.sup1]);
    }
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
    // No invoice before delivery (2026-10-06).
    expect(o.invoiceNo).toBeNull();
    const early = await get(`${API_PREFIX}/purchase-orders/${o.id}/invoice.pdf`);
    expect(early.statusCode).toBe(409);
    const audit = await admin.query(
      `SELECT 1 FROM audit_log WHERE action='Order submitted' AND object=$1`,
      [`Order · ${o.ref}`],
    );
    expect(audit.rows).toHaveLength(1);

    // The supplier is notified and gets an "order placed" mail.
    const notif = await admin.query(
      `SELECT title, kind FROM supplier_notifications WHERE ref_id=$1`,
      [o.id],
    );
    expect(notif.rows[0]).toMatchObject({ kind: 'order', title: `New order ${o.ref}` });
    const mail = await admin.query(
      `SELECT to_email, kind FROM mail_outbox WHERE ref_id=$1 AND kind='order_placed'`,
      [o.id],
    );
    expect(mail.rows[0]).toMatchObject({ to_email: 'vesna@beautypro.mk', kind: 'order_placed' });

    // The portal notification feed surfaces it.
    const feed = (await get(`${API_PREFIX}/portal/notifications`, vesnaToken)).json() as {
      notifications: { title: string; refId: string }[];
    };
    expect(feed.notifications.some((n) => n.refId === o.id)).toBe(true);

    // And it leads the dashboard's newest-orders list.
    const dash = (await get(`${API_PREFIX}/portal/dashboard`, vesnaToken)).json() as {
      recentOrders: { id: string }[];
    };
    expect(dash.recentOrders[0]?.id).toBe(o.id);
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
    // The salon heard both steps the supplier took — bell and mail (2026-10-06).
    const bells = await admin.query(
      `SELECT kind, title FROM platform_notices WHERE audience='salons' AND tenant_id=$1 AND ref_id=$2 ORDER BY created_at`,
      [demo.business, orderId],
    );
    expect(bells.rows.map((r: { kind: string }) => r.kind)).toEqual(['supplier_order', 'supplier_order']);
    expect(bells.rows[0].title).toContain('accepted');
    expect(bells.rows[1].title).toContain('shipped');
    const mails = await admin.query(`SELECT kind, to_email FROM mail_outbox WHERE ref_id=$1 AND kind LIKE 'order_%' ORDER BY sent_at`, [orderId]);
    expect(mails.rows.map((r: { kind: string }) => r.kind)).toEqual(['order_placed', 'order_accepted', 'order_shipped']);
    expect(mails.rows[1].to_email).toBe('maria@velnes.mk');
    // The wrong side cannot receive: that is the salon's step.
    const wrong = await post(
      `${API_PREFIX}/portal/orders/${orderId}/transitions`,
      { to: 'shipped' },
      vesnaToken,
    );
    expect(wrong.statusCode).toBe(409);
  });

  it('declining an order needs a reason, and records it on the order', async () => {
    // A fresh submitted order to decline.
    const made = await post(`${API_PREFIX}/purchase-orders`, {
      supplierId: demo.sup1,
      locationId: demo.locCentar,
      lines: [{ supplierProductId: SP1, qty: 20 }],
      submit: true,
    });
    const o = PurchaseOrderSchema.parse(made.json());
    // Decline with no reason is refused.
    const noReason = await post(
      `${API_PREFIX}/portal/orders/${o.id}/transitions`,
      { to: 'cancelled' },
      vesnaToken,
    );
    expect(noReason.statusCode).toBe(422);
    // With a reason it cancels and the reason lands on the order.
    const declined = await post(
      `${API_PREFIX}/portal/orders/${o.id}/transitions`,
      { to: 'cancelled', reason: 'Out of stock until next month' },
      vesnaToken,
    );
    expect(declined.statusCode).toBe(200);
    const body = PurchaseOrderSchema.parse(declined.json());
    expect(body.status).toBe('cancelled');
    expect(body.supplierNote).toBe('Out of stock until next month');
    const audit = await admin.query(
      `SELECT reason FROM audit_log WHERE object=$1 AND after='cancelled' ORDER BY ts DESC LIMIT 1`,
      [`Order · ${o.ref}`],
    );
    expect(audit.rows[0].reason).toBe('Out of stock until next month');
    // cleanup
    await admin.query(`DELETE FROM supplier_notifications WHERE ref_id=$1`, [o.id]);
    await admin.query(`DELETE FROM mail_outbox WHERE ref_id=$1`, [o.id]);
    await admin.query(`DELETE FROM purchase_order_lines WHERE order_id=$1`, [o.id]);
    await admin.query(`DELETE FROM purchase_orders WHERE id=$1`, [o.id]);
    await admin.query(`DELETE FROM audit_log WHERE object=$1`, [`Order · ${o.ref}`]);
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
    // Delivered is invoiced: a number in the supplier's yearly sequence,
    // and the same PDF from either side (2026-10-06).
    expect(done.json().invoiceNo).toMatch(/^INV-\d{4}-\d{4}$/);
    expect(done.json().invoicedAt).toBeTruthy();
    const pdf = await get(`${API_PREFIX}/purchase-orders/${orderId}/invoice.pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.headers['content-disposition']).toContain(`${done.json().invoiceNo}.pdf`);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const theirs = await get(`${API_PREFIX}/portal/orders/${orderId}/invoice.pdf`, vesnaToken);
    expect(theirs.statusCode).toBe(200);
    expect(theirs.headers['content-disposition']).toContain(`${done.json().invoiceNo}.pdf`);
    // Numbered once: the list says the same number.
    const listed = await get(`${API_PREFIX}/purchase-orders`);
    expect(listed.json().orders.find((x: { id: string }) => x.id === orderId).invoiceNo).toBe(done.json().invoiceNo);
    // The supplier heard both: the shortage, then the finish (2026-10-06).
    const heard = await admin.query(
      `SELECT title FROM supplier_notifications WHERE supplier_id=$1 AND ref_id=$2 ORDER BY created_at`,
      [demo.sup1, orderId],
    );
    const titles = heard.rows.map((r: { title: string }) => r.title);
    expect(titles.some((t: string) => t.includes('partially received'))).toBe(true);
    expect(titles[titles.length - 1]).toContain('received in full');
    const mail = await admin.query(`SELECT kind FROM mail_outbox WHERE ref_id=$1 AND kind IN ('order_received','order_partly_received') ORDER BY sent_at`, [orderId]);
    expect(mail.rows.map((r: { kind: string }) => r.kind)).toEqual(['order_partly_received', 'order_received']);
  });

  it('keeps the token worlds apart: a portal token opens no tenant door', async () => {
    const denied = await get(`${API_PREFIX}/purchase-orders`, vesnaToken);
    expect(denied.statusCode).toBe(401);
    const denied2 = await get(`${API_PREFIX}/portal/orders`);
    expect(denied2.statusCode).toBe(401);
  });

  it('the portal Settings kit: real roles/team, owner-only writes, scope moves, guarded delete', async () => {
    const patch = (url: string, payload: unknown, token = bojanToken) =>
      app.inject({ method: 'PATCH', url, headers: { authorization: `Bearer ${token}` }, payload: payload as Record<string, unknown> });
    const del = (url: string, token = bojanToken) =>
      app.inject({ method: 'DELETE', url, headers: { authorization: `Bearer ${token}` } });

    // The seven standard roles carry the prototype's perm matrix.
    const roles = (await get(`${API_PREFIX}/portal/roles`, bojanToken)).json() as {
      roles: { id: string; std: boolean; locked: boolean; perms: Record<string, string> }[];
    };
    expect(roles.roles.map((r) => r.id)).toEqual([
      'sr_owner', 'sr_account', 'sr_catalog', 'sr_order', 'sr_trainer', 'sr_finance', 'sr_analyst',
    ]);
    expect(roles.roles.find((r) => r.id === 'sr_owner')).toMatchObject({ locked: true });
    expect(roles.roles.find((r) => r.id === 'sr_account')?.perms).toMatchObject({
      'po.promotions': 'own', 'po.catalog': 'none', 'po.users': 'none',
    });

    // Team: the three seeded people, owner first.
    const team = (await get(`${API_PREFIX}/portal/team`, bojanToken)).json() as {
      members: { name: string; role: string }[];
    };
    expect(team.members.map((m) => m.role)).toContain('sr_owner');

    // An Account Manager (Vesna) cannot manage the team.
    expect((await post(`${API_PREFIX}/portal/roles`, { name: 'X', scope: '', base: 'sr_account' }, vesnaToken)).statusCode).toBe(403);
    expect(
      (await app.inject({
        method: 'POST', url: `${API_PREFIX}/portal/team`,
        headers: { authorization: `Bearer ${vesnaToken}` },
        payload: { name: 'X', email: 'x@beautypro.mk', role: 'sr_account' },
      })).statusCode,
    ).toBe(403);

    // The owner creates a custom role from a base, moves a scope, and
    // the locked owner role refuses edits.
    const created = await post(`${API_PREFIX}/portal/roles`, { name: 'Balkans AM (test)', scope: '', base: 'sr_account' }, bojanToken);
    expect(created.statusCode).toBe(200);
    const rid = (created.json() as { id: string }).id;
    expect((await patch(`${API_PREFIX}/portal/roles/${rid}`, { perms: { 'po.catalog': 'all' } })).statusCode).toBe(200);
    const after = (await get(`${API_PREFIX}/portal/roles`, bojanToken)).json() as {
      roles: { id: string; perms: Record<string, string> }[];
    };
    expect(after.roles.find((r) => r.id === rid)?.perms['po.catalog']).toBe('all');
    expect((await patch(`${API_PREFIX}/portal/roles/sr_owner`, { perms: { 'po.users': 'none' } })).statusCode).toBe(409);
    expect((await patch(`${API_PREFIX}/portal/roles/${rid}`, { perms: { 'po.nonsense': 'all' } })).statusCode).toBe(409);

    // A standard role never leaves; the unused custom one does.
    expect((await del(`${API_PREFIX}/portal/roles/sr_account`)).statusCode).toBe(409);
    expect((await del(`${API_PREFIX}/portal/roles/${rid}`)).statusCode).toBe(200);
  });

  it('invites a portal teammate through the outbox, keeps the last owner, and refuses self-removal', async () => {
    const del = (url: string, token = bojanToken) =>
      app.inject({ method: 'DELETE', url, headers: { authorization: `Bearer ${token}` } });

    const invited = await post(
      `${API_PREFIX}/portal/team`,
      { name: 'Sara Ilieva', email: 'sara.test@beautypro.mk', role: 'sr_trainer' },
      bojanToken,
    );
    expect(invited.statusCode).toBe(200);
    const uid = (invited.json() as { id: string }).id;
    const mail = await admin.query(
      `SELECT kind, status FROM mail_outbox WHERE to_email='sara.test@beautypro.mk' AND kind='supplier_invite'`,
    );
    expect(mail.rows).toHaveLength(1);
    const member = await admin.query(`SELECT status FROM supplier_users WHERE id=$1`, [uid]);
    expect(member.rows[0].status).toBe('invited');

    // The last owner cannot be demoted or removed; nobody removes self.
    const ownerId = (
      await admin.query(`SELECT id FROM supplier_users WHERE role='sr_owner' AND email='bojan@beautypro.mk'`)
    ).rows[0].id;
    expect(
      (await app.inject({
        method: 'PATCH', url: `${API_PREFIX}/portal/team/${ownerId}`,
        headers: { authorization: `Bearer ${bojanToken}` }, payload: { role: 'sr_account' },
      })).statusCode,
    ).toBe(409);
    expect((await del(`${API_PREFIX}/portal/team/${ownerId}`)).statusCode).toBe(409);

    // Clean up the invited teammate.
    expect((await del(`${API_PREFIX}/portal/team/${uid}`)).statusCode).toBe(200);
    await admin.query(`DELETE FROM mail_outbox WHERE to_email='sara.test@beautypro.mk'`);
  });

  it('reports and company read real figures from the supplier’s own data', async () => {
    const rep = (await get(`${API_PREFIX}/portal/reports`, bojanToken)).json() as {
      orderValue: number; orders: number; averageOrder: number; repeatRate: number | null;
      promotionUptake: number | null; bySalon: { name: string; value: number }[];
    };
    expect(rep.orders).toBeGreaterThan(0);
    expect(rep.orderValue).toBeGreaterThan(0);
    expect(rep.averageOrder).toBe(Math.round(rep.orderValue / rep.orders));
    expect(rep.promotionUptake).toBeNull(); // not tracked yet — honest
    expect(rep.bySalon.length).toBeGreaterThan(0);

    const co = (await get(`${API_PREFIX}/portal/company`, bojanToken)).json() as { name: string; minOrder: number };
    expect(co.name).toBe('BeautyPro MK');
    expect(co.minOrder).toBe(6000);
  });

  it('catalog edit/delete/bulk: full edit, guarded delete, bulk price, owner-only', async () => {
    const patch = (url: string, payload: unknown, token = bojanToken) =>
      app.inject({ method: 'PATCH', url, headers: { authorization: `Bearer ${token}` }, payload: payload as Record<string, unknown> });
    const del = (url: string, token = bojanToken) =>
      app.inject({ method: 'DELETE', url, headers: { authorization: `Bearer ${token}` } });

    // A brand the platform does not know is born on the product panel
    // (2026-10-07): a platform row in the supplier's name, the link, and
    // a note to HQ; the same name in another spelling is the same brand.
    const nb = await post(`${API_PREFIX}/portal/catalog`, { name: 'Bond builder', brand: '  Olaplex  Pro ', sku: 'OLX-1', buy: 900 }, bojanToken);
    expect(nb.statusCode, nb.body).toBe(200);
    const brandRow = (await admin.query(`SELECT id, name, source, added_by_supplier_id FROM brands WHERE lower(name) = 'olaplex pro'`)).rows[0];
    expect(brandRow).toMatchObject({ name: 'Olaplex Pro', source: 'supplier' });
    expect((await admin.query(`SELECT 1 FROM supplier_brands WHERE brand_id=$1 AND supplier_id=$2`, [brandRow.id, brandRow.added_by_supplier_id])).rowCount).toBe(1);
    expect((await admin.query(`SELECT title FROM platform_notices WHERE audience='hq' AND kind='brand_added' AND ref_id=$1`, [brandRow.id])).rows[0]?.title).toBe('New brand: Olaplex Pro');
    const nb2 = await post(`${API_PREFIX}/portal/catalog`, { name: 'Bond builder 2', brand: 'OLAPLEX PRO', sku: 'OLX-2', buy: 900 }, bojanToken);
    expect(nb2.statusCode).toBe(200);
    expect((await admin.query(`SELECT brand FROM supplier_products WHERE id=$1`, [(nb2.json() as { id: string }).id])).rows[0].brand).toBe('Olaplex Pro');
    expect((await admin.query(`SELECT count(*)::int AS c FROM brands WHERE lower(name)='olaplex pro'`)).rows[0].c).toBe(1);
    expect((await admin.query(`SELECT count(*)::int AS c FROM platform_notices WHERE kind='brand_added' AND ref_id=$1`, [brandRow.id])).rows[0].c).toBe(1);
    const offered = (await get(`${API_PREFIX}/portal/brands`, bojanToken)).json() as { brands: { name: string; carried: boolean }[] };
    expect(offered.brands.find((b) => b.name === 'Olaplex Pro')?.carried).toBe(true);
    const firstForeign = offered.brands.findIndex((b) => !b.carried); // own first, then the rest
    if (firstForeign >= 0) expect(offered.brands.slice(0, firstForeign).every((b) => b.carried)).toBe(true);
    // Every portal user of the platform is offered it from now on.
    const theirs = (await get(`${API_PREFIX}/portal/brands`, vesnaToken)).json() as { brands: { name: string; carried: boolean }[] };
    expect(theirs.brands.some((b) => b.name === 'Olaplex Pro')).toBe(true);
    for (const id of [(nb.json() as { id: string }).id, (nb2.json() as { id: string }).id]) await del(`${API_PREFIX}/portal/catalog/${id}`);

    // Create a throwaway product, edit every kind of field, delete it.
    const created = await post(
      `${API_PREFIX}/portal/catalog`,
      { name: 'Test Widget', brand: 'Thera-Band', sku: 'TW-1', buy: 100 },
      bojanToken,
    );
    expect(created.statusCode).toBe(200);
    const pid = (created.json() as { id: string }).id;
    expect((await patch(`${API_PREFIX}/portal/catalog/${pid}`, { name: 'Renamed', size: '250 ml', use: 'pro', rrp: 180, active: false })).statusCode).toBe(200);
    const row = await admin.query(`SELECT name, size, use, rrp, active FROM supplier_products WHERE id=$1`, [pid]);
    expect(row.rows[0]).toMatchObject({ name: 'Renamed', size: '250 ml', use: 'pro', rrp: 180, active: false });
    // An Account Manager (no po.catalog) cannot edit or delete.
    expect((await patch(`${API_PREFIX}/portal/catalog/${pid}`, { name: 'x' }, vesnaToken)).statusCode).toBe(403);
    expect((await del(`${API_PREFIX}/portal/catalog/${pid}`, vesnaToken)).statusCode).toBe(403);
    expect((await del(`${API_PREFIX}/portal/catalog/${pid}`)).statusCode).toBe(200);

    // A product with order history refuses delete (409 — deactivate).
    const onOrder = (
      await admin.query(
        `SELECT sp.id FROM supplier_products sp JOIN purchase_order_lines l ON l.supplier_product_id=sp.id
         WHERE sp.supplier_id=$1 LIMIT 1`,
        [demo.sup1],
      )
    ).rows[0].id as string;
    expect((await del(`${API_PREFIX}/portal/catalog/${onOrder}`)).statusCode).toBe(409);

    // Bulk +50% on buy, then restore exactly from a snapshot.
    const before = (await admin.query(`SELECT id, buy FROM supplier_products WHERE supplier_id=$1`, [demo.sup1])).rows as {
      id: string; buy: number;
    }[];
    const bulk = await post(`${API_PREFIX}/portal/catalog/bulk`, { target: 'buy', percent: 50 }, bojanToken);
    expect(bulk.statusCode).toBe(200);
    expect((bulk.json() as { updated: number }).updated).toBe(before.length);
    const sample = before[0]!;
    const after = (await admin.query(`SELECT buy FROM supplier_products WHERE id=$1`, [sample.id])).rows[0].buy as number;
    expect(after).toBe(Math.round(sample.buy * 1.5));
    for (const r of before) await admin.query(`UPDATE supplier_products SET buy=$1 WHERE id=$2`, [r.buy, r.id]);
    // Non-catalog role cannot bulk.
    expect((await post(`${API_PREFIX}/portal/catalog/bulk`, { target: 'buy', percent: 10 }, vesnaToken)).statusCode).toBe(403);
  });
});
