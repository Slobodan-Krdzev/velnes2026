import {
  CustomerExportResponseSchema,
  CustomerListQuerySchema,
  CustomerListResponseSchema,
  EmployeeInviteSchema,
  EmployeeTimingsSchema,
  EmployeeListResponseSchema,
  EmployeePatchSchema,
  EmployeeSchema,
  PermMapSchema,
  RoleListResponseSchema,
  RoleWriteSchema,
  type Employee,
} from '@velnes/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import { withTenant } from '../../db/index.js';
import { logAudit } from '../audit/audit.service.js';
import { effTreatment } from '../timing/timing.service.js';
import { can, permsFor } from '../auth/authz.service.js';
import { createEmployee, TeamError, updateEmployee } from './team.service.js';


export function teamRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/employees',
    preHandler: [app.authenticate],
    schema: { response: { 200: EmployeeListResponseSchema } },
    handler: async (req) =>
      withTenant(req.claims.ten, async (trx) => {
        const rows = await trx
          .selectFrom('employees')
          .selectAll()
          .orderBy('name')
          .execute();
        const locs = await trx.selectFrom('employeeLocations').selectAll().execute();
        const skills = await trx.selectFrom('employeeSkills').selectAll().execute();
        // Last active = the newest sign-in or token rotation. Real
        // session data — an invited user honestly shows never.
        const seen = await trx
          .selectFrom('refreshTokens')
          .select([
            'employeeId',
            sql<Date>`max(greatest(created_at, coalesce(rotated_at, created_at)))`.as('last'),
          ])
          .groupBy('employeeId')
          .execute();
        const lastOf = new Map(seen.map((s) => [s.employeeId, s.last] as const));
        return {
          employees: rows.map((e) => ({
            id: e.id,
            name: e.name,
            roleTitle: e.roleTitle,
            email: e.email,
            phone: e.phone,
            access: e.access,
            roleId: e.roleId,
            bookable: e.bookable,
            status: e.status,
            color: e.color,
            locationIds: locs.filter((l) => l.employeeId === e.id).map((l) => l.locationId),
            skillServiceIds: skills
              .filter((s) => s.employeeId === e.id)
              .map((s) => s.serviceId),
            hours: (e.hours ?? null) as Employee['hours'],
            twofaEnabled: e.twofaEnabled,
            lastActive: lastOf.get(e.id)?.toISOString() ?? null,
          })),
        };
      }),
  });

  r.route({
    method: 'GET',
    url: '/customers',
    preHandler: [app.authenticate],
    schema: {
      querystring: CustomerListQuerySchema,
      response: {
        200: CustomerListResponseSchema,
        403: z.object({ error: z.string(), message: z.string() }),
      },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        // The prototype's customer ladder: business/location readers
        // see the file; view_assigned alone sees the customers they
        // have actually served. No permission, no list.
        const perms = await permsFor(trx, req.claims);
        const wide =
          can(perms, 'customers.view_location') || can(perms, 'customers.view_business');
        if (!wide && !can(perms, 'customers.view_assigned'))
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: customers.view_assigned' });
        let q = trx
          .selectFrom('customers')
          .selectAll()
          .orderBy('name')
          .limit(req.query.limit);
        if (!wide)
          q = q.where('id', 'in', (eb) =>
            eb
              .selectFrom('appointments')
              .select('customerId')
              .where('employeeId', '=', req.claims.sub)
              .where('customerId', 'is not', null)
              .$castTo<{ customerId: string }>(),
          );
        if (req.query.query)
          q = q.where(sql<boolean>`name ILIKE ${'%' + req.query.query + '%'}`);
        const rows = await q.execute();
        let tq = trx
          .selectFrom('customers')
          .select(({ fn }) => fn.countAll<string>().as('n'));
        if (!wide)
          tq = tq.where('id', 'in', (eb) =>
            eb
              .selectFrom('appointments')
              .select('customerId')
              .where('employeeId', '=', req.claims.sub)
              .where('customerId', 'is not', null)
              .$castTo<{ customerId: string }>(),
          );
        const total = await tq.executeTakeFirstOrThrow();
        return {
          total: Number(total.n),
          customers: rows.map((c) => ({
            id: c.id,
            name: c.name,
            email: c.email,
            phone: c.phone,
            group: c.custGroup,
            visits: c.visits,
            spend: c.spend,
            points: c.points,
            blacklisted: c.blacklisted,
            noShows: c.noShows,
          })),
        };
      }),
  });

  r.route({
    method: 'GET',
    url: '/customers/export',
    preHandler: [app.authenticate],
    schema: {
      response: {
        200: CustomerExportResponseSchema,
        403: z.object({ error: z.string(), message: z.string() }),
      },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        // Taking the whole file out of the building is its own right,
        // and it always goes on the record.
        const perms = await permsFor(trx, req.claims);
        if (!can(perms, 'customers.export'))
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: customers.export' });
        const rows = await trx.selectFrom('customers').selectAll().orderBy('name').execute();
        const esc = (v: string | number | null) => {
          const s = v == null ? '' : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const csv = [
          'name,email,phone,group,visits,spend,points,no_shows',
          ...rows.map((c) =>
            [c.name, c.email, c.phone, c.custGroup, c.visits, c.spend, c.points, c.noShows]
              .map(esc)
              .join(','),
          ),
        ].join('\n');
        const actor = await trx
          .selectFrom('employees')
          .select('name')
          .where('id', '=', req.claims.sub)
          .executeTakeFirst();
        await logAudit(trx, req.claims.ten, {
          actorEmployeeId: req.claims.sub,
          actorName: actor?.name ?? '',
          action: 'Customer data exported',
          object: `Customers · ${rows.length}`,
          after: `${rows.length} customers`,
        });
        return { csv, count: rows.length };
      }),
  });

  r.route({
    method: 'PATCH',
    url: '/employees/:id',
    preHandler: [app.authenticate],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: EmployeePatchSchema,
      response: {
        200: EmployeeSchema,
        403: z.object({ error: z.string(), message: z.string() }),
        404: z.object({ error: z.string(), message: z.string() }),
        409: z.object({ error: z.string(), message: z.string() }),
        422: z.object({ error: z.string(), message: z.string() }),
      },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        const perms = await permsFor(trx, req.claims);
        if (!can(perms, 'users.manage'))
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: users.manage' });
        try {
          return await updateEmployee(trx, req.claims, req.params.id, req.body);
        } catch (e) {
          if (e instanceof TeamError) {
            const status = { NOT_FOUND: 404, LAST_OWNER: 409, REFUSED_STATE: 422 } as const;
            return reply.code(status[e.code]).send({ error: e.code, message: e.message });
          }
          throw e;
        }
      }),
  });

  r.route({
    method: 'GET',
    url: '/employees/:id/timings',
    preHandler: [app.authenticate],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 200: EmployeeTimingsSchema },
    },
    handler: async (req) =>
      withTenant(req.claims.ten, async (trx) => {
        const biz = await trx
          .selectFrom('businesses')
          .select('timingEnabled')
          .executeTakeFirstOrThrow();
        if (!biz.timingEnabled) return { timingEnabled: false, rows: [] };
        const skills = (
          await trx
            .selectFrom('employeeSkills')
            .select('serviceId')
            .where('employeeId', '=', req.params.id)
            .execute()
        ).map((s) => s.serviceId);
        let svcQ = trx
          .selectFrom('services')
          .select(['id', 'name', 'durationMin'])
          .where('status', '=', 'active')
          .orderBy('sort');
        if (skills.length) svcQ = svcQ.where('id', 'in', skills);
        const svcs = await svcQ.execute();
        const timings = await trx
          .selectFrom('empTimings')
          .selectAll()
          .where('employeeId', '=', req.params.id)
          .where('variantId', 'is', null)
          .execute();
        const rows = [];
        for (const s of svcs) {
          const t = timings.find((x) => x.serviceId === s.id);
          const eff = await effTreatment(trx, s.id, null, null, req.params.id);
          rows.push({
            serviceId: s.id,
            name: s.name,
            catalogMin: s.durationMin,
            inUseMin: eff.min,
            observedN: t?.observedN ?? 0,
            observedMedianMin: t?.observedMedianMin ?? null,
            suggestion:
              t && t.status === 'suggested' && t.recommendedMin && t.recommendedMin !== eff.min
                ? { timingId: t.id, recommendedMin: t.recommendedMin }
                : null,
          });
        }
        return { timingEnabled: true, rows };
      }),
  });

  r.route({
    method: 'POST',
    url: '/employees',
    preHandler: [app.authenticate],
    schema: {
      body: EmployeeInviteSchema,
      response: {
        200: EmployeeSchema,
        403: z.object({ error: z.string(), message: z.string() }),
        422: z.object({ error: z.string(), message: z.string() }),
      },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        const perms = await permsFor(trx, req.claims);
        if (!can(perms, 'users.manage'))
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: users.manage' });
        try {
          return await createEmployee(trx, req.claims, req.body);
        } catch (e) {
          if (e instanceof TeamError)
            return reply.code(422).send({ error: e.code, message: e.message });
          throw e;
        }
      }),
  });

  r.route({
    method: 'GET',
    url: '/roles',
    preHandler: [app.authenticate],
    schema: { response: { 200: RoleListResponseSchema } },
    handler: async (req) =>
      withTenant(req.claims.ten, async (trx) => {
        const rows = await trx.selectFrom('roles').selectAll().orderBy('std', 'desc').orderBy('name').execute();
        return {
          roles: rows.map((r2) => ({
            id: r2.id,
            name: r2.name,
            std: r2.std,
            locked: r2.locked,
            description: r2.description,
            perms: PermMapSchema.parse(r2.perms ?? {}),
          })),
        };
      }),
  });

  r.route({
    method: 'POST',
    url: '/roles',
    preHandler: [app.authenticate],
    schema: {
      body: RoleWriteSchema,
      response: {
        200: z.object({ id: z.uuid() }),
        403: z.object({ error: z.string(), message: z.string() }),
      },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        const perms = await permsFor(trx, req.claims);
        if (!can(perms, 'roles.manage'))
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: roles.manage' });
        const row = await trx
          .insertInto('roles')
          .values({
            tenantId: req.claims.ten,
            name: req.body.name,
            std: false,
            locked: false,
            description: req.body.description,
            perms: JSON.stringify(req.body.perms),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const actor = await trx
          .selectFrom('employees')
          .select('name')
          .where('id', '=', req.claims.sub)
          .executeTakeFirst();
        await logAudit(trx, req.claims.ten, {
          actorEmployeeId: req.claims.sub,
          actorName: actor?.name ?? '',
          action: 'Role created',
          object: `Role · ${req.body.name}`,
          after: req.body.name,
        });
        return { id: row.id };
      }),
  });

  r.route({
    method: 'DELETE',
    url: '/roles/:id',
    preHandler: [app.authenticate],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: {
        200: z.object({ ok: z.literal(true) }),
        403: z.object({ error: z.string(), message: z.string() }),
        404: z.object({ error: z.string(), message: z.string() }),
        409: z.object({ error: z.string(), message: z.string() }),
      },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        const perms = await permsFor(trx, req.claims);
        if (!can(perms, 'roles.manage'))
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: roles.manage' });
        const role = await trx
          .selectFrom('roles')
          .selectAll()
          .where('id', '=', req.params.id)
          .executeTakeFirst();
        if (!role) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown role' });
        if (role.std || role.locked)
          return reply
            .code(409)
            .send({ error: 'STANDARD', message: 'A standard role cannot be removed' });
        const holders = await trx
          .selectFrom('employees')
          .select(({ fn }) => fn.countAll<string>().as('n'))
          .where('roleId', '=', req.params.id)
          .executeTakeFirstOrThrow();
        const n = Number(holders.n);
        if (n)
          return reply.code(409).send({
            error: 'IN_USE',
            message: `${n} ${n === 1 ? 'person is' : 'people are'} still on this role — move them first`,
          });
        await trx.deleteFrom('roles').where('id', '=', req.params.id).execute();
        const actor = await trx
          .selectFrom('employees')
          .select('name')
          .where('id', '=', req.claims.sub)
          .executeTakeFirst();
        await logAudit(trx, req.claims.ten, {
          actorEmployeeId: req.claims.sub,
          actorName: actor?.name ?? '',
          action: 'Role removed',
          object: `Role · ${role.name}`,
          before: role.name,
          after: '—',
        });
        return { ok: true as const };
      }),
  });

  r.route({
    method: 'PUT',
    url: '/roles/:id',
    preHandler: [app.authenticate],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: RoleWriteSchema,
      response: {
        200: z.object({ ok: z.literal(true) }),
        403: z.object({ error: z.string(), message: z.string() }),
        404: z.object({ error: z.string(), message: z.string() }),
        409: z.object({ error: z.string(), message: z.string() }),
      },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        const perms = await permsFor(trx, req.claims);
        if (!can(perms, 'roles.manage'))
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: roles.manage' });
        const role = await trx
          .selectFrom('roles')
          .selectAll()
          .where('id', '=', req.params.id)
          .executeTakeFirst();
        if (!role) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown role' });
        if (role.locked)
          return reply
            .code(409)
            .send({ error: 'LOCKED', message: 'The Owner role cannot be changed' });
        await trx
          .updateTable('roles')
          .set({
            name: req.body.name,
            description: req.body.description,
            perms: JSON.stringify(req.body.perms),
          })
          .where('id', '=', req.params.id)
          .execute();
        const actor = await trx
          .selectFrom('employees')
          .select('name')
          .where('id', '=', req.claims.sub)
          .executeTakeFirst();
        await logAudit(trx, req.claims.ten, {
          actorEmployeeId: req.claims.sub,
          actorName: actor?.name ?? '',
          action: 'Role updated',
          object: `Role · ${role.name}`,
          after: req.body.name,
        });
        return { ok: true as const };
      }),
  });
}
