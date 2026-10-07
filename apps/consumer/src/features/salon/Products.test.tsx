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
  productsTotal: 2,
  locations: [{ id: LOC, name: 'Centar', city: 'Skopje', address: 'Makedonija 12', lat: null, lng: null, amenities: [], hours: null }],
};
const services = {
  services: [{ id: SVC, name: 'Sports massage', category: 'Recovery', durationMin: 45, price: 1900, priceFrom: 1900, variants: [], modifiers: [], employees: [{ id: '40000000-0000-4000-8000-000000000001', name: 'Maria Petrovska' }] }],
};

const PROMO = '70000000-0000-4000-8000-000000000050';
const many = {
  ...detail,
  products: [
    { id: PROMO, name: 'Arnica massage oil', category: 'Oils', price: 900, promo: { kind: 'pct', value: 20, ends: '2026-10-20' }, at: [{ locationId: LOC, price: 720, regularPrice: 900 }] },
    ...Array.from({ length: 14 }, (_, i) => ({ id: `70000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, name: `Shelf product ${String(i + 1).padStart(2, '0')}`, category: 'Oils', price: 100 + i, at: [{ locationId: LOC, price: 100 + i, regularPrice: 100 + i }] })),
  ].slice(0, 12),
  productsTotal: 15,
};
const extra = { id: '70000000-0000-4000-8000-000000000199', name: 'Foot cream deluxe', category: 'Oils', price: 450, at: [{ locationId: LOC, price: 450, regularPrice: 450 }] };

function mockApi(which: 'few' | 'many' = 'few') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.includes('/discovery/salons/velnes-fizio/reviews')) return ok({ reviews: [], total: 0, offset: 0, limit: 5 });
      if (url.includes('/discovery/salons/velnes-fizio/products')) {
        const q = new URL(url, 'http://x').searchParams.get('q') ?? '';
        const all = [many.products[0]!, ...many.products.slice(1), extra].filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
        return ok({ products: all.slice(0, 12), total: all.length, page: 1, limit: 12 });
      }
      if (url.includes('/discovery/salons/velnes-fizio')) return ok(which === 'many' ? many : detail);
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
    const row0 = await within(cart).findByTestId('cart-product');
    expect(row0.textContent).toContain('Resistance band set');
    expect(within(cart).getByText(/3\.100/)).toBeDefined(); // 1.900 + 1.200
    expect(within(cart).getByTestId('loyalty-earn').textContent).toContain('120 Velnes points'); // 100 + 20
    // More of it: the card's stepper, mirrored in the cart row.
    const stepper = card.parentElement!.querySelector('[data-testid="qty"]')!;
    fireEvent.click(within(stepper as HTMLElement).getByRole('button', { name: /One more Resistance band set/ }));
    await waitFor(() => expect(card.textContent).toContain('2 in your visit'));
    expect(within(cart).getByTestId('cart-product').textContent).toContain('2 × 1.200');
    expect(within(cart).getByText(/4\.300/)).toBeDefined(); // 1.900 + 2 × 1.200
    expect(within(cart).getByTestId('loyalty-earn').textContent).toContain('140 Velnes points'); // 100 + 2 × 20
    // Fewer, from the cart row this time; below one it is out.
    const rowStep = within(within(cart).getByTestId('cart-product')).getByRole('button', { name: /One fewer Resistance band set/ });
    fireEvent.click(rowStep);
    await waitFor(() => expect(within(cart).getByText(/3\.100/)).toBeDefined());
    fireEvent.click(within(within(cart).getByTestId('cart-product')).getByRole('button', { name: /One fewer Resistance band set/ }));
    await waitFor(() => expect(within(cart).queryByTestId('cart-product')).toBeNull());
    expect(card.getAttribute('aria-pressed')).toBe('false');
    // In once more, then out again, from the row's remove.
    fireEvent.click(card);
    await within(cart).findByTestId('cart-product');
    const row = within(cart).getByTestId('cart-product');
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

  it('a promotion shows its tag with the regular price crossed out, the page stops at twelve, and "See all products" opens the searchable modal that adds to the visit', async () => {
    cleanup();
    vi.unstubAllGlobals();
    mockApi('many');
    window.history.replaceState({}, '', `/salon/velnes-fizio?service=${SVC}`);
    render(<App />);
    await waitFor(() => expect(document.getElementById('dcart')).toBeTruthy());
    const toggles = screen.getAllByRole('button', { name: /products/i });
    expect(toggles[0]!.textContent).toContain('15 products');
    fireEvent.click(toggles[0]!);
    const promoCard = document.querySelector<HTMLButtonElement>(`[data-product="${PROMO}"]`)!;
    expect(within(promoCard).getByTestId('promo-tag').textContent).toContain('Promo');
    expect(within(promoCard).getByTestId('promo-tag').textContent).toContain('20%');
    expect(within(promoCard).getByText('900 MKD').tagName).toBe('S');
    expect(within(promoCard).getByText('720 MKD')).toBeDefined();
    // Twelve on the page, the promotion first.
    const grid = promoCard.closest('.tr-grid')!;
    expect(grid.querySelectorAll('[data-product]').length).toBe(12);
    expect(grid.querySelector('[data-product]')!.getAttribute('data-product')).toBe(PROMO);
    fireEvent.click(screen.getAllByTestId('see-all-products')[0]!);
    const modal = (await screen.findAllByTestId('all-products'))[0]!;
    expect(await within(modal).findByText(/1–12 of 13/)).toBeDefined(); // the mock's shelf: the promo, eleven more, and the one only the modal carries
    fireEvent.change(within(modal).getByLabelText('Search by name'), { target: { value: 'foot' } });
    const found = await within(modal).findByText('Foot cream deluxe');
    fireEvent.click(found.closest('button')!);
    await waitFor(() => expect(within(modal).getByText('Foot cream deluxe').closest('button')?.getAttribute('aria-pressed')).toBe('true'));
    // The product the modal added is in the visit's basket at its price.
    const cart = document.getElementById('dcart')!;
    await waitFor(() => expect(within(cart).getByTestId('cart-product').textContent).toContain('Foot cream deluxe'));
  });
});
