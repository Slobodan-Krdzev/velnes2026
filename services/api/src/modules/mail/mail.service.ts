import type { Trx } from '../../db/index.js';
import { env } from '../../env.js';

/**
 * The one mail door. Every email the platform sends goes through
 * queueMail and lands in the outbox first — the outbox is the truth
 * of what was said to whom, whatever the transport does.
 *
 * The provider is undecided (likely Resend). Until that decision the
 * transport is 'mock': the row is stamped 'mock_sent' immediately and
 * NOTHING leaves the building — the state never pretends a delivery
 * happened. A real adapter later flips rows queued → sent.
 */
export interface MailInput {
  tenantId?: string | null | undefined;
  to: string;
  subject: string;
  body: string;
  kind: string; // 'employee_invite' | 'hq_invite' | 'email_verify' | ...
  refId?: string | null | undefined;
}

export async function queueMail(trx: Trx, mail: MailInput) {
  const mock = env.mailTransport === 'mock';
  await trx
    .insertInto('mailOutbox')
    .values({
      tenantId: mail.tenantId ?? null,
      toEmail: mail.to,
      subject: mail.subject,
      body: mail.body,
      kind: mail.kind,
      refId: mail.refId ?? null,
      status: mock ? 'mock_sent' : 'queued',
      sentAt: mock ? new Date() : null,
    })
    .execute();
}
