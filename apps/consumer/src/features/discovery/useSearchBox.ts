import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSuggest, useSuggestKeys, type SuggestItem } from './useSuggest.js';

/**
 * Whether moving the page would actually move this box.
 *
 * The results page keeps its search bar in a sticky toolbar, pinned
 * near the top whatever the scroll — so there is nothing to centre
 * there, and trying would only drag the results out from under it.
 * Asked of the DOM rather than hardcoded per page, so a third search
 * bar added later gets the right answer without anybody remembering to
 * come back here.
 */
function scrollsWithPage(el: HTMLElement): boolean {
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const pos = getComputedStyle(n).position;
    if (pos === 'sticky' || pos === 'fixed') return false;
  }
  return true;
}

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

  /** Read inside the centring callbacks, which must not re-subscribe
   *  on every keystroke. */
  const qRef = useRef(q);
  qRef.current = q;

  const typing = useSuggest(q);
  const keys = useSuggestKeys(typing.items, choose);

  /**
   * Opening the panel brings the whole thing to the middle of the
   * screen.
   *
   * The search card sits low on the home page, so the list it drops
   * opened half below the fold: the suggestions were there, and you had
   * to scroll to find that out. Centring the box and its panel together
   * puts the question and the answers in front of the person at once.
   *
   * Once per opening, and never while typing — re-centring on every
   * keystroke as the list grows and shrinks would be seasickness.
   */
  useEffect(() => {
    if (!open) return;
    const box = boxRef.current;
    // `offsetParent` is null for whichever layout is hidden — the phone
    // and desktop trees are both rendered, and measuring the one nobody
    // can see would scroll to nowhere.
    if (!box || !box.offsetParent || !scrollsWithPage(box)) return;

    const centre = () => {
      // Only while the panel is the one that opened with the box. Once
      // anybody types, the list grows and shrinks on every keystroke
      // and moving the page under them would be seasickness — and by
      // then they can see what they are doing anyway.
      if (qRef.current !== '') return;
      const b = box.getBoundingClientRect();
      // The panel is absolutely positioned, so it is not part of the
      // box's own height: the two have to be measured together.
      const panel = box.querySelector('.sugg')?.getBoundingClientRect();
      const height = (panel ? Math.max(b.bottom, panel.bottom) : b.bottom) - b.top;
      // The header is sticky, so the usable screen starts below it —
      // centring against the whole viewport slides the input itself up
      // underneath it, which is the one part that must stay visible.
      const head = document.querySelector('.d-head');
      const safe = (head ? head.getBoundingClientRect().height : 0) + 12;
      const room = window.innerHeight - safe - height;
      // Taller than the space there is: pin its top just under the
      // header, since no centre would show all of it anyway.
      const top = Math.max(0, window.scrollY + b.top - safe - (room > 32 ? room / 2 : 0));
      if (Math.abs(top - window.scrollY) < 2) return;
      window.scrollTo({
        top,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
      });
    };

    /**
     * The panel is measured as it settles, not once.
     *
     * On the first open of a session the suggestion panel is empty for
     * a moment — "Most chosen" is still in flight — so a single
     * measurement centres the bare card and the list then unrolls
     * straight back off the bottom of the screen. Watching it until it
     * stops growing is the difference between this working and working
     * only on the second try.
     *
     * It stops the moment the person types: re-centring on every
     * keystroke as the list grows and shrinks would be seasickness, and
     * by then they can see what they are doing anyway.
     */
    let raf = requestAnimationFrame(centre);
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(centre);
    });
    ro.observe(box);
    // The panel arrives as a new child, so the box itself changing size
    // is not enough to notice it.
    const mo = new MutationObserver(() => {
      const panel = box.querySelector('.sugg');
      if (panel) ro.observe(panel);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(centre);
    });
    mo.observe(box, { childList: true, subtree: true });
    const panel = box.querySelector('.sugg');
    if (panel) ro.observe(panel);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
    };
  }, [open]);

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
