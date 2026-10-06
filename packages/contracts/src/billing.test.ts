import { describe, expect, it } from 'vitest';
import { BillingCustomerWriteSchema, BillingProfileWriteSchema, evaluateBillingProfile } from './billing.js';

/** The one completeness evaluator, on its own (Phase 1, 2026-10-06). */
const base = {
  legalName: 'Velnes Studio DOOEL Skopje',
  edb: 'MK4030026512345',
  vatRegNo: '',
  embs: '7012345',
  entityStatus: 'verified',
  address: 'Partizanski Odredi 14',
  city: 'Skopje',
  zip: '1000',
  country: 'North Macedonia',
  vatRegistered: false,
  defaultCurrency: 'MKD',
  invoicePrefix: '',
  creditPrefix: 'KO-',
  numberWidth: 6,
  defaultVatRateBp: 0,
  signatoryName: 'Maria Petrovska',
  contactEmail: '',
  bankAccount: '',
};

describe('billing profile completeness', () => {
  it('a non-VAT salon is complete without a VAT number', () => {
    expect(evaluateBillingProfile(base)).toEqual({ complete: true, missing: [], invalid: [] });
  });
  it('a VAT-registered salon needs its VAT number, and the number must look like one', () => {
    const r = evaluateBillingProfile({ ...base, vatRegistered: true, defaultVatRateBp: 1800 });
    expect(r.complete).toBe(false);
    expect(r.missing).toEqual(['vatRegNo']);
    const bad = evaluateBillingProfile({ ...base, vatRegistered: true, defaultVatRateBp: 1800, vatRegNo: '12345' });
    expect(bad.invalid).toContainEqual({ field: 'vatRegNo', reason: 'invalid' });
    const ok = evaluateBillingProfile({ ...base, vatRegistered: true, defaultVatRateBp: 1800, vatRegNo: 'MK4030026512345' });
    expect(ok.complete).toBe(true);
  });
  it('a non-VAT salon cannot carry a default VAT rate — nothing may be invented', () => {
    const r = evaluateBillingProfile({ ...base, defaultVatRateBp: 1800 });
    expect(r.invalid).toContainEqual({ field: 'defaultVatRateBp', reason: 'invalid' });
  });
  it('lists every missing identity and seat field by name', () => {
    const r = evaluateBillingProfile({ ...base, legalName: '', edb: '', address: '', city: '', zip: '', country: '', signatoryName: '' });
    expect(r.missing).toEqual(['legalName', 'edb', 'address', 'city', 'zip', 'country', 'signatoryName']);
  });
  it('an unverified entity, a bad currency, a bad series or an equal pair of series is not complete', () => {
    expect(evaluateBillingProfile({ ...base, entityStatus: 'pending' }).invalid).toContainEqual({ field: 'legalName', reason: 'unverified' });
    expect(evaluateBillingProfile({ ...base, defaultCurrency: 'den' }).invalid).toContainEqual({ field: 'defaultCurrency', reason: 'invalid' });
    expect(evaluateBillingProfile({ ...base, invoicePrefix: 'inv/' }).invalid).toContainEqual({ field: 'invoicePrefix', reason: 'invalid' });
    expect(evaluateBillingProfile({ ...base, invoicePrefix: 'KO-' }).invalid).toContainEqual({ field: 'creditPrefix', reason: 'invalid' });
    expect(evaluateBillingProfile({ ...base, numberWidth: 3 }).invalid).toContainEqual({ field: 'numberWidth', reason: 'invalid' });
    expect(evaluateBillingProfile({ ...base, contactEmail: 'nope' }).invalid).toContainEqual({ field: 'contactEmail', reason: 'invalid' });
  });
});

describe('the write contracts', () => {
  it('defaults the numbering to 2026-000001 style and refuses a width outside 4–8', () => {
    const d = BillingProfileWriteSchema.parse({});
    expect(d).toMatchObject({ invoicePrefix: '', creditPrefix: 'KO-', yearlyReset: true, numberWidth: 6, defaultCurrency: 'MKD', issueMode: 'draft', pricesIncludeVat: true });
    expect(BillingProfileWriteSchema.safeParse({ numberWidth: 9 }).success).toBe(false);
    expect(BillingProfileWriteSchema.safeParse({ defaultVatRateBp: 10001 }).success).toBe(false);
    expect(BillingProfileWriteSchema.safeParse({ issueMode: 'now' }).success).toBe(false);
    expect(BillingProfileWriteSchema.safeParse({ defaultCurrency: 'denars' }).success).toBe(false);
    expect(BillingProfileWriteSchema.safeParse({ contactEmail: 'x' }).success).toBe(false);
    expect(BillingProfileWriteSchema.safeParse({ website: 'www.salon.mk' }).success).toBe(true);
    expect(BillingProfileWriteSchema.safeParse({ embs: '12' }).success).toBe(false);
    expect(BillingProfileWriteSchema.safeParse({ vatRegNo: 'mk4030026512345' }).data?.vatRegNo).toBe('MK4030026512345');
  });
  it('a company billing identity needs its seat and ЕДБ; a person needs a name', () => {
    const co = BillingCustomerWriteSchema.safeParse({ kind: 'company', name: 'Nova DOO' });
    expect(co.success).toBe(false);
    expect(co.error?.issues.map((i) => i.path[0]).sort()).toEqual(['address', 'city', 'edb']);
    expect(BillingCustomerWriteSchema.safeParse({ kind: 'company', name: 'Nova DOO', address: 'Ul 1', city: 'Skopje', edb: '4030026512345' }).success).toBe(true);
    expect(BillingCustomerWriteSchema.safeParse({ kind: 'person', name: 'Ana' }).success).toBe(true);
    expect(BillingCustomerWriteSchema.safeParse({ kind: 'person', name: '' }).success).toBe(false);
  });
});
