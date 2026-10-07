import type {
  AccessClaims,
  BillingCustomer,
  BillingIssueProblem,
  BillingCustomerWrite,
  BillingProfile,
  BillingProfileWrite,
} from '@velnes/contracts';
import { evaluateBillingProfile } from '@velnes/contracts';
import type { Trx } from '../../db/index.js';
import { logAudit } from '../audit/audit.service.js';

/**
 * Invoicing phase 1 (Alex, 2026-10-06) — docs/INVOICING.md.
 *
 * The issuer side: one billing profile per legal entity, the entity's
 * identity read from `legal_entities` and only its configuration kept
 * here. The buyer side: billing identities, a person or a company,
 * linked to a Velnes customer or standing alone, with electronic
 * invoice consent as an explicit, append-only history. Every function
 * runs inside the caller's tenant transaction — RLS does the
 * isolation, these doors add the permission and the audit row.
 */

export class BillingError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'INVALID' | 'ISSUE_BLOCKED' | 'CONFLICT',
    message: string,
    /** For ISSUE_BLOCKED: what the issue door found wrong, structured. */
    public problems: BillingIssueProblem[] = [],
  ) {
    super(message);
  }
}

async function actorName(trx: Trx, id: string | null) {
  if (!id) return '';
  return (await trx.selectFrom('employees').select('name').where('id', '=', id).executeTakeFirst())?.name ?? '';
}

/* ── Profiles ───────────────────────────────────────────────────────── */

async function buildProfile(trx: Trx, legalEntityId: string): Promise<BillingProfile | null> {
  const e = await trx
    .selectFrom('legalEntities')
    .select(['id', 'name', 'taxId', 'vatReg', 'embs', 'status', 'isDefault', 'currency'])
    .where('id', '=', legalEntityId)
    .where('ownerType', '=', 'salon')
    .executeTakeFirst();
  if (!e) return null;
  const biz = await trx.selectFrom('businesses').select('name').executeTakeFirst();
  const p = await trx.selectFrom('billingProfiles').selectAll().where('legalEntityId', '=', e.id).executeTakeFirst();
  const locations = await trx
    .selectFrom('legalEntityLocations as ll')
    .innerJoin('locations as l', 'l.id', 'll.locationId')
    .select(['l.id', 'l.name', 'l.tz'])
    .where('ll.legalEntityId', '=', e.id)
    .orderBy('l.name')
    .execute();
  const cfg = {
    tradingName: p?.tradingName ?? null,
    address: p?.address ?? '',
    city: p?.city ?? '',
    zip: p?.zip ?? '',
    country: p?.country ?? 'North Macedonia',
    vatRegistered: p?.vatRegistered ?? false,
    bankName: p?.bankName ?? '',
    bankAccount: p?.bankAccount ?? '',
    defaultCurrency: p?.defaultCurrency ?? e.currency ?? 'MKD',
    invoicePrefix: p?.invoicePrefix ?? '',
    creditPrefix: p?.creditPrefix ?? 'KO-',
    yearlyReset: p?.yearlyReset ?? true,
    numberWidth: p?.numberWidth ?? 6,
    // Nothing is invented: until the salon says it is VAT-registered, the default rate is 0.
    defaultVatRateBp: p?.defaultVatRateBp ?? 0,
    pricesIncludeVat: p?.pricesIncludeVat ?? true,
    footerText: p?.footerText ?? '',
    paymentInstructions: p?.paymentInstructions ?? '',
    signatoryName: p?.signatoryName ?? '',
    contactEmail: p?.contactEmail ?? '',
    phone: p?.phone ?? '',
    website: p?.website ?? '',
    logo: p?.logo ?? null,
    issueMode: (p?.issueMode ?? 'draft') as 'draft' | 'auto',
  };
  // Phase 3: a series that has issued a document fixes its format.
  const used = await trx
    .selectFrom('billingSequences')
    .select('lastSeq')
    .where('legalEntityId', '=', e.id)
    .where('lastSeq', '>', 0)
    .limit(1)
    .executeTakeFirst();
  const identity = {
    legalName: e.name,
    edb: e.taxId ?? '',
    vatRegNo: e.vatReg ?? '',
    embs: e.embs ?? '',
    entityStatus: String(e.status),
  };
  return {
    ...cfg,
    ...identity,
    legalEntityId: e.id,
    isDefault: e.isDefault,
    businessName: biz?.name ?? '',
    locations: locations.map((l) => ({ id: l.id, name: l.name, tz: l.tz })),
    completeness: evaluateBillingProfile({ ...identity, ...cfg }),
    numberingLocked: !!used,
    updatedAt: p ? p.updatedAt.toISOString() : null,
  };
}

/** Every salon legal entity of the tenant, with its profile (or the defaults). */
export async function listProfiles(trx: Trx): Promise<BillingProfile[]> {
  const ids = await trx
    .selectFrom('legalEntities')
    .select('id')
    .where('ownerType', '=', 'salon')
    .orderBy('isDefault', 'desc')
    .orderBy('name')
    .execute();
  const out: BillingProfile[] = [];
  for (const { id } of ids) {
    const p = await buildProfile(trx, id);
    if (p) out.push(p);
  }
  return out;
}

export async function getProfile(trx: Trx, legalEntityId: string): Promise<BillingProfile> {
  const p = await buildProfile(trx, legalEntityId);
  if (!p) throw new BillingError('NOT_FOUND', 'Unknown legal entity');
  return p;
}

/** Save the configuration; fill the identity fields the salon may. */
export async function upsertProfile(
  trx: Trx,
  claims: AccessClaims,
  legalEntityId: string,
  w: BillingProfileWrite,
): Promise<BillingProfile> {
  const e = await trx
    .selectFrom('legalEntities')
    .select(['id', 'name', 'vatReg', 'embs', 'status'])
    .where('id', '=', legalEntityId)
    .where('ownerType', '=', 'salon')
    .executeTakeFirst();
  if (!e) throw new BillingError('NOT_FOUND', 'Unknown legal entity');
  const before = await buildProfile(trx, e.id);

  // Identity on the entity. ЕМБС is the salon's to keep. The VAT number
  // is HQ-verified once the entity is: it may be filled while empty or
  // while unverified, never changed underneath a verified entity here.
  const entityPatch: { embs?: string | null; vatReg?: string | null } = {};
  if (w.embs !== undefined) entityPatch.embs = w.embs || null;
  if (w.vatRegNo !== undefined && w.vatRegNo !== (e.vatReg ?? '')) {
    if ((e.vatReg ?? '') && String(e.status) === 'verified')
      throw new BillingError('INVALID', 'The VAT number of a verified legal entity is changed by Velnes HQ');
    entityPatch.vatReg = w.vatRegNo || null;
  }
  if (Object.keys(entityPatch).length)
    await trx.updateTable('legalEntities').set(entityPatch).where('id', '=', e.id).execute();

  // Numbering is fixed once a document has been issued under this
  // entity: a new prefix, width or reset rule would read as another
  // series over numbers already given (phase 3, 2026-10-07).
  if (before?.numberingLocked) {
    const changed = (['invoicePrefix', 'creditPrefix', 'numberWidth', 'yearlyReset'] as const).filter((k) => w[k] !== before[k]);
    if (changed.length)
      throw new BillingError(
        'INVALID',
        `Numbering cannot change once an invoice has been issued (${changed.join(', ')}); a new series is a decision for the accountant`,
      );
  }

  const row = {
    tenantId: claims.ten,
    legalEntityId: e.id,
    tradingName: w.tradingName,
    address: w.address,
    city: w.city,
    zip: w.zip,
    country: w.country,
    vatRegistered: w.vatRegistered,
    bankName: w.bankName,
    bankAccount: w.bankAccount,
    defaultCurrency: w.defaultCurrency,
    invoicePrefix: w.invoicePrefix,
    creditPrefix: w.creditPrefix,
    yearlyReset: w.yearlyReset,
    numberWidth: w.numberWidth,
    defaultVatRateBp: w.defaultVatRateBp,
    pricesIncludeVat: w.pricesIncludeVat,
    footerText: w.footerText,
    paymentInstructions: w.paymentInstructions,
    signatoryName: w.signatoryName,
    contactEmail: w.contactEmail,
    phone: w.phone,
    website: w.website,
    logo: w.logo,
    issueMode: w.issueMode,
    updatedAt: new Date(),
  };
  const { tenantId: _t, legalEntityId: _l, ...update } = row;
  await trx
    .insertInto('billingProfiles')
    .values(row)
    .onConflict((oc) => oc.column('legalEntityId').doUpdateSet(update))
    .execute();

  const after = (await buildProfile(trx, e.id))!;
  await logAudit(trx, claims.ten, {
    actorEmployeeId: claims.sub,
    actorName: await actorName(trx, claims.sub),
    action: 'Invoice settings changed',
    object: `Legal entity · ${e.name}`,
    before: before ? (before.completeness.complete ? 'complete' : `${before.completeness.missing.length} missing`) : '—',
    after: after.completeness.complete ? 'complete' : `${after.completeness.missing.length} missing`,
  });
  return after;
}

/* ── Billing identities ─────────────────────────────────────────────── */

async function toCustomer(trx: Trx, id: string): Promise<BillingCustomer> {
  const r = await trx.selectFrom('billingCustomers').selectAll().where('id', '=', id).executeTakeFirst();
  if (!r) throw new BillingError('NOT_FOUND', 'Unknown billing identity');
  const history = await trx
    .selectFrom('billingConsentEvents')
    .select(['id', 'granted', 'at', 'actorName', 'note'])
    .where('billingCustomerId', '=', id)
    .orderBy('at', 'desc')
    .execute();
  return {
    id: r.id,
    customerId: r.customerId,
    kind: r.kind as 'person' | 'company',
    name: r.name,
    address: r.address,
    city: r.city,
    zip: r.zip,
    country: r.country,
    edb: r.edb,
    vatRegNo: r.vatRegNo,
    email: r.email,
    phone: r.phone,
    consentElectronicAt: r.consentElectronicAt ? r.consentElectronicAt.toISOString() : null,
    consentHistory: history.map((h) => ({ id: h.id, granted: h.granted, at: h.at.toISOString(), actorName: h.actorName, note: h.note })),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function listCustomers(trx: Trx, q: { customerId?: string | undefined; q?: string | undefined; limit: number }): Promise<BillingCustomer[]> {
  let qb = trx.selectFrom('billingCustomers').select('id').orderBy('updatedAt', 'desc').limit(q.limit);
  if (q.customerId) qb = qb.where('customerId', '=', q.customerId);
  if (q.q) qb = qb.where('name', 'ilike', `%${q.q}%`);
  const ids = await qb.execute();
  const out: BillingCustomer[] = [];
  for (const { id } of ids) out.push(await toCustomer(trx, id));
  return out;
}

export const getCustomer = (trx: Trx, id: string) => toCustomer(trx, id);

async function customerExists(trx: Trx, customerId: string) {
  const c = await trx.selectFrom('customers').select('id').where('id', '=', customerId).executeTakeFirst();
  if (!c) throw new BillingError('NOT_FOUND', 'Unknown customer');
}

export async function createCustomer(trx: Trx, claims: AccessClaims, w: BillingCustomerWrite): Promise<BillingCustomer> {
  if (w.customerId) await customerExists(trx, w.customerId);
  const row = await trx
    .insertInto('billingCustomers')
    .values({
      tenantId: claims.ten,
      customerId: w.customerId,
      kind: w.kind,
      name: w.name,
      address: w.address,
      city: w.city,
      zip: w.zip,
      country: w.country,
      edb: w.edb,
      vatRegNo: w.vatRegNo,
      email: w.email,
      phone: w.phone,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await logAudit(trx, claims.ten, {
    actorEmployeeId: claims.sub,
    actorName: await actorName(trx, claims.sub),
    action: 'Billing details created',
    object: `Billing identity · ${w.name}`,
    after: w.kind,
  });
  return toCustomer(trx, row.id);
}

export async function updateCustomer(trx: Trx, claims: AccessClaims, id: string, w: BillingCustomerWrite): Promise<BillingCustomer> {
  const before = await toCustomer(trx, id);
  if (w.customerId) await customerExists(trx, w.customerId);
  await trx
    .updateTable('billingCustomers')
    .set({
      customerId: w.customerId,
      kind: w.kind,
      name: w.name,
      address: w.address,
      city: w.city,
      zip: w.zip,
      country: w.country,
      edb: w.edb,
      vatRegNo: w.vatRegNo,
      email: w.email,
      phone: w.phone,
      updatedAt: new Date(),
    })
    .where('id', '=', id)
    .execute();
  await logAudit(trx, claims.ten, {
    actorEmployeeId: claims.sub,
    actorName: await actorName(trx, claims.sub),
    action: 'Billing details changed',
    object: `Billing identity · ${before.name}`,
    before: `${before.kind} · ${before.name}`,
    after: `${w.kind} · ${w.name}`,
  });
  return toCustomer(trx, id);
}

/** Consent given or withdrawn — by a person, on the record, forever. */
export async function setConsent(
  trx: Trx,
  claims: AccessClaims,
  id: string,
  w: { granted: boolean; note: string },
): Promise<BillingCustomer> {
  const before = await toCustomer(trx, id);
  const name = await actorName(trx, claims.sub);
  const now = new Date();
  await trx
    .insertInto('billingConsentEvents')
    .values({ tenantId: claims.ten, billingCustomerId: id, granted: w.granted, at: now, actorEmployeeId: claims.sub, actorName: name, note: w.note })
    .execute();
  await trx
    .updateTable('billingCustomers')
    .set({ consentElectronicAt: w.granted ? now : null, updatedAt: now })
    .where('id', '=', id)
    .execute();
  await logAudit(trx, claims.ten, {
    actorEmployeeId: claims.sub,
    actorName: name,
    action: w.granted ? 'Electronic invoice consent given' : 'Electronic invoice consent withdrawn',
    object: `Billing identity · ${before.name}`,
    before: before.consentElectronicAt ? 'consented' : 'no consent',
    after: w.granted ? 'consented' : 'no consent',
    reason: w.note,
  });
  return toCustomer(trx, id);
}
