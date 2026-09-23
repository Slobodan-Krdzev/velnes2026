const isProd = process.env.NODE_ENV === 'production';

function required(name: string, devFallback: string): string {
  const v = process.env[name];
  if (v) return v;
  if (isProd) throw new Error(`${name} must be set in production`);
  return devFallback;
}

const resendKey = process.env.RESEND_API_KEY ?? '';

export const env = {
  isProd,
  /** Restricted role — RLS always applies to this connection. */
  apiDatabaseUrl: required(
    'API_DATABASE_URL',
    'postgres://velnes_api:velnes_api@localhost:5432/velnes',
  ),
  jwtSecret: required('JWT_SECRET', 'velnes-dev-secret-not-for-production'),
  /** 'smtp' delivers the outbox over SMTP (any provider); 'mock' stamps
   *  rows mock_sent and nothing leaves the building (dev, tests). */
  mailTransport: (process.env.MAIL_TRANSPORT ?? (resendKey ? 'smtp' : 'mock')) as 'mock' | 'smtp',
  /** Resend is the provider (Alex, 2026-09-23): RESEND_API_KEY alone
   *  switches mail on with Resend's SMTP settings; the SMTP_* variables
   *  still override for any other provider. */
  smtp: {
    host: process.env.SMTP_HOST ?? (resendKey ? 'smtp.resend.com' : ''),
    port: Number(process.env.SMTP_PORT ?? 587),
    /** true for implicit TLS on 465; false uses STARTTLS on 587. */
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER ?? (resendKey ? 'resend' : ''),
    pass: process.env.SMTP_PASS ?? resendKey,
  },
  /** Whose X-Forwarded-* headers to believe: the reverse proxy on the
   *  same box (deploy/nginx). 'true' trusts every hop; 'false' none.
   *  The rate limiters key on req.ip, so this decides whether they see
   *  the visitor or the proxy. */
  trustProxy: ((): boolean | string => {
    const v = process.env.TRUST_PROXY ?? '127.0.0.1';
    return v === 'true' ? true : v === 'false' ? false : v;
  })(),
  /** The From header, e.g. "Velnes <no-reply@velnes.mk>". */
  mailFrom: process.env.MAIL_FROM ?? 'Velnes <no-reply@velnes.local>',
  mailReplyTo: process.env.MAIL_REPLY_TO ?? '',
  /** Where the staff apps live — the buttons in invites and reminders. */
  workspaceAppUrl: (process.env.WORKSPACE_APP_URL ?? 'http://localhost:5173').replace(/\/+$/, ''),
  hqAppUrl: (process.env.HQ_APP_URL ?? 'http://localhost:5177').replace(/\/+$/, ''),
  supplierAppUrl: (process.env.SUPPLIER_APP_URL ?? 'http://localhost:5176').replace(/\/+$/, ''),
  /** Where the consumer app lives — the base of every link a mail or a
   *  notification hands a customer (their appointment, the payment
   *  screen). Dev: the Vite server. */
  consumerAppUrl: (process.env.CONSUMER_APP_URL ?? 'http://localhost:5178').replace(/\/+$/, ''),
  /** Where the employee app lives — the base of every personal sign-in
   *  link (Settings › Team, the invite mail). Dev: the Vite server. */
  employeeAppUrl: (process.env.EMPLOYEE_APP_URL ?? 'http://localhost:5174').replace(/\/+$/, ''),
  /** Where the flightdeck's opportunities and Kumo insight come from.
   *  'rules' (default) derives them from the salon's own data — real,
   *  honest, no external call. 'claude' hands the same job to the
   *  Claude Messages API once a key is provisioned; until then it
   *  falls back to 'rules' rather than pretend. See the insights
   *  provider — one door, swappable like mailTransport. */
  insightProvider: process.env.INSIGHT_PROVIDER ?? 'rules',
  /** AI-onboarding website import. 'rules' (default) reads only the
   *  page's structured data — deterministic, honest, no external call.
   *  'claude' additionally hands the page text to the Claude Messages
   *  API to extract full services/products/hours; with no key it
   *  degrades to 'rules' rather than fake a read. Same swappable shape
   *  as insightProvider / mailTransport. */
  onboardingProvider: process.env.ONBOARDING_PROVIDER ?? 'rules',
  /** The Claude model the onboarding extractor calls when live. */
  onboardingModel: process.env.ONBOARDING_MODEL ?? 'claude-sonnet-5',
  /** AI Assistant planner. 'stub' (default) = the deterministic pattern
   *  matcher used by the V1 spike and the tests; 'claude' = the Messages
   *  API planner (degrades to 'stub' with no key). Provider/model are
   *  configurable so we are never coupled to one model. */
  assistantProvider: process.env.ASSISTANT_PROVIDER ?? 'stub',
  assistantModel: process.env.ASSISTANT_MODEL ?? 'claude-sonnet-5',
  /** Set when INSIGHT_PROVIDER or ONBOARDING_PROVIDER = 'claude'. Absent
   *  → the claude providers degrade to rules, never fake an answer. */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  accessTtl: '15m',
  refreshTtlDays: 30,
};

if (env.mailTransport === 'smtp' && !env.smtp.host)
  throw new Error('SMTP_HOST must be set when MAIL_TRANSPORT=smtp');
if (env.mailTransport !== 'smtp' && env.mailTransport !== 'mock')
  throw new Error(`MAIL_TRANSPORT must be 'smtp' or 'mock', got '${env.mailTransport}'`);
