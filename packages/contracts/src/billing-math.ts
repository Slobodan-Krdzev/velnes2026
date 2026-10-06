/**
 * Billing math (Alex, 2026-10-06) — docs/INVOICING-PLAN.md C.5 / Phase 0.
 *
 * The one place money arithmetic lives. Everything is an integer:
 * amounts in the caller's minor unit (deni for the accounting invoice,
 * whole denars where the till ledger still speaks denars — the maths is
 * scale-free), VAT rates in basis points (1800 = 18 %), quantities in
 * thousandths (2000 = 2 units) so fractional units stay integer too.
 * Products are taken through BigInt so no intermediate ever meets a
 * floating-point number. Rounding is half-up, away from zero, applied
 * once per line; totals are sums of rounded lines and nothing else.
 *
 * Invariants every function keeps: `net + vat === gross` for a line;
 * `summarize(lines)` is Σ of the lines, by rate and in total.
 */

/** Basis points: 18 % → 1800. */
export const BP_DENOM = 10_000;
/** Quantities are integers in thousandths. */
export const QTY_DENOM = 1_000;

export const bp = (percent: number): number => Math.round(percent * 100);
export const qty = (units: number): number => Math.round(units * QTY_DENOM);

const assertInt = (n: number, what: string) => {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what} must be a safe integer, got ${n}`);
};

/** (a × b) ÷ den, rounded half-up (half away from zero), in integers. */
export function mulDivHalfUp(a: number, b: number, den: number): number {
  assertInt(a, 'a');
  assertInt(b, 'b');
  assertInt(den, 'den');
  if (den === 0) throw new RangeError('division by zero');
  const num = BigInt(a) * BigInt(b);
  const d = BigInt(den);
  const neg = num < 0n !== d < 0n;
  const an = num < 0n ? -num : num;
  const ad = d < 0n ? -d : d;
  const q = (an + ad / 2n) / ad; // half-up on the absolute value
  const out = neg ? -q : q;
  const n = Number(out);
  if (!Number.isSafeInteger(n)) throw new RangeError('result exceeds a safe integer');
  return n;
}

export interface VatSplit {
  net: number;
  vat: number;
  gross: number;
  rateBp: number;
}

/** A VAT-inclusive amount: the VAT inside it, the net left over. */
export function splitGross(gross: number, rateBp: number): VatSplit {
  assertInt(gross, 'gross');
  assertInt(rateBp, 'rateBp');
  if (rateBp < 0) throw new RangeError('negative VAT rate');
  const vat = rateBp === 0 ? 0 : mulDivHalfUp(gross, rateBp, BP_DENOM + rateBp);
  return { net: gross - vat, vat, gross, rateBp };
}

/** A net amount: the VAT on top, the gross it makes. */
export function addVat(net: number, rateBp: number): VatSplit {
  assertInt(net, 'net');
  assertInt(rateBp, 'rateBp');
  if (rateBp < 0) throw new RangeError('negative VAT rate');
  const vat = rateBp === 0 ? 0 : mulDivHalfUp(net, rateBp, BP_DENOM);
  return { net, vat, gross: net + vat, rateBp };
}

export interface LineInput {
  /** Quantity in thousandths (`qty(2)` = 2000). */
  qtyMilli: number;
  /** Unit price in minor units, in the pricing basis (gross when
   *  `pricesIncludeVat`, net otherwise). */
  unitPrice: number;
  /** Line discount in minor units, same basis; never below zero. */
  discount?: number;
  /** The line's share of an invoice-level discount, same basis. */
  allocatedDiscount?: number;
  rateBp: number;
  pricesIncludeVat: boolean;
  /** A non-registered issuer charges no VAT whatever the catalog says. */
  vatRegistered?: boolean;
}

export interface LineResult extends VatSplit {
  /** qty × unit price, rounded once. */
  extended: number;
  /** extended − discounts, floored at zero — the amount in the pricing basis. */
  amount: number;
  discount: number;
  allocatedDiscount: number;
  exempt: boolean;
}

/** One line, rounded once: the amount in its basis, then net/VAT/gross. */
export function computeLine(l: LineInput): LineResult {
  assertInt(l.qtyMilli, 'qtyMilli');
  assertInt(l.unitPrice, 'unitPrice');
  const discount = l.discount ?? 0;
  const allocated = l.allocatedDiscount ?? 0;
  assertInt(discount, 'discount');
  assertInt(allocated, 'allocatedDiscount');
  if (l.qtyMilli < 0 || discount < 0 || allocated < 0) throw new RangeError('negative quantity or discount');
  const extended = mulDivHalfUp(l.qtyMilli, l.unitPrice, QTY_DENOM);
  const amount = Math.max(0, extended - discount - allocated);
  const registered = l.vatRegistered ?? true;
  const rateBp = registered ? l.rateBp : 0;
  const split = l.pricesIncludeVat || !registered ? splitGross(amount, rateBp) : addVat(amount, rateBp);
  return { ...split, extended, amount, discount, allocatedDiscount: allocated, exempt: !registered };
}

export type RateTotal = VatSplit;
export interface Totals {
  net: number;
  vat: number;
  gross: number;
  byRate: RateTotal[];
}

/** Sums — never a second formula. By rate ascending, then the whole. */
export function summarize(lines: readonly VatSplit[]): Totals {
  const by = new Map<number, RateTotal>();
  let net = 0;
  let vat = 0;
  let gross = 0;
  for (const l of lines) {
    const r = by.get(l.rateBp) ?? { rateBp: l.rateBp, net: 0, vat: 0, gross: 0 };
    r.net += l.net;
    r.vat += l.vat;
    r.gross += l.gross;
    by.set(l.rateBp, r);
    net += l.net;
    vat += l.vat;
    gross += l.gross;
  }
  return { net, vat, gross, byRate: [...by.values()].sort((a, b) => a.rateBp - b.rateBp) };
}

/**
 * Spread a whole-invoice discount over lines in proportion to their
 * weights (their amounts), largest remainder first so the parts sum to
 * the whole exactly; no part exceeds its weight.
 */
export function allocateDiscount(total: number, weights: readonly number[]): number[] {
  assertInt(total, 'total');
  for (const w of weights) assertInt(w, 'weight');
  const sum = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const capped = Math.min(total, sum);
  const floors = weights.map((w) => (w <= 0 ? 0 : Number((BigInt(capped) * BigInt(w)) / BigInt(sum))));
  let left = capped - floors.reduce((s, f) => s + f, 0);
  // Largest remainder: the lines whose exact share lost the most get the leftover.
  const rem = weights.map((w, i) => ({ i, r: w <= 0 ? -1n : (BigInt(capped) * BigInt(w)) % BigInt(sum) }));
  rem.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of rem) {
    if (left <= 0) break;
    if (floors[i]! < weights[i]!) {
      floors[i]! += 1;
      left -= 1;
    }
  }
  return floors;
}
