import { randomUUID } from 'node:crypto';
import {
  PERM_KEYS,
  REG_SERVICE_TEMPLATES,
  scopeChoices,
  type PermMap,
  type RegistrationDraft,
} from '@velnes/contracts';
import argon2 from 'argon2';
import { sql } from 'kysely';
import { db, withHq, type Trx } from '../../db/index.js';
import { logAudit } from '../audit/audit.service.js';

export class RegistrationError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'WRONG_STATE' | 'REASON_REQUIRED' | 'EMAIL_TAKEN',
    message: string,
  ) {
    super(message);
  }
}

/** Owner role: every permission at its widest legal scope — the same
 *  rule the seed uses. */
const ownerPerms = (): PermMap =>
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

    await trx
      .insertInto('businesses')
      .values({
        id: businessId,
        name: draft.salon.name,
        country: 'North Macedonia',
        since: new Date(),
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
        taxId: draft.legal.taxId,
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

    // The picked starter services, one category row per template cat.
    const picked = REG_SERVICE_TEMPLATES.filter((t) => draft.services.includes(t.key));
    const catIds = new Map<string, string>();
    for (const cat of [...new Set(picked.map((t) => t.category))]) {
      const cid = randomUUID();
      catIds.set(cat, cid);
      await trx
        .insertInto('serviceCategories')
        .values({ id: cid, tenantId: businessId, name: cat, sort: catIds.size })
        .execute();
    }
    for (const [i, t] of picked.entries())
      await trx
        .insertInto('services')
        .values({
          tenantId: businessId,
          name: t.name,
          categoryId: catIds.get(t.category)!,
          durationMin: t.durationMin,
          price: t.price,
          vat: 18,
          status: 'active',
          pos: true,
          online: false, // online selling is a deliberate later switch
          sort: i,
        })
        .execute();

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
