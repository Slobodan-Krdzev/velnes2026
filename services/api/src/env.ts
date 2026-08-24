const isProd = process.env.NODE_ENV === 'production';

function required(name: string, devFallback: string): string {
  const v = process.env[name];
  if (v) return v;
  if (isProd) throw new Error(`${name} must be set in production`);
  return devFallback;
}

export const env = {
  isProd,
  /** Restricted role — RLS always applies to this connection. */
  apiDatabaseUrl: required(
    'API_DATABASE_URL',
    'postgres://velnes_api:velnes_api@localhost:5432/velnes',
  ),
  jwtSecret: required('JWT_SECRET', 'velnes-dev-secret-not-for-production'),
  accessTtl: '15m',
  refreshTtlDays: 30,
};
