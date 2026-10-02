/**
 * Query and index normalisation — deterministic, local, and tolerant of
 * how people actually type in this market.
 *
 * `canon(text)` maps every supported spelling of a word onto one form:
 *   lowercase → accents folded (ë→e, ç→c, š→s) → Macedonian Cyrillic
 *   transliterated to Latin → the digraphs people skip on a Latin
 *   keyboard collapsed (ќ→kj→k, ш→sh→s, ч→ch→c, ж→zh→z, ѓ→gj→g,
 *   џ/ѕ→dz→z, љ→lj→l, њ→nj→n) → punctuation to spaces.
 * So `погодности`, `pogodnosti`, `Pogodnosti!` are one token, and
 * `плаќања`, `plakjanja`, `plakanja` are one token. The collapse is
 * lossy on purpose: a navigation index of a few dozen destinations has
 * no pair of words that only a digraph tells apart.
 *
 * Nothing here is the platform's search normaliser (that lives in
 * Postgres and deliberately keeps Cyrillic): this is for finding a
 * screen, not a salon.
 */
const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ѓ: 'gj', е: 'e', ж: 'zh', з: 'z', ѕ: 'dz',
  и: 'i', ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', ќ: 'kj', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', џ: 'dz',
  ш: 'sh',
  // Serbian / Bulgarian / Russian letters people's keyboards also have.
  ђ: 'dj', ћ: 'c', й: 'j', ъ: '', ь: '', ы: 'i', э: 'e', ю: 'ju', я: 'ja', щ: 'sht', ё: 'e',
};

const DIGRAPHS: [RegExp, string][] = [
  [/kj/g, 'k'],
  [/gj/g, 'g'],
  [/zh/g, 'z'],
  [/sh/g, 's'],
  [/ch/g, 'c'],
  [/dz/g, 'z'],
  [/dj/g, 'd'],
  [/lj/g, 'l'],
  [/nj/g, 'n'],
  [/ts/g, 'c'],
];

const FOLD: Record<string, string> = { đ: 'd', ð: 'd', ł: 'l', ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o' };

export function canon(text: string): string {
  let s = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[đðłßæœø]/g, (c) => FOLD[c] ?? c);
  s = s.replace(/[Ѐ-ӿ]/g, (c) => CYR[c] ?? c);
  for (const [re, to] of DIGRAPHS) s = s.replace(re, to);
  return s.replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function tokens(text: string): string[] {
  const c = canon(text);
  return c ? c.split(' ') : [];
}

/** Words that carry no destination: articles, pronouns, "I want to". */
const STOP = new Set(
  [
    // en
    'the', 'a', 'an', 'my', 'our', 'to', 'of', 'for', 'in', 'on', 'at', 'i', 'want', 'need', 'how', 'do', 'where', 'is', 'can', 'me', 'please', 'go', 'and',
    // mk (canonical Latin forms)
    'na', 'go', 'ja', 'gi', 'mi', 'da', 'so', 'vo', 'za', 'od', 'kako', 'kade', 'sakam', 'moja', 'moj', 'mojot', 'mojata', 'moite', 'ni', 'ne', 'li', 'se', 'e', 'sum', 'treba',
    // sq
    'te', 'e', 'i', 'ne', 'me', 'per', 'si', 'ku', 'dua', 'time', 'tim', 'tonat', 'tone', 'nje', 'ta', 'ti',
  ].map(canon),
);

/** Intent verbs: "change", "add", "open" — dropped so `change amenities`
 *  meets `Amenities`, unless the verb is all there is. */
const VERBS = new Set(
  [
    'change', 'edit', 'update', 'manage', 'add', 'remove', 'delete', 'create', 'view', 'open', 'configure', 'set', 'see', 'show', 'upload', 'new', 'find', 'setup', 'adjust', 'check',
    'смени', 'промени', 'уреди', 'уредување', 'ажурирај', 'додади', 'додај', 'избриши', 'отстрани', 'креирај', 'отвори', 'прикажи', 'постави', 'види', 'најди', 'нов', 'нова', 'нови', 'ново', 'промена', 'менување', 'подеси',
    'ndrysho', 'ndryshoj', 'ndryshoni', 'redakto', 'perditeso', 'menaxho', 'shto', 'shtoj', 'fshi', 'hiq', 'krijo', 'hap', 'hape', 'shiko', 'shfaq', 'konfiguro', 'vendos', 'ngarko', 'gjej', 'ri', 're', 'rregullo',
  ].map(canon),
);

/** The query as content tokens: filler and verbs gone, unless nothing
 *  would be left — a query of only "add" still means something. */
export function queryTokens(text: string): { all: string[]; lean: string[]; content: string[] } {
  const all = tokens(text);
  const lean = all.filter((w) => !STOP.has(w));
  const content = lean.filter((w) => !VERBS.has(w));
  return { all, lean: lean.length ? lean : all, content: content.length ? content : lean.length ? lean : all };
}

/** Optimal string alignment distance (transpositions count as one). */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i]![0] = i;
  for (let j = 0; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[m]![n]!;
}

/** How many typos a token of this length may carry: none under five
 *  letters, one to seven, two from eight. */
export function typoBudget(token: string): number {
  return token.length >= 8 ? 2 : token.length >= 5 ? 1 : 0;
}
