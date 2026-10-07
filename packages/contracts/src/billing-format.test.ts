import { describe, expect, it } from 'vitest';
import { formatDocDate, formatMinorNumber, formatMoneyMinor, formatPctBp, formatQtyMilli } from './billing-format.js';

/** The PDF's spelling of integers: separators by language, never a float. */
describe('money in minor units', () => {
  it('spells zero, one deni, whole denars, thousands and large values', () => {
    expect(formatMoneyMinor(0, 'MKD', 'mk')).toBe('0,00 MKD');
    expect(formatMoneyMinor(1, 'MKD', 'mk')).toBe('0,01 MKD');
    expect(formatMoneyMinor(100, 'MKD', 'mk')).toBe('1,00 MKD');
    expect(formatMoneyMinor(515000, 'MKD', 'mk')).toBe('5.150,00 MKD');
    expect(formatMoneyMinor(123456789012, 'MKD', 'mk')).toBe('1.234.567.890,12 MKD');
    expect(formatMoneyMinor(Number.MAX_SAFE_INTEGER, 'MKD', 'en')).toBe('90,071,992,547,409.91 MKD');
  });
  it('language changes the separators, not the amount', () => {
    expect(formatMinorNumber(515000, 'mk')).toBe('5.150,00');
    expect(formatMinorNumber(515000, 'sq')).toBe('5.150,00');
    expect(formatMinorNumber(515000, 'en')).toBe('5,150.00');
  });
  it('is ready for credit notes: negatives carry a leading minus', () => {
    expect(formatMoneyMinor(-515000, 'MKD', 'mk')).toBe('-5.150,00 MKD');
    expect(formatMoneyMinor(-1, 'MKD', 'en')).toBe('-0.01 MKD');
  });
  it('refuses anything that is not a safe integer', () => {
    expect(() => formatMinorNumber(1.5, 'mk')).toThrow(RangeError);
    expect(() => formatMinorNumber(Number.NaN, 'mk')).toThrow(RangeError);
  });
});

describe('quantities in thousandths', () => {
  it('whole quantities print whole', () => {
    expect(formatQtyMilli(1000, 'mk')).toBe('1');
    expect(formatQtyMilli(12000, 'mk')).toBe('12');
    expect(formatQtyMilli(1000000, 'en')).toBe('1,000');
  });
  it('fractions print only the digits they need', () => {
    expect(formatQtyMilli(1500, 'mk')).toBe('1,5');
    expect(formatQtyMilli(250, 'sq')).toBe('0,25');
    expect(formatQtyMilli(2005, 'en')).toBe('2.005');
  });
});

describe('rates and dates', () => {
  it('basis points as a percentage', () => {
    expect(formatPctBp(1800, 'mk')).toBe('18%');
    expect(formatPctBp(500, 'mk')).toBe('5%');
    expect(formatPctBp(550, 'mk')).toBe('5,5%');
    expect(formatPctBp(550, 'en')).toBe('5.5%');
    expect(formatPctBp(0, 'mk')).toBe('0%');
  });
  it('dates as day.month.year', () => {
    expect(formatDocDate('2026-10-07')).toBe('07.10.2026');
    expect(formatDocDate('2026-10-07T07:34:08.778Z')).toBe('07.10.2026');
    expect(() => formatDocDate('7.10.2026')).toThrow(RangeError);
  });
});
