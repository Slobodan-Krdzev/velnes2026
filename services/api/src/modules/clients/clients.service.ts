import { randomInt } from 'node:crypto';
import { CLIENT_CODE_LENGTH, type ClientProfile } from '@velnes/contracts';
import argon2 from 'argon2';
import { sql } from 'kysely';
import { db, withClient, withClientAuth, withTenant, type Trx } from '../../db/index.js';
import { queueMail } from '../mail/mail.service.js';

/** Client users: the consumer account. Registration, the email code,
 *  the session, the profile — and the bridge that turns a client into a
 *  salon's customer the first time they book there. */

export class ClientError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const norm = (email: string) => email.trim().toLowerCase();
const isoDate = (d: Date | string | null) =>
  d ? (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10)) : null;

interface ClientRow {
  id: string;
  email: string;
  first: string;
  last: string;
  phone: string | null;
  dob: Date | null;
  lang: string;
  avatar: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

export function toProfile(c: ClientRow): ClientProfile {
  return {
    id: c.id,
    email: c.email,
    emailVerified: c.emailVerifiedAt !== null,
    first: c.first,
    last: c.last,
    phone: c.phone,
    dob: isoDate(c.dob),
    lang: (['en', 'mk', 'sq'].includes(c.lang) ? c.lang : 'en') as 'en' | 'mk' | 'sq',
    avatar: c.avatar,
    since: isoDate(c.createdAt)!,
  };
}

const newCode = () =>
  String(randomInt(0, 10 ** CLIENT_CODE_LENGTH)).padStart(CLIENT_CODE_LENGTH, '0');

async function sendCode(trx: Trx, email: string, first: string, code: string) {
  await queueMail(trx, {
    to: email,
    subject: 'Your Velnes verification code',
    body:
      `Hi${first ? ` ${first}` : ''},\n\n` +
      `Your Velnes verification code is ${code}.\n\n` +
      `It confirms this is your email address. If you did not create a Velnes ` +
      `account, you can ignore this message.`,
    kind: 'client_email_verify',
  });
}

/**
 * Register, or quietly re-send a code to an unverified account. The
 * answer is the same either way: the app must never become an oracle
 * for which addresses have accounts.
 */
export async function registerClient(input: {
  email: string;
  password: string;
  first: string;
  last: string;
  phone: string;
  dob: string | null;
  lang: 'en' | 'mk' | 'sq';
}): Promise<void> {
  const email = norm(input.email);
  const passwordHash = await argon2.hash(input.password);
  const code = newCode();
  await withClientAuth(async (trx) => {
    const existing = await trx
      .selectFrom('clientUsers')
      .selectAll()
      .where(sql<boolean>`lower(email) = ${email}`)
      .executeTakeFirst();
    if (existing) {
      // A verified account: say nothing new, send nothing. An
      // unverified one: refresh the code so a lost email recovers.
      if (existing.emailVerifiedAt) return;
      await trx
        .updateTable('clientUsers')
        .set({ emailCode: code, emailCodeSentAt: new Date(), passwordHash })
        .where('id', '=', existing.id)
        .execute();
      await sendCode(trx, existing.email, existing.first, code);
      return;
    }
    const row = await trx
      .insertInto('clientUsers')
      .values({
        email,
        passwordHash,
        first: input.first.trim(),
        last: input.last.trim(),
        phone: input.phone.trim() || null,
        dob: input.dob,
        lang: input.lang,
        emailCode: code,
        emailCodeSentAt: new Date(),
      })
      .returning(['id', 'email', 'first'])
      .executeTakeFirstOrThrow();
    await sendCode(trx, row.email, row.first, code);
  });
}

export async function resendClientCode(emailIn: string): Promise<void> {
  const email = norm(emailIn);
  const code = newCode();
  await withClientAuth(async (trx) => {
    const c = await trx
      .selectFrom('clientUsers')
      .selectAll()
      .where(sql<boolean>`lower(email) = ${email}`)
      .executeTakeFirst();
    if (!c || c.emailVerifiedAt) return;
    await trx
      .updateTable('clientUsers')
      .set({ emailCode: code, emailCodeSentAt: new Date() })
      .where('id', '=', c.id)
      .execute();
    await sendCode(trx, c.email, c.first, code);
  });
}

/** The code gate. Wrong code, expired code and unknown address all
 *  answer the same way — no oracle. */
export async function verifyClientEmail(emailIn: string, code: string): Promise<ClientRow> {
  const email = norm(emailIn);
  return withClientAuth(async (trx) => {
    const c = await trx
      .selectFrom('clientUsers')
      .selectAll()
      .where(sql<boolean>`lower(email) = ${email}`)
      .executeTakeFirst();
    const fresh =
      c?.emailCodeSentAt && Date.now() - c.emailCodeSentAt.getTime() < 24 * 60 * 60 * 1000;
    if (!c || !c.emailCode || c.emailCode !== code || !fresh)
      throw new ClientError('BAD_CODE', 'That code is not right, or it has expired');
    const row = await trx
      .updateTable('clientUsers')
      .set({ emailVerifiedAt: c.emailVerifiedAt ?? new Date(), emailCode: null })
      .where('id', '=', c.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return row as ClientRow;
  });
}

/** An unverified account cannot sign in: the code is the gate. */
export async function loginClient(emailIn: string, password: string): Promise<ClientRow> {
  const email = norm(emailIn);
  const c = await withClientAuth((trx) =>
    trx
      .selectFrom('clientUsers')
      .selectAll()
      .where(sql<boolean>`lower(email) = ${email}`)
      .executeTakeFirst(),
  );
  // Always burn a verification so an unknown address takes as long as
  // a known one (the employee door's rule).
  const hash =
    c?.passwordHash ??
    '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const ok = await argon2.verify(hash, password).catch(() => false);
  if (!c || !ok) throw new ClientError('BAD_LOGIN', 'That email and password do not match');
  if (!c.emailVerifiedAt)
    throw new ClientError('EMAIL_UNVERIFIED', 'Confirm your email address first');
  return c as ClientRow;
}

export async function clientById(id: string): Promise<ClientRow> {
  const c = await withClient(id, (trx) =>
    trx.selectFrom('clientUsers').selectAll().where('id', '=', id).executeTakeFirst(),
  );
  if (!c) throw new ClientError('NOT_FOUND', 'Unknown account');
  return c as ClientRow;
}

export async function changeClientPassword(id: string, current: string, next: string) {
  const c = await clientById(id);
  const row = await withClient(id, (trx) =>
    trx.selectFrom('clientUsers').select('passwordHash').where('id', '=', id).executeTakeFirstOrThrow(),
  );
  const ok = await argon2.verify(row.passwordHash, current).catch(() => false);
  if (!ok) throw new ClientError('BAD_PASSWORD', 'Your current password is not right');
  const passwordHash = await argon2.hash(next);
  await withClient(id, (trx) =>
    trx.updateTable('clientUsers').set({ passwordHash }).where('id', '=', id).execute(),
  );
  await notifyClient(id, {
    kind: 'account',
    title: 'Password changed',
    body: `The password for ${c.email} was changed.`,
    refType: 'general',
  });
}

/** A line in the client's own bell feed. Written from the client's own
 *  context — the salon side writes these from its tenant context. */
export async function notifyClient(
  clientUserId: string,
  n: { kind: string; title: string; body: string; refType?: string; refId?: string },
) {
  await withClient(clientUserId, (trx) =>
    trx
      .insertInto('clientNotifications')
      .values({
        clientUserId,
        kind: n.kind,
        title: n.title,
        body: n.body,
        refType: n.refType ?? null,
        refId: n.refId ?? null,
      })
      .execute(),
  );
}

/**
 * The bridge, and the answer to "when does someone become a customer?"
 * — when they book. Called inside the salon's own transaction: find
 * this salon's existing customer for the person (by link, then by
 * email, then by phone), else create one. The salon keeps owning its
 * customer row; the link just remembers whose account it belongs to.
 */
export async function linkCustomer(
  trx: Trx,
  tenantId: string,
  client: { id: string; email: string; first: string; last: string; phone: string | null },
): Promise<string> {
  const name = `${client.first} ${client.last}`.trim() || client.email;
  const link = await trx
    .selectFrom('clientCustomerLinks')
    .select('customerId')
    .where('clientUserId', '=', client.id)
    .where('tenantId', '=', tenantId)
    .executeTakeFirst();
  if (link) {
    // Keep the salon's copy of the contact details current.
    await trx
      .updateTable('customers')
      .set({ email: client.email, ...(client.phone ? { phone: client.phone } : {}) })
      .where('id', '=', link.customerId)
      .execute();
    return link.customerId;
  }
  // The salon may already know this person from a guest booking —
  // adopt that row rather than creating a duplicate.
  const byEmail = await trx
    .selectFrom('customers')
    .select('id')
    .where(sql<boolean>`lower(customers.email) = ${client.email}`)
    .executeTakeFirst();
  const existing =
    byEmail ??
    (client.phone
      ? await trx
          .selectFrom('customers')
          .select('id')
          .where('phone', '=', client.phone)
          .executeTakeFirst()
      : undefined);
  const customerId =
    existing?.id ??
    (
      await trx
        .insertInto('customers')
        .values({
          tenantId,
          name,
          email: client.email,
          phone: client.phone,
          custGroup: 'New',
          since: new Date(),
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  await trx
    .insertInto('clientCustomerLinks')
    .values({ clientUserId: client.id, tenantId, customerId })
    .onConflict((oc) => oc.columns(['clientUserId', 'tenantId']).doNothing())
    .execute();
  return customerId;
}

/** The salon's own bell: a client booking or cancelling is news. */
export async function notifySalon(
  trx: Trx,
  tenantId: string,
  n: { kind: string; title: string; body: string; refId?: string },
) {
  await trx
    .insertInto('platformNotices')
    .values({
      audience: 'salons',
      tenantId,
      kind: n.kind,
      title: n.title,
      body: n.body,
      refId: n.refId ?? null,
    })
    .execute();
}

/** Every salon this client is a customer of — the bridge from their
 *  side, read across tenants under their own context. */
export async function clientSalons(clientUserId: string) {
  const links = await withClient(clientUserId, (trx) =>
    trx
      .selectFrom('clientCustomerLinks')
      .select(['tenantId', 'customerId', 'createdAt'])
      .execute(),
  );
  const out = [];
  for (const l of links) {
    const biz = await db.transaction().execute(async (trx) => {
      await sql`select set_config('app.public', '1', true)`.execute(trx);
      return trx
        .selectFrom('businesses')
        .select(['name', 'slug'])
        .where('id', '=', l.tenantId)
        .executeTakeFirst();
    });
    const visits = await withClient(clientUserId, (trx) =>
      trx
        .selectFrom('appointments')
        .select(({ fn }) => fn.countAll<string>().as('n'))
        .where('clientUserId', '=', clientUserId)
        .where('tenantId', '=', l.tenantId)
        .executeTakeFirst(),
    );
    if (biz)
      out.push({
        slug: biz.slug,
        name: biz.name,
        visits: Number(visits?.n ?? 0),
        since: isoDate(l.createdAt)!,
      });
  }
  return out;
}

export { withTenant };
