import { randomUUID } from 'node:crypto';
import {
  PERM_KEYS,
  scopeChoices,
  type PermMap,
  type RegistrationDraft,
} from '@velnes/contracts';
import argon2 from 'argon2';
import { sql } from 'kysely';
import { db, withHq, type Trx } from '../../db/index.js';
import { logAudit } from '../audit/audit.service.js';
import { queueMail } from '../mail/mail.service.js';

export class RegistrationError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'WRONG_STATE' | 'REASON_REQUIRED' | 'EMAIL_TAKEN',
    message: string,
  ) {
    super(message);
  }
}

/** Owner role: every permission at its widest legal scope — the same
 *  rule the seed uses. Shared with HQ's create-business door. */
export const ownerPerms = (): PermMap =>
  Object.fromEntries(PERM_KEYS.map((k) => [k, scopeChoices(k).at(-1) ?? 'none'])) as PermMap;

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
    await trx
      .insertInto('registrations')
      .values({
        id,
        draft: JSON.stringify(draft),
        resubmitToken,
        log: JSON.stringify([{ to: 'pending_review', at: new Date().toISOString() }]),
      })
      .execute();
    return { id, status: 'pending_review' as const, resubmitToken };
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
      .select(['id', 'status', 'log'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new RegistrationError('NOT_FOUND', 'Unknown registration');
    if (row.status !== 'changes_required')
      throw new RegistrationError('WRONG_STATE', 'Only a sent-back registration can be resubmitted');
    await trx
      .updateTable('registrations')
      .set({
        status: 'resubmitted',
        draft: JSON.stringify(draft),
        hqReason: null,
        ts: new Date(),
        log: JSON.stringify([
          ...(row.log as unknown[]),
          { from: 'changes_required', to: 'resubmitted', at: new Date().toISOString() },
        ]),
      })
      .where('id', '=', id)
      .execute();
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
      .select(['id', 'status', 'log', 'draft'])
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
    return { id, status: to };
  });
}

/**
 * Approval provisions the whole tenant world in one transaction:
 * business, Owner role, owner account with the wizard's password,
 * legal entity (verified — the compound decision), the location
 * (APPROVED, never ACTIVE: the owner still activates deliberately
 * behind the readiness gate), and the picked starter services.
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
        country: 'North Macedonia',
        since: new Date(),
        // The photos the owner brought in (AI onboarding read them off the
        // website, or they uploaded them) become the business gallery.
        gallery: JSON.stringify(
          draft.gallery.map((g, i) => ({
            id: randomUUID(),
            name: g.name || `Photo ${i + 1}`,
            img: g.img,
          })),
        ),
      })
      .execute();

    const roleId = randomUUID();
    await trx
      .insertInto('roles')
      .values({
        id: roleId,
        tenantId: businessId,
        name: 'Owner',
        std: true,
        locked: true,
        description: 'Everything, everywhere. The account itself.',
        perms: JSON.stringify(ownerPerms()),
      })
      .execute();

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
        roleId,
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
        tz: 'Europe/Skopje',
        phone: draft.salon.phone || null,
        rooms: 2,
        invPrefix: `${draft.salon.name.slice(0, 3).toUpperCase()}-`,
        online: false,
        cancelHours: 24,
        lifecycle: 'APPROVED', // verified here; activation stays with the owner
        hours: JSON.stringify(hoursFromDraft(draft)),
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
          online: false, // online selling is a deliberate later switch
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
          stock: 0,
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
          roleId: null,
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
      await queueMail(trx, {
        tenantId: businessId,
        to: email,
        subject: 'You are invited to Velnes',
        body: `${draft.salon.name} invited you to join their team on Velnes. The invite is valid for 7 days.`,
        kind: 'employee_invite',
        refId: memberId,
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

    await logAudit(trx, businessId, {
      actorEmployeeId: null,
      actorName: `HQ · ${reviewer}`,
      action: 'Salon registration activated',
      object: `Registration · ${draft.salon.name}`,
      before: row.status,
      after: 'active',
    });

    return { businessId, locationId, ownerEmail: draft.acct.email };
  });
}
