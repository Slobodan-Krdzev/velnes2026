/** The prototype's money(): MKD, whole denars. */
export const money = (n: number) =>
  new Intl.NumberFormat('mk-MK', {
    style: 'currency',
    currency: 'MKD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

/** Accounting money: integer minor units (deni) in an ISO currency,
 *  shown with its two decimals — the document's own figures, never
 *  recomputed here (invoicing phase 2, 2026-10-06). */
export const moneyMinor = (minor: number, currency = 'MKD') =>
  new Intl.NumberFormat('mk-MK', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100);

/** A VAT rate in basis points as the document prints it: 1800 → "18%". */
export const pctBp = (bp: number) => `${(bp / 100).toLocaleString('mk-MK', { maximumFractionDigits: 2 })}%`;
