/**
 * Navigation search — "I know what I want to do, not where Velnes put
 * it" (Alex, 2026-09-30). One engine, three app registries.
 *
 * A destination is a place in ONE app: a page, a section of a page, or
 * an action the user reaches by opening a page a certain way. Its
 * title and breadcrumb are i18n KEYS, resolved by the app in the
 * viewer's language; matching runs over the key's value in every
 * language at once, plus the search-only aliases, so the query's
 * language and the display language stay independent.
 */
export type Lang = 'en' | 'mk' | 'sq';

/** Where a chosen destination goes. Router apps use `path`; the
 *  tab-switching apps (HQ, supplier portal) use `tab` and `sub`. */
export interface NavTarget {
  path?: string;
  tab?: string;
  /** A block inside the tab to scroll into view (an element id the app knows). */
  sub?: string;
}

export interface NavEntry<Ctx = unknown> {
  /** Stable, untranslated, unique within the app: `workspace.locations.amenities`. */
  id: string;
  /** i18n key of the title. */
  title: string;
  /** i18n keys of the breadcrumb, root first (the title is not repeated). */
  crumbs: string[];
  /** An `I.*` path from `@velnes/ui`. */
  icon: string;
  /**
   * Search-only phrases and words, per language. Macedonian goes in
   * Cyrillic only — the Latin-keyboard forms are derived by the
   * normaliser, so `погодности` covers `pogodnosti` (and `wifi` stays
   * as typed).
   */
  aliases: Partial<Record<Lang, string[]>>;
  /** i18n keys whose values, in every language, are also aliases —
   *  e.g. the amenity names under the Amenities destination. */
  terms?: string[];
  /** May this viewer see it? Absent means everybody. */
  visible?: (ctx: Ctx) => boolean;
  /** Shown before anything is typed. */
  quick?: boolean;
  /** The destination, or how to compute it from the app's context
   *  (a location-dependent setting, say). */
  go: NavTarget | ((ctx: Ctx) => NavTarget);
}

export interface NavResult<Ctx = unknown> {
  entry: NavEntry<Ctx>;
  score: number;
}

/** How an app resolves an i18n key in each language, for the index. */
export type Labels = (key: string) => Partial<Record<Lang, string>>;
