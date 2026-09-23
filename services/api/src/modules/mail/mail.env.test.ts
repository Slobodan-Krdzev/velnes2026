import { afterEach, describe, expect, it, vi } from 'vitest';

/** RESEND_API_KEY alone turns mail on with Resend's SMTP settings; the
 *  SMTP_* variables still win when set; no key means mock. */
describe('mail env', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.resetModules();
  });

  it('a Resend key switches the transport on with Resend settings', async () => {
    delete process.env.MAIL_TRANSPORT;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    process.env.RESEND_API_KEY = 're_test_123';
    vi.resetModules();
    const { env } = await import('../../env.js');
    expect(env.mailTransport).toBe('smtp');
    expect(env.smtp).toMatchObject({ host: 'smtp.resend.com', port: 587, secure: false, user: 'resend', pass: 're_test_123' });
  });

  it('explicit SMTP_* variables override the Resend defaults', async () => {
    process.env.RESEND_API_KEY = 're_test_123';
    process.env.SMTP_HOST = 'smtp.example.org';
    process.env.SMTP_USER = 'someone';
    process.env.SMTP_PASS = 'secret';
    vi.resetModules();
    const { env } = await import('../../env.js');
    expect(env.smtp).toMatchObject({ host: 'smtp.example.org', user: 'someone', pass: 'secret' });
  });

  it('without a key or a transport the mail stays mock', async () => {
    delete process.env.MAIL_TRANSPORT;
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    vi.resetModules();
    const { env } = await import('../../env.js');
    expect(env.mailTransport).toBe('mock');
  });
});
