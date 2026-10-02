import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, qc } from '../../App.js';
import { DRAFT_KEY } from './store.js';

/**
 * The review step (Alex, 2026-10-01: "/book/review page is empty"). The
 * draft survives a reload, and a step reached with nothing to book says
 * so instead of rendering nothing.
 */
const profile = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', email: 'ana@example.com', emailVerified: true, first: 'Ana', last: 'D', phone: null, dob: null,
  lang: 'en', avatar: null, since: '2026-09-01', personalisedResults: true, locationAllowed: null, loyaltyPoints: 100,
};
const draft = {
  slug: 'velnes-fizio', salonName: 'Velnes Fizio Centar', photo: '', publishableKey: 'pk_test', locationId: '20000000-0000-4000-8000-000000000001', lat: null, lng: null,
  items: [{ serviceId: '60000000-0000-4000-8000-000000000008', variantId: null, modifierOptionIds: [], name: 'Sports massage', durationMin: 45, price: 1900 }],
  serviceId: '60000000-0000-4000-8000-000000000008', variantId: null, serviceName: 'Sports massage', durationMin: 45, price: 1900,
  employeeId: '', employeeName: 'Any available professional', date: '2026-10-02', dayLbl: 'Tomorrow', time: '09:00',
  forWhom: 'self', guestName: '', email: '', name: '', phone: '',
};

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.includes('/client/me/notifications')) return ok({ notifications: [], unread: 0 });
      if (url.includes('/client/me')) return ok(profile);
      return ok({ categories: [], salons: [], services: [], towns: [], suggestions: [], how: 'default' });
    }),
  );
}

describe('/book/review', () => {
  beforeEach(() => mockApi());
  afterEach(() => {
    cleanup();
    qc.clear();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('a reload keeps the draft: the summary comes back from the tab, with the signed-in person named', async () => {
    localStorage.setItem('velnes.client.token', 'tok');
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    window.history.replaceState({}, '', '/book/review');
    render(<App />);
    expect(await screen.findByText(/Booking as Ana D · ana@example.com/)).toBeDefined();
    expect(screen.getByText('Velnes Fizio Centar')).toBeDefined();
    expect(screen.getByText(/Tomorrow · 09:00/)).toBeDefined();
    expect(screen.getByRole('button', { name: /Confirm booking/ })).toBeDefined();
    expect(screen.queryByTestId('no-draft')).toBeNull();
  });

  it('with nothing to book it says so and offers the way back — never a blank page', async () => {
    localStorage.setItem('velnes.client.token', 'tok');
    window.history.replaceState({}, '', '/book/review');
    render(<App />);
    const empty = await screen.findByTestId('no-draft');
    expect(empty.textContent).toContain('Pick a treatment at a salon first');
    screen.getByRole('button', { name: /Find a salon/ }).click();
    expect(window.location.pathname).toBe('/');
  });

  it('a guest at the review step is sent to the identity step, which says the same', async () => {
    window.history.replaceState({}, '', '/book/review');
    render(<App />);
    await screen.findByTestId('no-draft');
    expect(window.location.pathname).toBe('/book/identity');
  });
});
