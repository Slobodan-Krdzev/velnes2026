import type { Trx } from '../../db/index.js';
import { env } from '../../env.js';
import type { MailMeta } from './mail.render.js';
import { scheduleSend } from './mail.sender.js';

/**
 * The one mail door. Every email the platform sends goes through
 * queueMail and lands in the outbox first — the outbox is the truth
 * of what was said to whom, whatever the transport does.
 *
 * Two transports (Alex, 2026-09-23):
 *  - 'smtp' — the row is queued and the sender (mail.sender.ts)
 *    delivers it over SMTP in the Velnes layout, retrying with backoff;
 *    it reads 'sent' only once the provider accepted it, 'failed' with
 *    the provider's words otherwise.
 *  - 'mock' — the row is stamped 'mock_sent' at once and NOTHING
 *    leaves the building (dev, tests): the state never pretends.
 *
 * `body` is plain prose (blank line = new paragraph); `cta` becomes the
 * mail's button and `code` its large one-time code.
 */
export interface MailInput {
  tenantId?: string | null | undefined;
  to: string;
  subject: string;
  body: string;
  kind: string; // 'employee_invite' | 'hq_invite' | 'email_verify' | ...
  refId?: string | null | undefined;
  cta?: MailMeta['cta'];
  code?: string | undefined;
}

export async function queueMail(trx: Trx, mail: MailInput) {
  const mock = env.mailTransport === 'mock';
  const meta: MailMeta = {};
  if (mail.cta) meta.cta = mail.cta;
  if (mail.code) meta.code = mail.code;
  await trx
    .insertInto('mailOutbox')
    .values({
      tenantId: mail.tenantId ?? null,
      toEmail: mail.to,
      subject: mail.subject,
      body: mail.body,
      kind: mail.kind,
      refId: mail.refId ?? null,
      meta: JSON.stringify(meta),
      status: mock ? 'mock_sent' : 'queued',
      sentAt: mock ? new Date() : null,
    })
    .execute();
  // The caller's transaction commits after this returns; the sender
  // runs a moment later and finds the row.
  if (!mock) scheduleSend();
}
