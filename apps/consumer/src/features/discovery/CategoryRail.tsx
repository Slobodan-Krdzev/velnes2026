import { useCallback, useEffect, useRef } from 'react';
import type { CategoryVM } from '../../lib/api/mappers.js';
import { CatCard } from './cards.js';

/**
 * The category shelf: one row that slides, and never ends. The list is
 * laid out three times over and the scroll position is quietly moved
 * back a set whenever it drifts into the copy on either side — so the
 * row loops in both directions without a seam, and without cloning
 * state or fighting the browser's own momentum scrolling.
 */

/** Move the row without animating: the loop's seam has to be invisible,
 *  and the arrows do their own smooth scrolling separately. */
function jump(el: HTMLElement, to: number) {
  const had = el.style.scrollBehavior;
  el.style.scrollBehavior = 'auto';
  el.scrollLeft = to;
  el.style.scrollBehavior = had;
}

const CHEV_L = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 6 8.5 12l6 6" /></svg>
);
const CHEV_R = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 6l6 6-6 6" /></svg>
);

export function CategoryRail({ categories }: { categories: CategoryVM[] }) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const setWidth = useRef(0);
  const n = categories.length;
  // Too few to fill a row: a loop would just be a jitter.
  const loops = n > 3;
  const laps = loops ? 3 : 1;

  /** One lap's width, remeasured whenever the row can change size. */
  const measure = useCallback(() => {
    const el = trackRef.current;
    if (!el || !loops) return;
    setWidth.current = el.scrollWidth / laps;
    // Start on the middle lap, so the row can be pushed either way.
    if (setWidth.current && el.scrollLeft < setWidth.current * 0.5)
      jump(el, setWidth.current);
  }, [laps, loops]);

  useEffect(() => {
    // Measure now if the row is already laid out, and again after the
    // next paint if it is not. (A backgrounded tab never paints, so the
    // frame callback alone would leave the row unmeasured.)
    measure();
    const raf = requestAnimationFrame(measure);
    if (!loops) return () => cancelAnimationFrame(raf);
    // Re-measure when the row changes size. ResizeObserver catches a
    // sidebar opening as well as the window moving; where it does not
    // exist, the window's own resize is close enough.
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', measure);
      };
    }
    const ro = new ResizeObserver(measure);
    if (trackRef.current) ro.observe(trackRef.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [measure, loops, n]);

  // The seam: whenever the middle lap is left behind, step back onto it.
  const onScroll = () => {
    const el = trackRef.current;
    if (!el || !loops) return;
    if (!setWidth.current) setWidth.current = el.scrollWidth / laps;
    const w = setWidth.current;
    if (!w) return;
    if (el.scrollLeft < w * 0.5) jump(el, el.scrollLeft + w);
    else if (el.scrollLeft > w * 1.5) jump(el, el.scrollLeft - w);
  };

  const step = (dir: number) => {
    const el = trackRef.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>('.catcard');
    const by = card ? card.offsetWidth + 14 : 220;
    el.scrollBy({ left: dir * by * 2, behavior: 'smooth' });
  };

  if (!n) return null;
  return (
    <div className="catrail">
      {loops ? (
        <button className="catrail-nav prev" aria-label="Previous categories" onClick={() => step(-1)}>
          {CHEV_L}
        </button>
      ) : null}
      <div className="catrail-track" ref={trackRef} onScroll={onScroll}>
        {Array.from({ length: laps }).flatMap((_, lap) =>
          categories.map((c) => <CatCard key={`${lap}-${c.id}`} c={c} />),
        )}
      </div>
      {loops ? (
        <button className="catrail-nav next" aria-label="More categories" onClick={() => step(1)}>
          {CHEV_R}
        </button>
      ) : null}
    </div>
  );
}
