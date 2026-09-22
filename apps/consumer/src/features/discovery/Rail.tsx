import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { t } from '../../lib/i18n-core.js';
import { useWheelScroll } from '../../lib/useWheelScroll.js';

/**
 * A row of cards that slides. The arrows move the row — a page's worth
 * at a time — and never leave the page (Alex, 2026-09-23: "the arrows on
 * the swipers should swipe the slider, not redirect"); the mouse wheel
 * pushes it too, through the same hook the category shelf uses. An
 * arrow greys out at its end so the row's edge is visible before it is
 * hit. On a touch screen the row is swiped and the arrows step aside
 * (CSS, `hover: none`).
 */

const CHEV_L = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 6 8.5 12l6 6" /></svg>
);
const CHEV_R = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 6l6 6-6 6" /></svg>
);

export function Rail({ track, children }: { track: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [ends, setEnds] = useState({ start: true, end: true });
  useWheelScroll(ref);

  // Which arrows still have somewhere to go — re-read on scroll, on
  // resize and whenever the cards change.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const max = el.scrollWidth - el.clientWidth;
      setEnds({ start: el.scrollLeft <= 1, end: el.scrollLeft >= max - 1 });
    };
    read();
    el.addEventListener('scroll', read, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    ro?.observe(el);
    if (!ro) window.addEventListener('resize', read);
    return () => {
      el.removeEventListener('scroll', read);
      ro?.disconnect();
      if (!ro) window.removeEventListener('resize', read);
    };
  }, [children]);

  const step = (dir: number) => {
    const el = ref.current;
    if (!el) return;
    // A page at a time: as many cards as are in view, minus a sliver so
    // the reader keeps their place.
    const by = Math.max(el.clientWidth * 0.9, 200);
    el.scrollBy({ left: dir * by, behavior: 'smooth' });
  };

  return (
    <div className="rail">
      <button type="button" className="catrail-nav prev" aria-label={t('c.rail.prevItems')} disabled={ends.start} onClick={() => step(-1)}>
        {CHEV_L}
      </button>
      <div className={`rail-track ${track}`} ref={ref}>
        {children}
      </div>
      <button type="button" className="catrail-nav next" aria-label={t('c.rail.nextItems')} disabled={ends.end} onClick={() => step(1)}>
        {CHEV_R}
      </button>
    </div>
  );
}
