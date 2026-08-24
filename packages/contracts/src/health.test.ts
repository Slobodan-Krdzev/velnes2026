import { describe, expect, it } from 'vitest';
import { HealthResponseSchema } from './health.js';

describe('HealthResponse contract', () => {
  it('accepts a valid payload', () => {
    const parsed = HealthResponseSchema.parse({
      status: 'ok',
      version: '0.0.1',
      time: new Date().toISOString(),
    });
    expect(parsed.status).toBe('ok');
  });

  it('rejects an invalid status', () => {
    expect(() =>
      HealthResponseSchema.parse({
        status: 'down',
        version: '0.0.1',
        time: new Date().toISOString(),
      }),
    ).toThrow();
  });
});
