/**
 * Document formatting (invoicing phase 4, 2026-10-07) — the one place
 * integer minor units, basis points and thousandth quantities become
 * strings for the accounting PDF. Pure integer arithmetic: nothing is
 * divided in floating point, nothing is rounded here — the figures
 * arrive final from billing-math and are only spelled out. The
 * language chooses the separators; it never changes an amount.
 *
 *   mk / sq   5.150,00 MKD     (thousands '.', decimals ',')
 *   en        5,150.00 MKD
 *
 * Negative values render with a leading minus so credit notes (a later
 * phase) print through the same door.
 */

export const BILLING_LANGS = ['mk', 'sq', 'en'] as const;
export type BillingLang = (typeof BILLING_LANGS)[number];

const SEPS: Record<BillingLang, { group: string; decimal: string }> = {
  mk: { group: '.', decimal: ',' },
  sq: { group: '.', decimal: ',' },
  en: { group: ',', decimal: '.' },
};

function assertInt(n: number, what: string) {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what} must be a safe integer, got ${n}`);
}

const groupDigits = (digits: string, sep: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);

/** `515000` → `5.150,00`; `-1` → `-0,01`; `0` → `0,00`. No currency. */
export function formatMinorNumber(minor: number, lang: BillingLang): string {
  assertInt(minor, 'minor');
  const s = SEPS[lang];
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.trunc(abs / 100);
  const cents = abs - whole * 100;
  return `${neg ? '-' : ''}${groupDigits(String(whole), s.group)}${s.decimal}${String(cents).padStart(2, '0')}`;
}

/** `515000, 'MKD'` → `5.150,00 MKD`. */
export function formatMoneyMinor(minor: number, currency: string, lang: BillingLang): string {
  return `${formatMinorNumber(minor, lang)} ${currency}`;
}

/** Quantities in thousandths: `1000` → `1`; `1500` → `1,5`; `250` → `0,25`; `2005` → `2,005`. */
export function formatQtyMilli(milli: number, lang: BillingLang): string {
  assertInt(milli, 'milli');
  const s = SEPS[lang];
  const neg = milli < 0;
  const abs = Math.abs(milli);
  const whole = Math.trunc(abs / 1000);
  const frac = String(abs - whole * 1000).padStart(3, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${groupDigits(String(whole), s.group)}${frac ? `${s.decimal}${frac}` : ''}`;
}

/** Basis points as a rate: `1800` → `18%`; `550` → `5,5%`; `0` → `0%`. */
export function formatPctBp(bp: number, lang: BillingLang): string {
  assertInt(bp, 'bp');
  const s = SEPS[lang];
  const whole = Math.trunc(bp / 100);
  const frac = String(bp - whole * 100).padStart(2, '0').replace(/0+$/, '');
  return `${whole}${frac ? `${s.decimal}${frac}` : ''}%`;
}

/** An ISO date as the document prints it, `07.10.2026` in every language. */
export function formatDocDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new RangeError(`not an ISO date: ${iso}`);
  return `${m[3]}.${m[2]}.${m[1]}`;
}
