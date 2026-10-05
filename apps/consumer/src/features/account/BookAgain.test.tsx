import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, qc } from '../../App.js';
import { bookAgainHref } from './MyVelnes.js';

/**
 * "Book again" (Alex, 2026-09-30): the salon page opens on the visit as
 * it was — location, treatment, variant, options, professional — and
 * only the day and time are left. Nothing is locked.
 */
const APPT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LOC = '20000000-0000-4000-8000-000000000001';
const SVC = '60000000-0000-4000-8000-000000000008';
const VAR = '61000000-0000-4000-8000-000000000001';
const OPT = '62000000-0000-4000-8000-000000000001';
const EMP = '40000000-0000-4000-8000-000000000001';
const profile = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', email: 'ana@example.com', emailVerified: true, first: 'Ana', last: 'D', phone: null, dob: null,
  lang: 'en', avatar: null, since: '2026-09-01', personalisedResults: true, locationAllowed: null,
};
const appointment = {
  id: APPT, ref: 'AAAAAAAA', salonName: 'Velnes Fizio Centar', salonSlug: 'velnes-fizio', locationName: 'Centar', locationAddress: 'Makedonija 12', lat: null, lng: null,
  serviceName: 'Sports massage · 60 min', employeeName: 'Maria Petrovska', date: '2026-09-20', time: '10:00', end: '11:00', durationMin: 60, price: 2400, status: 'booked', paid: false, cancelHours: 24,
  completed: true, canReview: false, review: null, serviceId: SVC, employeeId: EMP, locationId: LOC, variantId: VAR, modifierOptionIds: [OPT],
  canReschedule: true, canCancel: true, cancelDeadline: null, cancelBlockedReason: null, changeRequest: null, cancellation: null, payment: { status: 'unpaid', method: null, amount: null }, refund: null, history: [],
};
const detail = {
  id: '10000000-0000-4000-8000-000000000001', slug: 'velnes-fizio', name: 'Velnes Fizio Centar', city: 'Skopje', address: 'Makedonija 12', phone: null,
  description: '', pitch: '', lat: null, lng: null, categories: [], gallery: [], socials: { website: null, instagram: null, facebook: null, tiktok: null },
  showPrices: true, team: [], products: [], bookable: true, publishableKey: 'pk_test', reviews: null,
  locations: [{ id: LOC, name: 'Centar', city: 'Skopje', address: 'Makedonija 12', lat: null, lng: null, amenities: [], hours: null }],
};
const services = {
  services: [
    {
      id: SVC, name: 'Sports massage', category: 'Recovery', durationMin: 45, price: 1900, priceFrom: 1900,
      variants: [{ id: VAR, label: '60 min', durationMin: 60, price: 2400, std: false }],
      modifiers: [{ id: '63000000-0000-4000-8000-000000000001', name: 'Extras', type: 'multi', required: false, options: [{ id: OPT, name: 'Hot stones', price: 300, durationMin: 10 }] }],
      employees: [{ id: EMP, name: 'Maria Petrovska' }, { id: '40000000-0000-4000-8000-000000000003', name: 'Elena Ristova' }],
    },
  ],
};

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (url.includes('/client/me/appointments')) return ok({ appointments: [appointment] });
      if (url.includes('/client/me/notifications')) return ok({ notifications: [], unread: 0 });
      if (url.includes('/client/me/offers')) return ok({ offers: [] });
      if (url.includes('/client/me/salons')) return ok({ salons: [] });
      if (url.includes('/client/me/favourites')) return ok({ salons: [], services: [], pros: [] });
      if (url.includes('/client/me')) return ok(profile);
      if (url.includes('/discovery/salons/velnes-fizio/reviews')) return ok({ reviews: [], total: 0, offset: 0, limit: 5 });
      if (url.includes('/discovery/salons/velnes-fizio')) return ok(detail);
      if (url.includes('/services?key=')) return ok(services);
      return ok({ categories: [], salons: [], services: [], slots: [], towns: [], suggestions: [], how: 'default' });
    }),
  );
}

describe('book again', () => {
  beforeEach(() => mockApi());
  afterEach(() => {
    cleanup();
    qc.clear();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('the link carries the visit as it was, and only what it really had', () => {
    expect(bookAgainHref(appointment)).toBe(`/salon/velnes-fizio?service=${SVC}&location=${LOC}&employee=${EMP}&variant=${VAR}&mods=${OPT}`);
    expect(bookAgainHref({ salonSlug: 'x', serviceId: SVC, locationId: LOC, employeeId: null, variantId: null, modifierOptionIds: [] })).toBe(`/salon/x?service=${SVC}&location=${LOC}`);
  });

  it('opens the salon page with the treatment, its variant and options, and the professional chosen', async () => {
    localStorage.setItem('velnes.client.token', 'tok');
    window.history.replaceState({}, '', `/account/appointments/${APPT}`);
    render(<App />);
    const again = await screen.findByRole('button', { name: 'Book again' });
    again.click();
    await waitFor(() => expect(window.location.pathname).toBe('/salon/velnes-fizio'));
    const q = new URLSearchParams(window.location.search);
    expect(q.get('service')).toBe(SVC);
    expect(q.get('employee')).toBe(EMP);
    // The cart holds the treatment, as its variant with the option (the
    // line's price is the variant's plus the option's); the professional
    // is Maria, not "any". Both layouts render; either will do.
    expect((await screen.findAllByRole('button', { name: /Sports massage/ })).length).toBeGreaterThan(0);
    await waitFor(() => expect(document.body.textContent).toContain('60 min ·'));
    await waitFor(() => expect(document.querySelector('[data-sum="pro"]')?.textContent).toBe('Maria Petrovska'));
    expect(document.body.textContent).toContain('2.700');
    // The booking summary says what the visit will earn — one service,
    // a length beyond Standard (no length is marked standard, so the
    // service itself is) and one option: 100 + 20 + 20, from the one
    // place the rule lives. Both cards say the "+20" themselves.
    expect((await screen.findAllByTestId('loyalty-earn'))[0]!.textContent).toBe('+140 Velnes points with this visit');
    const tags = screen.getAllByTestId('pts-badge');
    expect(tags[0]!.textContent).toBe('+20 points');
    expect(tags.some((el) => el.closest('button')?.textContent?.includes('60 min'))).toBe(true);
    expect(tags.some((el) => el.closest('button')?.textContent?.includes('Hot stones'))).toBe(true);
  });
});
