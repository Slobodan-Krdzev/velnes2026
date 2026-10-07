import { z } from 'zod';
import { AvatarSchema } from './auth.js';
import { BILLING_LANGS } from './billing-format.js';
import { splitGross } from './billing-math.js';

/**
 * Invoicing phase 1 (Alex, 2026-10-06) — docs/INVOICING-PLAN.md, docs/INVOICING.md.
 *
 * The issuer of an accounting invoice is the legal entity. Its identity
 * (legal name, ЕДБ, VAT number, ЕМБС) lives on `legal_entities`; its
 * billing configuration lives on `billing_profiles`, one per entity.
 * Buyers are billing identities — a person or a company — optionally
 * linked to a Velnes customer. Nothing here issues anything yet; the
 * completeness evaluator below is the one the issue door will use.
 *
 * Identifier shapes are structural and marked [confirm] where an
 * accountant has to confirm them before they are tightened:
 *   ЕМБС   7 digits                      [confirm]
 *   ЕДБ    13 digits, often written MK+13 [confirm]
 *   VAT no MK + 13 digits                 [confirm]
 */

export const ISSUE_MODES = ['draft', 'auto'] as const;
export const IssueModeSchema = z.enum(ISSUE_MODES);
export const BILLING_KINDS = ['person', 'company'] as const;
export const BillingKindSchema = z.enum(BILLING_KINDS);

export const EMBS_RE = /^\d{7}$/;
export const EDB_RE = /^(MK)?\d{13}$/;
export const VAT_NO_RE = /^MK\d{13}$/;
const SERIES_RE = /^[A-Z0-9-]{0,12}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const WEBSITE_RE = /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i;
const BANK_ACCOUNT_RE = /^[A-Z0-9 -]{8,34}$/i;

const text = (max: number) => z.string().trim().max(max);
const optEmail = z.union([z.literal(''), z.email()]);
const optWebsite = z.union([z.literal(''), z.string().trim().regex(WEBSITE_RE, 'Not a web address')]);

/** What the salon writes. Identity fields it may fill when empty
 *  (ЕМБС, VAT number) ride along and land on the legal entity. */
export const BillingProfileWriteSchema = z.object({
  tradingName: text(120).nullable().default(null),
  address: text(200).default(''),
  city: text(80).default(''),
  zip: text(20).default(''),
  country: text(80).default('North Macedonia'),
  vatRegistered: z.boolean().default(false),
  /** Written to legal_entities.vat_reg when the entity has none yet. */
  vatRegNo: z.union([z.literal(''), z.string().trim().toUpperCase().regex(VAT_NO_RE, 'A VAT number is MK followed by 13 digits')]).optional(),
  /** Written to legal_entities.embs. */
  embs: z.union([z.literal(''), z.string().trim().regex(EMBS_RE, 'ЕМБС is 7 digits')]).optional(),
  bankName: text(120).default(''),
  bankAccount: z.union([z.literal(''), z.string().trim().regex(BANK_ACCOUNT_RE, 'Not an account number')]).default(''),
  defaultCurrency: z.string().trim().toUpperCase().regex(CURRENCY_RE, 'ISO 4217 code').default('MKD'),
  invoicePrefix: z.string().trim().toUpperCase().regex(SERIES_RE, 'Letters, digits and dashes, up to 12').default(''),
  creditPrefix: z.string().trim().toUpperCase().regex(SERIES_RE, 'Letters, digits and dashes, up to 12').default('KO-'),
  yearlyReset: z.boolean().default(true),
  numberWidth: z.number().int().min(4).max(8).default(6),
  /** 0 until the salon declares VAT registration — nothing is invented. */
  defaultVatRateBp: z.number().int().min(0).max(10_000).default(0),
  pricesIncludeVat: z.boolean().default(true),
  footerText: text(1000).default(''),
  paymentInstructions: text(1000).default(''),
  signatoryName: text(120).default(''),
  contactEmail: optEmail.default(''),
  phone: text(40).default(''),
  website: optWebsite.default(''),
  logo: AvatarSchema.nullable().default(null),
  issueMode: IssueModeSchema.default('draft'),
});
export type BillingProfileWrite = z.infer<typeof BillingProfileWriteSchema>;

/** One missing or wrong thing, named by the field the form shows. */
export const BillingIssueSchema = z.object({
  field: z.string(),
  reason: z.enum(['missing', 'invalid', 'unverified']),
});
export const BillingCompletenessSchema = z.object({
  complete: z.boolean(),
  missing: z.array(z.string()),
  invalid: z.array(BillingIssueSchema),
});
export type BillingCompleteness = z.infer<typeof BillingCompletenessSchema>;

/** The profile as the workspace reads it: identity from the entity,
 *  configuration from the profile, the entity's locations with their
 *  clocks (the supply date is the location's day, never the server's),
 *  and the one completeness verdict. */
export const BillingProfileSchema = BillingProfileWriteSchema.extend({
  legalEntityId: z.uuid(),
  legalName: z.string(),
  edb: z.string(),
  vatRegNo: z.string(),
  embs: z.string(),
  entityStatus: z.string(),
  isDefault: z.boolean(),
  /** The brand name invoices show beside the legal name when no override is set. */
  businessName: z.string(),
  locations: z.array(z.object({ id: z.uuid(), name: z.string(), tz: z.string() })),
  completeness: BillingCompletenessSchema,
  /** Phase 3: once this entity has issued a document, prefix, width and
   *  yearly reset are fixed — a changed format would read as another
   *  series over the same numbers. */
  numberingLocked: z.boolean(),
  updatedAt: z.iso.datetime().nullable(),
});
export type BillingProfile = z.infer<typeof BillingProfileSchema>;
export const BillingProfileListSchema = z.object({ profiles: z.array(BillingProfileSchema) });

/**
 * The one completeness evaluator. The settings page shows its result;
 * the issue door (a later phase) refuses on it. Pure, so it is tested
 * on its own. Fields are named as the form names them.
 */
export function evaluateBillingProfile(p: {
  legalName: string;
  edb: string;
  vatRegNo: string;
  embs: string;
  entityStatus: string;
  address: string;
  city: string;
  zip: string;
  country: string;
  vatRegistered: boolean;
  defaultCurrency: string;
  invoicePrefix: string;
  creditPrefix: string;
  numberWidth: number;
  defaultVatRateBp: number;
  signatoryName: string;
  contactEmail: string;
  bankAccount: string;
}): BillingCompleteness {
  const missing: string[] = [];
  const invalid: BillingCompleteness['invalid'] = [];
  const need = (field: string, v: string) => {
    if (!v.trim()) missing.push(field);
  };
  need('legalName', p.legalName);
  need('edb', p.edb);
  need('address', p.address);
  need('city', p.city);
  need('zip', p.zip);
  need('country', p.country);
  need('signatoryName', p.signatoryName); // ЗДДВ чл. 53(10) т. 10
  if (p.vatRegistered) need('vatRegNo', p.vatRegNo);
  if (p.edb && !EDB_RE.test(p.edb)) invalid.push({ field: 'edb', reason: 'invalid' });
  if (p.embs && !EMBS_RE.test(p.embs)) invalid.push({ field: 'embs', reason: 'invalid' });
  if (p.vatRegistered && p.vatRegNo && !VAT_NO_RE.test(p.vatRegNo)) invalid.push({ field: 'vatRegNo', reason: 'invalid' });
  if (!p.vatRegistered && p.defaultVatRateBp !== 0) invalid.push({ field: 'defaultVatRateBp', reason: 'invalid' });
  if (!CURRENCY_RE.test(p.defaultCurrency)) invalid.push({ field: 'defaultCurrency', reason: 'invalid' });
  if (!SERIES_RE.test(p.invoicePrefix)) invalid.push({ field: 'invoicePrefix', reason: 'invalid' });
  if (!SERIES_RE.test(p.creditPrefix)) invalid.push({ field: 'creditPrefix', reason: 'invalid' });
  if (p.invoicePrefix === p.creditPrefix) invalid.push({ field: 'creditPrefix', reason: 'invalid' });
  if (p.numberWidth < 4 || p.numberWidth > 8) invalid.push({ field: 'numberWidth', reason: 'invalid' });
  if (p.contactEmail && !z.email().safeParse(p.contactEmail).success) invalid.push({ field: 'contactEmail', reason: 'invalid' });
  if (p.bankAccount && !BANK_ACCOUNT_RE.test(p.bankAccount)) invalid.push({ field: 'bankAccount', reason: 'invalid' });
  if (p.entityStatus !== 'verified') invalid.push({ field: 'legalName', reason: 'unverified' });
  return { complete: missing.length === 0 && invalid.length === 0, missing, invalid };
}

/* ── Billing identities (buyers) ─────────────────────────────────── */

export const BillingCustomerWriteSchema = z
  .object({
    customerId: z.uuid().nullable().default(null),
    kind: BillingKindSchema,
    name: text(160).min(1),
    address: text(200).default(''),
    city: text(80).default(''),
    zip: text(20).default(''),
    country: text(80).default('North Macedonia'),
    edb: z.union([z.literal(''), z.string().trim().toUpperCase().regex(EDB_RE, 'ЕДБ is 13 digits')]).default(''),
    vatRegNo: z.union([z.literal(''), z.string().trim().toUpperCase().regex(VAT_NO_RE, 'A VAT number is MK followed by 13 digits')]).default(''),
    email: optEmail.default(''),
    phone: text(40).default(''),
  })
  .superRefine((v, ctx) => {
    // A company is addressed by its legal name, seat and ЕДБ (ЗДДВ чл. 53(10) т. 3).
    if (v.kind === 'company') {
      for (const f of ['address', 'city', 'edb'] as const)
        if (!v[f]) ctx.addIssue({ code: 'custom', path: [f], message: 'Required for a company' });
    }
  });
export type BillingCustomerWrite = z.infer<typeof BillingCustomerWriteSchema>;
export const BillingCustomerPatchSchema = BillingCustomerWriteSchema;

export const BillingConsentEventSchema = z.object({
  id: z.uuid(),
  granted: z.boolean(),
  at: z.iso.datetime(),
  actorName: z.string(),
  note: z.string(),
});
export const BillingCustomerSchema = z.object({
  id: z.uuid(),
  customerId: z.uuid().nullable(),
  kind: BillingKindSchema,
  name: z.string(),
  address: z.string(),
  city: z.string(),
  zip: z.string(),
  country: z.string(),
  edb: z.string(),
  vatRegNo: z.string(),
  email: z.string(),
  phone: z.string(),
  /** Explicit consent to receive invoices electronically (ЗДДВ чл. 53-б); null = none standing. */
  consentElectronicAt: z.iso.datetime().nullable(),
  consentHistory: z.array(BillingConsentEventSchema).default([]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type BillingCustomer = z.infer<typeof BillingCustomerSchema>;
export const BillingCustomerListSchema = z.object({ customers: z.array(BillingCustomerSchema) });
export const BillingCustomerQuerySchema = z.object({
  customerId: z.uuid().optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
/** Consent is given or withdrawn by a person saying so — never inferred. */
export const BillingConsentWriteSchema = z.object({
  granted: z.boolean(),
  note: text(300).default(''),
});

/* ── Accounting invoice drafts (phase 2, 2026-10-06) ─────────────────
   Money in minor units (deni: the till's whole denars × 100); rates in
   basis points; quantities in thousandths — the billing-math units.
   The document carries snapshots; the UI renders, it never computes. */

export const BILLING_DOC_KINDS = ['invoice', 'credit_note', 'debit_note', 'advance_invoice'] as const;
export const BillingDocKindSchema = z.enum(BILLING_DOC_KINDS);
export const BILLING_DOC_STATUSES = ['draft', 'issued', 'void'] as const;
export const BillingDocStatusSchema = z.enum(BILLING_DOC_STATUSES);
/** The document's one language (phase 4): chosen on the draft, frozen at issue. */
export const BillingLangSchema = z.enum(BILLING_LANGS);

export const BillingIssuerSnapshotSchema = z.object({
  legalEntityId: z.uuid(),
  legalName: z.string(),
  tradingName: z.string(),
  edb: z.string(),
  vatRegNo: z.string(),
  embs: z.string(),
  address: z.string(),
  city: z.string(),
  zip: z.string(),
  country: z.string(),
  bankName: z.string(),
  bankAccount: z.string(),
  signatoryName: z.string(),
  contactEmail: z.string(),
  phone: z.string(),
  website: z.string(),
  footerText: z.string(),
  paymentInstructions: z.string(),
  /** Phase 3: the branding the ISSUED document used, by content hash
   *  (a `billing_assets` row). Null on a draft — a draft shows the
   *  profile's current logo; the issue step freezes the one it used. */
  logoSha256: z.string().nullable().default(null),
  logoMime: z.string().nullable().default(null),
});
export type BillingIssuerSnapshot = z.infer<typeof BillingIssuerSnapshotSchema>;

export const BillingBuyerSnapshotSchema = z.object({
  /** The billing identity it was taken from, when it was one. */
  billingCustomerId: z.uuid().nullable(),
  /** The Velnes customer behind it, when known. */
  customerId: z.uuid().nullable(),
  kind: BillingKindSchema,
  name: z.string(),
  address: z.string(),
  city: z.string(),
  zip: z.string(),
  country: z.string(),
  edb: z.string(),
  vatRegNo: z.string(),
  email: z.string(),
  phone: z.string(),
});
export type BillingBuyerSnapshot = z.infer<typeof BillingBuyerSnapshotSchema>;

export const BillingLocationSnapshotSchema = z.object({
  locationId: z.uuid(),
  name: z.string(),
  address: z.string(),
  city: z.string(),
  zip: z.string(),
  country: z.string(),
  tz: z.string(),
});

/** What the till sale said, as the document remembers it — the facts
 *  the reconciliation invariant is checked against. Amounts in minor. */
export const BillingOriginSchema = z.object({
  saleNumber: z.string(),
  saleDate: z.iso.date(),
  method: z.string(),
  employeeName: z.string(),
  saleTotalMinor: z.number().int(),
  linesMinor: z.number().int(),
  /** Price reductions allocated over the lines (reduce the VAT base). */
  cartDiscountMinor: z.number().int(),
  promoMinor: z.number().int(),
  loyaltyMinor: z.number().int(),
  /** Not a price reduction: a gift card redeemed is a means of payment. [confirm] */
  giftTenderMinor: z.number().int(),
  /** Not a supply: a gratuity to staff, outside the document. [confirm] */
  tipMinor: z.number().int(),
  /** Flags for the reviewer: which [confirm] treatments this document relies on. */
  flags: z.array(z.enum(['loyalty_as_discount', 'gift_card_as_tender', 'tip_excluded', 'promo_as_discount'])),
});
export type BillingOrigin = z.infer<typeof BillingOriginSchema>;

export const BillingInvoiceLineSchema = z.object({
  id: z.uuid(),
  sort: z.number().int(),
  itemClass: z.enum(['service', 'product', 'other']),
  serviceId: z.uuid().nullable(),
  productId: z.uuid().nullable(),
  appointmentId: z.uuid().nullable(),
  tillLineId: z.uuid().nullable(),
  description: z.string(),
  employeeName: z.string(),
  unit: z.string(),
  qtyMilli: z.number().int(),
  unitPriceMinor: z.number().int(),
  sourceAmountMinor: z.number().int(),
  allocatedDiscountMinor: z.number().int(),
  vatRateBp: z.number().int(),
  exempt: z.boolean(),
  netMinor: z.number().int(),
  vatMinor: z.number().int(),
  grossMinor: z.number().int(),
});
export type BillingInvoiceLine = z.infer<typeof BillingInvoiceLineSchema>;

export const BillingVatRowSchema = z.object({
  rateBp: z.number().int(),
  netMinor: z.number().int(),
  vatMinor: z.number().int(),
  grossMinor: z.number().int(),
});

/* ── Issuing (phase 3, 2026-10-07) ──────────────────────────────────
   One structured vocabulary for "why this cannot be issued": a part of
   the document, the field, and what is wrong with it. The Workspace
   names the field; the API never invents a value to fill it. */

export const BILLING_ISSUE_PARTS = ['issuer', 'buyer', 'location', 'dates', 'money', 'sale', 'document'] as const;
export const BillingIssueProblemSchema = z.object({
  part: z.enum(BILLING_ISSUE_PARTS),
  field: z.string(),
  reason: z.enum(['missing', 'invalid', 'unverified', 'changed', 'mismatch']),
});
export type BillingIssueProblem = z.infer<typeof BillingIssueProblemSchema>;
/** A fact worth a look that does not block issuing. */
export const BillingIssueWarningSchema = z.object({
  code: z.enum(['supply_to_issue_gap', 'buyer_absent']),
  params: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
});
export const BillingIssueReadinessSchema = z.object({
  ready: z.boolean(),
  problems: z.array(BillingIssueProblemSchema),
  warnings: z.array(BillingIssueWarningSchema),
});
export type BillingIssueReadiness = z.infer<typeof BillingIssueReadinessSchema>;

export const BILLING_EVENT_KINDS = ['created', 'edited', 'issued', 'payment', 'credit_note', 'void', 'pdf', 'emailed', 'fiscal_ref', 'efaktura'] as const;
export const BillingEventSchema = z.object({
  id: z.uuid(),
  kind: z.enum(BILLING_EVENT_KINDS),
  at: z.iso.datetime(),
  actorName: z.string(),
  source: z.string(),
  data: z.record(z.string(), z.unknown()),
});
export type BillingEvent = z.infer<typeof BillingEventSchema>;

/** The issue door's body: the idempotency key the client keeps for
 *  its retries — the same key returns the same issued document, a
 *  different key against an issued document is a conflict. */
export const BillingIssueRequestSchema = z.object({ key: z.string().min(8).max(120) });
/** 422 from the issue door: the problems, structured. */
export const BillingIssueBlockedSchema = z.object({
  error: z.literal('ISSUE_BLOCKED'),
  message: z.string(),
  problems: z.array(BillingIssueProblemSchema),
});
/** The frozen logo of an issued document, or a draft's current one. */
export const BillingLogoSchema = z.object({
  sha256: z.string().nullable(),
  mime: z.string(),
  dataUrl: z.string(),
});

/**
 * The legal number, rendered from its parts — the only place the
 * string is built. `2026-000001` by default; the configured prefix
 * before, the year (always: the number says when it was issued even
 * for a series that does not reset), a dash, the sequence padded to
 * the configured width. A sequence wider than the width is not cut.
 */
export function formatInvoiceNumber(p: { prefix: string; year: number; seq: number; width: number }): string {
  if (!Number.isInteger(p.seq) || p.seq < 1) throw new RangeError('sequence must be a positive integer');
  if (!Number.isInteger(p.year) || p.year < 2000 || p.year > 2999) throw new RangeError('year out of range');
  if (!Number.isInteger(p.width) || p.width < 4 || p.width > 8) throw new RangeError('width out of range');
  if (!SERIES_RE.test(p.prefix)) throw new RangeError('prefix out of shape');
  return `${p.prefix}${p.year}-${String(p.seq).padStart(p.width, '0')}`;
}

/** Is this an IANA zone the runtime knows? The issue date is taken in
 *  it, so an unknown zone must block, never fall back. */
export function isKnownTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/** Calendar days from one ISO date to another (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export const BillingInvoiceSchema = z.object({
  id: z.uuid(),
  kind: BillingDocKindSchema,
  status: BillingDocStatusSchema,
  /** Null until issued — a draft has no number, by design. */
  number: z.string().nullable(),
  /** The number's parts, stored apart from the rendered string (phase 3). */
  series: z.string().nullable(),
  year: z.number().int().nullable(),
  numberSeq: z.number().int().nullable(),
  lang: BillingLangSchema,
  /** The canonical PDF's SHA-256 once it has been rendered (phase 4); null before. */
  pdfSha256: z.string().nullable(),
  /** An external fiscal device's receipt reference, when one was recorded; never produced here. */
  fiscalReceiptRef: z.string().nullable(),
  currency: z.string(),
  vatRegistered: z.boolean(),
  pricesIncludeVat: z.boolean(),
  legalEntityId: z.uuid(),
  locationId: z.uuid(),
  billingCustomerId: z.uuid().nullable(),
  originSaleId: z.uuid().nullable(),
  originAppointmentId: z.uuid().nullable(),
  supplyDate: z.iso.date(),
  issueDate: z.iso.date().nullable(),
  dueDate: z.iso.date().nullable(),
  issuedAt: z.iso.datetime().nullable(),
  issuer: BillingIssuerSnapshotSchema,
  buyer: BillingBuyerSnapshotSchema.nullable(),
  location: BillingLocationSnapshotSchema,
  origin: BillingOriginSchema.nullable(),
  lines: z.array(BillingInvoiceLineSchema),
  totals: z.object({
    netMinor: z.number().int(),
    vatMinor: z.number().int(),
    grossMinor: z.number().int(),
    discountMinor: z.number().int(),
  }),
  vatBreakdown: z.array(BillingVatRowSchema),
  /** What a later issue would still need on the buyer side (B2B). */
  buyerCompleteness: BillingCompletenessSchema,
  /** Everything the issue door would refuse on, evaluated the same way
   *  it will evaluate — so the Workspace can say what to fix first.
   *  Always `ready` on an issued document. */
  issueReadiness: BillingIssueReadinessSchema,
  issuedBy: z.object({ id: z.uuid().nullable(), name: z.string() }).nullable(),
  /** The document's own timeline, oldest first. */
  events: z.array(BillingEventSchema),
  notes: z.string(),
  createdBy: z.object({ id: z.uuid().nullable(), name: z.string() }),
  createdAt: z.iso.datetime(),
  updatedBy: z.object({ id: z.uuid().nullable(), name: z.string() }),
  updatedAt: z.iso.datetime(),
});
export type BillingInvoice = z.infer<typeof BillingInvoiceSchema>;

export const BillingInvoiceRowSchema = BillingInvoiceSchema.pick({
  id: true, kind: true, status: true, number: true, currency: true, vatRegistered: true,
  legalEntityId: true, locationId: true, billingCustomerId: true, originSaleId: true,
  supplyDate: true, issueDate: true, dueDate: true, totals: true, createdAt: true, updatedAt: true,
}).extend({
  buyerName: z.string(),
  locationName: z.string(),
  saleNumber: z.string().nullable(),
});
export const BillingInvoiceListSchema = z.object({ invoices: z.array(BillingInvoiceRowSchema) });

export const BillingInvoiceCreateSchema = z.object({
  saleId: z.uuid(),
  /** The document's language; absent, the buyer's Velnes account language, else the salon's country's, else Macedonian. */
  lang: BillingLangSchema.optional(),
  /** A billing identity to invoice; absent, the sale's customer's own identity is used when there is exactly one, else the customer's name alone. */
  billingCustomerId: z.uuid().nullable().optional(),
  key: z.string().min(8).optional(),
});
export const BillingInvoicePatchSchema = z.object({
  /** Re-snapshot the buyer from this identity; null = back to the sale's customer, or nobody. */
  billingCustomerId: z.uuid().nullable().optional(),
  supplyDate: z.iso.date().optional(),
  dueDate: z.iso.date().nullable().optional(),
  notes: z.string().trim().max(1000).optional(),
  lang: BillingLangSchema.optional(),
});
export const BillingInvoiceQuerySchema = z.object({
  status: BillingDocStatusSchema.optional(),
  kind: BillingDocKindSchema.optional(),
  locationId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** What a buyer snapshot still lacks for a legally addressed invoice:
 *  a company needs its legal name, seat and ЕДБ; a person its name. */
export function evaluateBuyer(b: BillingBuyerSnapshot | null): BillingCompleteness {
  if (!b) return { complete: true, missing: [], invalid: [] };
  const missing: string[] = [];
  const invalid: BillingCompleteness['invalid'] = [];
  if (!b.name.trim()) missing.push('name');
  if (b.kind === 'company') {
    for (const f of ['address', 'city', 'edb'] as const) if (!b[f].trim()) missing.push(f);
    if (b.edb && !EDB_RE.test(b.edb)) invalid.push({ field: 'edb', reason: 'invalid' });
    if (b.vatRegNo && !VAT_NO_RE.test(b.vatRegNo)) invalid.push({ field: 'vatRegNo', reason: 'invalid' });
  }
  return { complete: missing.length === 0 && invalid.length === 0, missing, invalid };
}

/**
 * The one issue-readiness evaluator (phase 3). The GET door reports
 * it so the Workspace can say what to fix; the issue door refuses on
 * it — the same function, so they never disagree. Pure: it is handed
 * the issuer's completeness (from `evaluateBillingProfile`), the
 * document as stored, and the issue date the door would use. It
 * re-derives every money fact from billing-math and the stored lines;
 * it never rebuilds the document from today's catalog.
 */
export function evaluateIssueReadiness(d: {
  issuer: BillingCompleteness;
  buyer: BillingBuyerSnapshot | null;
  location: { locationId: string; tz: string } | null;
  vatRegistered: boolean;
  pricesIncludeVat: boolean;
  supplyDate: string;
  issueDate: string;
  dueDate: string | null;
  lines: readonly Pick<BillingInvoiceLine, 'sourceAmountMinor' | 'allocatedDiscountMinor' | 'vatRateBp' | 'exempt' | 'netMinor' | 'vatMinor' | 'grossMinor'>[];
  totals: { netMinor: number; vatMinor: number; grossMinor: number; discountMinor: number };
  vatBreakdown: readonly { rateBp: number; netMinor: number; vatMinor: number; grossMinor: number }[];
  origin: BillingOrigin | null;
  /** The sale as it is NOW, for a sale-backed document; null when it is gone. */
  sale: { status: string; totalMinor: number; tipMinor: number; serviceChargeMinor: number; giftMinor: number } | null | undefined;
}): BillingIssueReadiness {
  const problems: BillingIssueProblem[] = [];
  const warnings: BillingIssueReadiness['warnings'] = [];
  const add = (part: BillingIssueProblem['part'], field: string, reason: BillingIssueProblem['reason']) => {
    if (!problems.some((p) => p.part === part && p.field === field)) problems.push({ part, field, reason });
  };

  // Issuer — Phase 1's evaluator decides; nothing is re-stated here.
  for (const f of d.issuer.missing) add('issuer', f, 'missing');
  for (const i of d.issuer.invalid) add('issuer', i.field, i.reason);

  // Buyer — a draft may be incomplete, an issued document may not.
  const b = evaluateBuyer(d.buyer);
  for (const f of b.missing) add('buyer', f, 'missing');
  for (const i of b.invalid) add('buyer', i.field, i.reason);
  if (!d.buyer) warnings.push({ code: 'buyer_absent', params: {} });

  // Place — a known clock, or no issue date can be taken.
  if (!d.location) add('location', 'location', 'missing');
  else if (!isKnownTimeZone(d.location.tz)) add('location', 'tz', 'invalid');

  // Dates.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.supplyDate)) add('dates', 'supplyDate', 'invalid');
  else if (d.supplyDate > d.issueDate) add('dates', 'supplyDate', 'invalid'); // supplied after it was invoiced
  else {
    const gap = daysBetween(d.supplyDate, d.issueDate);
    // ЗДДВ: the invoice follows the supply within five working days
    // [confirm]. Working days need the holiday calendar, which is not
    // modelled; the gap is reported, not enforced.
    if (gap > 7) warnings.push({ code: 'supply_to_issue_gap', params: { days: gap } });
  }
  if (d.dueDate && d.dueDate < d.issueDate) add('dates', 'dueDate', 'invalid');

  // Money — every invariant, from the stored figures and billing-math.
  if (!d.lines.length) add('money', 'lines', 'missing');
  let net = 0;
  let vat = 0;
  let gross = 0;
  let disc = 0;
  const byRate = new Map<number, { net: number; vat: number; gross: number }>();
  for (const l of d.lines) {
    if (l.netMinor + l.vatMinor !== l.grossMinor) add('money', 'line', 'mismatch');
    if (l.grossMinor !== l.sourceAmountMinor - l.allocatedDiscountMinor) add('money', 'line', 'mismatch');
    if (d.vatRegistered) {
      const s = d.pricesIncludeVat ? splitGross(l.grossMinor, l.vatRateBp) : null;
      if (s && (s.net !== l.netMinor || s.vat !== l.vatMinor)) add('money', 'line', 'mismatch');
      if (l.exempt && l.vatMinor !== 0) add('money', 'line', 'mismatch');
    } else if (l.vatMinor !== 0 || l.vatRateBp !== 0 || !l.exempt) add('money', 'line', 'mismatch');
    net += l.netMinor;
    vat += l.vatMinor;
    gross += l.grossMinor;
    disc += l.allocatedDiscountMinor;
    const r = byRate.get(l.vatRateBp) ?? { net: 0, vat: 0, gross: 0 };
    r.net += l.netMinor;
    r.vat += l.vatMinor;
    r.gross += l.grossMinor;
    byRate.set(l.vatRateBp, r);
  }
  if (d.totals.netMinor !== net || d.totals.vatMinor !== vat || d.totals.grossMinor !== gross) add('money', 'totals', 'mismatch');
  if (d.totals.netMinor + d.totals.vatMinor !== d.totals.grossMinor) add('money', 'totals', 'mismatch');
  if (d.totals.discountMinor !== disc) add('money', 'discount', 'mismatch');
  const rates = [...byRate.keys()].sort((a, c) => a - c);
  const brRates = [...d.vatBreakdown].map((r) => r.rateBp).sort((a, c) => a - c);
  if (rates.length !== brRates.length || rates.some((r, i) => r !== brRates[i])) add('money', 'vatBreakdown', 'mismatch');
  else
    for (const row of d.vatBreakdown) {
      const mine = byRate.get(row.rateBp)!;
      if (mine.net !== row.netMinor || mine.vat !== row.vatMinor || mine.gross !== row.grossMinor) add('money', 'vatBreakdown', 'mismatch');
    }

  // Origin — the sale-backed equation of phase 2, both readings.
  if (d.origin) {
    const o = d.origin;
    if (gross !== o.linesMinor - o.cartDiscountMinor - o.promoMinor - o.loyaltyMinor) add('money', 'origin', 'mismatch');
    if (gross !== o.saleTotalMinor - o.tipMinor + o.giftTenderMinor) add('money', 'origin', 'mismatch');
    if (disc !== o.cartDiscountMinor + o.promoMinor + o.loyaltyMinor) add('money', 'origin', 'mismatch');
    if (d.sale === null) add('sale', 'sale', 'missing');
    else if (d.sale) {
      if (d.sale.status !== 'Paid') add('sale', 'status', 'changed');
      if (d.sale.serviceChargeMinor > 0) add('sale', 'serviceCharge', 'invalid');
      if (d.sale.totalMinor !== o.saleTotalMinor || d.sale.tipMinor !== o.tipMinor || d.sale.giftMinor !== o.giftTenderMinor) add('sale', 'amounts', 'changed');
    }
  }

  return { ready: problems.length === 0, problems, warnings };
}
