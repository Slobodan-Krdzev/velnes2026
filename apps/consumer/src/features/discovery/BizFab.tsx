import { businessOnboardingUrl } from '../../lib/business.js';
import { t } from '../../lib/i18n-core.js';
import { SCROLL_SETTLE_MS, useScrolling } from '../../lib/useScrollSettle.js';

/** How long the page must be still before the button comes back. */
export const BIZFAB_SETTLE_MS = SCROLL_SETTLE_MS;

/**
 * "Velnes for Business" on a phone or tablet home (Alex, 2026-10-05):
 * the desktop header's link, as a floating button just above the tab
 * bar. It steps out of the way while the page scrolls and comes back
 * once the page has been still for a moment, so it never covers what
 * the thumb is reading mid-scroll. Same door as the desktop button.
 */
export function BizFab() {
  const scrolling = useScrolling(BIZFAB_SETTLE_MS);
  return (
    <a
      className={'m-bizfab' + (scrolling ? ' hid' : '')}
      href={businessOnboardingUrl()}
      tabIndex={scrolling ? -1 : undefined}
      data-testid="bizfab"
    >
      {t('c.hdr.business')}
    </a>
  );
}
