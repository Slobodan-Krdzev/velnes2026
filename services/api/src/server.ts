import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { API_PREFIX } from '@velnes/contracts';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { healthRoutes } from './modules/health/health.routes.js';

export function buildServer() {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Permissive for now; the public widget surface gets its own strict
  // limits and per-domain CORS when it is built (Phase 7).
  app.register(cors, { origin: true });
  app.register(rateLimit, { max: 1000, timeWindow: '1 minute' });

  app.register(healthRoutes, { prefix: API_PREFIX });

  return app;
}
