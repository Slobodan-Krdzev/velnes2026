import { render, screen, waitFor } from '@testing-library/react';
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
      const body = url.includes('/discovery/categories')
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
afterEach(() => vi.unstubAllGlobals());

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
});
