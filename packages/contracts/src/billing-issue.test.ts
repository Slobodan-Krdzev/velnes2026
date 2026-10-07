import { describe, expect, it } from 'vitest';
import { splitGross } from './billing-math.js';
import {
  daysBetween,
  evaluateIssueReadiness,
  formatInvoiceNumber,
  isKnownTimeZone,
  type BillingBuyerSnapshot,
  type BillingOrigin,
} from './billing.js';

/** Issuing (phase 3): the number string, the clock check and the one
 *  readiness evaluator the GET door reports and the issue door refuses on. */

const complete = { complete: true, missing: [], invalid: [] };
const company: BillingBuyerSnapshot = {
  billingCustomerId: null, customerId: null, kind: 'company', name: 'Nova Health DOO', address: 'Ilinden 5', city: 'Skopje', zip: '1000',
  country: 'North Macedonia', edb: 'MK4032011501234', vatRegNo: '', email: '', phone: '',
};
const lineOf = (src: number, disc: number, rateBp: number, registered = true) => {
  const gross = src - disc;
  const s = registered ? splitGross(gross, rateBp) : { net: gross, vat: 0 };
  return { sourceAmountMinor: src, allocatedDiscountMinor: disc, vatRateBp: registered ? rateBp : 0, exempt: !registered, netMinor: s.net, vatMinor: s.vat, grossMinor: gross };
};
function doc(registered = true) {
  const lines = [lineOf(150000, 3000, 1800, registered), lineOf(85000, 2000, 500, registered)];
  const sum = (k: 'netMinor' | 'vatMinor' | 'grossMinor' | 'allocatedDiscountMinor') => lines.reduce((s, l) => s + l[k], 0);
  const rates = [...new Set(lines.map((l) => l.vatRateBp))];
  const origin: BillingOrigin = {
    saleNumber: 'AER-2026-0001', saleDate: '2026-10-06', method: 'Card', employeeName: 'Maria', saleTotalMinor: sum('grossMinor') + 10000,
    linesMinor: 235000, cartDiscountMinor: 5000, promoMinor: 0, loyaltyMinor: 0, giftTenderMinor: 0, tipMinor: 10000, flags: ['tip_excluded'],
  };
  return {
    issuer: complete,
    buyer: company,
    location: { locationId: '20000000-0000-4000-8000-000000000002', tz: 'Europe/Skopje' },
    vatRegistered: registered,
    pricesIncludeVat: true,
    supplyDate: '2026-10-06',
    issueDate: '2026-10-07',
    dueDate: null as string | null,
    lines,
    totals: { netMinor: sum('netMinor'), vatMinor: sum('vatMinor'), grossMinor: sum('grossMinor'), discountMinor: sum('allocatedDiscountMinor') },
    vatBreakdown: rates.map((r) => ({
      rateBp: r,
      netMinor: lines.filter((l) => l.vatRateBp === r).reduce((s, l) => s + l.netMinor, 0),
      vatMinor: lines.filter((l) => l.vatRateBp === r).reduce((s, l) => s + l.vatMinor, 0),
      grossMinor: lines.filter((l) => l.vatRateBp === r).reduce((s, l) => s + l.grossMinor, 0),
    })),
    origin,
    sale: { status: 'Paid', totalMinor: origin.saleTotalMinor, tipMinor: 10000, serviceChargeMinor: 0, giftMinor: 0 },
  };
}
const problemsOf = (r: ReturnType<typeof evaluateIssueReadiness>) => r.problems.map((p) => `${p.part}.${p.field}:${p.reason}`);

describe('the legal number', () => {
  it('renders prefix, year, dash and the padded sequence — 2026-000001 by default', () => {
    expect(formatInvoiceNumber({ prefix: '', year: 2026, seq: 1, width: 6 })).toBe('2026-000001');
    expect(formatInvoiceNumber({ prefix: 'KO-', year: 2026, seq: 7, width: 6 })).toBe('KO-2026-000007');
    expect(formatInvoiceNumber({ prefix: 'INV-', year: 2027, seq: 1234, width: 4 })).toBe('INV-2027-1234');
    // Wider than the width: never cut.
    expect(formatInvoiceNumber({ prefix: '', year: 2026, seq: 123456789, width: 4 })).toBe('2026-123456789');
  });
  it('refuses parts that could not have come from the issue door', () => {
    expect(() => formatInvoiceNumber({ prefix: '', year: 2026, seq: 0, width: 6 })).toThrow();
    expect(() => formatInvoiceNumber({ prefix: '', year: 1999, seq: 1, width: 6 })).toThrow();
    expect(() => formatInvoiceNumber({ prefix: 'inv', year: 2026, seq: 1, width: 6 })).toThrow();
    expect(() => formatInvoiceNumber({ prefix: '', year: 2026, seq: 1, width: 3 })).toThrow();
  });
});

describe('the clock', () => {
  it('knows IANA zones and nothing else', () => {
    expect(isKnownTimeZone('Europe/Skopje')).toBe(true);
    expect(isKnownTimeZone('Pacific/Kiritimati')).toBe(true);
    expect(isKnownTimeZone('Mars/Olympus')).toBe(false);
    expect(isKnownTimeZone('')).toBe(false);
  });
  it('counts calendar days between ISO dates', () => {
    expect(daysBetween('2026-10-06', '2026-10-07')).toBe(1);
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
    expect(daysBetween('2026-10-07', '2026-10-06')).toBe(-1);
  });
});

describe('issue readiness', () => {
  it('a complete, reconciled, VAT-registered document is ready', () => {
    const r = evaluateIssueReadiness(doc());
    expect(r.problems).toEqual([]);
    expect(r.ready).toBe(true);
    expect(r.warnings).toEqual([]);
  });
  it('a non-registered document is ready when its lines carry no VAT', () => {
    const r = evaluateIssueReadiness(doc(false));
    expect(r.ready, JSON.stringify(r.problems)).toBe(true);
  });
  it('repeats the issuer problems Phase 1 found, unchanged', () => {
    const r = evaluateIssueReadiness({ ...doc(), issuer: { complete: false, missing: ['signatoryName'], invalid: [{ field: 'legalName', reason: 'unverified' }] } });
    expect(problemsOf(r)).toEqual(['issuer.signatoryName:missing', 'issuer.legalName:unverified']);
  });
  it('an incomplete company buyer blocks; an absent buyer only warns', () => {
    const r = evaluateIssueReadiness({ ...doc(), buyer: { ...company, address: '', edb: '' } });
    expect(problemsOf(r)).toEqual(['buyer.address:missing', 'buyer.edb:missing']);
    const w = evaluateIssueReadiness({ ...doc(), buyer: null });
    expect(w.ready).toBe(true);
    expect(w.warnings).toEqual([{ code: 'buyer_absent', params: {} }]);
  });
  it('an unknown clock at the place of supply blocks', () => {
    expect(problemsOf(evaluateIssueReadiness({ ...doc(), location: { locationId: 'x', tz: 'Mars/Olympus' } }))).toEqual(['location.tz:invalid']);
  });
  it('dates: supply after issue blocks, due before issue blocks, a long gap only warns', () => {
    expect(problemsOf(evaluateIssueReadiness({ ...doc(), supplyDate: '2026-10-08' }))).toEqual(['dates.supplyDate:invalid']);
    expect(problemsOf(evaluateIssueReadiness({ ...doc(), dueDate: '2026-10-01' }))).toEqual(['dates.dueDate:invalid']);
    const r = evaluateIssueReadiness({ ...doc(), supplyDate: '2026-09-20' });
    expect(r.ready).toBe(true);
    expect(r.warnings).toEqual([{ code: 'supply_to_issue_gap', params: { days: 17 } }]);
  });
  it('money: a tampered line, total, breakdown or discount is a mismatch', () => {
    const d = doc();
    const l0 = d.lines[0]!;
    expect(problemsOf(evaluateIssueReadiness({ ...d, lines: [{ ...l0, vatMinor: l0.vatMinor + 1, netMinor: l0.netMinor - 1 }, d.lines[1]!] }))).toContain('money.line:mismatch');
    expect(problemsOf(evaluateIssueReadiness({ ...d, totals: { ...d.totals, grossMinor: d.totals.grossMinor + 100 } }))).toContain('money.totals:mismatch');
    expect(problemsOf(evaluateIssueReadiness({ ...d, totals: { ...d.totals, discountMinor: 0 } }))).toContain('money.discount:mismatch');
    expect(problemsOf(evaluateIssueReadiness({ ...d, vatBreakdown: d.vatBreakdown.slice(0, 1) }))).toContain('money.vatBreakdown:mismatch');
    expect(problemsOf(evaluateIssueReadiness({ ...d, lines: [] }))).toContain('money.lines:missing');
  });
  it('origin: the sale equation must hold both ways, and the sale must still be what it was', () => {
    const d = doc();
    expect(problemsOf(evaluateIssueReadiness({ ...d, origin: { ...d.origin, tipMinor: 0 } }))).toContain('money.origin:mismatch');
    expect(problemsOf(evaluateIssueReadiness({ ...d, sale: { ...d.sale, status: 'Refunded' } }))).toEqual(['sale.status:changed']);
    expect(problemsOf(evaluateIssueReadiness({ ...d, sale: { ...d.sale, totalMinor: d.sale.totalMinor + 100 } }))).toEqual(['sale.amounts:changed']);
    expect(problemsOf(evaluateIssueReadiness({ ...d, sale: { ...d.sale, serviceChargeMinor: 5000 } }))).toEqual(['sale.serviceCharge:invalid']);
    expect(problemsOf(evaluateIssueReadiness({ ...d, sale: null }))).toEqual(['sale.sale:missing']);
  });
});
