import { z } from 'zod';
import { MoneySchema } from './catalog.js';

/**
 * Last-minute offers & the Velnes Premium pipeline (Phase 9).
 * Nothing stacks: an offer is a whole alternative, and priceFor
 * compares alternatives — it never adds discounts up.
 */

/** The owner's morning defaults: first VIP (Premium), then everyone. */
export const OFFER_DEFAULTS = { vipPct: 40, publicPct: 25, vipUntilMin: 60 } as const;

/** Suitability, transparently weighed — no black box. At-risk counts
 *  as a soft signal, never a requirement. */
export const MATCH = {
  SVC: 30,
  EMP: 15,
  WD: 10,
  BAND: 10,
  ATRISK: 15,
  RELIABLE: 10,
  FATIGUE: -12,
  FATIGUE_DAYS: 14,
  SVC_MIN: 3,
} as const;

/** The HQ-set Premium rules document — read-only in the salon.
 *  Config tunes the game, never one player. */
export const PREMIUM_RULES = {
  enabled: true,
  loyaltyMult: 1.5,
  version: '2026-08.1',
  maxDiscountPct: 50,
  minLeadMin: 120,
  priorityMin: 60,
  escalationMin: 30,
  publicFallback: true,
} as const;

export const CapacitySlotSchema = z.object({
  id: z.string(), // capId — locationId|date|empId|start
  locationId: z.uuid(),
  date: z.iso.date(),
  empId: z.uuid(),
  empName: z.string(),
  start: z.string(), // the customer-facing start (after prep)
  blockStart: z.string(),
  dur: z.number().int(),
  prepMin: z.number().int(),
  resetMin: z.number().int(),
  operationalMin: z.number().int(),
  serviceId: z.uuid(),
  serviceName: z.string(),
  variantId: z.uuid().nullable(),
  price: MoneySchema,
  gap: z.number().int(),
});
export type CapacitySlot = z.infer<typeof CapacitySlotSchema>;
export const CapacityResponseSchema = z.object({
  slots: z.array(CapacitySlotSchema),
  value: MoneySchema, // what the empty time is worth at list price
});

export const OfferPhaseSchema = z.object({
  startsAt: z.string(), // HH:MM; empty start = immediately
  endsAt: z.string().nullable(), // null = until the appointment starts
  audience: z.enum(['PUBLIC', 'PREMIUM_MEMBERS', 'SPECIFIC_CUSTOMERS']),
  customerIds: z.array(z.uuid()).default([]),
  discountType: z.enum(['percentage_discount', 'fixed_promo_price']),
  discountValue: z.number(),
});
export type OfferPhase = z.infer<typeof OfferPhaseSchema>;

export const LastMinuteOfferSchema = z.object({
  id: z.uuid(),
  locationId: z.uuid(),
  date: z.iso.date(),
  slotIds: z.array(z.string()),
  slots: z.record(z.string(), CapacitySlotSchema),
  phases: z.array(OfferPhaseSchema),
  status: z.enum(['live', 'ended']),
  createdAt: z.iso.datetime(),
});
export const OfferListSchema = z.object({ offers: z.array(LastMinuteOfferSchema) });

export const OfferCreateSchema = z.object({
  locationId: z.uuid(),
  date: z.iso.date(),
  pickedSlotIds: z.array(z.string()).min(1),
  vipPct: z.number().min(0).max(100),
  vipFrom: z.string(),
  vipUntil: z.string(),
  publicOn: z.boolean(),
  publicPct: z.number().min(0).max(100),
});

export const MemberCandidateSchema = z.object({
  cid: z.uuid(),
  name: z.string(),
  score: z.number(),
  why: z.array(z.string()),
});
export const MemberRecSchema = z.object({
  id: z.uuid(),
  locationId: z.uuid(),
  date: z.iso.date(),
  start: z.string(),
  end: z.string(),
  serviceId: z.uuid(),
  serviceName: z.string(),
  variantId: z.uuid().nullable(),
  employeeId: z.uuid().nullable(),
  employeeName: z.string().nullable(),
  normalPrice: MoneySchema,
  recPct: z.number().int(),
  recPrice: MoneySchema,
  candidates: z.array(MemberCandidateSchema),
  status: z.enum(['pending', 'approved', 'declined']),
  offerId: z.uuid().nullable(),
});
export const MemberRecListSchema = z.object({ recommendations: z.array(MemberRecSchema) });

export const PremiumOfferSchema = z.object({
  id: z.uuid(),
  locationId: z.uuid(),
  date: z.iso.date(),
  start: z.string(),
  end: z.string(),
  serviceId: z.uuid(),
  serviceName: z.string(),
  variantId: z.uuid().nullable(),
  normalPrice: MoneySchema,
  pct: z.number().int(),
  price: MoneySchema,
  candidates: z.array(MemberCandidateSchema),
  stage: z.number().int(), // 1 best member · 2 member group · 3 public
  status: z.enum(['live', 'done']),
});
export const PremiumOfferListSchema = z.object({ offers: z.array(PremiumOfferSchema) });

export const DiscountCodeTypeSchema = z.enum(['Percentage', 'Fixed amount']);

export const DiscountCodeRowSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  type: DiscountCodeTypeSchema,
  value: z.number(),
  used: z.number().int(),
  usageLimit: z.number().int().nullable(),
  starts: z.iso.date(),
  ends: z.iso.date(),
  /** The owner's switch — off pauses the code everywhere at once. */
  active: z.boolean(),
  status: z.enum(['Active', 'Scheduled', 'Expired', 'Off']),
});
export const DiscountCodeListSchema = z.object({ codes: z.array(DiscountCodeRowSchema) });

/** A new code: upper-cased, letters/digits/dashes, a window, an optional cap. */
export const DiscountCodeCreateSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3)
      .max(24)
      .regex(/^[A-Za-z0-9-]+$/, 'Letters, digits and dashes only')
      .transform((c) => c.toUpperCase()),
    type: DiscountCodeTypeSchema,
    value: z.number().int().positive(),
    starts: z.iso.date(),
    ends: z.iso.date(),
    usageLimit: z.number().int().positive().nullable().default(null),
  })
  .refine((c) => c.type !== 'Percentage' || c.value <= 100, { message: 'A percentage cannot exceed 100', path: ['value'] })
  .refine((c) => c.ends >= c.starts, { message: 'The end date is before the start', path: ['ends'] });
export type DiscountCodeCreate = z.infer<typeof DiscountCodeCreateSchema>;

export const DiscountCodePatchSchema = z.object({
  active: z.boolean().optional(),
  usageLimit: z.number().int().positive().nullable().optional(),
  ends: z.iso.date().optional(),
});
export type DiscountCodePatch = z.infer<typeof DiscountCodePatchSchema>;
