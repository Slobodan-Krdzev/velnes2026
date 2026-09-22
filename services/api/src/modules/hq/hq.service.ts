import { randomUUID } from 'node:crypto';
import { PLAN_PRICES, type HqOnboardSteps, type HqRole } from '@velnes/contracts';
import type { z } from 'zod';
import type { HqBusinessCreateSchema } from '@velnes/contracts';
import argon2 from 'argon2';
import { sql } from 'kysely';
import { db, withHq } from '../../db/index.js';
import { logAudit } from '../audit/audit.service.js';
import { AuthError } from '../auth/auth.service.js';
import { queueMail } from '../mail/mail.service.js';
import { RegistrationError } from '../registrations/registrations.service.js';
import { standardRoles } from '../team/role-kits.js';

/** HQ principals are their own kind: separate table, separate token
 *  shape. The login lookup reuses the explicit app.auth mode. */
export async function hqLogin(email: string, password: string) {
  const row = await db.transaction().execute(async (trx) => {
    await sql`select set_config('app.auth', 'login', true)`.execute(trx);
    return trx
      .selectFrom('hqUsers')
      .selectAll()
      .where(sql<boolean>`lower(email) = lower(${email})`)
      .executeTakeFirst();
  });
  const hash =
    row?.passwordHash ??
    '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const ok = await argon2.verify(hash, password).catch(() => false);
  if (!row || !ok) throw new AuthError('INVALID_CREDENTIALS');
  if (row.status !== 'active') throw new AuthError('NOT_ACTIVE');
  return { id: row.id, name: row.name, email: row.email, role: row.role as HqRole };
}

export async function hqUserById(id: string) {
  const row = await withHq((trx) =>
    trx
      .selectFrom('hqUsers')
      .select(['id', 'name', 'email', 'role'])
      .where('id', '=', id)
      .executeTakeFirst(),
  );
  return row ? { ...row, role: row.role as HqRole } : undefined;
}

/** Which HQ roles may decide intake reviews. */
export const canReview = (role: HqRole) => role === 'hq_super' || role === 'hq_onboard';

/** date column → 'YYYY-MM-DD' without a UTC shift (pg hands back
 *  local-midnight Dates; toISOString would slip a day west of UTC). */
const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const countBy = (rows: { tenantId: string }[]) => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.tenantId, (m.get(r.tenantId) ?? 0) + 1);
  return m;
};

/**
 * The customers dashboard: every account with its onboarding steps
 * derived from the real tables — a step is "done" because the rows
 * exist, never because someone ticked a box. Open tickets and the
 * last support access stay honest zeros/nulls until the support
 * surface is built.
 */
export async function hqBusinessList() {
  return withHq(async (trx) => {
    const rows = await trx
      .selectFrom('businesses as b')
      .leftJoin('employees as o', 'o.id', 'b.ownerEmployeeId')
      .select([
        'b.id',
        'b.name',
        'b.slug',
        'b.city',
        'b.plan',
        'b.since',
        'b.assistantEnabled',
        'o.name as ownerName',
        'o.email as ownerEmail',
        'o.status as ownerStatus',
      ])
      .orderBy('b.createdAt')
      .execute();
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const [locs, emps, svcs, prods, pays, widgets, errs, tickets] = await Promise.all([
      trx.selectFrom('locations').select(['tenantId', 'lifecycle']).execute(),
      trx.selectFrom('employees').select(['tenantId']).execute(),
      trx.selectFrom('services').select(['tenantId']).execute(),
      trx.selectFrom('products').select(['tenantId']).execute(),
      trx.selectFrom('paymentAccounts').select(['tenantId', 'status']).execute(),
      trx.selectFrom('widgets').select(['tenantId']).execute(),
      trx
        .selectFrom('integrationEvents')
        .select(['tenantId'])
        .where('level', '=', 'error')
        .where('ts', '>', weekAgo)
        .execute(),
      trx
        .selectFrom('supportTickets')
        .select(['tenantId'])
        .where('status', 'in', ['open', 'in_progress'])
        .execute(),
    ]);
    // Open tickets are real now: per-salon on the row, and the whole
    // platform (suppliers included) in the header stat.
    const openTicketCount = countBy(tickets.filter((tt) => tt.tenantId).map((tt) => ({ tenantId: tt.tenantId as string })));
    const openTicketTotal = tickets.length;
    const empCount = countBy(emps);
    const svcCount = countBy(svcs);
    const prodCount = countBy(prods);
    const widgetCount = countBy(widgets);
    const errCount = countBy(errs.filter((e): e is { tenantId: string } => e.tenantId !== null));

    const businesses = rows.map((b) => {
      const mine = locs.filter((l) => l.tenantId === b.id);
      const live = mine.filter((l) => l.lifecycle === 'ACTIVE').length;
      const steps: HqOnboardSteps = {
        account: true,
        // "Locations added" means genuinely submitted, not a draft.
        locations: mine.some((l) => l.lifecycle !== 'DRAFT'),
        catalog: (svcCount.get(b.id) ?? 0) + (prodCount.get(b.id) ?? 0) > 0,
        employees: (empCount.get(b.id) ?? 0) >= 2,
        payments: pays.some((p) => p.tenantId === b.id && p.status === 'active'),
        widget: (widgetCount.get(b.id) ?? 0) > 0,
      };
      const status =
        !b.ownerName || b.ownerStatus === 'invited' ? 'invited' : live > 0 ? 'live' : 'onboarding';
      return {
        id: b.id,
        name: b.name,
        slug: b.slug,
        city: b.city,
        plan: b.plan,
        since: b.since ? localDay(new Date(b.since)) : null,
        ownerName: b.ownerName,
        ownerEmail: b.ownerEmail,
        locations: mine.length,
        liveLocations: live,
        employees: empCount.get(b.id) ?? 0,
        status: status as 'live' | 'invited' | 'onboarding',
        steps,
        assistantEnabled: b.assistantEnabled,
        mrr: status === 'invited' ? 0 : (PLAN_PRICES[b.plan] ?? 0),
        syncErrors7d: errCount.get(b.id) ?? 0,
        openTickets: openTicketCount.get(b.id) ?? 0,
        lastSupportAccess: null,
      };
    });
    return {
      businesses,
      stats: {
        businesses: businesses.length,
        live: businesses.filter((b) => b.status === 'live').length,
        onboarding: businesses.filter((b) => b.status !== 'live').length,
        openTickets: openTicketTotal,
        monthlyRevenue: businesses.reduce((s, b) => s + b.mrr, 0),
      },
    };
  });
}

/**
 * The prototype's hqNewBiz door: one transaction provisions the
 * account (business, Owner role, invited owner, optional first
 * location) and queues the owner's invite through the outbox. The
 * owner sets their own password — HQ never holds one, so no
 * user_credentials row exists until the invite flow completes.
 */
export async function hqCreateBusiness(
  input: z.infer<typeof HqBusinessCreateSchema>,
  actor: { name: string; role: string },
) {
  return db.transaction().execute(async (trx) => {
    const businessId = randomUUID();
    await sql`select set_config('app.hq', '1', true)`.execute(trx);
    await sql`select set_config('app.tenant_id', ${businessId}, true)`.execute(trx);

    const taken = await trx
      .selectFrom('employees')
      .select('id')
      .where(sql<boolean>`lower(email) = lower(${input.ownerEmail})`)
      .executeTakeFirst();
    if (taken)
      throw new RegistrationError('EMAIL_TAKEN', 'That email already belongs to an account');

    await trx
      .insertInto('businesses')
      .values({
        id: businessId,
        name: input.name,
        country: 'North Macedonia',
        city: input.city,
        plan: input.plan,
        since: new Date(),
      })
      .execute();

    const { ownerRoleId } = await standardRoles(trx, businessId);

    const ownerId = randomUUID();
    await trx
      .insertInto('employees')
      .values({
        id: ownerId,
        tenantId: businessId,
        name: input.ownerName,
        roleTitle: 'Owner',
        email: input.ownerEmail,
        access: 'owner',
        roleId: ownerRoleId,
        bookable: true,
        status: 'invited',
        color: 'olive',
      })
      .execute();
    await trx
      .updateTable('businesses')
      .set({ ownerEmployeeId: ownerId })
      .where('id', '=', businessId)
      .execute();

    if (input.firstLocation) {
      // HQ creates the first location so the owner starts with
      // something that works — APPROVED, never ACTIVE: activation
      // stays with the owner, behind the readiness gate.
      await trx
        .insertInto('locations')
        .values({
          tenantId: businessId,
          name: input.firstLocation,
          city: input.city,
          rooms: 2,
          invPrefix: `${input.name.slice(0, 3).toUpperCase()}-`,
          online: false,
          cancelHours: 24,
          lifecycle: 'APPROVED',
        })
        .execute();
    }

    await queueMail(trx, {
      tenantId: businessId,
      to: input.ownerEmail,
      subject: `You are invited to Velnes — ${input.name}`,
      body: `${actor.name} (Revelapps) created ${input.name} for you. You set your own password and two-factor at first sign-in; Revelapps never holds customer passwords.`,
      kind: 'owner_invite',
      refId: ownerId,
    });
    await logAudit(trx, businessId, {
      actorName: actor.name,
      roleName: `HQ ${actor.role}`,
      businessName: input.name,
      action: 'Business created',
      object: `Business · ${input.name}`,
      before: '—',
      after: 'Owner invited',
      source: 'HQ portal',
    });
    return { id: businessId };
  });
}

/** HQ flips the AI Assistant on or off for one salon. Off by default;
 *  this is the pilot's control. Audited into the salon's own trail so
 *  the owner can see HQ turned it on. */
export async function hqSetAssistant(
  businessId: string,
  enabled: boolean,
  actor: { name: string; role: string },
): Promise<{ id: string; assistantEnabled: boolean }> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.hq', '1', true)`.execute(trx);
    await sql`select set_config('app.tenant_id', ${businessId}, true)`.execute(trx);
    const biz = await trx
      .selectFrom('businesses')
      .select(['name', 'assistantEnabled'])
      .where('id', '=', businessId)
      .executeTakeFirst();
    if (!biz) throw new RegistrationError('NOT_FOUND', 'No such business');
    if (biz.assistantEnabled !== enabled) {
      await trx
        .updateTable('businesses')
        .set({ assistantEnabled: enabled })
        .where('id', '=', businessId)
        .execute();
      await logAudit(trx, businessId, {
        actorName: actor.name,
        roleName: `HQ ${actor.role}`,
        businessName: biz.name,
        action: enabled ? 'AI Assistant enabled' : 'AI Assistant disabled',
        object: `Business · ${biz.name}`,
        before: biz.assistantEnabled ? 'Enabled' : 'Disabled',
        after: enabled ? 'Enabled' : 'Disabled',
        source: 'HQ portal',
      });
    }
    return { id: businessId, assistantEnabled: enabled };
  });
}
