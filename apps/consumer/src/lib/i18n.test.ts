import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { en, mk, sq } from '@velnes/i18n';
import { describe, expect, it } from 'vitest';

/**
 * `t()` accepts any string, so a mistyped key renders as the key itself
 * and nobody notices until a customer does. Every `c.*` key the app
 * mentions must exist in the source dictionary — and, by the typed
 * dictionaries and the completeness test, therefore in mk and sq too.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

const SRC = join(import.meta.dirname, '..');

describe('the consumer dictionary', () => {
  it('has every c.* key the app uses', () => {
    const used = new Set<string>();
    for (const f of walk(SRC)) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/['"`](c\.[a-zA-Z0-9_.]+)['"`]/g)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(0);
    const missing = [...used].filter((k) => !(k in en)).sort();
    expect(missing, 'keys used but not in en.ts').toEqual([]);
  });

  it('is complete in Macedonian and Albanian, and not English by accident', () => {
    const keys = Object.keys(en).filter((k) => k.startsWith('c.')) as (keyof typeof en)[];
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(mk[k], `mk ${k}`).toBeTruthy();
      expect(sq[k], `sq ${k}`).toBeTruthy();
    }
    // Brand words, numbers and phone formats legitimately match; prose
    // should not.
    const same = keys.filter(
      (k) => en[k].length > 12 && /[a-z]{3}/i.test(en[k]) && (mk[k] === en[k] || sq[k] === en[k]),
    );
    expect(same, 'untranslated prose').toEqual([]);
  });
});
