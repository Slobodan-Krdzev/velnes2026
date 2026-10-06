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
  defaultVatRateBp: z.number().int().min(0).max(10_000).default(1800),
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
