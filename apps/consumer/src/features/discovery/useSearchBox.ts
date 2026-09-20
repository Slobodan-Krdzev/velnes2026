import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSuggest, useSuggestKeys, type SuggestItem } from './useSuggest.js';

/**
 * One search box, wherever it appears.
 *
 * The home page and the results page both carry the search bar, and the
 * whole point of this phase was that there is ONE of it — so the text
 * state, the suggestions, the keyboard handling and the three ways out
 * of a suggestion list live here rather than being written twice and
 * drifting.
 *
 * The three ways out, all settled in step 5 and unchanged:
 *
 *  - **A suggestion** goes wherever that row points, by `replace`,
 *    because a dropdown row is not a place the back button should
 *    return anybody to.
 *  - **Enter** always goes to the results page, even when the text
 *    names a salon outright. The door decides whether that becomes a
 *    salon, from the server's own answer, and replaces the results
 *    entry on the way — so the history reads home → salon and the query
 *    still has a shareable URL.
 *  - **A category** opens the same ranked page a shelf card opens.
 */
export function useSearchBox(onLeave?: () => void) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Held in a ref so a caller passing an inline closure does not rebuild
  // every callback below on every render.
  const leaveRef = useRef(onLeave);
  leaveRef.current = onLeave;
  const leave = useCallback(() => {
    setOpen(false);
    leaveRef.current?.();
  }, []);

  const choose = useCallback(
    (item: SuggestItem) => {
      leave();
      nav(item.href, { replace: true });
    },
    [leave, nav],
  );
  const submit = useCallback(
    (text: string) => {
      const t = text.trim();
      if (t.length < 2) return;
      leave();
      nav(`/search?q=${encodeURIComponent(t)}`);
    },
    [leave, nav],
  );
  const openCat = useCallback(
    (slug: string) => {
      leave();
      nav(`/s/${slug}`);
    },
    [leave, nav],
  );

  const typing = useSuggest(q);
  const keys = useSuggestKeys(typing.items, choose);

  /** Clicking away or pressing Escape closes the panel — and only the
   *  panel, never the query, which the person may still be editing. */
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  /** Everything an <input> needs to be the search box. Spread it. */
  const inputProps = {
    value: q,
    autoComplete: 'off' as const,
    role: 'combobox' as const,
    'aria-expanded': open,
    'aria-autocomplete': 'list' as const,
    'aria-activedescendant':
      keys.active >= 0 ? `sug-${typing.items[keys.active]?.key}` : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setQ(e.target.value);
      setOpen(true);
    },
    onFocus: () => setOpen(true),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      keys.onKeyDown(e);
      // Only when the list did not already act on it: Enter on a
      // highlighted row chooses that row, and must not also search.
      if (e.key === 'Enter' && !e.defaultPrevented) submit(q);
    },
  };

  return { q, setQ, open, setOpen, boxRef, typing, keys, choose, submit, openCat, inputProps };
}
