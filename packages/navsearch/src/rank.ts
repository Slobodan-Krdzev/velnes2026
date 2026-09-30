import { canon, editDistance, queryTokens, tokens, typoBudget } from './normalize.js';
import type { Labels, NavEntry, NavResult } from './types.js';

/**
 * The index: every entry with its titles, aliases and breadcrumb in
 * canonical form, built once per app (the registry is static; the
 * viewer's permissions are applied at query time, not here).
 */
interface Indexed<Ctx> {
  entry: NavEntry<Ctx>;
  order: number;
  titles: string[]; // canonical title phrases, every language
  titleTokens: Set<string>;
  aliases: string[]; // canonical alias phrases
  aliasTokens: Set<string>;
  crumbTokens: Set<string>;
  /** Every token the entry can be found by — for the typo pass. */
  allTokens: string[];
}

export interface NavIndex<Ctx = unknown> {
  items: Indexed<Ctx>[];
}

const LANGS = ['en', 'mk', 'sq'] as const;

export function buildIndex<Ctx>(entries: NavEntry<Ctx>[], labels: Labels): NavIndex<Ctx> {
  const seen = new Set<string>();
  const items = entries.map((entry, order) => {
    if (seen.has(entry.id)) throw new Error(`duplicate navigation entry ${entry.id}`);
    seen.add(entry.id);
    const values = (key: string) =>
      LANGS.map((l) => labels(key)[l]).filter((v): v is string => Boolean(v));
    const titles = values(entry.title).map(canon).filter(Boolean);
    const aliasPhrases = [
      ...LANGS.flatMap((l) => entry.aliases[l] ?? []),
      ...(entry.terms ?? []).flatMap(values),
    ]
      .map(canon)
      .filter(Boolean);
    const crumbs = entry.crumbs.flatMap(values).map(canon);
    const titleTokens = new Set(titles.flatMap((t) => t.split(' ')));
    const aliasTokens = new Set(aliasPhrases.flatMap((t) => t.split(' ')));
    const crumbTokens = new Set(crumbs.flatMap((t) => t.split(' ')));
    return {
      entry,
      order,
      titles,
      titleTokens,
      aliases: aliasPhrases,
      aliasTokens,
      crumbTokens,
      allTokens: [...new Set([...titleTokens, ...aliasTokens])],
    };
  });
  return { items };
}

/** A query token matched by a token of the entry: exactly, as a prefix
 *  (three letters or more), or within its typo budget. */
function matchToken(q: string, pool: Set<string>, all: string[], fuzzy: boolean): 'exact' | 'prefix' | 'fuzzy' | null {
  if (pool.has(q)) return 'exact';
  if (q.length >= 3) for (const w of pool) if (w.startsWith(q) || (w.length >= 5 && q.startsWith(w))) return 'prefix';
  if (fuzzy) {
    const budget = typoBudget(q);
    if (budget) for (const w of all) if (Math.abs(w.length - q.length) <= budget && editDistance(q, w, budget) <= budget) return 'fuzzy';
  }
  return null;
}

function scoreOne<Ctx>(it: Indexed<Ctx>, content: string[], lean: string[]): number {
  const phrase = content.join(' ');
  const single = content.length === 1;
  let best = 0;
  const take = (n: number) => {
    if (n > best) best = n;
  };

  // The whole thing, verbs included, is an alias: "add worker" is
  // exactly what the invite destination is called by.
  if (lean.length > content.length) {
    const full = lean.join(' ');
    if (it.aliases.some((a) => a === full)) take(95);
    else if (it.aliases.some((a) => a.startsWith(full))) take(80);
  }

  // Title, in any language.
  if (it.titles.some((t) => t === phrase)) take(100);
  else if (it.titles.some((t) => t.startsWith(phrase) || (single && t.split(' ').some((w) => w.startsWith(phrase))))) take(85);
  else if (content.every((q) => it.titleTokens.has(q))) take(75);

  // Aliases — the phrases people actually type.
  if (best < 90 && it.aliases.some((a) => a === phrase)) take(90);
  else if (best < 70 && it.aliases.some((a) => a.startsWith(phrase))) take(70);
  else if (best < 62 && content.every((q) => it.aliasTokens.has(q))) take(62);

  // Every content token found somewhere in title or aliases (mixed).
  if (best < 58 && content.every((q) => it.titleTokens.has(q) || it.aliasTokens.has(q))) take(58);

  // Partial: most of the tokens, allowing prefixes and typos.
  if (best < 50) {
    const pool = new Set([...it.titleTokens, ...it.aliasTokens]);
    let hits = 0;
    let fuzzyUsed = false;
    for (const q of content) {
      const m = matchToken(q, pool, it.allTokens, true);
      if (m) hits += 1;
      if (m === 'fuzzy') fuzzyUsed = true;
    }
    const f = hits / content.length;
    if (f >= 0.5) take(Math.round((hits === content.length ? 52 : 40) * f * (fuzzyUsed ? 0.85 : 1)));
  }

  // The breadcrumb, lowest: "settings" finds everything under Settings,
  // after the pages named Settings.
  if (best < 30 && content.every((q) => it.crumbTokens.has(q))) take(30);
  else if (best < 20 && single && [...it.crumbTokens].some((w) => w.startsWith(phrase)) && phrase.length >= 3) take(20);

  // The verbs the query carried count a little when the entry lists
  // that action among its aliases ("add employee" over "Employees").
  if (best > 0 && lean.length > content.length) {
    const verbs = lean.filter((w) => !content.includes(w));
    if (verbs.some((v) => it.aliasTokens.has(v))) best += 3;
  }
  return best;
}

export const MIN_QUERY = 2;
export const MAX_RESULTS = 8;

/**
 * Rank the destinations this viewer may see against the query. Below
 * two characters nothing is searched (the caller shows the quick
 * links); results under the floor are dropped; ties keep the shorter
 * title first, then registry order.
 */
export function search<Ctx>(index: NavIndex<Ctx>, query: string, ctx: Ctx, limit = MAX_RESULTS): NavResult<Ctx>[] {
  const raw = query.trim();
  if (canon(raw).length < MIN_QUERY) return [];
  const { lean, content } = queryTokens(raw);
  if (!content.length) return [];
  const out: (NavResult<Ctx> & { order: number; len: number })[] = [];
  for (const it of index.items) {
    if (it.entry.visible && !it.entry.visible(ctx)) continue;
    const score = scoreOne(it, content, lean);
    if (score >= 25) out.push({ entry: it.entry, score, order: it.order, len: it.titles[0]?.length ?? 99 });
  }
  out.sort((a, b) => b.score - a.score || a.len - b.len || a.order - b.order);
  return out.slice(0, limit).map(({ entry, score }) => ({ entry, score }));
}

/** The destinations to offer before anything is typed. */
export function quickLinks<Ctx>(index: NavIndex<Ctx>, ctx: Ctx, limit = 6): NavEntry<Ctx>[] {
  return index.items
    .filter((it) => it.entry.quick && (!it.entry.visible || it.entry.visible(ctx)))
    .slice(0, limit)
    .map((it) => it.entry);
}

export { canon, tokens };
