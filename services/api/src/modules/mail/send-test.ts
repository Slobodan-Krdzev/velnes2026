import nodemailer from 'nodemailer';
import { env } from '../../env.js';
import { renderMail } from './mail.render.js';

/**
 * One real mail, to prove a mail setup: `pnpm --filter @velnes/api
 * mail:test you@example.com`. Reads the same env the API reads (a
 * RESEND_API_KEY, or the SMTP_* variables), renders the Velnes layout
 * and hands it to the provider directly — no database, no outbox.
 */
const to = process.argv[2];
if (!to || !to.includes('@')) {
  console.error('Usage: pnpm --filter @velnes/api mail:test you@example.com');
  process.exit(1);
}
if (env.mailTransport !== 'smtp') {
  console.error('Mail is on the mock transport. Set RESEND_API_KEY (or MAIL_TRANSPORT=smtp with SMTP_*) in .env first.');
  process.exit(1);
}

const { html, text } = renderMail({
  subject: 'Velnes mail works',
  body: `This is a test mail from the Velnes API on ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC.\n\nIf you can read this, the provider accepted mail from ${env.mailFrom} and the layout survived the trip.`,
  meta: { code: '482913', cta: { label: 'Open Velnes', url: env.consumerAppUrl } },
});
const transport = nodemailer.createTransport({
  host: env.smtp.host,
  port: env.smtp.port,
  secure: env.smtp.secure,
  ...(env.smtp.user ? { auth: { user: env.smtp.user, pass: env.smtp.pass } } : {}),
});
try {
  const info = await transport.sendMail({ from: env.mailFrom, to, subject: 'Velnes mail works', text, html });
  console.log(`Accepted by ${env.smtp.host}: ${info.messageId} → ${to}`);
} catch (e) {
  console.error(`Refused by ${env.smtp.host}: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
