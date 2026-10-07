import { invoicePdf } from './invoice-pdf.service.js';
import {
  OrderCreateSchema,
  PurchaseOrderListSchema,
  PurchaseOrderSchema,
  PurchaseOrderStatusSchema,
  ReceiveRequestSchema,
  SupplierListSchema,
  SupplierMediaListSchema,
  SupplierProductListSchema,
  SalonPromotionListSchema,
} from '@velnes/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/index.js';
import { can, permsFor } from '../auth/authz.service.js';
import { localIso } from '../scheduling/scheduling.service.js';
import { salonPromotions } from './promotions.service.js';
import { listMedia, readMedia } from './media.service.js';
import {
  createOrder,
  poTransition,
  receiveOrder,
  SupplierError,
  toOrderContract,
  notifyConnectionRequested,
} from './suppliers.service.js';

const Err = z.object({ error: z.string(), message: z.string() });
const statusFor = { NOT_FOUND: 404, INVALID: 422, WRONG_STATE: 409, MIN_ORDER: 422 } as const;

function sendErr(reply: FastifyReply, e: unknown) {
  if (e instanceof SupplierError)
    return reply.code(statusFor[e.code]).send({ error: e.code, message: e.message });
  throw e;
}

export function suppliersRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const gate = async (
    trx: Parameters<typeof permsFor>[0],
    claims: Parameters<typeof permsFor>[1],
    reply: FastifyReply,
  ) => {
    const perms = await permsFor(trx, claims);
    if (!can(perms, 'suppliers.manage')) {
      await reply
        .code(403)
        .send({ error: 'FORBIDDEN', message: 'Missing permission: suppliers.manage' });
      return false;
    }
    return true;
  };

  r.route({
    method: 'GET',
    url: '/suppliers',
    preHandler: [app.authenticate],
    schema: {
      response: {
        200: SupplierListSchema,
        403: z.object({ error: z.string(), message: z.string() }),
      },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply))) return reply;
        const rows = await trx.selectFrom('suppliers').selectAll().orderBy('name').execute();
        const conns = await trx.selectFrom('supplierConnections').selectAll().execute();
        const counts = await trx
          .selectFrom('supplierProducts')
          .select(['supplierId'])
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .groupBy('supplierId')
          .execute();
        return {
          suppliers: rows.map((s) => {
            const c = conns.find((x) => x.supplierId === s.id);
            return {
              id: s.id,
              name: s.name,
              type: s.type,
              territory: s.territory,
              verified: s.verified,
              minOrder: s.minOrder,
              lead: s.lead,
              terms: s.terms,
              contact: s.contact,
              manager: s.manager,
              rating: s.rating == null ? null : Number(s.rating),
              products: Number(counts.find((x) => x.supplierId === s.id)?.n ?? 0),
              avatar: s.avatar ?? null,
              status: (c?.status === 'connected'
                ? 'connected'
                : c?.status === 'pending'
                  ? 'pending'
                  : 'available') as 'available' | 'pending' | 'connected',
              customerNo: c?.customerNo ?? '',
              connected: c?.connected ? localIso(c.connected) : null,
              share: (c?.share ?? {}) as Record<string, boolean>,
              locationIds: c?.locationIds ?? [],
            };
          }),
        };
      }),
  });

  r.route({
    method: 'POST',
    url: '/suppliers/:id/connect',
    preHandler: [app.authenticate],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ note: z.string().default(''), locationIds: z.array(z.uuid()).default([]) }),
      response: { 200: z.object({ ok: z.literal(true) }), 403: Err, 404: Err, 409: Err },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply))) return reply;
        const sup = await trx
          .selectFrom('suppliers')
          .select('id')
          .where('id', '=', req.params.id)
          .executeTakeFirst();
        if (!sup) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown supplier' });
        const existing = await trx
          .selectFrom('supplierConnections')
          .select('status')
          .where('supplierId', '=', req.params.id)
          .executeTakeFirst();
        if (existing)
          return reply
            .code(409)
            .send({ error: 'WRONG_STATE', message: `Already ${existing.status}` });
        await trx
          .insertInto('supplierConnections')
          .values({
            tenantId: req.claims.ten,
            supplierId: req.params.id,
            status: 'pending',
            note: req.body.note,
            locationIds: req.body.locationIds,
          })
          .execute();
        await notifyConnectionRequested(trx, req.claims.ten, req.params.id);
        return { ok: true as const };
      }),
  });

  r.route({
    method: 'GET',
    url: '/suppliers/:id/catalog',
    preHandler: [app.authenticate],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 200: SupplierProductListSchema, 403: Err },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply))) return reply;
        const rows = await trx
          .selectFrom('supplierProducts')
          .selectAll()
          .where('supplierId', '=', req.params.id)
          .where('active', '=', true)
          .orderBy('category')
          .orderBy('name')
          .execute();
        const links = await trx
          .selectFrom('products')
          .select(['id', 'supplierProductId'])
          .where('supplierProductId', 'is not', null)
          .execute();
        return {
          products: rows.map((p) => ({
            id: p.id,
            supplierId: p.supplierId,
            brand: p.brand,
            name: p.name,
            sku: p.sku,
            ean: p.ean,
            size: p.size,
            pack: p.pack,
            buy: p.buy,
            rrp: p.rrp,
            vat: p.vat,
            moq: p.moq,
            stock: p.stock,
            lead: p.lead,
            use: p.use,
            category: p.category,
            categoryId: p.categoryId,
            descr: p.descr,
            sample: p.sample,
            linkedProductId: links.find((l) => l.supplierProductId === p.id)?.id ?? null,
          })),
        };
      }),
  });

  r.route({
    method: 'GET',
    url: '/purchase-orders',
    preHandler: [app.authenticate],
    schema: { response: { 200: PurchaseOrderListSchema, 403: Err } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply))) return reply;
        const rows = await trx
          .selectFrom('purchaseOrders')
          .select('id')
          .orderBy('createdAt', 'desc')
          .limit(100)
          .execute();
        const orders = [];
        for (const row of rows) orders.push(await toOrderContract(trx, row.id));
        return { orders };
      }),
  });

  // The invoice as a PDF (Alex, 2026-10-06): the same document the
  // supplier opens, for a delivered order of this salon.
  // ── A connected supplier's printed catalogs (2026-10-07). RLS shows a
  // salon only the files of suppliers it is connected to; the door says
  // 404 for anyone else rather than an empty list.
  const connectedTo = async (trx: Parameters<typeof permsFor>[0], supplierId: string) =>
    !!(await trx
      .selectFrom('supplierConnections')
      .select('supplierId')
      .where('supplierId', '=', supplierId)
      .where('status', '=', 'connected')
      .executeTakeFirst());

  r.route({
    method: 'GET',
    url: '/suppliers/:id/media',
    preHandler: [app.authenticate],
    schema: { params: z.object({ id: z.uuid() }), response: { 200: SupplierMediaListSchema, 403: Err, 404: Err } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply))) return reply;
        if (!(await connectedTo(trx, req.params.id))) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Not a connected supplier' });
        return { files: await listMedia(trx, req.params.id) };
      }),
  });

  r.route({
    method: 'GET',
    url: '/suppliers/:id/media/:fid/file',
    preHandler: [app.authenticate],
    schema: { params: z.object({ id: z.uuid(), fid: z.uuid() }) },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply))) return reply;
        const file = await readMedia(trx, req.params.id, req.params.fid);
        if (!file) return reply.code(404).send({ error: 'NOT_FOUND', message: 'No such file' });
        return reply
          .header('content-type', file.mime)
          .header('content-disposition', `inline; filename="${encodeURIComponent(file.name)}"`)
          .send(file.data);
      }),
  });

  r.route({
    method: 'GET',
    url: '/purchase-orders/:id/invoice.pdf',
    preHandler: [app.authenticate],
    schema: { params: z.object({ id: z.uuid() }) },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply))) return reply;
        try {
          const { buffer, invoiceNo } = await invoicePdf(trx, req.params.id);
          return reply
            .header('content-type', 'application/pdf')
            .header('content-disposition', `inline; filename="${invoiceNo}.pdf"`)
            .send(buffer);
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });

  r.route({
    method: 'POST',
    url: '/purchase-orders',
    preHandler: [app.authenticate],
    schema: {
      body: OrderCreateSchema,
      response: { 200: PurchaseOrderSchema, 403: Err, 404: Err, 409: Err, 422: Err },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply))) return reply;
        try {
          return await createOrder(trx, req.claims, req.body);
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });

  r.route({
    method: 'POST',
    url: '/purchase-orders/:id/transitions',
    preHandler: [app.authenticate],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ to: PurchaseOrderStatusSchema }),
      response: { 200: PurchaseOrderSchema, 403: Err, 404: Err, 409: Err },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply))) return reply;
        const actor = await trx
          .selectFrom('employees')
          .select('name')
          .where('id', '=', req.claims.sub)
          .executeTakeFirst();
        try {
          return await poTransition(
            trx,
            'salon',
            { id: req.claims.sub, name: actor?.name ?? '' },
            req.params.id,
            req.body.to,
          );
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });

  r.route({
    method: 'POST',
    url: '/purchase-orders/:id/receive',
    preHandler: [app.authenticate],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: ReceiveRequestSchema,
      response: { 200: PurchaseOrderSchema, 403: Err, 404: Err, 409: Err },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply))) return reply;
        try {
          return await receiveOrder(trx, req.claims, req.params.id, req.body.lines);
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });

  // Promotions from connected suppliers, running or about to, with the
  // reasons each may matter to this salon — one ranking for the tab and
  // for the flight deck's picks (2026-10-07).
  r.route({
    method: 'GET',
    url: '/supplier-promotions',
    preHandler: [app.authenticate],
    schema: { querystring: z.object({ limit: z.coerce.number().int().min(1).max(50).optional() }), response: { 200: SalonPromotionListSchema, 403: Err } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply))) return reply;
        const all = await salonPromotions(trx, req.claims.ten);
        return { promotions: req.query.limit ? all.slice(0, req.query.limit) : all };
      }),
  });
}
