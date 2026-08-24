import { HealthResponseSchema } from '@velnes/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { health } from './health.service.js';

export function healthRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: '/health',
    schema: {
      response: { 200: HealthResponseSchema },
    },
    handler: async () => health(),
  });
}
