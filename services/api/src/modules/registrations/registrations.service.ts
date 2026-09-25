import { randomUUID } from 'node:crypto';
import {
  ownerPermMap,
  type PermMap,
  type RegistrationDraft,
  REG_COUNTRY_NAMES,
} from '@velnes/contracts';
import argon2 from 'argon2';
import { sql } from 'kysely';
import { db, withHq, type Trx } from '../../db/index.js';
import { env } from '../../env.js';
import { logAudit } from '../audit/audit.service.js';
import { locReadiness, locTransition } from '../locations/locations.service.js';
import { queueMail } from '../mail/mail.service.js';
import { standardRoles } from '../team/role-kits.js';
import { mintSignInLink } from '../auth/sign-in-link.service.js';

export class RegistrationError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'WRONG_STATE' | 'REASON_REQUIRED' | 'EMAIL_TAKEN',
    message: string,
  ) {
    super(message);
  }
}

/** Where every mail to the applicant points: the workspace's status
 *  page, unlocked by the e-mail token. One link for the whole journey —
 *  the page reads where the machine stands and shows that. */
const statusUrl = (id: string, emailToken: string) =>
  `${env.workspaceAppUrl}/registration/${id}?token=${emailToken}`;

/** The verification mail: sent at registration, and again whenever the
 *  applicant resubmits under a different address. Tenant-less — no
 *  salon exists yet. */
async function queueVerifyMail(trx: Trx, id: string, emailToken: string, draft: RegistrationDraft) {
  await queueMail(trx, {
    tenantId: null,
    to: draft.acct.email,
    subject: `Confirm your e-mail for ${draft.salon.name}`,
    body:
      `Hi ${draft.acct.name},\n\n` +
      `Thank you for registering ${draft.salon.name} on Velnes. Confirm this e-mail address with the button below.\n\n` +
      `After that, Revelapps HQ reviews every new salon before it goes live — we will e-mail you here the moment that is done.`,
    kind: 'registration_verify',
    refId: id,
    cta: { label: 'Confirm my e-mail', url: statusUrl(id, emailToken) },
  });
}

/** Owner role: every permission at its widest legal scope — the kit in
 *  @velnes/contracts. Kept as a name for the callers that grew up on it. */
export const ownerPerms = (): PermMap => ownerPermMap();

/** mon..sun (wizard) → weekday index 0..6 (locations.hours). */
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
function hoursFromDraft(draft: RegistrationDraft): Record<string, [string, string][] | null> {
  const out: Record<string, [string, string][] | null> = {};
  DAY_KEYS.forEach((k, i) => {
    const d = draft.hours[k];
    if (!d || d.closed) {
      out[String(i)] = null;
      return;
    }
    out[String(i)] = d.split
      ? [
          [d.open, d.close],
          [d.open2, d.close2],
        ]
      : [[d.open, d.close]];
  });
  return out;
}

/** The application door — anonymous, one row, the whole draft. */
export async function createRegistration(draft: RegistrationDraft) {
  // One account per email across the platform: check the login door's
  // view of the world the same way login does.
  const taken = await db.transaction().execute(async (trx) => {
    await sql`select set_config('app.auth', 'login', true)`.execute(trx);
    return trx
      .selectFrom('employees')
      .select('id')
      .where(sql<boolean>`lower(email) = lower(${draft.acct.email})`)
      .executeTakeFirst();
  });
  if (taken)
    throw new RegistrationError(
      'EMAIL_TAKEN',
      'That e-mail address already has an account — sign in instead',
    );

  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.public', '1', true)`.execute(trx);
    const id = randomUUID();
    const resubmitToken = randomUUID();
    const emailToken = randomUUID();
    await trx
      .insertInto('registrations')
      .values({
        id,
        draft: JSON.stringify(draft),
        resubmitToken,
        emailToken,
        emailSentAt: new Date(),
        log: JSON.stringify([{ to: 'pending_review', at: new Date().toISOString() }]),
      })
      .execute();
    await queueVerifyMail(trx, id, emailToken, draft);
    return { id, status: 'pending_review' as const, resubmitToken };
  });
}

/**
 * The e-mail link's door: confirm the address — once; a second click
 * keeps the first stamp — and say where the machine stands. A wrong
 * token sees nothing, by RLS. Hands back the resubmit token too, so the
 * mail is a way back into the wizard from any device.
 */
export async function verifyRegistrationEmail(id: string, token: string) {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.reg_email_token', ${token}, true)`.execute(trx);
    const row = await trx
      .selectFrom('registrations')
      .select(['id', 'status', 'hqReason', 'draft', 'resubmitToken', 'emailVerifiedAt'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) return null;
    const verifiedAt = row.emailVerifiedAt ?? new Date();
    if (!row.emailVerifiedAt)
      await trx.updateTable('registrations').set({ emailVerifiedAt: verifiedAt }).where('id', '=', id).execute();
    const draft = row.draft as RegistrationDraft;
    return {
      id: row.id,
      status: row.status,
      hqReason: row.hqReason,
      salonName: draft.salon.name,
      email: draft.acct.email,
      resubmitToken: row.resubmitToken,
      verifiedAt: verifiedAt.toISOString(),
    };
  });
}

/** The applicant's own row, unlocked by the resubmit token (RLS). */
export async function registrationByToken(id: string, token: string) {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.reg_token', ${token}, true)`.execute(trx);
    return trx.selectFrom('registrations').selectAll().where('id', '=', id).executeTakeFirst();
  });
}

export async function resubmitRegistration(id: string, token: string, draft: RegistrationDraft) {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.reg_token', ${token}, true)`.execute(trx);
    const row = await trx
      .selectFrom('registrations')
      .select(['id', 'status', 'log', 'draft', 'emailToken'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new RegistrationError('NOT_FOUND', 'Unknown registration');
    if (row.status !== 'changes_required')
      throw new RegistrationError('WRONG_STATE', 'Only a sent-back registration can be resubmitted');
    // A different address is an unconfirmed one: fresh token, fresh mail.
    const before = (row.draft as RegistrationDraft).acct.email.trim().toLowerCase();
    const emailChanged = before !== draft.acct.email.trim().toLowerCase();
    const emailToken = emailChanged ? randomUUID() : row.emailToken;
    await trx
      .updateTable('registrations')
      .set({
        status: 'resubmitted',
        draft: JSON.stringify(draft),
        hqReason: null,
        ts: new Date(),
        ...(emailChanged ? { emailToken, emailVerifiedAt: null, emailSentAt: new Date() } : {}),
        log: JSON.stringify([
          ...(row.log as unknown[]),
          { from: 'changes_required', to: 'resubmitted', at: new Date().toISOString() },
        ]),
      })
      .where('id', '=', id)
      .execute();
    if (emailChanged) await queueVerifyMail(trx, id, emailToken, draft);
    return { id, status: 'resubmitted' as const };
  });
}

/** HQ decisions. Request-changes demands a reason the owner can act
 *  on; decline is exceptional; approve provisions the tenant world. */
export async function reviewRegistration(
  id: string,
  action: 'request_changes' | 'decline',
  reviewer: string,
  reason?: string,
) {
  if (action === 'request_changes' && !reason?.trim())
    throw new RegistrationError('REASON_REQUIRED', 'Request changes needs a reason the owner can act on');
  return withHq(async (trx) => {
    const row = await trx
      .selectFrom('registrations')
      .select(['id', 'status', 'log', 'draft', 'emailToken'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new RegistrationError('NOT_FOUND', 'Unknown registration');
    if (row.status !== 'pending_review' && row.status !== 'resubmitted' && row.status !== 'under_review')
      throw new RegistrationError('WRONG_STATE', `A ${row.status} registration cannot be reviewed`);
    const to = (action === 'request_changes' ? 'changes_required' : 'declined') as
      | 'changes_required'
      | 'declined';
    await trx
      .updateTable('registrations')
      .set({
        status: to,
        hqReason: reason ?? null,
        reviewedBy: reviewer,
        reviewedAt: new Date(),
        log: JSON.stringify([
          ...(row.log as unknown[]),
          { from: row.status, to, by: reviewer, reason: reason ?? null, at: new Date().toISOString() },
        ]),
      })
      .where('id', '=', id)
      .execute();
    // The decision reaches the applicant by mail — the same link as the
    // verification mail, so the status page tells them what to do next.
    const draft = row.draft as RegistrationDraft;
    if (to === 'changes_required')
      await queueMail(trx, {
        tenantId: null,
        to: draft.acct.email,
        subject: `Revelapps HQ asks for a change to ${draft.salon.name}`,
        body:
          `Hi ${draft.acct.name},\n\n` +
          `Revelapps HQ reviewed the registration of ${draft.salon.name} and needs one thing corrected before it can go live:\n\n` +
          `${reason!.trim()}\n\n` +
          `Everything you filled in is still there — open the wizard, correct it and resubmit.`,
        kind: 'registration_changes',
        refId: row.id,
        cta: { label: 'Review and resubmit', url: statusUrl(row.id, row.emailToken) },
      });
    else
      await queueMail(trx, {
        tenantId: null,
        to: draft.acct.email,
        subject: `Your Velnes registration for ${draft.salon.name} was declined`,
        body:
          `Hi ${draft.acct.name},\n\n` +
          `Revelapps HQ declined the registration of ${draft.salon.name}.` +
          (reason?.trim() ? `\n\n${reason.trim()}` : '') +
          `\n\nYou can start a new registration at any time.`,
        kind: 'registration_declined',
        refId: row.id,
      });
    return { id, status: to };
  });
}

/**
 * Approval provisions the whole tenant world in one transaction:
 * business, the Owner and Employee roles, owner account with the
 * wizard's password, legal entity (verified — the compound decision),
 * the location, the picked services (online), the products, and a live
 * booking widget. Then, if the readiness gate is satisfied — it is,
 * for any wizard draft — the location goes ACTIVE right here: an
 * approved salon is bookable the same minute (Alex, 2026-09-22),
 * nothing waits for the owner. A draft that somehow is not ready stays
 * at APPROVED with the readiness checklist telling the owner why.
 */
export async function approveRegistration(id: string, reviewer: string) {
  return db.transaction().execute(async (trx: Trx) => {
    await sql`select set_config('app.hq', '1', true)`.execute(trx);
    const row = await trx
      .selectFrom('registrations')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new RegistrationError('NOT_FOUND', 'Unknown registration');
    if (row.businessId) {
      // Already approved — hand back the same world, never a double.
      await sql`select set_config('app.tenant_id', ${row.businessId}, true)`.execute(trx);
      const loc = await trx
        .selectFrom('locations')
        .select('id')
        .where('tenantId', '=', row.businessId)
        .executeTakeFirstOrThrow();
      return {
        businessId: row.businessId,
        locationId: loc.id,
        ownerEmail: (row.draft as RegistrationDraft).acct.email,
      };
    }
    if (row.status !== 'pending_review' && row.status !== 'resubmitted' && row.status !== 'under_review')
      throw new RegistrationError('WRONG_STATE', `A ${row.status} registration cannot be approved`);

    const draft = row.draft as RegistrationDraft;
    const businessId = randomUUID();
    await sql`select set_config('app.tenant_id', ${businessId}, true)`.execute(trx);

    // A booking-page slug from the salon's name, made unique.
    const base =
      draft.salon.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'salon';
    let slug = base;
    for (let n = 2; ; n++) {
      const taken = await trx
        .selectFrom('businesses')
        .select('id')
        .where('slug', '=', slug)
        .executeTakeFirst();
      if (!taken) break;
      slug = `${base}-${n}`;
    }

    await trx
      .insertInto('businesses')
      .values({
        id: businessId,
        name: draft.salon.name,
        slug,
        city: draft.loc.city,
        phone: draft.salon.phone || null,
        country: REG_COUNTRY_NAMES[draft.loc.country],
        since: new Date(),
        // The photos the owner brought in (AI onboarding read them off the
        // website, or they uploaded them) become the business gallery; the
        // one they marked is the salon's card in the consumer app.
        gallery: JSON.stringify(
          draft.gallery.map((g, i) => ({
            id: randomUUID(),
            name: g.name || `Photo ${i + 1}`,
            img: g.img,
            ...(g.card ? { card: true } : {}),
          })),
        ),
      })
      .execute();

    const { ownerRoleId, employeeRoleId } = await standardRoles(trx, businessId);

    const ownerId = randomUUID();
    await trx
      .insertInto('employees')
      .values({
        id: ownerId,
        tenantId: businessId,
        name: draft.acct.name,
        roleTitle: 'Owner',
        email: draft.acct.email,
        phone: draft.salon.phone || null,
        access: 'owner',
        roleId: ownerRoleId,
        bookable: true,
        status: 'active',
        color: 'olive',
        hours: JSON.stringify(hoursFromDraft(draft)),
      })
      .execute();
    await trx
      .updateTable('businesses')
      .set({ ownerEmployeeId: ownerId })
      .where('id', '=', businessId)
      .execute();
    await trx
      .insertInto('userCredentials')
      .values({
        employeeId: ownerId,
        tenantId: businessId,
        passwordHash: await argon2.hash(draft.acct.pass),
      })
      .execute();

    // The compound decision: approving the salon verifies its entity.
    const legalId = randomUUID();
    await trx
      .insertInto('legalEntities')
      .values({
        id: legalId,
        tenantId: businessId,
        ownerType: 'salon',
        isDefault: true,
        name: draft.legal.name,
        taxId: draft.legal.taxId || null,
        vatReg: draft.legal.vat || null,
        currency: draft.legal.currency || 'MKD',
        status: 'verified',
      })
      .execute();

    const locationId = randomUUID();
    await trx
      .insertInto('locations')
      .values({
        id: locationId,
        tenantId: businessId,
        name: draft.salon.name,
        city: draft.loc.city,
        address: `${draft.loc.street} ${draft.loc.no}`.trim(),
        zip: draft.loc.zip || null,
        country: REG_COUNTRY_NAMES[draft.loc.country],
        tz: 'Europe/Skopje',
        phone: draft.salon.phone || null,
        rooms: 2,
        invPrefix: `${draft.salon.name.slice(0, 3).toUpperCase()}-`,
        online: false, // flipped by the ACTIVE transition below
        cancelHours: 24,
        lifecycle: 'APPROVED', // → ACTIVE at the end of this transaction
        hours: JSON.stringify(hoursFromDraft(draft)),
        // The pin the owner dropped on the map in the wizard — kept, not
        // discarded: it is what the consumer app's map obeys.
        lat: draft.loc.lat,
        lng: draft.loc.lng,
      })
      .execute();
    await trx
      .insertInto('legalEntityLocations')
      .values({ tenantId: businessId, legalEntityId: legalId, locationId })
      .execute();
    await trx
      .insertInto('employeeLocations')
      .values({ tenantId: businessId, employeeId: ownerId, locationId })
      .execute();

    // The salon's own services, each on the Velnes taxonomy: the
    // category is a platform row (find-or-create under app.hq), the
    // name/price/duration are the salon's.
    const catIds = new Map<string, string>();
    for (const cat of [...new Set(draft.services.map((s) => s.category))]) {
      const found = await trx
        .selectFrom('serviceCategories')
        .select('id')
        .where('name', '=', cat)
        .executeTakeFirst();
      if (found) {
        catIds.set(cat, found.id);
      } else {
        const made = await trx
          .insertInto('serviceCategories')
          .values({ name: cat })
          .returning('id')
          .executeTakeFirstOrThrow();
        catIds.set(cat, made.id);
      }
    }
    for (const [i, s] of draft.services.entries())
      await trx
        .insertInto('services')
        .values({
          tenantId: businessId,
          name: s.name,
          categoryId: catIds.get(s.category)!,
          durationMin: s.durationMin,
          price: s.price,
          vat: 18,
          status: 'active',
          pos: true,
          online: true, // on offer to the public from the first minute
          sort: i,
        })
        .execute();

    // The salon's own products, on the product taxonomy. Stock starts
    // at 0 — a deliberate first count, never a guess.
    const prodCatIds = new Map<string, string>();
    for (const cat of [...new Set(draft.products.map((p) => p.category))]) {
      const found = await trx
        .selectFrom('productCategories')
        .select('id')
        .where('name', '=', cat)
        .executeTakeFirst();
      prodCatIds.set(
        cat,
        found?.id ??
          (
            await trx
              .insertInto('productCategories')
              .values({ name: cat })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id,
      );
    }
    for (const p of draft.products) {
      const prod = await trx
        .insertInto('products')
        .values({
          tenantId: businessId,
          name: p.name,
          categoryId: prodCatIds.get(p.category)!,
          price: p.price,
          cost: p.cost,
          ...(p.sizeMl != null ? { sizeAmount: p.sizeMl, sizeUnit: 'ml' } : {}),
          vat: 18,
          active: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('locationCatalogProducts')
        .values({
          tenantId: businessId,
          locationId,
          productId: prod.id,
          active: true,
          price: p.price,
          pos: true,
          stock: p.stock,
        })
        .execute();
      // Opening stock is a movement like any other, so the stock room's
      // history starts at the truth rather than at an unexplained number.
      if (p.stock > 0)
        await trx
          .insertInto('stockMovements')
          .values({
            tenantId: businessId,
            locationId,
            productId: prod.id,
            qty: p.stock,
            kind: 'adjustment',
            ref: 'registration',
            note: 'Opening stock',
          })
          .execute();
    }

    // The colleagues invited in the wizard. Each becomes an invited,
    // non-bookable staff member linked to the location (the prototype's
    // "invited by e-mail" — bookable, hours and skills are the owner's
    // to fill in under Settings › Team). Email is globally unique, so an
    // address already in use anywhere — the owner's own included — is
    // skipped rather than aborting the whole approval.
    const PALETTE = ['clay', 'rose', 'sage', 'lilac', 'sky', 'sand', 'stone'];
    const usedEmails = new Set([draft.acct.email.trim().toLowerCase()]);
    let colorIdx = 0;
    for (const member of draft.team) {
      const email = member.email.trim();
      const name = member.name.trim();
      if (!email || !name) continue;
      const lower = email.toLowerCase();
      if (usedEmails.has(lower)) continue;
      const taken = await trx
        .selectFrom('employees')
        .select('id')
        .where(sql<boolean>`lower(email) = ${lower}`)
        .executeTakeFirst();
      if (taken) continue;
      usedEmails.add(lower);
      const memberId = randomUUID();
      await trx
        .insertInto('employees')
        .values({
          id: memberId,
          tenantId: businessId,
          name,
          roleTitle: 'New user',
          email,
          phone: null,
          access: 'staff',
          roleId: employeeRoleId,
          bookable: false,
          status: 'invited',
          color: PALETTE[colorIdx % PALETTE.length]!,
          hours: JSON.stringify(hoursFromDraft(draft)),
        })
        .execute();
      colorIdx += 1;
      await trx
        .insertInto('employeeLocations')
        .values({ tenantId: businessId, employeeId: memberId, locationId })
        .execute();
      const link = await mintSignInLink(trx, businessId, memberId, null);
      await queueMail(trx, {
        tenantId: businessId,
        to: email,
        subject: 'You are invited to Velnes',
        body: `${draft.salon.name} invited you to join their team on Velnes.\n\nOpen the button below on your phone: it signs you straight into the salon and asks you to choose a password once. The link works once and is valid for 7 days.`,
        kind: 'employee_invite',
        refId: memberId,
        cta: { label: 'Sign in on your phone', url: link.url },
      });
    }

    await trx
      .updateTable('registrations')
      .set({
        status: 'active',
        reviewedBy: reviewer,
        reviewedAt: new Date(),
        businessId,
        hqReason: null,
        log: JSON.stringify([
          ...(row.log as unknown[]),
          { from: row.status, to: 'active', by: reviewer, at: new Date().toISOString() },
        ]),
      })
      .where('id', '=', id)
      .execute();

    // The owner hears it from us, not by refreshing the wizard: the
    // same link as the verification mail now leads to sign-in and on to
    // the flightdeck.
    await queueMail(trx, {
      tenantId: businessId,
      to: draft.acct.email,
      subject: `${draft.salon.name} is live on Velnes`,
      body:
        `Hi ${draft.acct.name},\n\n` +
        `Revelapps HQ approved ${draft.salon.name}. Your salon, your catalog and your location are ready, and customers can book from this minute.\n\n` +
        `Sign in with this e-mail and the password you chose at registration to open your flightdeck.`,
      kind: 'registration_approved',
      refId: id,
      cta: { label: 'Open your flightdeck', url: statusUrl(id, row.emailToken) },
    });

    await logAudit(trx, businessId, {
      actorEmployeeId: null,
      actorName: `HQ · ${reviewer}`,
      action: 'Salon registration activated',
      object: `Registration · ${draft.salon.name}`,
      before: row.status,
      after: 'active',
    });

    await publishSalon(trx, { businessId, locationId, actorName: reviewer, reason: 'Registration approved' });

    return { businessId, locationId, ownerEmail: draft.acct.email };
  });
}

/**
 * Publish a salon: what "approved" has meant since 2026-09-22. One
 * function, idempotent, so registration approval and the repair tool
 * for salons approved before that day (`src/db/publish-salon.ts`)
 * cannot disagree:
 *
 *  - every active service goes online (the wizard's are already);
 *  - the owner is skilled in every active service they are not yet —
 *    the owner delivers what they listed;
 *  - the location walks APPROVED → ACTIVE through the one lifecycle
 *    writer when the readiness gate says yes, the actor named in the
 *    log. Not ready → stays APPROVED, and the checklist says why.
 *
 * Runs inside the caller's transaction. Every query names the tenant:
 * approval runs with `app.hq` set, which reads across tenants, and a
 * publish that saw another salon's widget or services would be wrong.
 */
export async function publishSalon(
  trx: Trx,
  opts: { businessId: string; locationId: string; actorName: string; reason: string },
): Promise<{ activated: boolean; notReady: string[] }> {
  const { businessId, locationId } = opts;

  await trx
    .updateTable('services')
    .set({ online: true })
    .where('tenantId', '=', businessId)
    .where('status', '=', 'active')
    .where('online', '=', false)
    .execute();

  const biz = await trx
    .selectFrom('businesses')
    .select('ownerEmployeeId')
    .where('id', '=', businessId)
    .executeTakeFirstOrThrow();
  if (biz.ownerEmployeeId) {
    const missing = await trx
      .selectFrom('services as s')
      .select('s.id')
      .where('s.tenantId', '=', businessId)
      .where('s.status', '=', 'active')
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('employeeSkills as k')
              .select('k.serviceId')
              .whereRef('k.serviceId', '=', 's.id')
              .where('k.employeeId', '=', biz.ownerEmployeeId!),
          ),
        ),
      )
      .execute();
    for (const s of missing)
      await trx
        .insertInto('employeeSkills')
        .values({ tenantId: businessId, employeeId: biz.ownerEmployeeId, serviceId: s.id })
        .execute();
  }

  // No widget is made here: the website booking widget is the salon's
  // separate product, and the consumer app books with the salon's own
  // key (`salon:<slug>`) regardless (Alex, 2026-09-22).

  const loc = await trx
    .selectFrom('locations')
    .select('lifecycle')
    .where('id', '=', locationId)
    .executeTakeFirstOrThrow();
  if (loc.lifecycle !== 'APPROVED') return { activated: loc.lifecycle === 'ACTIVE', notReady: [] };
  const ready = await locReadiness(trx, locationId);
  if (!ready.ok) return { activated: false, notReady: ready.items.filter((i) => !i.ok).map((i) => i.label) };
  await locTransition(trx, null, locationId, 'ACTIVE', opts.reason, {
    employeeId: null,
    name: opts.actorName,
  });
  return { activated: true, notReady: [] };
}
