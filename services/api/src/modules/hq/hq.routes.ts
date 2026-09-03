import {
  HqApproveResponseSchema,
  HqAuditListSchema,
  HqBusinessListSchema,
  HqCategoryCreateSchema,
  HqCategoryDeclineSchema,
  HqCategoryListSchema,
  HqCategoryPatchSchema,
  HqCategoryRequestListSchema,
  PlatformNoticeListSchema,
  HqLocationDecisionSchema,
  HqLocationQueueSchema,
  HqLocationReviewSchema,
  HqLoginRequestSchema,
  HqLoginResponseSchema,
  HqMeResponseSchema,
  HqRegistrationListSchema,
  RegistrationStatusSchema,
  type RegistrationDraft,
} from '@velnes/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withHq, withTenant } from '../../db/index.js';
import { AuthError } from '../auth/auth.service.js';
import { LocationError, locTransition } from '../locations/locations.service.js';
import {
  approveRegistration,
  RegistrationError,
  reviewRegistration,
} from '../registrations/registrations.service.js';
import { canReview, hqLogin, hqUserById } from '../hq/hq.service.js';

const Err = z.object({ error: z.string(), message: z.string() });

function sendErr(reply: FastifyReply, e: unknown) {
  if (e instanceof RegistrationError) {
    const code = e.code === 'NOT_FOUND' ? 404 : 422;
    return reply.code(code).send({ error: e.code, message: e.message });
  }
  if (e instanceof LocationError)
    return reply
      .code(e.code === 'NOT_FOUND' ? 404 : 422)
      .send({ error: e.code, message: e.message });
  throw e;
}

export function hqRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'POST',
    url: '/hq/auth/login',
    config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    schema: {
      body: HqLoginRequestSchema,
      response: { 200: HqLoginResponseSchema, 401: Err },
    },
    handler: async (req, reply) => {
      try {
        const user = await hqLogin(req.body.email, req.body.password);
        const accessToken = await reply.jwtSign(
          { hq: true, sub: user.id, name: user.name, rol: user.role },
          { expiresIn: '8h' },
        );
        return { accessToken, user };
      } catch (e) {
        if (e instanceof AuthError)
          return reply.code(401).send({ error: e.code, message: 'Sign-in refused' });
        throw e;
      }
    },
  });

  r.route({
    method: 'GET',
    url: '/hq/me',
    preHandler: [app.authenticateHq],
    schema: { response: { 200: HqMeResponseSchema, 401: Err } },
    handler: async (req, reply) => {
      const u = await hqUserById(req.hqClaims.sub);
      if (!u) return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Unknown HQ user' });
      return u;
    },
  });

  r.route({
    method: 'GET',
    url: '/hq/registrations',
    preHandler: [app.authenticateHq],
    schema: { response: { 200: HqRegistrationListSchema } },
    handler: async () =>
      withHq(async (trx) => {
        const rows = await trx
          .selectFrom('registrations')
          .selectAll()
          .orderBy('ts', 'desc')
          .execute();
        return {
          registrations: rows.map((row) => {
            const d = row.draft as RegistrationDraft;
            return {
              id: row.id,
              ts: row.ts.toISOString(),
              status: RegistrationStatusSchema.parse(row.status),
              salonName: d.salon.name,
              salonType: d.salon.type,
              ownerName: d.acct.name,
              ownerEmail: d.acct.email,
              city: d.loc.city,
              legalName: d.legal.name,
              taxId: d.legal.taxId,
              emailVerifiedAt: row.emailVerifiedAt?.toISOString() ?? null,
              hqReason: row.hqReason,
              businessId: row.businessId,
            };
          }),
        };
      }),
  });

  const reviewGate = (reply: FastifyReply, rol: string) => {
    if (!canReview(rol as Parameters<typeof canReview>[0])) {
      void reply
        .code(403)
        .send({ error: 'FORBIDDEN', message: 'Only HQ onboarding reviewers decide intake' });
      return false;
    }
    return true;
  };

  r.route({
    method: 'POST',
    url: '/hq/registrations/:id/request-changes',
    preHandler: [app.authenticateHq],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ reason: z.string() }),
      response: {
        200: z.object({ id: z.uuid(), status: RegistrationStatusSchema }),
        403: Err,
        404: Err,
        422: Err,
      },
    },
    handler: async (req, reply) => {
      if (!reviewGate(reply, req.hqClaims.rol)) return reply;
      try {
        return await reviewRegistration(
          req.params.id,
          'request_changes',
          req.hqClaims.name,
          req.body.reason,
        );
      } catch (e) {
        return sendErr(reply, e);
      }
    },
  });

  r.route({
    method: 'POST',
    url: '/hq/registrations/:id/decline',
    preHandler: [app.authenticateHq],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: {
        200: z.object({ id: z.uuid(), status: RegistrationStatusSchema }),
        403: Err,
        404: Err,
        422: Err,
      },
    },
    handler: async (req, reply) => {
      if (!reviewGate(reply, req.hqClaims.rol)) return reply;
      try {
        return await reviewRegistration(req.params.id, 'decline', req.hqClaims.name);
      } catch (e) {
        return sendErr(reply, e);
      }
    },
  });

  r.route({
    method: 'POST',
    url: '/hq/registrations/:id/approve',
    preHandler: [app.authenticateHq],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 200: HqApproveResponseSchema, 403: Err, 404: Err, 422: Err },
    },
    handler: async (req, reply) => {
      if (!reviewGate(reply, req.hqClaims.rol)) return reply;
      try {
        return await approveRegistration(req.params.id, req.hqClaims.name);
      } catch (e) {
        return sendErr(reply, e);
      }
    },
  });

  // ── The New-locations queue: same table pattern, across tenants. ──
  r.route({
    method: 'GET',
    url: '/hq/locations',
    preHandler: [app.authenticateHq],
    schema: { response: { 200: HqLocationQueueSchema } },
    handler: async () =>
      withHq(async (trx) => {
        const rows = await trx
          .selectFrom('locations as l')
          .innerJoin('businesses as b', 'b.id', 'l.tenantId')
          .select(['l.id', 'l.name', 'l.city', 'l.lifecycle', 'l.tenantId as businessId', 'b.name as businessName'])
          .where('l.lifecycle', 'in', ['SUBMITTED', 'UNDER_REVIEW', 'RESUBMITTED'])
          .orderBy('l.createdAt')
          .execute();
        const out = [];
        for (const l of rows) {
          const le = await trx
            .selectFrom('legalEntityLocations as ll')
            .innerJoin('legalEntities as e', 'e.id', 'll.legalEntityId')
            .select(['e.name', 'e.status'])
            .where('ll.locationId', '=', l.id)
            .executeTakeFirst();
          out.push({
            id: l.id,
            name: l.name,
            businessId: l.businessId,
            businessName: l.businessName,
            city: l.city,
            lifecycle: l.lifecycle,
            legalName: le?.name ?? null,
            legalStatus: le?.status ?? null,
          });
        }
        return { locations: out };
      }),
  });

  r.route({
    method: 'GET',
    url: '/hq/locations/:id',
    preHandler: [app.authenticateHq],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 200: HqLocationReviewSchema, 404: Err },
    },
    handler: async (req, reply) =>
      withHq(async (trx) => {
        const l = await trx
          .selectFrom('locations as l')
          .innerJoin('businesses as b', 'b.id', 'l.tenantId')
          .selectAll('l')
          .select('b.name as businessName')
          .where('l.id', '=', req.params.id)
          .executeTakeFirst();
        if (!l) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown location' });
        const le = await trx
          .selectFrom('legalEntityLocations as ll')
          .innerJoin('legalEntities as e', 'e.id', 'll.legalEntityId')
          .select(['e.id', 'e.name', 'e.taxId', 'e.status'])
          .where('ll.locationId', '=', l.id)
          .executeTakeFirst();
        const pa = le
          ? await trx
              .selectFrom('paymentAccounts')
              .select(['provider', 'status'])
              .where('legalEntityId', '=', le.id)
              .executeTakeFirst()
          : undefined;
        const log = await trx
          .selectFrom('locationLifecycleLog')
          .select(['fromState', 'toState', 'reason'])
          .where('locationId', '=', l.id)
          .orderBy('at')
          .execute();
        return {
          id: l.id,
          name: l.name,
          businessName: l.businessName,
          address: l.address,
          city: l.city,
          country: 'North Macedonia',
          phone: l.phone,
          tz: l.tz,
          invPrefix: l.invPrefix ?? '',
          lifecycle: l.lifecycle,
          legal: le ? { id: le.id, name: le.name, taxId: le.taxId ?? '', status: le.status } : null,
          paymentAccount: pa ? { provider: pa.provider ?? '—', status: pa.status } : null,
          compound: le?.status === 'pending',
          log: log.map((e) => ({ from: e.fromState, to: e.toState, reason: e.reason })),
        };
      }),
  });

  r.route({
    method: 'POST',
    url: '/hq/locations/:id/decision',
    preHandler: [app.authenticateHq],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: HqLocationDecisionSchema,
      response: {
        200: z.object({ id: z.uuid(), lifecycle: z.string() }),
        403: Err,
        404: Err,
        422: Err,
      },
    },
    handler: async (req, reply) => {
      if (!reviewGate(reply, req.hqClaims.rol)) return reply;
      if (req.body.action === 'request_changes' && !req.body.reason?.trim())
        return reply
          .code(422)
          .send({ error: 'REASON_REQUIRED', message: 'Request changes needs a reason the owner can act on' });
      const target = await withHq((trx) =>
        trx
          .selectFrom('locations')
          .select(['id', 'tenantId', 'lifecycle'])
          .where('id', '=', req.params.id)
          .executeTakeFirst(),
      );
      if (!target)
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown location' });
      const to =
        req.body.action === 'approve'
          ? 'APPROVED'
          : req.body.action === 'start_review'
            ? 'UNDER_REVIEW'
            : 'CHANGES_REQUIRED';
      try {
        const l = await withTenant(target.tenantId, async (trx) => {
          // The compound decision: approving a location whose entity
          // is still pending verifies the entity in the same act.
          if (to === 'APPROVED') {
            await trx
              .updateTable('legalEntities')
              .set({ status: 'verified' })
              .where('status', '=', 'pending')
              .where('id', 'in', (qb) =>
                qb
                  .selectFrom('legalEntityLocations')
                  .select('legalEntityId')
                  .where('locationId', '=', req.params.id),
              )
              .execute();
          }
          return locTransition(trx, null, req.params.id, to, req.body.reason, {
            employeeId: null,
            name: `HQ · ${req.hqClaims.name}`,
          });
        });
        return { id: l.id, lifecycle: l.lifecycle };
      } catch (e) {
        return sendErr(reply, e);
      }
    },
  });

  r.route({
    method: 'GET',
    url: '/hq/businesses',
    preHandler: [app.authenticateHq],
    schema: { response: { 200: HqBusinessListSchema } },
    handler: async () =>
      withHq(async (trx) => {
        const rows = await trx
          .selectFrom('businesses as b')
          .leftJoin('employees as o', 'o.id', 'b.ownerEmployeeId')
          .select(['b.id', 'b.name', 'b.slug', 'o.name as ownerName', 'o.email as ownerEmail'])
          .orderBy('b.createdAt')
          .execute();
        const locs = await trx
          .selectFrom('locations')
          .select(['tenantId', 'lifecycle'])
          .execute();
        const emps = await trx.selectFrom('employees').select(['tenantId']).execute();
        return {
          businesses: rows.map((b) => ({
            id: b.id,
            name: b.name,
            slug: b.slug,
            ownerName: b.ownerName,
            ownerEmail: b.ownerEmail,
            locations: locs.filter((l) => l.tenantId === b.id).length,
            liveLocations: locs.filter((l) => l.tenantId === b.id && l.lifecycle === 'ACTIVE').length,
            employees: emps.filter((e) => e.tenantId === b.id).length,
          })),
        };
      }),
  });

  r.route({
    method: 'GET',
    url: '/hq/audit',
    preHandler: [app.authenticateHq],
    schema: {
      querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(80) }),
      response: { 200: HqAuditListSchema },
    },
    handler: async (req) =>
      withHq(async (trx) => {
        const rows = await trx
          .selectFrom('auditLog as a')
          .innerJoin('businesses as b', 'b.id', 'a.tenantId')
          .selectAll('a')
          .select('b.name as tenantName')
          .orderBy('a.ts', 'desc')
          .limit(req.query.limit)
          .execute();
        return {
          entries: rows.map((e) => ({
            id: e.id,
            ts: e.ts.toISOString(),
            actorName: e.actorName,
            roleName: e.roleName,
            businessName: e.businessName,
            locationName: e.locationName,
            action: e.action,
            object: e.object,
            before: e.before,
            after: e.after,
            source: e.source,
            reason: e.reason,
            tenantName: e.tenantName,
          })),
        };
      }),
  });

  // ── The Velnes taxonomy: HQ defines the category shelves every
  //    salon picks from. Create and rename; no delete — a shelf a
  //    salon may already stand items on never silently vanishes. ──

  r.route({
    method: 'GET',
    url: '/hq/categories',
    preHandler: [app.authenticateHq],
    schema: { response: { 200: HqCategoryListSchema } },
    handler: async () =>
      withHq(async (trx) => {
        const svc = await trx.selectFrom('serviceCategories').selectAll().orderBy('sort').orderBy('name').execute();
        const prod = await trx.selectFrom('productCategories').selectAll().orderBy('sort').orderBy('name').execute();
        return {
          categories: [
            ...svc.map((c) => ({ id: c.id, name: c.name, type: 'services' as const, sort: c.sort })),
            ...prod.map((c) => ({ id: c.id, name: c.name, type: 'products' as const, sort: c.sort })),
          ],
        };
      }),
  });

  r.route({
    method: 'POST',
    url: '/hq/categories',
    preHandler: [app.authenticateHq],
    schema: {
      body: HqCategoryCreateSchema,
      response: { 200: z.object({ id: z.uuid() }), 409: Err },
    },
    handler: async (req, reply) =>
      withHq(async (trx) => {
        const table =
          req.body.type === 'services' ? ('serviceCategories' as const) : ('productCategories' as const);
        const dupe = await trx
          .selectFrom(table)
          .select('id')
          .where('name', '=', req.body.name)
          .executeTakeFirst();
        if (dupe)
          return reply.code(409).send({ error: 'DUPLICATE', message: 'That category already exists' });
        const max = await trx
          .selectFrom(table)
          .select((eb) => eb.fn.max('sort').as('m'))
          .executeTakeFirst();
        const row = await trx
          .insertInto(table)
          .values({ name: req.body.name, sort: (max?.m ?? 0) + 1 })
          .returning('id')
          .executeTakeFirstOrThrow();
        return { id: row.id };
      }),
  });

  for (const [url, table] of [
    ['/hq/categories/services/:id', 'serviceCategories'],
    ['/hq/categories/products/:id', 'productCategories'],
  ] as const) {
    r.route({
      method: 'PATCH',
      url,
      preHandler: [app.authenticateHq],
      schema: {
        params: z.object({ id: z.uuid() }),
        body: HqCategoryPatchSchema,
        response: { 200: z.object({ ok: z.literal(true) }), 404: Err, 409: Err },
      },
      handler: async (req, reply) =>
        withHq(async (trx) => {
          const row = await trx
            .selectFrom(table)
            .select('id')
            .where('id', '=', req.params.id)
            .executeTakeFirst();
          if (!row)
            return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown category' });
          const dupe = await trx
            .selectFrom(table)
            .select('id')
            .where('name', '=', req.body.name)
            .where('id', '!=', req.params.id)
            .executeTakeFirst();
          if (dupe)
            return reply.code(409).send({ error: 'DUPLICATE', message: 'That category already exists' });
          // A rename follows every salon's items automatically — the
          // id is the truth, the name is the label.
          await trx.updateTable(table).set({ name: req.body.name }).where('id', '=', req.params.id).execute();
          return { ok: true as const };
        }),
    });

    r.route({
      method: 'DELETE',
      url,
      preHandler: [app.authenticateHq],
      schema: {
        params: z.object({ id: z.uuid() }),
        response: { 200: z.object({ ok: z.literal(true) }), 404: Err, 409: Err },
      },
      handler: async (req, reply) => {
        const row = await withHq((trx) =>
          trx.selectFrom(table).select('id').where('id', '=', req.params.id).executeTakeFirst(),
        );
        if (!row)
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown category' });
        try {
          // Its own transaction: the FK is the referee, and a refused
          // delete must abort only itself. A shelf any salon still
          // stands items on never goes — no cross-tenant read needed.
          await withHq((trx) => trx.deleteFrom(table).where('id', '=', req.params.id).execute());
        } catch {
          return reply.code(409).send({
            error: 'IN_USE',
            message: 'Salons still have items on this shelf — it cannot be removed',
          });
        }
        return { ok: true as const };
      },
    });
  }

  // HQ reads the same notices it writes — the bell in its topbar.
  r.route({
    method: 'GET',
    url: '/hq/notices',
    preHandler: [app.authenticateHq],
    schema: { response: { 200: PlatformNoticeListSchema } },
    handler: async () =>
      withHq(async (trx) => {
        const rows = await trx
          .selectFrom('platformNotices')
          .selectAll()
          .where('audience', '=', 'hq')
          .orderBy('createdAt', 'desc')
          .limit(20)
          .execute();
        return {
          notices: rows.map((n) => ({
            id: n.id,
            kind: n.kind,
            title: n.title,
            body: n.body,
            createdAt: n.createdAt.toISOString(),
          })),
        };
      }),
  });

  // ── The request intake: salons ask, HQ decides. Approval creates
  //    the shelf and tells every salon through a platform notice. ──

  r.route({
    method: 'GET',
    url: '/hq/categories/requests',
    preHandler: [app.authenticateHq],
    schema: { response: { 200: HqCategoryRequestListSchema } },
    handler: async () =>
      withHq(async (trx) => {
        const rows = await trx
          .selectFrom('categoryRequests as cr')
          .innerJoin('businesses as b', 'b.id', 'cr.tenantId')
          .selectAll('cr')
          .select('b.name as tenantName')
          .orderBy('cr.createdAt', 'desc')
          .limit(100)
          .execute();
        return {
          requests: rows.map((r2) => ({
            id: r2.id,
            tenantName: r2.tenantName,
            name: r2.name,
            type: r2.kind as 'services' | 'products',
            note: r2.note,
            status: r2.status as 'pending' | 'approved' | 'declined',
            hqReason: r2.hqReason,
            createdAt: r2.createdAt.toISOString(),
          })),
        };
      }),
  });

  r.route({
    method: 'POST',
    url: '/hq/categories/requests/:id/approve',
    preHandler: [app.authenticateHq],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 200: z.object({ ok: z.literal(true) }), 404: Err, 409: Err },
    },
    handler: async (req, reply) =>
      withHq(async (trx) => {
        const cr = await trx
          .selectFrom('categoryRequests')
          .selectAll()
          .where('id', '=', req.params.id)
          .executeTakeFirst();
        if (!cr) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown request' });
        if (cr.status !== 'pending')
          return reply.code(409).send({ error: 'DECIDED', message: 'This request is already decided' });
        const table = cr.kind === 'services' ? ('serviceCategories' as const) : ('productCategories' as const);
        // Idempotent against a race: the shelf may exist by now.
        const existing = await trx
          .selectFrom(table)
          .select('id')
          .where('name', '=', cr.name)
          .executeTakeFirst();
        if (!existing) {
          const max = await trx
            .selectFrom(table)
            .select((eb) => eb.fn.max('sort').as('m'))
            .executeTakeFirst();
          await trx.insertInto(table).values({ name: cr.name, sort: (max?.m ?? 0) + 1 }).execute();
        }
        await trx
          .updateTable('categoryRequests')
          .set({ status: 'approved', decidedAt: new Date() })
          .where('id', '=', cr.id)
          .execute();
        // Every salon hears about the new shelf.
        await trx
          .insertInto('platformNotices')
          .values({
            kind: 'category',
            title: `New Velnes category: ${cr.name}`,
            body:
              cr.kind === 'services'
                ? 'A new service category is available to every salon.'
                : 'A new product category is available to every salon.',
          })
          .execute();
        return { ok: true as const };
      }),
  });

  r.route({
    method: 'POST',
    url: '/hq/categories/requests/:id/decline',
    preHandler: [app.authenticateHq],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: HqCategoryDeclineSchema,
      response: { 200: z.object({ ok: z.literal(true) }), 404: Err, 409: Err },
    },
    handler: async (req, reply) =>
      withHq(async (trx) => {
        const cr = await trx
          .selectFrom('categoryRequests')
          .select(['id', 'status', 'name', 'tenantId'])
          .where('id', '=', req.params.id)
          .executeTakeFirst();
        if (!cr) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown request' });
        if (cr.status !== 'pending')
          return reply.code(409).send({ error: 'DECIDED', message: 'This request is already decided' });
        await trx
          .updateTable('categoryRequests')
          .set({ status: 'declined', hqReason: req.body.reason, decidedAt: new Date() })
          .where('id', '=', cr.id)
          .execute();
        // The answer travels back to whoever asked — with the reason.
        await trx
          .insertInto('platformNotices')
          .values({
            audience: 'salons',
            tenantId: cr.tenantId,
            kind: 'category_declined',
            title: `Category request declined: ${cr.name}`,
            body: req.body.reason,
          })
          .execute();
        return { ok: true as const };
      }),
  });
}
