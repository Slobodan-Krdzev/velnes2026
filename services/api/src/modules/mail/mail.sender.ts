import nodemailer, { type Transporter } from 'nodemailer';
import { sql } from 'kysely';
import { withHq } from '../../db/index.js';
import { env } from '../../env.js';
import { renderMail, type MailMeta } from './mail.render.js';

/**
 * The sender: drains the outbox over SMTP (Alex, 2026-09-23 — mail
 * has to really work before hosting). `queueMail` writes a row inside
 * the caller's transaction; once that commits the sender picks it up,
 * renders the Velnes layout and hands it to the SMTP provider. A row
 * that the provider refuses retries with backoff and finally reads
 * `failed` with the provider's words in `error` — nothing is ever
 * marked sent that was not accepted.
 *
 * Any SMTP provider works (Resend, Brevo, Mailgun, Postmark, a Google
 * Workspace app password, the host's own relay): SMTP_HOST/PORT/USER/
 * PASS and MAIL_FROM are all it needs. With MAIL_TRANSPORT=mock the
 * sender does nothing and rows read `mock_sent`, as before.
 */

export const MAX_ATTEMPTS = 5;
/** Minutes to wait before the 2nd, 3rd, 4th and 5th attempt. */
const BACKOFF_MIN = [1, 5, 15, 60];

let transporter: Transporter | null = null;
function transport(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    ...(env.smtp.user ? { auth: { user: env.smtp.user, pass: env.smtp.pass } } : {}),
    connectionTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return transporter;
}

let running: Promise<void> | null = null;
let kick: NodeJS.Timeout | null = null;

/** Send everything due. Serialised: a second call while one runs waits
 *  for it and then runs itself, so nothing is sent twice. */
export async function sendPending(limit = 25): Promise<{ sent: number; retried: number; failed: number }> {
  if (env.mailTransport !== 'smtp') return { sent: 0, retried: 0, failed: 0 };
  while (running) await running;
  let result = { sent: 0, retried: 0, failed: 0 };
  running = (async () => {
    result = await drain(limit);
  })();
  try {
    await running;
  } finally {
    running = null;
  }
  return result;
}

async function drain(limit: number) {
  const out = { sent: 0, retried: 0, failed: 0 };
  const due = await withHq((trx) =>
    trx
      .selectFrom('mailOutbox')
      .select(['id', 'tenantId', 'toEmail', 'subject', 'body', 'meta', 'attempts'])
      .where('status', '=', 'queued')
      .where((eb) => eb.or([eb('nextAttemptAt', 'is', null), eb('nextAttemptAt', '<=', new Date())]))
      .orderBy('createdAt')
      .limit(limit)
      .execute(),
  );
  for (const row of due) {
    const salon = row.tenantId
      ? await withHq((trx) => trx.selectFrom('businesses').select('name').where('id', '=', row.tenantId!).executeTakeFirst())
      : null;
    const meta = (row.meta ?? {}) as MailMeta;
    const { html, text } = renderMail({ subject: row.subject, body: row.body, meta, salon: salon?.name ?? null });
    try {
      const info = await transport().sendMail({
        from: env.mailFrom,
        to: row.toEmail,
        subject: row.subject,
        text,
        html,
        ...(env.mailReplyTo ? { replyTo: env.mailReplyTo } : {}),
      });
      await withHq((trx) =>
        trx
          .updateTable('mailOutbox')
          .set({ status: 'sent', sentAt: new Date(), messageId: info.messageId ?? null, error: null, attempts: row.attempts + 1 })
          .where('id', '=', row.id)
          .execute(),
      );
      out.sent += 1;
    } catch (e) {
      const attempts = row.attempts + 1;
      const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      const gaveUp = attempts >= MAX_ATTEMPTS;
      const wait = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)]!;
      await withHq((trx) =>
        trx
          .updateTable('mailOutbox')
          .set({
            attempts,
            error,
            status: gaveUp ? 'failed' : 'queued',
            nextAttemptAt: gaveUp ? null : sql<Date>`now() + make_interval(mins => ${wait})`,
          })
          .where('id', '=', row.id)
          .execute(),
      );
      if (gaveUp) out.failed += 1;
      else out.retried += 1;
    }
  }
  return out;
}

/** Nudge the sender shortly — called after a mail is queued, so the
 *  caller's transaction has committed by the time it runs. */
export function scheduleSend() {
  if (env.mailTransport !== 'smtp' || kick) return;
  kick = setTimeout(() => {
    kick = null;
    void sendPending().catch(() => {});
  }, 400);
  kick.unref();
}

/** The retry heartbeat, started by the API process (not by tests). */
export function startMailLoop(everyMs = 30_000) {
  if (env.mailTransport !== 'smtp') return null;
  const t = setInterval(() => void sendPending().catch(() => {}), everyMs);
  t.unref();
  scheduleSend();
  return t;
}

/** Test seam: forget the cached transporter (env changed). */
export function resetTransport() {
  transporter = null;
}
