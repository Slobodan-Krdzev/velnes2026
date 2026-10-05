import { useEffect, useState } from 'react';
import { businessOnboardingUrl } from '../../lib/business.js';
import { t } from '../../lib/i18n-core.js';

/** How long the page must be still before the button comes back. */
export const BIZFAB_SETTLE_MS = 220;

/**
 * "Velnes for Business" on a phone or tablet home (Alex, 2026-10-05):
 * the desktop header's link, as a floating button just above the tab
 * bar. It steps out of the way while the page scrolls and comes back
 * once the page has been still for a moment, so it never covers what
 * the thumb is reading mid-scroll. Same door as the desktop button.
 */
export function BizFab() {
  const [scrolling, setScrolling] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      setScrolling(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setScrolling(false), BIZFAB_SETTLE_MS);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (timer) clearTimeout(timer);
    };
  }, []);
  return (
    <a
      className={'m-bizfab' + (scrolling ? ' hid' : '')}
      href={businessOnboardingUrl()}
      tabIndex={scrolling ? -1 : undefined}
      data-testid="bizfab"
    >
      {t('c.hdr.business')}
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 12h13M13 6l6 6-6 6" />
      </svg>
    </a>
  );
}
