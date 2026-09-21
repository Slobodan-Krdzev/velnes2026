import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * Let a horizontal rail be pushed with an ordinary mouse wheel.
 *
 * A wheel reports a vertical delta and the page is what normally moves,
 * so a row that only scrolls sideways reads as a dead spot: the cursor
 * is over the thing you want to move and nothing about it budges. Here
 * the rail takes that delta and slides instead.
 *
 * Two rules keep it from stealing the page out from under the reader:
 *
 *  - A gesture that is already scrolling the page runs through the rail
 *    untouched, so sweeping the cursor down over a shelf mid-scroll does
 *    not snag on it. Only a wheel that starts while the page is still
 *    moves the rail.
 *  - A rail that has run out of room hands the rest back, the way a
 *    nested scroller normally chains to its parent. (The looping
 *    category shelf never reaches an end, which is exactly why the first
 *    rule has to exist.)
 *
 * A trackpad's own sideways swipe already scrolls the rail natively, and
 * pinch-zoom arrives as a ctrl-wheel; both are left alone.
 */

/** How long after the page last moved a wheel still counts as "part of
 *  that gesture" rather than a fresh push on the rail. */
const PAGE_SCROLL_GRACE_MS = 180;

let lastPageScrollAt = 0;
let watchingPage = false;

/** One shared listener: every rail asks the same question, and a scroll
 *  listener per rail would be a needless cost on a long page. */
function watchPageScroll() {
  if (watchingPage || typeof window === 'undefined') return;
  watchingPage = true;
  // A scroll on the rail itself does not reach the window — scroll does
  // not bubble — so this only ever records the page moving.
  window.addEventListener(
    'scroll',
    () => {
      lastPageScrollAt = Date.now();
    },
    { passive: true },
  );
}

/** Wheel deltas arrive in pixels, lines or pages depending on the
 *  device; normalise them so one notch feels the same everywhere. */
function pixels(e: WheelEvent, el: HTMLElement) {
  if (e.deltaMode === 1) return e.deltaY * 16; // lines
  if (e.deltaMode === 2) return e.deltaY * el.clientWidth; // pages
  return e.deltaY;
}

export function useWheelScroll(ref: RefObject<HTMLElement | null>) {
  // The effect deliberately has no dependency array. A rail is usually
  // empty on its first render — the categories, the days, the salons are
  // still on their way — and a component with nothing to show returns
  // null, so there is no element to listen to yet. A ref object keeps
  // the same identity once the element does arrive, so a [ref]
  // dependency would never fire again and the rail would stay deaf for
  // good. Re-running each render costs one listener swap and is always
  // right.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    watchPageScroll();

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch-zoom
      // Already a sideways gesture: the browser handles it better.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (Date.now() - lastPageScrollAt < PAGE_SCROLL_GRACE_MS) return;

      const max = el.scrollWidth - el.clientWidth;
      if (max <= 1) return; // nothing to slide

      const delta = pixels(e, el);
      if (!delta) return;
      // At the end of the rail, let the page have the rest.
      if (delta < 0 && el.scrollLeft <= 0) return;
      if (delta > 0 && el.scrollLeft >= max - 1) return;

      e.preventDefault();
      // A rail may ask for smooth scrolling so its arrows glide. A wheel
      // should answer under the hand instead, and an animation in flight
      // would fight the looping shelf's seam correction, so the delta
      // goes on with that turned off — the shelf's own trick.
      const had = el.style.scrollBehavior;
      el.style.scrollBehavior = 'auto';
      el.scrollLeft += delta;
      el.style.scrollBehavior = had;
    };

    // Not passive: taking the delta means preventing the page scroll.
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });
}
