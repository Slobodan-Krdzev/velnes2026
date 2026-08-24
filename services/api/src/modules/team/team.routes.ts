import {
  CustomerListQuerySchema,
  CustomerListResponseSchema,
  EmployeeListResponseSchema,
} from '@velnes/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { withTenant } from '../../db/index.js';

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
}
