import { describe, expect, it } from 'vitest';
import { addVat, allocateDiscount, bp, computeLine, mulDivHalfUp, qty, splitGross, summarize } from './billing-math.js';

/** Billing math (Phase 0): integers only, half-up once per line, totals
 *  as sums. Amounts here are deni (1000.00 MKD = 100000). */
const MKD = (d: number) => Math.round(d * 100);

describe('rounding', () => {
  it('rounds half up, away from zero, in integers', () => {
    expect(mulDivHalfUp(5, 1, 2)).toBe(3); // 2.5 → 3
    expect(mulDivHalfUp(-5, 1, 2)).toBe(-3); // −2.5 → −3
    expect(mulDivHalfUp(7, 1, 2)).toBe(4);
    expect(mulDivHalfUp(1, 1, 3)).toBe(0);
    expect(mulDivHalfUp(2, 1, 3)).toBe(1);
  });
  it('survives products beyond 2^53 without floating point', () => {
    // 10 million MKD in deni × 1800 bp overflows a double's integer range as a product.
    expect(() => mulDivHalfUp(1_000_000_000, 1800, 11800)).not.toThrow();
    expect(splitGross(1_000_000_000, 1800).vat).toBe(152_542_373); // 1e9 × 18/118 = 152542372.88… → half-up
  });
  it('refuses non-integers', () => {
    expect(() => splitGross(10.5, 1800)).toThrow(RangeError);
    expect(() => addVat(100, 18.5)).toThrow(RangeError);
  });
});

describe('VAT-inclusive prices', () => {
  it('1000 MKD at 18 % holds 152.54 VAT and 847.46 net', () => {
    const s = splitGross(MKD(1000), bp(18));
    expect(s).toMatchObject({ net: 84746, vat: 15254, gross: 100000 });
    expect(s.net + s.vat).toBe(s.gross);
  });
  it('1000 MKD at 5 %: 47.62 VAT, 952.38 net', () => {
    expect(splitGross(MKD(1000), bp(5))).toMatchObject({ net: 95238, vat: 4762 });
  });
  it('1000 MKD at 10 %: 90.91 VAT, 909.09 net', () => {
    expect(splitGross(MKD(1000), bp(10))).toMatchObject({ net: 90909, vat: 9091 });
  });
  it('zero rate: all net', () => {
    expect(splitGross(MKD(1000), 0)).toMatchObject({ net: 100000, vat: 0, gross: 100000 });
  });
  it('tiny and awkward amounts still reconcile', () => {
    for (const g of [1, 2, 3, 7, 11, 59, 99, 118, 119, 1177, 12345]) {
      for (const r of [0, 500, 1000, 1800, 2500]) {
        const s = splitGross(g, r);
        expect(s.net + s.vat).toBe(g);
        expect(s.vat).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('VAT-exclusive prices', () => {
  it('adds VAT on top with half-up: 847.46 net at 18 % → 152.54 VAT', () => {
    expect(addVat(84746, bp(18))).toMatchObject({ vat: 15254, gross: 100000 });
  });
  it('1 deni at 18 % rounds its VAT to 0; 3 deni rounds to 1', () => {
    expect(addVat(1, 1800).vat).toBe(0);
    expect(addVat(3, 1800).vat).toBe(1);
  });
});

describe('a line', () => {
  it('quantity and discounts apply before VAT, once', () => {
    // 3 × 350.00, 100.00 off the line, 25.00 allocated from the cart, gross-priced at 18 %.
    const l = computeLine({ qtyMilli: qty(3), unitPrice: MKD(350), discount: MKD(100), allocatedDiscount: MKD(25), rateBp: bp(18), pricesIncludeVat: true });
    expect(l.extended).toBe(MKD(1050));
    expect(l.amount).toBe(MKD(925));
    expect(l.gross).toBe(MKD(925));
    expect(l.net + l.vat).toBe(l.gross);
    expect(l.vat).toBe(mulDivHalfUp(MKD(925), 1800, 11800));
  });
  it('fractional quantities stay integer: 1.5 × 199.99', () => {
    const l = computeLine({ qtyMilli: qty(1.5), unitPrice: 19999, rateBp: bp(18), pricesIncludeVat: true });
    expect(l.extended).toBe(29999); // 299.985 → half-up 299.99
  });
  it('a discount larger than the line floors at zero', () => {
    const l = computeLine({ qtyMilli: qty(1), unitPrice: 500, discount: 900, rateBp: 1800, pricesIncludeVat: true });
    expect(l.amount).toBe(0);
    expect(l.vat).toBe(0);
  });
  it('a non-registered issuer charges no VAT whatever the catalog rate says', () => {
    const l = computeLine({ qtyMilli: qty(2), unitPrice: MKD(1000), rateBp: bp(18), pricesIncludeVat: true, vatRegistered: false });
    expect(l).toMatchObject({ net: MKD(2000), vat: 0, gross: MKD(2000), rateBp: 0, exempt: true });
  });
  it('net-priced lines add VAT instead of splitting it', () => {
    const l = computeLine({ qtyMilli: qty(2), unitPrice: MKD(500), rateBp: bp(10), pricesIncludeVat: false });
    expect(l).toMatchObject({ net: MKD(1000), vat: MKD(100), gross: MKD(1100) });
  });
});

describe('totals', () => {
  it('are sums of the rounded lines, by rate and overall — never a second formula', () => {
    const lines = [
      computeLine({ qtyMilli: qty(1), unitPrice: MKD(1000), rateBp: bp(18), pricesIncludeVat: true }),
      computeLine({ qtyMilli: qty(3), unitPrice: MKD(333.33), rateBp: bp(18), pricesIncludeVat: true }),
      computeLine({ qtyMilli: qty(1), unitPrice: MKD(1000), rateBp: bp(5), pricesIncludeVat: true }),
      computeLine({ qtyMilli: qty(2), unitPrice: MKD(49.99), rateBp: bp(10), pricesIncludeVat: true }),
      computeLine({ qtyMilli: qty(1), unitPrice: MKD(250), rateBp: 0, pricesIncludeVat: true }),
    ];
    const t = summarize(lines);
    expect(t.gross).toBe(lines.reduce((s, l) => s + l.gross, 0));
    expect(t.net).toBe(lines.reduce((s, l) => s + l.net, 0));
    expect(t.vat).toBe(lines.reduce((s, l) => s + l.vat, 0));
    expect(t.net + t.vat).toBe(t.gross);
    expect(t.byRate.map((r) => r.rateBp)).toEqual([0, 500, 1000, 1800]);
    for (const r of t.byRate) {
      const mine = lines.filter((l) => l.rateBp === r.rateBp);
      expect(r.gross).toBe(mine.reduce((s, l) => s + l.gross, 0));
      expect(r.net + r.vat).toBe(r.gross);
    }
    // Rounding per line can differ from rounding the total — and that is the point.
    const whole = splitGross(t.gross, bp(18));
    expect(whole.vat).not.toBe(t.vat);
  });
  it('large values keep every invariant', () => {
    const lines = Array.from({ length: 250 }, (_, i) =>
      computeLine({ qtyMilli: qty(i + 1), unitPrice: MKD(99_999.99), rateBp: bp(18), pricesIncludeVat: true }),
    );
    const t = summarize(lines);
    expect(t.net + t.vat).toBe(t.gross);
    expect(Number.isSafeInteger(t.gross)).toBe(true);
  });
});

describe('invoice-level discount allocation', () => {
  it('spreads proportionally and sums to the whole', () => {
    expect(allocateDiscount(100, [100, 200, 300])).toEqual([17, 33, 50]);
    expect(allocateDiscount(10, [100, 100, 100])).toEqual([4, 3, 3]);
    expect(allocateDiscount(0, [5, 5])).toEqual([0, 0]);
  });
  it('never gives a line more than it is worth and caps at the sum of lines', () => {
    expect(allocateDiscount(1000, [100, 50])).toEqual([100, 50]);
    expect(allocateDiscount(7, [0, 7])).toEqual([0, 7]);
  });
  it('the allocated parts feed lines that still reconcile', () => {
    const amounts = [MKD(1000), MKD(333.33), MKD(1)];
    const parts = allocateDiscount(MKD(100), amounts);
    expect(parts.reduce((s, p) => s + p, 0)).toBe(MKD(100));
    const lines = amounts.map((a, i) => computeLine({ qtyMilli: qty(1), unitPrice: a, allocatedDiscount: parts[i]!, rateBp: 1800, pricesIncludeVat: true }));
    const t = summarize(lines);
    expect(t.gross).toBe(amounts.reduce((s, a) => s + a, 0) - MKD(100));
    expect(t.net + t.vat).toBe(t.gross);
  });
});
