import {
  CustomerListQuerySchema,
  CustomerListResponseSchema,
  EmployeeInviteSchema,
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
            spend: c.spend,
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
            ...(req.body.name !== undefined ? { name: req.body.name } : {}),
            ...(req.body.email !== undefined ? { email: req.body.email } : {}),
            ...(req.body.phone !== undefined ? { phone: req.body.phone } : {}),
            ...(req.body.bookable !== undefined ? { bookable: req.body.bookable } : {}),
            ...(req.body.color !== undefined ? { color: req.body.color } : {}),
            ...(req.body.access !== undefined ? { access: req.body.access } : {}),
            ...(req.body.roleId !== undefined ? { roleId: req.body.roleId } : {}),
            ...(req.body.roleTitle !== undefined ? { roleTitle: req.body.roleTitle } : {}),
            ...(req.body.hours !== undefined ? { hours: JSON.stringify(req.body.hours) } : {}),
          })
          .where('id', '=', req.params.id)
          .execute();
        // Locations: replace whole — where the role applies.
        if (req.body.locationIds !== undefined) {
          await trx
            .deleteFrom('employeeLocations')
            .where('employeeId', '=', req.params.id)
            .execute();
          for (const lid of req.body.locationIds)
            await trx
              .insertInto('employeeLocations')
              .values({ tenantId: req.claims.ten, employeeId: req.params.id, locationId: lid })
              .execute();
        }
        // Skills: replace whole — empty means "does everything".
        if (req.body.skillServiceIds !== undefined) {
          await trx
            .deleteFrom('employeeSkills')
            .where('employeeId', '=', req.params.id)
            .execute();
          for (const sid of req.body.skillServiceIds)
            await trx
              .insertInto('employeeSkills')
              .values({ tenantId: req.claims.ten, employeeId: req.params.id, serviceId: sid })
              .execute();
        }
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
          hours: (e.hours ?? null) as Employee['hours'],
          twofaEnabled: e.twofaEnabled,
          lastActive:
            (
              await trx
                .selectFrom('refreshTokens')
                .select(
                  sql<Date>`max(greatest(created_at, coalesce(rotated_at, created_at)))`.as('last'),
                )
                .where('employeeId', '=', e.id)
                .executeTakeFirst()
            )?.last?.toISOString() ?? null,
        };
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
      },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        const perms = await permsFor(trx, req.claims);
        if (!can(perms, 'users.manage'))
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: users.manage' });
        const b = req.body;
        // Invited, not bookable, no credentials: until the invite is
        // accepted (waits for SMTP) they can sign in nowhere.
        const row = await trx
          .insertInto('employees')
          .values({
            tenantId: req.claims.ten,
            name: b.name,
            email: b.email,
            roleId: b.roleId,
            roleTitle: 'New user',
            access: 'staff',
            bookable: false,
            status: 'invited',
            twofaEnabled: b.twofa,
            color: null,
            phone: null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        for (const lid of b.locationIds)
          await trx
            .insertInto('employeeLocations')
            .values({ tenantId: req.claims.ten, employeeId: row.id, locationId: lid })
            .execute();
        const actor = await trx
          .selectFrom('employees')
          .select('name')
          .where('id', '=', req.claims.sub)
          .executeTakeFirst();
        const role = await trx
          .selectFrom('roles')
          .select('name')
          .where('id', '=', b.roleId)
          .executeTakeFirst();
        await logAudit(trx, req.claims.ten, {
          actorEmployeeId: req.claims.sub,
          actorName: actor?.name ?? '',
          action: 'User invited',
          object: `User · ${b.name}`,
          before: '—',
          after: role?.name ?? '—',
        });
        return {
          id: row.id,
          name: b.name,
          roleTitle: 'New user',
          email: b.email,
          phone: null,
          access: 'staff' as const,
          roleId: b.roleId,
          bookable: false,
          status: 'invited' as const,
          color: null,
          locationIds: b.locationIds,
          skillServiceIds: [],
          hours: null,
          twofaEnabled: b.twofa,
          lastActive: null,
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
