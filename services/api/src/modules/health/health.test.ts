import { API_PREFIX, HealthResponseSchema } from '@velnes/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../../server.js';

describe('GET /api/v1/health', () => {
  const app = buildServer();

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers per the HealthResponse contract', async () => {
    const res = await app.inject({ method: 'GET', url: `${API_PREFIX}/health` });
    expect(res.statusCode).toBe(200);
    const body = HealthResponseSchema.parse(res.json());
    expect(body.status).toBe('ok');
  });
});
