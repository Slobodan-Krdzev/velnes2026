import type { DiscoverySuggestion } from '@velnes/contracts';

/**
 * Icons for discovery suggestions (Alex, 2026-09-29): different
 * meanings, different shapes — one brand, one colour. Every icon is a
 * 24-box stroke drawing at the same weight as the rest of the app's
 * icons (1.8, round caps), drawn in `currentColor`, which the row's
 * container sets to the brand coral on its warm tint. No fills, no
 * second colour, no emoji.
 */
const P = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const SUGGEST_ICONS = {
  scissors: (
    <svg {...P} aria-hidden="true"><circle cx="6" cy="6" r="2.6" /><circle cx="6" cy="18" r="2.6" /><path d="M8.2 7.6 20 17M8.2 16.4 20 7M11.2 12l-3-2.4M11.2 12l-3 2.4" /></svg>
  ),
  hands: (
    <svg {...P} aria-hidden="true"><path d="M4 12.5V8a1.6 1.6 0 0 1 3.2 0v4.2M7.2 9.6V6.4a1.6 1.6 0 0 1 3.2 0v5.6M10.4 8.6V5.8a1.6 1.6 0 0 1 3.2 0v6.8" /><path d="M13.6 10.4a1.6 1.6 0 0 1 3.2 0V15a6.4 6.4 0 0 1-6.4 6.4h-.8A5.6 5.6 0 0 1 4 15.8v-3.3" /><path d="M20 4.5c-.6.9-1.2 1.4-2 1.7M20 8.2c-.8.2-1.6.2-2.3 0" /></svg>
  ),
  spa: (
    <svg {...P} aria-hidden="true"><path d="M12 20c-4.4 0-8-2.9-8-6.5 2.2 0 4.2.8 5.6 2.2C10.3 12.5 11 9.2 12 6.5c1 2.7 1.7 6 2.4 9.2A8.3 8.3 0 0 1 20 13.5c0 3.6-3.6 6.5-8 6.5z" /><path d="M12 20c-1.7-1.9-2.6-4.4-2.6-7M12 20c1.7-1.9 2.6-4.4 2.6-7" /></svg>
  ),
  leaf: (
    <svg {...P} aria-hidden="true"><path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z" /><path d="M5 19c3-4 6-7 10-9" /></svg>
  ),
  nails: (
    <svg {...P} aria-hidden="true"><path d="M9.5 3.5h5a1.5 1.5 0 0 1 1.5 1.5v7.5a4 4 0 0 1-8 0V5a1.5 1.5 0 0 1 1.5-1.5z" /><path d="M8 9h8M12 16.5V21M9.5 21h5" /></svg>
  ),
  face: (
    <svg {...P} aria-hidden="true"><path d="M12 20.5c-3.6 0-6.5-3.4-6.5-7.6V9.5a6.5 6.5 0 0 1 13 0v3.4c0 4.2-2.9 7.6-6.5 7.6z" /><path d="M9 11.5h.01M15 11.5h.01M9.8 15.5c1.3 1 3.1 1 4.4 0" /><path d="M5.5 10.5c.8-2.4 2.9-4 6.5-4s5.7 1.6 6.5 4" /></svg>
  ),
  physio: (
    <svg {...P} aria-hidden="true"><circle cx="12" cy="4.6" r="1.9" /><path d="M9.2 20.5 11 13.8l-2.4-2.6 1.4-4.2h4l1.4 4.2-2.4 2.6 1.8 6.7" /><path d="M6.5 11.5l3.5-1.4M17.5 11.5l-3.5-1.4" /></svg>
  ),
  bolt: (
    <svg {...P} aria-hidden="true"><path d="M13 3 4 14h7l-1 7 9-11h-7z" /></svg>
  ),
  pin: (
    <svg {...P} aria-hidden="true"><path d="M12 21s6.5-6 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15 12 21 12 21z" /><circle cx="12" cy="10.5" r="2.4" /></svg>
  ),
  navigate: (
    <svg {...P} aria-hidden="true"><path d="M20.5 3.5 3.8 10.4a.6.6 0 0 0 .1 1.1l7 2.1 2.1 7a.6.6 0 0 0 1.1.1z" /></svg>
  ),
  repeat: (
    <svg {...P} aria-hidden="true"><path d="M17 2.5 20.5 6 17 9.5" /><path d="M3.5 11V9.5A3.5 3.5 0 0 1 7 6h13.5" /><path d="M7 21.5 3.5 18 7 14.5" /><path d="M20.5 13v1.5A3.5 3.5 0 0 1 17 18H3.5" /></svg>
  ),
  heart: (
    <svg {...P} aria-hidden="true"><path d="M12 20.5s-7.4-4.6-7.4-9.4A4.3 4.3 0 0 1 12 8.5a4.3 4.3 0 0 1 7.4 2.6c0 4.8-7.4 9.4-7.4 9.4z" /></svg>
  ),
  calendar: (
    <svg {...P} aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3.5v3M16 3.5v3" /></svg>
  ),
  clock: (
    <svg {...P} aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
  ),
  sparkle: (
    <svg {...P} aria-hidden="true"><path d="M12 3.5l1.7 5.2 5.3 1.8-5.3 1.8L12 17.5l-1.7-5.2L5 10.5l5.3-1.8z" /><path d="M19 15.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" /></svg>
  ),
} as const;
export type SuggestIcon = keyof typeof SUGGEST_ICONS;

/** A category's icon, from what it is called — the taxonomy is HQ's and
 *  may grow, so unknown names fall back to the sparkle. */
export function iconForCategory(name: string): SuggestIcon {
  const n = name.toLowerCase();
  if (/hair|barber|cut|frizur|коса|фризер|flok/.test(n)) return 'scissors';
  if (/massag|масаж|masazh/.test(n)) return 'hands';
  if (/spa|спа|sauna|сауна/.test(n)) return 'spa';
  if (/wellness|велнес|mirëqen|yoga|јога|medit/.test(n)) return 'leaf';
  if (/nail|нокт|thonj|manic|pedic/.test(n)) return 'nails';
  if (/skin|кожа|lëkur|facial|face|лице|fytyr|sminka|make/.test(n)) return 'face';
  if (/physio|физио|fizio|manual|rehab|рехаб|recover|assess|акупунктура|acupun/.test(n)) return 'physio';
  return 'sparkle';
}

/** The icon a suggestion wears: its kind first, then what it is about. */
export function iconFor(s: DiscoverySuggestion): SuggestIcon {
  if (s.kind === 'now_all') return 'bolt';
  if (s.kind === 'salon_again') return s.reason === 'favourite' ? 'heart' : 'repeat';
  if (s.kind === 'category_again') return 'repeat';
  if (s.intent.category) return iconForCategory(s.intent.category.name);
  if (s.intent.nearby) return 'navigate';
  return 'sparkle';
}
