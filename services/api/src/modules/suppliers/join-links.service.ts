import { SUPPLIER_JOIN_LINK_DAYS } from '@velnes/contracts';
import argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { db, withSupplier, type Trx } from '../../db/index.js';
import { env } from '../../env.js';
import { AuthError } from '../auth/auth.service.js';

/**
 * Supplier join links (Alex, 2026-10-07 — "the invite leads to the
 * login page and the supplier has no password yet; ask for the
 * password and the general info first, then log in").
 *
 * An invited supplier user (HQ's bootstrap owner, or a team member the
 * supplier invited) is created with a placeholder hash and status
 * `invited`; the login door refuses both. The invite mail now carries a
 * personal link: opening it shows who is invited and asks for a
 * password — and, for the first owner, the company's commercial
 * details — then activates the user and signs them in. Mirrors the
 * employee sign-in link: only a sha256 of the token is stored, a link
 * is single-use, expires after `SUPPLIER_JOIN_LINK_DAYS`, and minting
 * again revokes the old one.
 */

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export interface JoinCompany {
  contact: string;
  territory: string;
  lead: string;
  terms: string;
  minOrder: number;
}

/** Mint inside the caller's transaction (HQ or supplier context); any
 *  earlier unused link for that user stops working. */
export async function mintJoinLink(trx: Trx, supplierId: string, supplierUserId: string, createdBy: string) {
  await trx
    .updateTable('supplierJoinLinks')
    .set({ revokedAt: new Date() })
    .where('supplierUserId', '=', supplierUserId)
    .where('usedAt', 'is', null)
    .where('revokedAt', 'is', null)
    .execute();
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SUPPLIER_JOIN_LINK_DAYS * 86_400_000);
  await trx
    .insertInto('supplierJoinLinks')
    .values({ supplierId, supplierUserId, tokenHash: hashToken(token), createdBy, expiresAt })
    .execute();
  return { url: `${env.supplierAppUrl}/join/${token}`, expiresAt };
}

/** The mail every invite sends: the link is the only way in. */
export function joinMailBody(intro: string) {
  return `${intro}\n\nOpen the link below to choose your password and complete your details — then you are signed in. The link works once and expires in ${SUPPLIER_JOIN_LINK_DAYS} days; if it has, ask for a new invite.`;
}

async function lookup(token: string) {
  const row = await db.transaction().execute(async (trx) => {
    await sql`select set_config('app.auth', 'login', true)`.execute(trx);
    return trx
      .selectFrom('supplierJoinLinks as l')
      .innerJoin('supplierUsers as u', 'u.id', 'l.supplierUserId')
      .innerJoin('suppliers as s', 's.id', 'l.supplierId')
      .select([
        'l.id as linkId', 'l.supplierId', 'l.supplierUserId', 'l.expiresAt', 'l.usedAt', 'l.revokedAt',
        'u.name', 'u.email', 'u.role', 'u.status',
        's.name as supplierName', 's.contact', 's.territory', 's.lead', 's.terms', 's.minOrder',
      ])
      .where('l.tokenHash', '=', hashToken(token))
      .executeTakeFirst();
  });
  if (!row || row.usedAt || row.revokedAt || row.status !== 'invited') throw new AuthError('INVALID_LINK');
  if (row.expiresAt.getTime() < Date.now()) throw new AuthError('LINK_EXPIRED');
  // The first owner: nobody in this supplier has claimed a login yet.
  const others = await db.transaction().execute(async (trx) => {
    await sql`select set_config('app.auth', 'login', true)`.execute(trx);
    return trx
      .selectFrom('supplierUsers')
      .select(({ fn }) => fn.countAll<string>().as('n'))
      .where('supplierId', '=', row.supplierId)
      .where('status', '=', 'active')
      .executeTakeFirstOrThrow();
  });
  return { ...row, firstOwner: row.role === 'sr_owner' && Number(others.n) === 0 };
}

/** What the claim page shows before anything is typed. */
export async function peekJoinLink(token: string) {
  const r = await lookup(token);
  return {
    name: r.name,
    email: r.email,
    role: r.role,
    supplierName: r.supplierName,
    firstOwner: r.firstOwner,
    company: { contact: r.contact, territory: r.territory, lead: r.lead, terms: r.terms, minOrder: r.minOrder },
  };
}

/**
 * Claim: set the password, activate the user, complete the company
 * (first owner only), burn the link — one transaction under the link's
 * own supplier context. Returns the login-shaped user.
 */
export async function claimJoinLink(token: string, input: { name: string; password: string; company?: JoinCompany | undefined }) {
  const r = await lookup(token);
  const passwordHash = await argon2.hash(input.password);
  return withSupplier(r.supplierId, async (trx) => {
    // Re-check under the row lock: two tabs cannot both claim.
    const fresh = await trx
      .selectFrom('supplierJoinLinks')
      .select(['usedAt', 'revokedAt'])
      .where('id', '=', r.linkId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (fresh.usedAt || fresh.revokedAt) throw new AuthError('INVALID_LINK');
    await trx.updateTable('supplierJoinLinks').set({ usedAt: new Date() }).where('id', '=', r.linkId).execute();
    await trx
      .updateTable('supplierUsers')
      .set({ name: input.name, passwordHash, status: 'active' })
      .where('id', '=', r.supplierUserId)
      .execute();
    if (r.firstOwner && input.company) {
      await trx
        .updateTable('suppliers')
        .set({
          contact: input.company.contact,
          territory: input.company.territory,
          lead: input.company.lead,
          terms: input.company.terms,
          minOrder: input.company.minOrder,
        })
        .where('id', '=', r.supplierId)
        .execute();
    }
    return {
      id: r.supplierUserId,
      name: input.name,
      email: r.email,
      role: r.role,
      supplierId: r.supplierId,
      supplierName: r.supplierName,
    };
  });
}
