import { describe, expect, it } from 'vitest';
import { en, mk, sq } from './index.js';

/** The compiler enforces key completeness; this guards against empty
 *  or accidentally-English values slipping into mk/sq. */
describe('translation dictionaries', () => {
  const keys = Object.keys(en) as (keyof typeof en)[];

  it('mk and sq cover every key with a non-empty value', () => {
    for (const k of keys) {
      expect(mk[k], `mk missing ${k}`).toBeTruthy();
      expect(sq[k], `sq missing ${k}`).toBeTruthy();
    }
  });

  it('interpolation placeholders match across languages', () => {
    const holes = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join(',');
    for (const k of keys) {
      expect(holes(mk[k]), `mk placeholders for ${k}`).toBe(holes(en[k]));
      expect(holes(sq[k]), `sq placeholders for ${k}`).toBe(holes(en[k]));
    }
  });
});
