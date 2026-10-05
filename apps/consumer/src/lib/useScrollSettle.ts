import { useEffect, useState } from 'react';

/** How long the page must be still before a hidden control comes back. */
export const SCROLL_SETTLE_MS = 220;

/**
 * Is the page scrolling right now? True from the first scroll event
 * until the page has been still for `settleMs`. Floating controls on a
 * phone (the business button on the home, the booking bar on a salon)
 * step out of the way while it is true, so they never cover what the
 * thumb is reading mid-scroll, and come back once it stops.
 */
export function useScrolling(settleMs = SCROLL_SETTLE_MS): boolean {
  const [scrolling, setScrolling] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      setScrolling(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setScrolling(false), settleMs);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (timer) clearTimeout(timer);
    };
  }, [settleMs]);
  return scrolling;
}
