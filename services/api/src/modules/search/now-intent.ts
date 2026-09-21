/**
 * "Now", in any of the platform's languages — docs/SEARCH.md §10.
 *
 * A customer who types "massage now" is asking two things: what, and
 * when. The what goes on to the lookup as "massage"; the when becomes
 * a flag that the doors answer with real availability — a treatment
 * that can start within the next half hour, in the salon's own clock.
 *
 * Pure on purpose, like `interpret`: no database, no clock. The words
 * are the whole rule, so they are written down here and tested here.
 * Normalisation mirrors `search_norm` (lowercase, strip accents, split
 * on anything that is not a letter or digit) so a term matches whether
 * it was typed with diacritics, in Cyrillic, or in the Latin letters a
 * phone keyboard gives a Macedonian speaker.
 */

/** How soon "now" is: a start within this many minutes. */
export const NOW_WINDOW_MIN = 30;

/**
 * The words. Multi-word phrases first, longest first, so "right now"
 * is consumed whole rather than leaving "right" behind as a query.
 */
const NOW_TERMS: readonly string[] = [
  // en
  'right now',
  'as soon as possible',
  'now',
  'asap',
  'immediately',
  // mk — Cyrillic, and as typed on a Latin keyboard
  'сега',
  'веднаш',
  'одма',
  'sega',
  'vednas',
  'vednash',
  'odma',
  // sq
  'menjëherë',
  'menjehere',
  'tani',
  'tash',
  'tashti',
];

/** The same shape `search_norm` gives text: lowercase, unaccented, one
 *  space between runs of letters and digits. */
export function normNow(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const TERMS_NORM = [...NOW_TERMS].map(normNow).sort((a, b) => b.length - a.length);

export interface NowRead {
  /** The query with the "now" words taken out — what the lookup gets. */
  q: string;
  /** Whether the text asked for now. */
  now: boolean;
}

/**
 * Read the "when" out of a query and hand back the "what".
 *
 * Whole-word only: "nowhere" and "tanit" are not requests for now. A
 * query that was nothing but "now" comes back empty, and the door
 * treats that as "anything, now".
 */
export function readNow(raw: string): NowRead {
  const words = normNow(raw).split(' ').filter(Boolean);
  if (!words.length) return { q: '', now: false };
  const kept: string[] = [];
  let now = false;
  let i = 0;
  while (i < words.length) {
    let hit = 0;
    for (const term of TERMS_NORM) {
      const parts = term.split(' ');
      if (parts.every((p, k) => words[i + k] === p)) {
        hit = parts.length;
        break;
      }
    }
    if (hit) {
      now = true;
      i += hit;
    } else {
      kept.push(words[i]!);
      i += 1;
    }
  }
  return { q: kept.join(' '), now };
}
