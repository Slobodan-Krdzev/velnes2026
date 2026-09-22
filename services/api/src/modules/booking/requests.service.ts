import { createHmac } from 'node:crypto';
import type { Appointment } from '@velnes/contracts';
import { BusinessSettingsSchema } from '@velnes/contracts';
import type { Trx } from '../../db/index.js';
import { env } from '../../env.js';
import { notifySalon } from '../clients/clients.service.js';
import { queueMail } from '../mail/mail.service.js';

/**
 * Booking requests — Alex, 2026-09-22.
 *
 * A salon that switched "Confirm bookings automatically" off does not
 * get bookings from the Velnes app, it gets requests: the appointment
 * lands as `requested`, holds its slot, and waits for the salon to
 * accept or decline. Nobody pays for a request. Both bells ring at
 * every step and every step mails the customer; the acceptance mail
 * carries the link that opens the payment screen with the appointment
 * loaded.
 *
 * This module is the messaging around that lifecycle. The state itself
 * is written by `confirmBooking` (requested or booked) and
 * `decideRequest` (booked or cancelled) in booking.service — one
 * writer, audited, as every lifecycle here.
 */

/** Does this salon confirm Velnes-app bookings by itself? */
export async function autoConfirmOn(trx: Trx): Promise<boolean> {
  const b = await trx.selectFrom('businesses').select('settings').executeTakeFirst();
  const parsed = BusinessSettingsSchema.safeParse(b?.settings ?? {});
  return parsed.success ? parsed.data.marketplace.autoConfirm : true;
}

/**
 * A guest has no account to sign into, so their link carries a
 * capability: an HMAC of the appointment id under the API secret. It
 * opens exactly one appointment's payment screen and nothing else.
 */
export function guestPayToken(appointmentId: string): string {
  return createHmac('sha256', env.jwtSecret).update(`pay:${appointmentId}`).digest('base64url').slice(0, 32);
}

/** Where a customer goes to pay: their appointment page when they
 *  have an account, a tokened page when they booked as a guest. */
export function payLink(appointmentId: string, clientUserId: string | null, slug: string | null): string {
  return clientUserId
    ? `${env.consumerAppUrl}/account/appointments/${appointmentId}`
    : `${env.consumerAppUrl}/pay/${appointmentId}?t=${guestPayToken(appointmentId)}&s=${encodeURIComponent(slug ?? '')}`;
}

/** The salon's context for a message: its name and the owner's e-mail. */
async function salonOf(trx: Trx, tenantId: string) {
  const b = await trx
    .selectFrom('businesses')
    .select(['name', 'slug', 'ownerEmployeeId'])
    .where('id', '=', tenantId)
    .executeTakeFirstOrThrow();
  const owner = b.ownerEmployeeId
    ? await trx.selectFrom('employees').select('email').where('id', '=', b.ownerEmployeeId).executeTakeFirst()
    : undefined;
  return { name: b.name, slug: b.slug, ownerEmail: owner?.email ?? null };
}

export interface BookedVisitCtx {
  tenantId: string;
  booked: Appointment[];
  customerName: string;
  customerEmail: string | null;
  clientUserId: string | null;
}

/** What the client's bell should say after a booking — the route rings
 *  it outside the tenant transaction (it lives in the client's world). */
export interface ClientNotice {
  kind: string;
  title: string;
  body: string;
  refType: 'appointment';
  refId: string;
}

/**
 * After a Velnes-app booking landed (booked or requested): the salon's
 * bell, the owner's mail for a request, the customer's mail. Returns
 * the notice for the customer's own bell when they have an account.
 * Runs inside the tenant transaction so a refused booking leaves no
 * message behind.
 */
export async function afterBooked(trx: Trx, ctx: BookedVisitCtx): Promise<ClientNotice | null> {
  const first = ctx.booked[0];
  if (!first) return null;
  const requested = first.status === 'requested';
  const salon = await salonOf(trx, ctx.tenantId);
  const what = ctx.booked.map((a) => a.serviceName ?? '').filter(Boolean).join(' + ') || 'an appointment';
  const when = `${first.date} at ${first.start}`;
  const loc = await trx.selectFrom('locations').select('name').where('id', '=', first.locationId).executeTakeFirst();

  await notifySalon(trx, ctx.tenantId, {
    kind: requested ? 'booking_request' : 'booking',
    title: requested ? 'New booking request from Velnes' : 'New booking from Velnes',
    body: requested
      ? `${ctx.customerName} asked for ${what} on ${when}. Accept or decline it in the calendar.`
      : `${ctx.customerName} booked ${what} on ${when}.`,
    refId: first.id,
  });

  if (requested && salon.ownerEmail)
    await queueMail(trx, {
      tenantId: ctx.tenantId,
      to: salon.ownerEmail,
      subject: `New booking request — ${ctx.customerName}`,
      body: `${ctx.customerName} asked for ${what} on ${when} at ${loc?.name ?? salon.name}.\n\nOpen Velnes › Calendar to accept or decline the request. The customer is told either way, and pays only once you accept.`,
      kind: 'booking_request',
      refId: first.id,
    });

  if (ctx.customerEmail)
    await queueMail(trx, {
      tenantId: ctx.tenantId,
      to: ctx.customerEmail,
      subject: requested ? `Request sent to ${salon.name}` : `Booked at ${salon.name}`,
      body: requested
        ? `Your request for ${what} on ${when} is with ${salon.name}. They confirm requests themselves — you will get an e-mail as soon as they answer, and you pay only once it is accepted.`
        : `${what} on ${when} at ${salon.name} is booked.\n\nSee the appointment or pay for it here: ${payLink(first.id, ctx.clientUserId, salon.slug)}`,
      kind: requested ? 'booking_requested' : 'booking_confirmed',
      refId: first.id,
    });

  if (!ctx.clientUserId) return null;
  return {
    kind: 'appointment',
    title: requested ? 'Request sent' : 'Booking confirmed',
    body: requested
      ? `${what} at ${salon.name} · ${when}. The salon confirms requests itself; you will hear back here.`
      : `${what} at ${salon.name} · ${when}.`,
    refType: 'appointment',
    refId: first.id,
  };
}

/**
 * After the salon decided: the customer's mail — the acceptance one
 * carries the payment link — and the notice for their bell.
 */
export async function afterDecided(
  trx: Trx,
  tenantId: string,
  a: Appointment,
  decision: 'accept' | 'decline',
  reason: string | undefined,
  customer: { name: string; email: string | null; clientUserId: string | null },
): Promise<ClientNotice | null> {
  const salon = await salonOf(trx, tenantId);
  const what = a.serviceName ?? 'your appointment';
  const when = `${a.date} at ${a.start}`;
  const accepted = decision === 'accept';
  const link = payLink(a.id, customer.clientUserId, salon.slug);

  if (customer.email)
    await queueMail(trx, {
      tenantId,
      to: customer.email,
      subject: accepted ? `${salon.name} accepted your booking` : `${salon.name} could not take your booking`,
      body: accepted
        ? `${salon.name} accepted ${what} on ${when}.\n\nPay for it here: ${link}\n\nYou can also pay at the salon.`
        : `${salon.name} could not take ${what} on ${when}.${reason ? `\n\nTheir note: ${reason}` : ''}\n\nNothing was charged. Pick another time here: ${env.consumerAppUrl}`,
      kind: accepted ? 'booking_accepted' : 'booking_declined',
      refId: a.id,
    });

  if (!customer.clientUserId) return null;
  return {
    kind: 'appointment',
    title: accepted ? 'Booking accepted — pay now' : 'Booking declined',
    body: accepted
      ? `${salon.name} accepted ${what} on ${when}. Pay online, or at the salon.`
      : `${salon.name} could not take ${what} on ${when}.${reason ? ` ${reason}` : ''}`,
    refType: 'appointment',
    refId: a.id,
  };
}
