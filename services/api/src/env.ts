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
  /** 'mock' until the provider is decided (likely Resend): mails land
   *  in the outbox stamped mock_sent, nothing leaves the building. */
  mailTransport: process.env.MAIL_TRANSPORT ?? 'mock',
  /** Where the flightdeck's opportunities and Kumo insight come from.
   *  'rules' (default) derives them from the salon's own data — real,
   *  honest, no external call. 'claude' hands the same job to the
   *  Claude Messages API once a key is provisioned; until then it
   *  falls back to 'rules' rather than pretend. See the insights
   *  provider — one door, swappable like mailTransport. */
  insightProvider: process.env.INSIGHT_PROVIDER ?? 'rules',
  /** Set when INSIGHT_PROVIDER='claude'. Absent → the claude provider
   *  degrades to rules, never fakes an answer. */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  accessTtl: '15m',
  refreshTtlDays: 30,
};
