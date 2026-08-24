import type { HealthResponse } from '@velnes/contracts';

export const API_VERSION = '0.0.1';

export function health(): HealthResponse {
  return {
    status: 'ok',
    version: API_VERSION,
    time: new Date().toISOString(),
  };
}
