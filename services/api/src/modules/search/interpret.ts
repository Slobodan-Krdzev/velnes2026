/**
 * Step 3 of the Search phase — docs/SEARCH.md.
 *
 * What did the customer mean? Given every way the typed text met the
 * platform, decide whether it names one salon, an intent, particular
 * treatments, or nothing we recognise — and decide it the same way every
 * time.
 *
 * Pure on purpose. There is no database here and no HTTP: matching is
 * SQL's job and normalization lives only in `search_norm`, so there is
 * exactly one implementation of "what does this text become" and nothing
 * to drift. What is left is the rule set, which is the part worth
 * testing hardest and the part a wrong answer is most expensive in.
 */

export type MatchKind = 'salon' | 'service' | 'category';

/** How the normalized query met a row. Exact means the whole normalized
 *  query equals the whole normalized name — not a prefix of it. */
export type MatchHow = 'exact' | 'prefix' | 'fuzzy';

export interface SearchMatch {
  kind: MatchKind;
  id: string;
  display: string;
  how: MatchHow;
  /** 0–1. Exact is 1; fuzzy carries its word similarity. */
  score: number;
  /** Salon context, for services and for navigating to a salon. */
  salonSlug?: string;
  salonName?: string;
  /** The category a service belongs to, where it has one. */
  categoryId?: string | null;
  /** For a category: how many admitted salons sell something in it. */
  salonCount?: number;
}

export interface Interpretation {
  /**
   * Set only when the strict rule below fires, and the caller then
   * navigates instead of showing results. Null for everything else,
   * including "several salons match" — a typo must never be able to
   * land somebody in the wrong salon.
   */
  directSalon: { id: string; slug: string; name: string } | null;
  /** Categories the query means. Several is normal: "fizio" is four. */
  categoryIds: string[];
  /** Particular treatments the query names or resembles. */
  serviceIds: string[];
  /** How it was understood — for the Search Lab, and for honest copy. */
  how: 'salon' | 'category' | 'service' | 'fuzzy' | 'none';
  /**
   * Salons matched exactly but more than one did, so we refused to
   * guess. Worth surfacing: it is the difference between "we did not
   * understand" and "you have to tell us which one".
   */
  ambiguous: boolean;
}

const uniq = (xs: string[]) => [...new Set(xs)];

/**
 * The direct-navigation rule, in one place and deliberately strict.
 *
 * A submitted query goes straight to a salon only when all three hold:
 *
 *   1. the whole normalized query equals that salon's whole normalized
 *      name — not a prefix, not a fuzzy match;
 *   2. exactly one salon matches that way;
 *   3. the text is not also an exact category or service term.
 *
 * Rule 3 is what protects generic words. "barber" is a salon's name
 * somewhere and it is also how half the country asks for a haircut; the
 * customer typing it wants options, not that one shop.
 *
 * The data already contains what rule 2 protects: two salons carry the
 * byte-identical name "Barber Shop Labi - Pristina, Banesat e Arabve
 * Kulla 3 - Prishtina | Fresha". Typing it in full matches both, and
 * both times the honest answer is a results page.
 *
 * Choosing a salon from the suggestions is a different act and always
 * navigates — see the `suggest` door. Picking a row from a list says
 * which one you meant; typing does not.
 */
export function interpret(matches: SearchMatch[]): Interpretation {
  const exactOf = (kind: MatchKind) => matches.filter((m) => m.kind === kind && m.how === 'exact');

  const exactSalons = exactOf('salon');
  const exactCats = exactOf('category');
  const exactSvcs = exactOf('service');

  const base: Interpretation = {
    directSalon: null,
    categoryIds: [],
    serviceIds: [],
    how: 'none',
    ambiguous: false,
  };

  // 1–3, in order.
  if (exactSalons.length === 1 && exactCats.length === 0 && exactSvcs.length === 0) {
    const s = exactSalons[0]!;
    return {
      ...base,
      how: 'salon',
      directSalon: { id: s.id, slug: s.salonSlug ?? '', name: s.display },
    };
  }

  // Matched exactly, but more than one, and nothing else explains the
  // text. We know what they meant and still cannot act on it alone.
  const ambiguous = exactSalons.length > 1 && exactCats.length === 0 && exactSvcs.length === 0;

  // An intent, a named treatment, or both — "Massage" can be a category
  // and the literal name of a service, and the answer is both.
  if (exactCats.length || exactSvcs.length) {
    return {
      ...base,
      how: exactCats.length ? 'category' : 'service',
      categoryIds: uniq([
        ...exactCats.map((m) => m.id),
        ...exactSvcs.map((m) => m.categoryId).filter((x): x is string => !!x),
      ]),
      serviceIds: uniq(exactSvcs.map((m) => m.id)),
      ambiguous,
    };
  }

  // Nothing matched outright. Everything the text resembles becomes a
  // candidate — "deep tissue" is not the name of anything, and should
  // still find Deep Tissue Massage.
  const loose = matches.filter((m) => m.how !== 'exact');
  const looseSvcs = loose.filter((m) => m.kind === 'service');
  const looseCats = loose.filter((m) => m.kind === 'category');
  if (looseSvcs.length || looseCats.length) {
    return {
      ...base,
      how: 'fuzzy',
      categoryIds: uniq([
        ...looseCats.map((m) => m.id),
        ...looseSvcs.map((m) => m.categoryId).filter((x): x is string => !!x),
      ]),
      serviceIds: uniq(looseSvcs.map((m) => m.id)),
      ambiguous,
    };
  }

  // Salons resembled the text and nothing else did. There is nothing to
  // rank — a service-first results page has no services to show — so the
  // caller shows the salon suggestions rather than an empty page.
  return { ...base, ambiguous };
}

/**
 * How well a candidate service answers what was typed — the component
 * the ranker gains in step 6.
 *
 * Only ever computed for a text query. A category card carries no text,
 * so the component is absent there and the existing renormalisation
 * handles it, exactly as it does for a viewer who gave no location.
 */
export function textRelevanceOf(serviceId: string, matches: SearchMatch[]): number {
  const mine = matches.filter((m) => m.kind === 'service' && m.id === serviceId);
  if (mine.some((m) => m.how === 'exact')) return 1;
  if (mine.some((m) => m.how === 'prefix')) return 0.85;
  const fuzzy = mine.filter((m) => m.how === 'fuzzy').map((m) => m.score);
  // Scale a word similarity into the band between "matched its category"
  // and "matched by name", so a near-miss on the name still outranks a
  // service that only shares a category.
  if (fuzzy.length) return 0.6 + Math.min(1, Math.max(0, Math.max(...fuzzy))) * 0.25;
  // Reached only through its category: relevant, but the customer did
  // not name it.
  return 0.5;
}
