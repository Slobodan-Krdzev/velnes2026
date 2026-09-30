import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.js';

/**
 * The public information pages (Alex, 2026-09-30): every footer link
 * leads to a page that renders for a signed-out visitor, each page
 * names itself in the tab and describes itself for search engines, and
 * an unknown URL is a not-found page that leads back in — never the
 * home page in disguise.
 */
const categories = {
  categories: [
    { id: '11111111-1111-4111-8111-111111111111', name: 'Massage', cardImage: null, icon: null },
    { id: '22222222-2222-4222-8222-222222222222', name: 'Haircuts', cardImage: null, icon: null },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = url.includes('/discovery/most-chosen')
        ? { categories: [categories.categories[0]] }
        : url.includes('/discovery/categories')
          ? categories
          : url.includes('/discovery/towns')
            ? { towns: [] }
            : url.includes('/discovery/suggestions')
              ? { how: 'default', suggestions: [] }
              : { salons: [], services: [], slots: [], categories: [] };
      return { ok: true, json: async () => body } as Response;
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

const at = (path: string) => {
  window.history.replaceState({}, '', path);
  return render(<App />);
};

/** Route, the page's headline, and its tab title where the two differ
 *  (the tab carries the footer's label; the headline can say more). */
const PAGES: [string, string, string?][] = [
  ['/treatments', 'Treatments'],
  ['/how-it-works', 'How Velnes works'],
  ['/help', 'Help center'],
  ['/for-business', 'Grow your business with Velnes', 'List your business'],
  ['/business-benefits', 'Why salons use Velnes', 'Business benefits'],
  ['/business-resources', 'Resources for businesses'],
  ['/partner-support', 'Partner support'],
  ['/about', 'About Velnes'],
  ['/careers', 'Careers'],
  ['/press', 'Press'],
  ['/contact', 'Contact us'],
  ['/privacy', 'Privacy'],
  ['/terms', 'Terms of service'],
  ['/cookies', 'Cookies'],
];

describe('the public pages', () => {
  it.each(PAGES)('%s renders for a signed-out visitor, with a title and a description', async (path, heading, tab) => {
    at(path);
    const h1 = await screen.findByRole('heading', { level: 1, name: heading });
    expect(h1).toBeTruthy();
    await waitFor(() => expect(document.title).toBe(`${tab ?? heading} | Velnes`));
    const desc = document.head.querySelector('meta[name="description"]')!.getAttribute('content');
    expect(desc && desc.length > 20).toBe(true);
    // Public: nothing asked the visitor to sign in.
    expect(window.location.pathname).toBe(path);
  });

  it('every footer link leads to a page of its own, and nothing is left dead', async () => {
    at('/about');
    await screen.findByRole('heading', { level: 1, name: 'About Velnes' });
    const hrefs = [...document.querySelectorAll<HTMLAnchorElement>('.d-foot a, .m-foot a')].map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.length).toBeGreaterThan(0);
    const routes = new Set([...PAGES.map(([p]) => p), '/premium']);
    for (const h of hrefs) {
      expect(h, h).not.toBe('#');
      expect(routes.has(h), `${h} is not a page`).toBe(true);
    }
    // Gift cards has no product behind it yet, and left with the dead links.
    expect(hrefs.some((h) => h.includes('gift'))).toBe(false);
    expect(document.querySelector('.d-foot form')).toBeNull();
  });

  it('the treatments page shows the real categories, each opening its results page', async () => {
    at('/treatments');
    const card = (await screen.findAllByText('Haircuts')).find((el) => el.closest('.pub-catgrid'))!;
    fireEvent.click(card.closest('a')!);
    await waitFor(() => expect(window.location.pathname).toBe('/s/haircuts'));
  });

  it('help answers open and close, and the way to write in is a real address', async () => {
    at('/help');
    const q = await screen.findByText('Can I cancel an appointment?');
    const details = q.closest('details')!;
    expect(details.open).toBe(false);
    fireEvent.click(q);
    expect(details.open).toBe(true);
    const mail = document.querySelector<HTMLAnchorElement>('.pub a[href^="mailto:"]')!;
    expect(mail.getAttribute('href')).toMatch(/^mailto:.+@.+/);
  });

  it('the business CTA is the real onboarding door', async () => {
    at('/for-business');
    await screen.findByRole('heading', { level: 1, name: 'Grow your business with Velnes' });
    const cta = document.querySelector<HTMLAnchorElement>('.pub-cta a.btn-p')!;
    expect(cta.getAttribute('href')).toMatch(/\/onboarding$/);
  });

  it('an unknown URL is a not-found page that leads home or to search, and asks not to be indexed', async () => {
    at('/this/does/not/exist');
    await screen.findByRole('heading', { level: 1, name: 'We couldn’t find this page' });
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex');
    // Not the home page in disguise: no search hero, no category rail.
    expect(document.querySelector('.catrail')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: /Search Velnes/ }));
    await waitFor(() => expect(window.location.pathname).toBe('/search'));
    // Leaving takes the robots tag with it.
    await waitFor(() => expect(document.head.querySelector('meta[name="robots"]')).toBeNull());
  });

  it('the legal pages say what they are and when, and claim no cookies', async () => {
    at('/cookies');
    await screen.findByRole('heading', { level: 1, name: 'Cookies' });
    expect(screen.getByText(/Last updated 30 September 2026/)).toBeTruthy();
    expect(screen.getByText('No cookies')).toBeTruthy();
  });
});
