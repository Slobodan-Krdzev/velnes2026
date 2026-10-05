import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, qc } from '../../App.js';

/**
 * The Book now button as a pointer (Alex, 2026-10-01): short of a
 * step it names the step and a tap scrolls to that step, in whichever
 * layout the button lives — never a grey button with a hint under it.
 */
const LOC = '20000000-0000-4000-8000-000000000001';
const SVC = '60000000-0000-4000-8000-000000000008';
const GRP = '63000000-0000-4000-8000-000000000001';
const OPT = '62000000-0000-4000-8000-000000000001';
const detail = {
  id: '10000000-0000-4000-8000-000000000001', slug: 'velnes-fizio', name: 'Velnes Fizio Centar', city: 'Skopje', address: 'Makedonija 12', phone: null,
  description: '', pitch: '', lat: null, lng: null, categories: [], gallery: [], socials: { website: null, instagram: null, facebook: null, tiktok: null },
  showPrices: true, team: [], products: [], bookable: true, publishableKey: 'pk_test', reviews: null,
  locations: [{ id: LOC, name: 'Centar', city: 'Skopje', address: 'Makedonija 12', lat: null, lng: null, amenities: [], hours: null }],
};
const services = {
  services: [
    {
      id: SVC, name: 'Sports massage', category: 'Recovery', durationMin: 45, price: 1900, priceFrom: 1900, variants: [],
      modifiers: [{ id: GRP, name: 'Pressure', type: 'single', required: true, options: [{ id: OPT, name: 'Firm', price: 0, durationMin: 0 }] }],
      employees: [{ id: '40000000-0000-4000-8000-000000000001', name: 'Maria Petrovska' }],
    },
  ],
};

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.includes('/discovery/salons/velnes-fizio/reviews')) return ok({ reviews: [], total: 0, offset: 0, limit: 5 });
      if (url.includes('/discovery/salons/velnes-fizio')) return ok(detail);
      if (url.includes('/services?key=')) return ok(services);
      if (url.includes('/availability') || url.includes('/slots')) return ok({ slots: [{ t: '10:00', free: true }, { t: '11:00', free: true }] });
      return ok({ categories: [], salons: [], services: [], slots: [{ t: '10:00', free: true }], towns: [], suggestions: [], how: 'default' });
    }),
  );
}

/** The desktop cart's button — the cart itself appears once a treatment
 *  is in the visit; before that, the phone bar is the one that speaks. */
const cta = () => document.querySelector<HTMLButtonElement>('#dcart button[data-need]')!;
const bar = () => document.querySelector<HTMLButtonElement>('.m-bookbar button[data-need]')!;

describe('the Book now button names the missing step', () => {
  const scrolled: string[] = [];
  beforeEach(() => {
    mockApi();
    scrolled.length = 0;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
  });
  afterEach(() => {
    cleanup();
    qc.clear();
    vi.unstubAllGlobals();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('the phone bar slides away while the page scrolls and comes back once it is still', async () => {
    window.history.replaceState({}, '', '/salon/velnes-fizio');
    render(<App />);
    await waitFor(() => expect(bar()).toBeTruthy());
    const el = () => document.querySelector('.m-bookbar')!;
    expect(el().className).toBe('m-bookbar');
    fireEvent.scroll(window);
    expect(el().className).toContain('hid');
    await waitFor(() => expect(el().className).toBe('m-bookbar'));
  });

  it('treatment → required option → time → Book now, each tap scrolling to its own step in its own layout', async () => {
    window.history.replaceState({}, '', '/salon/velnes-fizio');
    render(<App />);
    // Nothing chosen: the phone bar asks for a treatment and leads to
    // the phone card's treatments, not the desktop card's.
    await waitFor(() => expect(bar()).toBeTruthy());
    expect(bar().textContent).toContain('Select a treatment');
    expect(bar().disabled).toBe(false);
    fireEvent.click(bar());
    expect(scrolled).toEqual(['m-bk-treat']);
    expect(document.getElementById('m-bk-treat')?.classList.contains('bk-flash')).toBe(true);
    // A treatment with a required group nobody answered: the group, by
    // name — in the desktop cart, which now exists, pointing at the
    // desktop card.
    fireEvent.click(document.querySelector<HTMLButtonElement>('#d-bk-treat ~ .tr-grid .tr-card')!);
    await waitFor(() => expect(cta()).toBeTruthy());
    expect(cta().textContent?.trim()).toBe('Select Pressure');
    fireEvent.click(cta());
    expect(scrolled.at(-1)).toBe(`d-bk-opt-${SVC}-${GRP}`);
    expect(document.getElementById(`d-bk-opt-${SVC}-${GRP}`)).toBeTruthy();
    // The option answered: a time is what is left.
    fireEvent.click(screen.getAllByRole('button', { name: /Firm/ })[0]!);
    await waitFor(() => expect(cta().textContent?.trim()).toBe('Select date & time'));
    fireEvent.click(cta());
    expect(scrolled.at(-1)).toBe('d-bk-when');
    // A time picked: the button books.
    const slot = await waitFor(() => {
      const el = document.querySelector<HTMLButtonElement>('#d-bk-when ~ div .timegrid .slot');
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.click(slot);
    await waitFor(() => expect(cta().textContent?.trim()).toBe('Book now'));
    expect(cta().dataset.need).toBe('none');
    expect(bar().textContent).toContain('Book now');
  });
});
