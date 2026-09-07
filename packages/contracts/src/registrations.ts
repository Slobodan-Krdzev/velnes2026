import { z } from 'zod';

/**
 * The classic salon registration (docs §4 Governance): one wizard,
 * one draft that travels whole through the status machine so
 * "request changes" reopens the same form.
 *
 * pending_review → under_review → changes_required → resubmitted →
 * active / declined
 */

export const RegistrationStatusSchema = z.enum([
  'pending_review',
  'under_review',
  'changes_required',
  'resubmitted',
  'active',
  'declined',
]);
export type RegistrationStatus = z.infer<typeof RegistrationStatusSchema>;

export const REG_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const RegDayHoursSchema = z.object({
  open: z.string(),
  close: z.string(),
  closed: z.boolean(),
  split: z.boolean(),
  open2: z.string(),
  close2: z.string(),
});

/** What a brand-new salon can pick to start with — the platform's
 *  starter templates (the prototype's demo catalog, verbatim). */
export const REG_SERVICE_TEMPLATES: {
  key: string;
  name: string;
  category: string;
  durationMin: number;
  price: number;
}[] = [
  { key: 'physio-session', name: 'Physiotherapy session', category: 'Manual therapy', durationMin: 45, price: 1800 },
  { key: 'manual-spine', name: 'Manual therapy, spine', category: 'Manual therapy', durationMin: 60, price: 2400 },
  { key: 'follow-up', name: 'Follow-up session', category: 'Manual therapy', durationMin: 30, price: 1200 },
  { key: 'rehab-training', name: 'Rehab training', category: 'Rehab', durationMin: 60, price: 1500 },
  { key: 'medical-taping', name: 'Medical taping', category: 'Recovery', durationMin: 30, price: 900 },
  { key: 'sports-assessment', name: 'Sports injury assessment', category: 'Assessment', durationMin: 50, price: 2200 },
  { key: 'dry-needling', name: 'Dry needling', category: 'Recovery', durationMin: 30, price: 1400 },
  { key: 'sports-massage', name: 'Sports massage', category: 'Recovery', durationMin: 45, price: 1900 },
];

/** One service the salon creates during registration. Name, price and
 *  duration are its own; the category is a name from the HQ taxonomy. */
export const RegServiceSchema = z.object({
  name: z.string().min(1).max(80),
  category: z.string().min(1),
  durationMin: z.number().int().positive(),
  price: z.number().int().nonnegative(),
});
export type RegService = z.infer<typeof RegServiceSchema>;

/** The Velnes service taxonomy, for the anonymous registration wizard. */
export const PublicServiceCategoryListSchema = z.object({
  categories: z.array(z.string()),
});

export const RegistrationDraftSchema = z.object({
  acct: z.object({
    name: z.string().min(1),
    email: z.email(),
    pass: z.string().min(6),
  }),
  salon: z.object({
    name: z.string().min(1),
    type: z.string().default('Physiotherapy'),
    phone: z.string().default(''),
    langs: z.string().default('MK, EN'),
  }),
  legal: z.object({
    name: z.string().min(1),
    taxId: z.string().min(1),
    vat: z.string().default(''),
    currency: z.string().default('MKD'),
  }),
  loc: z.object({
    street: z.string().min(1),
    no: z.string().default(''),
    city: z.string().min(1),
    zip: z.string().default(''),
    lat: z.number().nullable().default(null),
    lng: z.number().nullable().default(null),
  }),
  // The salon writes its own services; the category is picked from the
  // Velnes taxonomy HQ curates (a name from /service-categories).
  services: z.array(RegServiceSchema).min(1),
  gallery: z.array(z.string()).default([]),
  team: z.array(z.object({ name: z.string(), email: z.email() })).default([]),
  hours: z.record(z.enum(REG_DAYS), RegDayHoursSchema),
});
export type RegistrationDraft = z.infer<typeof RegistrationDraftSchema>;

/** Import from your own website: the owner pastes one link, the server
 *  fetches it (with SSRF guards) and reads the structured data on the
 *  page — JSON-LD, OpenGraph, microdata — into a partial draft the
 *  wizard pre-fills. Best-effort; the owner reviews everything. */
export const RegistrationImportRequestSchema = z.object({
  url: z.string().url().max(2048),
});
export const RegistrationImportResultSchema = z.object({
  source: z.string(),
  /** Human labels of what was filled, for the "we found …" summary. */
  found: z.array(z.string()),
  salon: z
    .object({ name: z.string().optional(), phone: z.string().optional(), type: z.string().optional() })
    .default({}),
  legal: z.object({ name: z.string().optional() }).default({}),
  loc: z
    .object({
      street: z.string().optional(),
      no: z.string().optional(),
      city: z.string().optional(),
      zip: z.string().optional(),
    })
    .default({}),
  /** Raw service names found on the page, shown as hints. */
  serviceNames: z.array(z.string()).default([]),
  hours: z
    .array(
      z.object({
        day: z.enum(REG_DAYS),
        open: z.string(),
        close: z.string(),
        closed: z.boolean(),
      }),
    )
    .default([]),
});
export type RegistrationImportResult = z.infer<typeof RegistrationImportResultSchema>;

export const RegistrationCreateResponseSchema = z.object({
  id: z.uuid(),
  status: RegistrationStatusSchema,
  // The applicant's own door back in — kept client-side; SMTP will
  // carry it by mail once a provider is decided.
  resubmitToken: z.uuid(),
});

export const RegistrationStatusResponseSchema = z.object({
  id: z.uuid(),
  status: RegistrationStatusSchema,
  hqReason: z.string().nullable(),
  draft: RegistrationDraftSchema.omit({ acct: true }).extend({
    acct: z.object({ name: z.string(), email: z.string() }), // never the password back out
  }),
});

/** HQ's view of the queue. */
export const HqRegistrationSchema = z.object({
  id: z.uuid(),
  ts: z.iso.datetime(),
  status: RegistrationStatusSchema,
  salonName: z.string(),
  salonType: z.string(),
  ownerName: z.string(),
  ownerEmail: z.string(),
  city: z.string(),
  legalName: z.string(),
  taxId: z.string(),
  emailVerifiedAt: z.iso.datetime().nullable(),
  hqReason: z.string().nullable(),
  businessId: z.uuid().nullable(),
});
export const HqRegistrationListSchema = z.object({
  registrations: z.array(HqRegistrationSchema),
});

export const HqApproveResponseSchema = z.object({
  businessId: z.uuid(),
  locationId: z.uuid(),
  ownerEmail: z.string(),
});
