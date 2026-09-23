import { env } from '../../env.js';
import type { SupportCategory, SupportMessage, SupportStatus, SupportTicket } from '@velnes/contracts';
import type { Trx } from '../../db/index.js';
import { queueMail } from '../mail/mail.service.js';

/**
 * Support tickets — the one door from a salon or a supplier to
 * Revelapps HQ. Every ticket and every reply also queues mail through
 * the outbox, so the thread exists both in the apps and (once the
 * provider is live) over SMTP. Until then the mail is honest mock.
 */

const HQ_SUPPORT_INBOX = 'support@revelapps.com';

export class SupportError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'INVALID',
    message: string,
  ) {
    super(message);
  }
}

type TicketRow = {
  id: string;
  origin: string;
  originName: string;
  subject: string;
  category: string;
  status: SupportStatus;
  createdBy: string;
  lastActor: string;
  replyTo: string;
  messages: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export function toTicketContract(r: TicketRow): SupportTicket {
  return {
    id: r.id,
    origin: r.origin as 'tenant' | 'supplier',
    originName: r.originName,
    subject: r.subject,
    category: r.category as SupportCategory,
    status: r.status,
    createdBy: r.createdBy,
    lastActor: r.lastActor as 'origin' | 'hq',
    messages: (Array.isArray(r.messages) ? r.messages : []) as SupportMessage[],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function snippet(body: string) {
  return body.length > 90 ? `${body.slice(0, 90)}…` : body;
}

// The bell feeds. HQ hears every open and reply; the opener hears HQ's
// answer. A notice carries the ticket id (ref_id) so a click lands on
// the thread. Each insert runs in the ticket's own transaction/context.
async function notifyHq(trx: Trx, ticketId: string, title: string, body: string) {
  await trx
    .insertInto('platformNotices')
    .values({ audience: 'hq', kind: 'support', title, body, refId: ticketId })
    .execute();
}
async function notifySalon(trx: Trx, tenantId: string, ticketId: string, title: string, body: string) {
  await trx
    .insertInto('platformNotices')
    .values({ audience: 'salons', tenantId, kind: 'support', title, body, refId: ticketId })
    .execute();
}
async function notifySupplier(trx: Trx, supplierId: string, ticketId: string, title: string, body: string) {
  await trx
    .insertInto('supplierNotifications')
    .values({ supplierId, kind: 'ticket', title, body, refId: ticketId })
    .execute();
}

export async function createTicket(
  trx: Trx,
  opts: {
    origin: 'tenant' | 'supplier';
    tenantId: string | null;
    supplierId: string | null;
    originName: string;
    createdBy: string;
    replyTo: string;
    subject: string;
    category: SupportCategory;
    body: string;
  },
) {
  const first: SupportMessage = {
    authorKind: opts.origin,
    authorName: opts.createdBy,
    body: opts.body,
    at: new Date().toISOString(),
  };
  const row = await trx
    .insertInto('supportTickets')
    .values({
      origin: opts.origin,
      tenantId: opts.tenantId,
      supplierId: opts.supplierId,
      originName: opts.originName,
      createdBy: opts.createdBy,
      replyTo: opts.replyTo,
      subject: opts.subject,
      category: opts.category,
      status: 'open',
      lastActor: 'origin',
      messages: JSON.stringify([first]),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await queueMail(trx, {
    // Under the salon's context the outbox is tenant-scoped; a supplier
    // ticket carries no tenant and rides the supplier insert policy.
    tenantId: opts.tenantId,
    to: HQ_SUPPORT_INBOX,
    subject: `New support ticket — ${opts.subject}`,
    body: `${opts.originName} (${opts.createdBy}) opened a ${opts.category} ticket:\n\n${opts.body}`,
    kind: 'support_ticket',
    cta: { label: 'Open in HQ', url: `${env.hqAppUrl}/tickets` },
    refId: row.id,
  });
  await notifyHq(trx, row.id, `New support ticket — ${opts.subject}`, `${opts.originName} · ${snippet(opts.body)}`);
  return row.id;
}

export async function replyToTicket(
  trx: Trx,
  ticketId: string,
  msg: { authorKind: 'tenant' | 'supplier' | 'hq'; authorName: string; body: string; status?: SupportStatus | undefined },
) {
  const t = await trx
    .selectFrom('supportTickets')
    .selectAll()
    .where('id', '=', ticketId)
    .executeTakeFirst();
  if (!t) throw new SupportError('NOT_FOUND', 'Unknown ticket');
  const existing = (Array.isArray(t.messages) ? t.messages : []) as SupportMessage[];
  const message: SupportMessage = {
    authorKind: msg.authorKind,
    authorName: msg.authorName,
    body: msg.body,
    at: new Date().toISOString(),
  };
  const fromHq = msg.authorKind === 'hq';
  await trx
    .updateTable('supportTickets')
    .set({
      messages: JSON.stringify([...existing, message]),
      lastActor: fromHq ? 'hq' : 'origin',
      updatedAt: new Date(),
      ...(msg.status ? { status: msg.status } : {}),
    })
    .where('id', '=', ticketId)
    .execute();
  if (fromHq) {
    if (t.replyTo)
      await queueMail(trx, {
        to: t.replyTo,
        subject: `Re: ${t.subject}`,
        body: `Revelapps support replied to your ticket:\n\n${msg.body}`,
        kind: 'support_reply',
        refId: ticketId,
      });
    // Ring the opener's bell — salon or supplier.
    if (t.origin === 'tenant' && t.tenantId)
      await notifySalon(trx, t.tenantId, ticketId, `Revelapps replied — ${t.subject}`, snippet(msg.body));
    else if (t.origin === 'supplier' && t.supplierId)
      await notifySupplier(trx, t.supplierId, ticketId, `Revelapps replied — ${t.subject}`, snippet(msg.body));
  } else {
    await queueMail(trx, {
      tenantId: t.tenantId,
      to: HQ_SUPPORT_INBOX,
      subject: `Reply on support ticket — ${t.subject}`,
      body: `${t.originName} (${msg.authorName}) replied:\n\n${msg.body}`,
      kind: 'support_ticket',
      refId: ticketId,
      cta: { label: 'Open in HQ', url: `${env.hqAppUrl}/tickets` },
    });
    await notifyHq(trx, ticketId, `New reply — ${t.subject}`, `${t.originName} · ${snippet(msg.body)}`);
  }
}

export async function setTicketStatus(trx: Trx, ticketId: string, status: SupportStatus) {
  const t = await trx
    .selectFrom('supportTickets')
    .select('id')
    .where('id', '=', ticketId)
    .executeTakeFirst();
  if (!t) throw new SupportError('NOT_FOUND', 'Unknown ticket');
  await trx
    .updateTable('supportTickets')
    .set({ status, updatedAt: new Date() })
    .where('id', '=', ticketId)
    .execute();
}

export async function listTickets(trx: Trx): Promise<SupportTicket[]> {
  const rows = await trx
    .selectFrom('supportTickets')
    .selectAll()
    .orderBy('updatedAt', 'desc')
    .execute();
  return rows.map((r) => toTicketContract(r as unknown as TicketRow));
}
