import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, qc } from '../../App.js';

/**
 * Products with a booking (Alex, 2026-10-01): the salon's shelf at the
 * chosen location is offered on the salon page; a product toggles into
 * the visit like a treatment, shows in the summary with the total and
 * the points preview, and can be taken out again. Only what this
 * location sells is offered.
 */
const LOC = '20000000-0000-4000-8000-000000000001';
const LOC2 = '20000000-0000-4000-8000-000000000002';
const SVC = '60000000-0000-4000-8000-000000000008';
const BAND = '70000000-0000-4000-8000-000000000001';
const TAPE = '70000000-0000-4000-8000-000000000003';
const detail = {
  id: '10000000-0000-4000-8000-000000000001', slug: 'velnes-fizio', name: 'Velnes Fizio Centar', city: 'Skopje', address: 'Makedonija 12', phone: null,
  description: '', pitch: '', lat: null, lng: null, categories: [], gallery: [], socials: { website: null, instagram: null, facebook: null, tiktok: null },
  showPrices: true, team: [], bookable: true, publishableKey: 'pk_test', reviews: null,
  products: [
    { id: BAND, name: 'Resistance band set', category: 'Home exercise', price: 1200, at: [{ locationId: LOC, price: 1200 }, { locationId: LOC2, price: 1100 }] },
    // Sold only at the other location: not offered here.
    { id: TAPE, name: 'Kinesiology tape roll', category: 'Recovery aids', price: 550, at: [{ locationId: LOC2, price: 550 }] },
  ],
  locations: [{ id: LOC, name: 'Centar', city: 'Skopje', address: 'Makedonija 12', lat: null, lng: null, amenities: [], hours: null }],
};
const services = {
  services: [{ id: SVC, name: 'Sports massage', category: 'Recovery', durationMin: 45, price: 1900, priceFrom: 1900, variants: [], modifiers: [], employees: [{ id: '40000000-0000-4000-8000-000000000001', name: 'Maria Petrovska' }] }],
};

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.includes('/discovery/salons/velnes-fizio/reviews')) return ok({ reviews: [], total: 0, offset: 0, limit: 5 });
      if (url.includes('/discovery/salons/velnes-fizio')) return ok(detail);
      if (url.includes('/services?key=')) return ok(services);
      return ok({ categories: [], salons: [], services: [], slots: [{ t: '10:00', free: true }], towns: [], suggestions: [], how: 'default' });
    }),
  );
}

describe('products with a booking, on the salon page', () => {
  beforeEach(() => mockApi());
  afterEach(() => {
    cleanup();
    qc.clear();
    vi.unstubAllGlobals();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('offers this location\'s shelf, toggles a product into the visit, totals it, counts its points, and lets it go again', async () => {
    window.history.replaceState({}, '', `/salon/velnes-fizio?service=${SVC}`);
    render(<App />);
    const cart = await waitFor(() => {
      const el = document.getElementById('dcart');
      expect(el).toBeTruthy();
      return el!;
    });
    // Open the products of the desktop card.
    const toggles = screen.getAllByRole('button', { name: /products/i });
    fireEvent.click(toggles[0]!);
    // One product offered — the tape is sold elsewhere.
    expect(document.querySelectorAll(`[data-product="${BAND}"]`).length).toBeGreaterThan(0);
    expect(document.querySelector(`[data-product="${TAPE}"]`)).toBeNull();
    const card = document.querySelector<HTMLButtonElement>(`[data-product="${BAND}"]`)!;
    expect(card.textContent).toContain('Product');
    fireEvent.click(card);
    expect(card.getAttribute('aria-pressed')).toBe('true');
    expect(card.textContent).toContain('In your visit');
    // The cart: a product row, the total with it, the points with it.
    const row = await within(cart).findByTestId('cart-product');
    expect(row.textContent).toContain('Resistance band set');
    expect(within(cart).getByText(/3\.100/)).toBeDefined(); // 1.900 + 1.200
    expect(within(cart).getByTestId('loyalty-earn').textContent).toContain('120 Velnes points'); // 100 + 20
    // Out again, from the row.
    fireEvent.click(within(row).getByRole('button', { name: /Remove Resistance band set/ }));
    await waitFor(() => expect(within(cart).queryByTestId('cart-product')).toBeNull());
    expect(within(cart).getByTestId('loyalty-earn').textContent).toContain('100 Velnes points');
    expect(card.getAttribute('aria-pressed')).toBe('false');
  });

  it('the treatment card\'s heart is beside the card, not inside it', async () => {
    window.history.replaceState({}, '', '/salon/velnes-fizio');
    render(<App />);
    await waitFor(() => expect(document.querySelector('.tr-wrap')).toBeTruthy());
    expect(document.querySelector('button button')).toBeNull();
    const wrap = document.querySelector('.tr-wrap')!;
    expect(wrap.querySelector(':scope > button.tr-card')).toBeTruthy();
    expect(wrap.querySelector(':scope > button.fav-inline')).toBeTruthy();
  });
});
