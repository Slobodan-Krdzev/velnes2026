import { z } from 'zod';
import { AvatarSchema } from './auth.js';

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

export const BillingInvoiceSchema = z.object({
  id: z.uuid(),
  kind: BillingDocKindSchema,
  status: BillingDocStatusSchema,
  /** Null until issued — a draft has no number, by design. */
  number: z.string().nullable(),
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
