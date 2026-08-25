import {
  CustomerListQuerySchema,
  CustomerListResponseSchema,
  EmployeeListResponseSchema,
  EmployeePatchSchema,
  EmployeeSchema,
  PermMapSchema,
  RoleListResponseSchema,
  RoleWriteSchema,
} from '@velnes/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import { withTenant } from '../../db/index.js';
import { logAudit } from '../audit/audit.service.js';
import { can, permsFor } from '../auth/authz.service.js';

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
      response: { 200: CustomerListResponseSchema },
    },
    handler: async (req) =>
      withTenant(req.claims.ten, async (trx) => {
        let q = trx
          .selectFrom('customers')
          .selectAll()
          .orderBy('name')
          .limit(req.query.limit);
        if (req.query.query)
          q = q.where(sql<boolean>`name ILIKE ${'%' + req.query.query + '%'}`);
        const rows = await q.execute();
        return {
          customers: rows.map((c) => ({
            id: c.id,
            name: c.name,
            email: c.email,
            phone: c.phone,
            group: c.custGroup,
            visits: c.visits,
            points: c.points,
            blacklisted: c.blacklisted,
            noShows: c.noShows,
          })),
        };
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
      },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        const perms = await permsFor(trx, req.claims);
        if (!can(perms, 'users.manage'))
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: users.manage' });
        const before = await trx
          .selectFrom('employees')
          .selectAll()
          .where('id', '=', req.params.id)
          .executeTakeFirst();
        if (!before)
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown employee' });
        await trx
          .updateTable('employees')
          .set({
            ...(req.body.bookable !== undefined ? { bookable: req.body.bookable } : {}),
            ...(req.body.color !== undefined ? { color: req.body.color } : {}),
            ...(req.body.access !== undefined ? { access: req.body.access } : {}),
            ...(req.body.roleId !== undefined ? { roleId: req.body.roleId } : {}),
          })
          .where('id', '=', req.params.id)
          .execute();
        if (req.body.roleId !== undefined && req.body.roleId !== before.roleId) {
          const actor = await trx
            .selectFrom('employees')
            .select('name')
            .where('id', '=', req.claims.sub)
            .executeTakeFirst();
          const roleName = async (id: string | null) =>
            id
              ? ((await trx.selectFrom('roles').select('name').where('id', '=', id).executeTakeFirst())?.name ?? '—')
              : '—';
          await logAudit(trx, req.claims.ten, {
            actorEmployeeId: req.claims.sub,
            actorName: actor?.name ?? '',
            action: 'Role changed',
            object: `User · ${before.name}`,
            before: await roleName(before.roleId),
            after: await roleName(req.body.roleId),
          });
        }
        const e = await trx
          .selectFrom('employees')
          .selectAll()
          .where('id', '=', req.params.id)
          .executeTakeFirstOrThrow();
        const locs = await trx
          .selectFrom('employeeLocations')
          .select('locationId')
          .where('employeeId', '=', e.id)
          .execute();
        const skills = await trx
          .selectFrom('employeeSkills')
          .select('serviceId')
          .where('employeeId', '=', e.id)
          .execute();
        return {
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
          locationIds: locs.map((l) => l.locationId),
          skillServiceIds: skills.map((s) => s.serviceId),
        };
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
        return { id: row.id };
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
