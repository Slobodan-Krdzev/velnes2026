import { FlightdeckSchema } from '@velnes/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/index.js';
import { can, permsFor } from '../auth/authz.service.js';
import { flightdeck } from './flightdeck.service.js';

const Err = z.object({ error: z.string(), message: z.string() });

/** The salon's home: one door composes the whole flightdeck. */
export function flightdeckRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/flightdeck',
    preHandler: [app.authenticate],
    schema: {
      querystring: z.object({ locationId: z.uuid().optional() }),
      response: { 200: FlightdeckSchema, 403: Err, 404: Err },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        // The flightdeck is the location's figures — revenue, customers,
        // stock, member opportunities — so it opens for whoever may read
        // location reports. A basic Employee lands on the calendar instead.
        const perms = await permsFor(trx, req.claims);
        if (!can(perms, 'reports.view_location') && !can(perms, 'reports.view_business'))
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: reports.view_location' });
        // With no location given ("All locations"), the flightdeck's
        // location-specific parts show the primary operating location —
        // the one with the most appointments — not the first by name.
        let locId = req.query.locationId;
        if (!locId) {
          const busiest = await trx
            .selectFrom('appointments')
            .select('locationId')
            .select((eb) => eb.fn.countAll<string>().as('n'))
            .where('kind', '=', 'appointment')
            .groupBy('locationId')
            .orderBy('n', 'desc')
            .executeTakeFirst();
          // Prefer the busiest, then the first ACTIVE location, then any
          // location at all (an HQ-created business starts with a bare
          // APPROVED one), otherwise the flightdeck 404s and the owner
          // never sees their getting-started checklist.
          const activeOrAny = async (activeOnly: boolean) => {
            let q = trx.selectFrom('locations').select('id');
            if (activeOnly) q = q.where('lifecycle', '=', 'ACTIVE');
            return (await q.orderBy('createdAt').executeTakeFirst())?.id;
          };
          locId =
            busiest?.locationId ?? (await activeOrAny(true)) ?? (await activeOrAny(false));
        }
        if (!locId) return reply.code(404).send({ error: 'NO_LOCATION', message: 'No location to view' });
        const me = await trx
          .selectFrom('employees')
          .select('name')
          .where('id', '=', req.claims.sub)
          .executeTakeFirst();
        return flightdeck(trx, {
          tenantId: req.claims.ten,
          locId,
          greetingName: (me?.name ?? '').split(' ')[0] ?? '',
        });
      }),
  });
}
