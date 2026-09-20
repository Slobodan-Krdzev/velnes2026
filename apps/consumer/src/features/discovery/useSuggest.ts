import type { SearchSuggestions } from '@velnes/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pubPost } from '../../lib/api/client.js';

/**
 * Live suggestions — step 5 of docs/SEARCH.md.
 *
 * The suggestions come from the search doors, not from filtering
 * whatever the page happened to have loaded. That was the old behaviour
 * and it could only ever match a category or salon name it already held;
 * it never saw a treatment, never understood "masaza", and never found a
 * typo.
 *
 * Four things have to be right for a box that fires while you type:
 * it must not ask on every keystroke, it must not let an early answer
 * overwrite a later one, it must not ask at all for a letter or two, and
 * it must say when it is working.
 */

/** Long enough to skip the letters between words, short enough to feel
 *  immediate. */
const DEBOUNCE_MS = 200;

/** Two characters match half the world. */
export const MIN_QUERY = 2;

const EMPTY: SearchSuggestions = { salons: [], services: [], categories: [], q: '' };

/** One row of the dropdown, flattened, so the keyboard can walk the list
 *  without caring which section a row came from. */
export interface SuggestItem {
  key: string;
  kind: 'category' | 'service' | 'salon';
  /** Where choosing it goes. */
  href: string;
}

export function useSuggest(q: string) {
  const [data, setData] = useState<SearchSuggestions>(EMPTY);
  const [loading, setLoading] = useState(false);
  // Monotonic: an answer is only allowed to land if nothing newer has
  // been asked since. Without this, a slow response to "mas" can arrive
  // after "massage" and quietly replace the better list.
  const seq = useRef(0);
  const short = q.trim().length < MIN_QUERY;

  useEffect(() => {
    if (short) {
      seq.current += 1; // cancel anything in flight
      setData(EMPTY);
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      void pubPost<SearchSuggestions>('/discovery/suggest', { q })
        .then((r) => {
          if (seq.current !== mine) return;
          setData(r);
          setLoading(false);
        })
        .catch(() => {
          if (seq.current !== mine) return;
          // A failed lookup leaves the box usable and silent. Typing is
          // not the moment to explain a network problem.
          setData(EMPTY);
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, short]);

  /** The dropdown in reading order, flattened for the arrow keys.
   *  Intents first, as the prototype's panel has always led with them. */
  const items = useMemo<SuggestItem[]>(
    () => [
      ...data.categories.map((c) => ({
        key: `category-${c.id}`,
        kind: 'category' as const,
        href: `/s/${slugify(c.name)}`,
      })),
      ...data.services.map((s) => ({
        key: `service-${s.id}`,
        kind: 'service' as const,
        // Straight to the treatment at its salon, already in the cart —
        // the link the salon page has understood since Phase A.
        href: `/salon/${s.salonSlug}?service=${encodeURIComponent(s.id)}`,
      })),
      ...data.salons.map((s) => ({
        key: `salon-${s.id}`,
        kind: 'salon' as const,
        href: `/salon/${s.slug}`,
      })),
    ],
    [data],
  );

  const empty = !short && !loading && items.length === 0;
  return { data, items, loading, empty, short };
}

/** The slug the category routes have used since Phase A. Kept in step
 *  with `slugify` in the mappers; both derive the same thing from a
 *  category name. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Arrow-key state for the dropdown.
 *
 * Kept apart from the fetching so the input can own the keyboard while
 * the panel owns the rendering — they are in different components and
 * both need to agree on which row is active.
 */
export function useSuggestKeys(items: SuggestItem[], onChoose: (item: SuggestItem) => void) {
  const [active, setActive] = useState(-1);
  useEffect(() => setActive(-1), [items]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!items.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => (i + 1) % items.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
      } else if (e.key === 'Enter') {
        const item = items[active];
        // Enter with nothing highlighted is a submitted search, which is
        // step 7's job; this only claims the key when a row is chosen.
        if (item) {
          e.preventDefault();
          onChoose(item);
        }
      } else if (e.key === 'Escape') {
        setActive(-1);
      }
    },
    [items, active, onChoose],
  );

  return { active, setActive, onKeyDown };
}
