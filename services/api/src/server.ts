import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { API_PREFIX } from '@velnes/contracts';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { authRoutes } from './modules/auth/auth.routes.js';
import { auditRoutes } from './modules/audit/audit.routes.js';
import { bookingRoutes } from './modules/booking/booking.routes.js';
import { catalogRoutes } from './modules/catalog/catalog.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { locationsRoutes } from './modules/locations/locations.routes.js';
import { schedulingRoutes } from './modules/scheduling/scheduling.routes.js';
import { stockRoutes } from './modules/stock/stock.routes.js';
import { teamRoutes } from './modules/team/team.routes.js';
import { tillRoutes } from './modules/till/till.routes.js';
import { timingRoutes } from './modules/timing/timing.routes.js';
import { widgetsRoutes } from './modules/widgets/widgets.routes.js';
import { hqRoutes } from './modules/hq/hq.routes.js';
import { customersRoutes } from './modules/customers/customers.routes.js';
import { marketingRoutes } from './modules/marketing/marketing.routes.js';
import { suppliersRoutes } from './modules/suppliers/suppliers.routes.js';
import { portalRoutes } from './modules/suppliers/portal.routes.js';
import { businessRoutes } from './modules/business/business.routes.js';
import { reportsRoutes } from './modules/reports/reports.routes.js';
import { supportRoutes } from './modules/support/support.routes.js';
import { flightdeckRoutes } from './modules/flightdeck/flightdeck.routes.js';
import { rankingRoutes } from './modules/ranking/ranking.routes.js';
import { registrationsRoutes } from './modules/registrations/registrations.routes.js';
import { authPlugin } from './plugins/auth.js';
import { publicRoutes } from './public/public.routes.js';

export async function buildServer() {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
    // The gallery PATCH replaces all photos at once: up to 12 data
    // URLs of ≤600k chars each (GALLERY_* in @velnes/contracts), so
    // the default 1 MiB body would refuse a full, legal gallery.
    bodyLimit: 10 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Permissive for now; the public widget surface gets its own strict
  // limits and per-domain CORS when it is built (Phase 7).
  await app.register(cors, { origin: true });
  await app.register(rateLimit, { max: 1000, timeWindow: '1 minute' });
  await app.register(authPlugin);

  await app.register(
    async (api) => {
      healthRoutes(api);
      authRoutes(api);
      locationsRoutes(api);
      auditRoutes(api);
      catalogRoutes(api);
      stockRoutes(api);
      schedulingRoutes(api);
      bookingRoutes(api);
      timingRoutes(api);
      tillRoutes(api);
      teamRoutes(api);
      widgetsRoutes(api);
      registrationsRoutes(api);
      hqRoutes(api);
      customersRoutes(api);
      marketingRoutes(api);
      suppliersRoutes(api);
      portalRoutes(api);
      businessRoutes(api);
      reportsRoutes(api);
      supportRoutes(api);
      flightdeckRoutes(api);
      rankingRoutes(api);
    },
    { prefix: API_PREFIX },
  );

  // The widget's public surface: its own narrow plugin scope with its
  // own rate limiting, CORS-per-domain and caching (docs §2, §7).
  await app.register(publicRoutes, { prefix: `${API_PREFIX}/public` });

  return app;
}
