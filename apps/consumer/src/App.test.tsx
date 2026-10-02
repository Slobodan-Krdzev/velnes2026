import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';

/** The home screen against a stubbed discovery surface: the categories
 *  and salons the API returns are the ones that reach the screen — no
 *  seeded fallbacks hiding an empty response. */

const categories = {
  categories: [
    { id: '11111111-1111-4111-8111-111111111111', name: 'Massage', cardImage: null, icon: null },
    { id: '22222222-2222-4222-8222-222222222222', name: 'Haircuts', cardImage: null, icon: null },
  ],
};
const salons = {
  salons: [
    {
      slug: 'zen-rooms',
      name: 'Zen Rooms',
      city: 'Skopje',
      address: 'Partizanska 1',
      pitch: 'Quiet massage studio',
      categories: [],
      serviceCategories: ['Massage'],
      photo: null,
      bookable: true,
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = url.includes('/discovery/suggestions')
        ? {
            how: 'default',
            suggestions: [
              { id: 'now-all', kind: 'now_all', reason: 'now', intent: { category: null, salon: null, city: null, nearby: false, radiusKm: null, now: true }, salons: null },
              { id: 'near-1', kind: 'category_now', reason: 'nearby', intent: { category: { id: '11111111-1111-4111-8111-111111111111', name: 'Massage' }, salon: null, city: null, nearby: true, radiusKm: 10, now: true }, salons: null },
            ],
          }
        : url.includes('/discovery/suggest')
        ? { categories: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Massage', salonCount: 1 }], services: [], salons: [] }
        : url.includes('/discovery/towns')
          ? { towns: [{ name: 'Skopje', salons: 1 }] }
          : url.includes('/discovery/categories')
        ? categories
        : // the detail door is a deeper path than the list door
          /\/discovery\/salons\/./.test(url)
          ? { ...salons.salons[0], description: '', gallery: [], showPrices: true, team: [], products: [], publishableKey: 'pk_test', locations: [], phone: null }
          : url.includes('/discovery/salons')
            ? salons
            : url.includes('/discovery/search')
              ? // The text reaches a salon by name too — offered on a typed search, not on a chip.
                { services: [], salons: [{ id: '33333333-3333-4333-8333-333333333333', slug: 'zen-rooms', name: 'Zen Rooms', city: 'Skopje' }], directSalon: null, how: 'default', widened: false, personalised: false }
              : { services: [], slots: [] };
      return { ok: true, json: async () => body } as Response;
    }),
  );
});
afterEach(() => {
  // One App per test: without this the renders pile up in the document
  // and a later test clicks into an earlier test's tree.
  cleanup();
  vi.unstubAllGlobals();
  // A test that navigated leaves the next one at home again.
  window.history.replaceState({}, '', '/');
});

describe('the consumer app', () => {
  it('renders the categories the API serves', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getAllByText('Massage').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Haircuts').length).toBeGreaterThan(0);
  });

  it('shows real salons in the recommendations', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getAllByText('Zen Rooms').length).toBeGreaterThan(0));
  });

  it('the phone home reads search, chips, recommended, then the treatments under "Explore treatments"', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getAllByText('Zen Rooms').length).toBeGreaterThan(0));
    const phone = document.querySelector('.m-env')!;
    const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const chips = phone.querySelector('.m-chiprow')!;
    const reco = phone.querySelector('.m-reco')!;
    const explore = [...phone.querySelectorAll('h2')].find((h) => h.textContent === 'Explore treatments')!;
    const rail = phone.querySelector('.catrail')!;
    // Alex, 2026-09-29: nothing between the chips and Recommended — the
    // treatment rail moved down under its own heading.
    expect(before(chips, reco)).toBe(true);
    expect(before(reco, explore)).toBe(true);
    expect(before(explore, rail)).toBe(true);
    expect(phone.querySelector('.m-chiprow + .catrail')).toBeNull();
    // No section heading for a section with nothing in it.
    expect([...phone.querySelectorAll('h2')].some((h) => h.textContent === 'Newest to Velnes')).toBe(false);
  });

  it('the "Available now" chip asks the search screen for anything that can start now', async () => {
    render(<App />);
    await screen.findAllByText('Massage tomorrow');
    // The chip is on both layouts (CSS picks one); the first will do.
    screen.getAllByRole('button', { name: 'Available now' })[0]!.click();
    await waitFor(() => expect(window.location.pathname).toBe('/search'));
    const q = new URLSearchParams(window.location.search);
    expect(q.get('q')).toBe('now');
    // Anything, now — not near (Alex, 2026-09-30): no radius, no intent.
    expect(q.get('near')).toBeNull();
    expect(q.get('km')).toBeNull();
    expect(q.get('when')).toBeNull();
  });

  /** Each chip is a whole search (Alex, 2026-09-30): the word, and the
   *  day, place or party it names — carried in the URL as the doors'
   *  own filters, and shown lit on the results page so it can be
   *  taken off. */
  it('"Massage tomorrow" searches massage with a day, lit on the results page', async () => {
    render(<App />);
    await screen.findAllByText('Massage tomorrow');
    screen.getAllByRole('button', { name: 'Massage tomorrow' })[0]!.click();
    await waitFor(() => expect(window.location.pathname).toBe('/search'));
    const q = new URLSearchParams(window.location.search);
    expect(q.get('q')).toBe('Massage');
    expect(q.get('when')).toBe('tomorrow');
    expect(q.get('party')).toBeNull();
    const chip = (await screen.findAllByRole('button', { name: 'Tomorrow' }))[0]!;
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    // A chip asks for treatments: the salon that carries the word is not offered.
    expect(q.get('via')).toBe('chip');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Zen Rooms')).toBeNull();
    // Off again: the day leaves the URL.
    chip.click();
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('when')).toBeNull());
  });

  it('a typed "Massage" still offers the salon that carries the word', async () => {
    window.history.pushState({}, '', '/search?q=Massage');
    render(<App />);
    // Both layouts render; either is enough.
    expect((await screen.findAllByText('Zen Rooms')).length).toBeGreaterThan(0);
  });

  it('"Facial this weekend" and "Manicure" carry the weekend, and just the word', async () => {
    render(<App />);
    await screen.findAllByText('Massage tomorrow');
    screen.getAllByRole('button', { name: 'Facial this weekend' })[0]!.click();
    await waitFor(() => expect(window.location.pathname).toBe('/search'));
    let q = new URLSearchParams(window.location.search);
    expect(q.get('q')).toBe('Facial');
    expect(q.get('when')).toBe('weekend');
    expect((await screen.findAllByRole('button', { name: 'This weekend' })).length).toBeGreaterThan(0);
    window.history.pushState({}, '', '/');
    cleanup();
    render(<App />);
    await screen.findAllByText('Massage tomorrow');
    screen.getAllByRole('button', { name: 'Manicure' })[0]!.click();
    await waitFor(() => expect(window.location.pathname).toBe('/search'));
    q = new URLSearchParams(window.location.search);
    expect(q.get('q')).toBe('Manicure');
    expect([...q.keys()]).toEqual(['q', 'via']);
  });

  it('"Haircut near me" asks for Near me the way the button would; "Couple massage" is massage for two', async () => {
    render(<App />);
    await screen.findAllByText('Massage tomorrow');
    screen.getAllByRole('button', { name: 'Haircut near me' })[0]!.click();
    await waitFor(() => expect(window.location.pathname).toBe('/search'));
    expect(new URLSearchParams(window.location.search).get('q')).toBe('Haircut');
    // `near` is an intent the results page consumes at once — with no
    // geolocation in this browser it can only drop it, and no radius
    // is claimed that could not run.
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('near')).toBeNull());
    expect(new URLSearchParams(window.location.search).get('km')).toBeNull();
    window.history.pushState({}, '', '/');
    cleanup();
    render(<App />);
    await screen.findAllByText('Massage tomorrow');
    screen.getAllByRole('button', { name: 'Couple massage' })[0]!.click();
    await waitFor(() => expect(window.location.pathname).toBe('/search'));
    const q = new URLSearchParams(window.location.search);
    expect(q.get('q')).toBe('Massage');
    expect(q.get('party')).toBe('2');
    const chip = (await screen.findAllByRole('button', { name: 'For two' }))[0]!;
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    chip.click();
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('party')).toBeNull());
  });

  it('the sheet\'s When? offers the days, and one rides to the category page', async () => {
    render(<App />);
    await screen.findAllByText('Massage tomorrow');
    fireEvent.click(screen.getAllByRole('button', { name: 'Search' })[0]!);
    const dlg = await screen.findByRole('dialog', { name: 'Search' });
    fireEvent.change(within(dlg).getByRole('textbox'), { target: { value: 'mass' } });
    fireEvent.mouseDown(await within(dlg).findByText('Massage'));
    fireEvent.click(within(dlg).getByText('When?'));
    fireEvent.click(within(dlg).getByRole('button', { name: /^Tomorrow/ }));
    fireEvent.click(within(dlg).getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(window.location.pathname).toBe('/s/massage'));
    const q = new URLSearchParams(window.location.search);
    expect(q.get('when')).toBe('tomorrow');
    expect(q.get('now')).toBeNull();
  });

  it('the Search tab opens the sheet; What, Where and When are applied together, on Search', async () => {
    render(<App />);
    await screen.findAllByText('Massage tomorrow');
    // The tab bar renders before the routes, so its Search is the first.
    fireEvent.click(screen.getAllByRole('button', { name: 'Search' })[0]!);
    const dlg = await screen.findByRole('dialog', { name: 'Search' });
    // An empty field is discovery: the door's suggestions, as intents.
    expect(await within(dlg).findByText('Massage now')).toBeTruthy();
    // What: typing brings the suggestions; a category becomes the answer
    // and the sheet moves on to Where — nothing has navigated yet.
    fireEvent.change(within(dlg).getByRole('textbox'), { target: { value: 'mass' } });
    // Suggestion rows act on mousedown, so the field keeps its focus.
    fireEvent.mouseDown(await within(dlg).findByText('Massage'));
    expect(window.location.pathname).toBe('/');
    // Where: a town — typed to narrow the suggestions, then picked. (A
    // town nobody has salons in can be typed and used as it is.)
    fireEvent.change(within(dlg).getByRole('textbox', { name: 'Search a town' }), { target: { value: 'sko' } });
    fireEvent.click(await within(dlg).findByText('Skopje'));
    // When: available now — a start within the next 30 minutes.
    fireEvent.click(within(dlg).getByText('When?'));
    fireEvent.click(within(dlg).getByRole('button', { name: /Available now/ }));
    expect(window.location.pathname).toBe('/');
    // Search: one URL, everything at once — the category page, in that
    // town, now.
    fireEvent.click(within(dlg).getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(window.location.pathname).toBe('/s/massage'));
    const q = new URLSearchParams(window.location.search);
    expect(q.get('now')).toBe('1');
    expect(q.get('city')).toBe('Skopje');
    expect(q.get('near')).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull();
  });

  it('a suggestion is a search intent: one tap fills What and When, and Search applies them together', async () => {
    render(<App />);
    await screen.findAllByText('Massage tomorrow');
    fireEvent.click(screen.getAllByRole('button', { name: 'Search' })[0]!);
    const dlg = await screen.findByRole('dialog', { name: 'Search' });
    fireEvent.click(await within(dlg).findByText('Massage now'));
    // What and When are answered; Where is not — this browser has no
    // geolocation, so the sheet never claims to know where the person is.
    expect(within(dlg).getByText('Massage')).toBeTruthy();
    expect(within(dlg).getAllByText('Available now').length).toBeGreaterThan(0);
    expect(window.location.pathname).toBe('/');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(window.location.pathname).toBe('/s/massage'));
    const q = new URLSearchParams(window.location.search);
    expect(q.get('now')).toBe('1');
    expect(q.get('near')).toBeNull();
  });
});
