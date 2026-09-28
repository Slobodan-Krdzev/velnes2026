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
      const body = url.includes('/discovery/suggest')
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

  it('the "Available now" chip asks the search screen for everything now, near me', async () => {
    render(<App />);
    await screen.findAllByText('Massage tomorrow');
    // The chip is on both layouts (CSS picks one); the first will do.
    screen.getAllByRole('button', { name: 'Available now' })[0]!.click();
    await waitFor(() => expect(window.location.pathname).toBe('/search'));
    const q = new URLSearchParams(window.location.search);
    expect(q.get('q')).toBe('now');
    // `near` is an intent the results page consumes at once — with no
    // geolocation in this browser it can only drop it, and no radius
    // is claimed that could not run.
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('near')).toBeNull());
    expect(new URLSearchParams(window.location.search).get('km')).toBeNull();
  });

  it('the Search tab opens the sheet; What, Where and When are applied together, on Search', async () => {
    render(<App />);
    await screen.findAllByText('Massage tomorrow');
    // The tab bar renders before the routes, so its Search is the first.
    fireEvent.click(screen.getAllByRole('button', { name: 'Search' })[0]!);
    const dlg = await screen.findByRole('dialog', { name: 'Search' });
    // An empty field offers the shelf — every category on offer — even
    // with no bookings to make a "most chosen".
    expect(await within(dlg).findByText('Haircuts')).toBeTruthy();
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
});
