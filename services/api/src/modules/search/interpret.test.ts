import { describe, expect, it } from 'vitest';
import { interpret, textRelevanceOf, type SearchMatch } from './interpret.js';

/**
 * Step 3 of the Search phase — docs/SEARCH.md.
 *
 * No database here, which is the point: these are the rules, and the
 * most expensive thing in this phase to get wrong is sending somebody to
 * the wrong salon. Every example in the brief has a case below.
 */

const salon = (id: string, display: string, how: SearchMatch['how'] = 'exact'): SearchMatch => ({
  kind: 'salon',
  id,
  display,
  how,
  score: how === 'exact' ? 1 : 0.7,
  salonSlug: id,
});
const category = (id: string, display: string, how: SearchMatch['how'] = 'exact'): SearchMatch => ({
  kind: 'category',
  id,
  display,
  how,
  score: how === 'exact' ? 1 : 0.7,
});
const service = (
  id: string,
  display: string,
  categoryId: string,
  how: SearchMatch['how'] = 'exact',
  score = 0.7,
): SearchMatch => ({
  kind: 'service',
  id,
  display,
  how,
  score: how === 'exact' ? 1 : score,
  categoryId,
  salonSlug: 'a-salon',
});

describe('interpreting a query', () => {
  describe('going straight to a salon', () => {
    it('does when the whole name matches exactly one salon', () => {
      const r = interpret([salon('studio-lumiere', 'Studio Lumière')]);
      expect(r.how).toBe('salon');
      expect(r.directSalon?.slug).toBe('studio-lumiere');
    });

    it('refuses when two salons carry the same name', () => {
      // Not hypothetical: both Barber Shop Labi rows are byte-identical
      // in the real data, so this is the case that actually occurs.
      const name = 'Barber Shop Labi - Pristina, Banesat e Arabve Kulla 3 - Prishtina | Fresha';
      const r = interpret([salon('labi-1', name), salon('labi-2', name)]);
      expect(r.directSalon, 'never guess between two').toBeNull();
      expect(r.ambiguous, 'but say that we knew what they meant').toBe(true);
    });

    it('refuses on a prefix — "Barber Shop Labi" is not the whole name', () => {
      const r = interpret([salon('labi-1', 'Barber Shop Labi …', 'prefix')]);
      expect(r.directSalon).toBeNull();
    });

    it('refuses on a fuzzy match, however close', () => {
      const r = interpret([{ ...salon('studio-lumiere', 'Studio Lumière', 'fuzzy'), score: 0.95 }]);
      expect(r.directSalon, 'a typo must not be able to redirect').toBeNull();
    });

    it('refuses when the text is also a category — "barber" wants options', () => {
      // Somewhere a salon is called Barber. Half the country types the
      // word meaning "cut my hair", and they want a page of choices.
      const r = interpret([salon('barber-co', 'Barber'), category('cat-hair', 'Haircuts')]);
      expect(r.directSalon).toBeNull();
      expect(r.how).toBe('category');
      expect(r.categoryIds).toEqual(['cat-hair']);
    });
  });

  describe('intents and treatments', () => {
    it('reads a category term as an intent', () => {
      const r = interpret([category('cat-massage', 'Massage')]);
      expect(r.how).toBe('category');
      expect(r.categoryIds).toEqual(['cat-massage']);
      expect(r.serviceIds).toEqual([]);
    });

    it('keeps every category when one word honestly means several', () => {
      // "fizio" is Manual therapy and Rehab and Assessment and Recovery.
      const r = interpret([
        category('cat-manual', 'Manual therapy'),
        category('cat-rehab', 'Rehab'),
        category('cat-assess', 'Assessment'),
      ]);
      expect(r.categoryIds).toHaveLength(3);
    });

    it('reads a named treatment, and carries its category with it', () => {
      const r = interpret([service('svc-swedish', 'Swedish Massage', 'cat-massage')]);
      expect(r.how).toBe('service');
      expect(r.serviceIds).toEqual(['svc-swedish']);
      expect(r.categoryIds, 'so the results are not one lonely row').toEqual(['cat-massage']);
    });

    it('takes both when a word is a category and the name of a treatment', () => {
      const r = interpret([
        category('cat-massage', 'Massage'),
        service('svc-massage', 'Massage', 'cat-massage'),
      ]);
      expect(r.categoryIds).toEqual(['cat-massage']);
      expect(r.serviceIds).toEqual(['svc-massage']);
    });

    it('finds what the text resembles when it names nothing — "deep tissue"', () => {
      const r = interpret([
        service('svc-deep', 'Deep Tissue Massage', 'cat-massage', 'fuzzy', 0.82),
      ]);
      expect(r.how).toBe('fuzzy');
      expect(r.serviceIds).toEqual(['svc-deep']);
      expect(r.categoryIds).toEqual(['cat-massage']);
    });

    it('understands nothing gracefully', () => {
      const r = interpret([]);
      expect(r.how).toBe('none');
      expect(r.directSalon).toBeNull();
      expect(r.serviceIds).toEqual([]);
    });

    it('does not invent services when only salons resemble the text', () => {
      // A service-first results page has nothing to show here; the
      // caller offers the salon suggestions instead of an empty page.
      const r = interpret([salon('some-salon', 'Some Salon', 'fuzzy')]);
      expect(r.how).toBe('none');
      expect(r.serviceIds).toEqual([]);
    });

    it('is the same answer every time it is asked', () => {
      const ms = [category('cat-massage', 'Massage'), service('svc-a', 'A', 'cat-massage')];
      expect(interpret(ms)).toEqual(interpret(ms));
    });
  });

  describe('text relevance', () => {
    const ms = [
      service('svc-exact', 'Swedish Massage', 'cat-massage'),
      service('svc-prefix', 'Swedish Massage 60', 'cat-massage', 'prefix'),
      service('svc-fuzzy', 'Deep Tissue Massage', 'cat-massage', 'fuzzy', 0.8),
    ];

    it('ranks naming it above resembling it above merely sharing a category', () => {
      const exact = textRelevanceOf('svc-exact', ms);
      const prefix = textRelevanceOf('svc-prefix', ms);
      const fuzzy = textRelevanceOf('svc-fuzzy', ms);
      const viaCategory = textRelevanceOf('svc-unmatched', ms);
      expect(exact).toBe(1);
      expect(exact).toBeGreaterThan(prefix);
      expect(prefix).toBeGreaterThan(fuzzy);
      expect(fuzzy).toBeGreaterThan(viaCategory);
    });

    it('never leaves the 0–1 band the scorer expects', () => {
      for (const id of ['svc-exact', 'svc-prefix', 'svc-fuzzy', 'svc-none']) {
        const v = textRelevanceOf(id, ms);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });

    it('gives a service reached only through its category the neutral middle', () => {
      // It is a fair answer to the intent; the customer just did not
      // name it. Zero would be a penalty for being found the ordinary
      // way.
      expect(textRelevanceOf('svc-unmatched', ms)).toBe(0.5);
    });
  });
});
