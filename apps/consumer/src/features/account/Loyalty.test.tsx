import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, qc } from '../../App.js';

/**
 * Velnes Loyalty in My Velnes (Alex, 2026-09-30): the balance on the
 * overview, the ledger as people read it, and how points are earned —
 * every number from the door, none computed here.
 */
const profile = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', email: 'ana@example.com', emailVerified: true, first: 'Ana', last: 'D', phone: null, dob: null,
  lang: 'en', avatar: null, since: '2026-09-01', personalisedResults: true, locationAllowed: null, loyaltyPoints: 1450,
};
const account = {
  balance: 1450,
  rules: { version: 1, registration: 100, firstService: 100, additionalService: 30, productUnit: 20, extraChoice: 20, review: 50 },
  entries: [
    { id: 'e0000000-0000-4000-8000-000000000003', type: 'review_submitted', points: 50, sourceType: 'review', sourceId: 'r1', salonName: 'Velnes Fizio Centar', meta: {}, at: '2026-09-30T10:00:00.000Z' },
    { id: 'e0000000-0000-4000-8000-000000000002', type: 'appointment_completed', points: 190, sourceType: 'appointment', sourceId: 'a1', salonName: 'Velnes Fizio Centar', meta: { serviceCount: 2, productUnits: 2, servicePoints: 130, productPoints: 40, total: 170 }, at: '2026-09-29T10:00:00.000Z' },
    { id: 'e0000000-0000-4000-8000-000000000001', type: 'registration_bonus', points: 100, sourceType: 'account', sourceId: 'c1', salonName: null, meta: {}, at: '2026-09-12T10:00:00.000Z' },
  ],
};

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.includes('/client/me/loyalty')) return ok(account);
      if (url.includes('/client/me/appointments')) return ok({ appointments: [] });
      if (url.includes('/client/me/notifications')) return ok({ notifications: [], unread: 0 });
      if (url.includes('/client/me/offers')) return ok({ offers: [] });
      if (url.includes('/client/me/salons')) return ok({ salons: [] });
      if (url.includes('/client/me/favourites')) return ok({ salons: [], services: [], pros: [] });
      if (url.includes('/client/me')) return ok(profile);
      return ok({ categories: [], salons: [], services: [], towns: [], suggestions: [], how: 'default' });
    }),
  );
}

describe('Velnes Loyalty', () => {
  beforeEach(() => mockApi());
  afterEach(() => {
    cleanup();
    qc.clear();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('the overview shows the balance and opens the loyalty section', async () => {
    localStorage.setItem('velnes.client.token', 'tok');
    window.history.replaceState({}, '', '/account');
    render(<App />);
    const card = await screen.findByTestId('loyalty-card');
    expect(within(card).getByText('Velnes Loyalty')).toBeDefined();
    expect(within(card).getByText('1,450 points')).toBeDefined();
    within(card).getByRole('button', { name: 'View points' }).click();
    const hero = await screen.findByTestId('loyalty-balance');
    expect(within(hero).getByText('1,450')).toBeDefined();
    expect(window.location.pathname).toBe('/account/loyalty');
  });

  it('the section reads the ledger with human labels, and explains the rules from the door', async () => {
    localStorage.setItem('velnes.client.token', 'tok');
    window.history.replaceState({}, '', '/account/loyalty');
    render(<App />);
    await screen.findByTestId('loyalty-balance');
    expect(screen.getByText('Review submitted')).toBeDefined();
    expect(screen.getByText('+50', { selector: '.loy-delta' })).toBeDefined();
    expect(screen.getByText('Appointment completed')).toBeDefined();
    expect(screen.getByText('+190', { selector: '.loy-delta' })).toBeDefined();
    expect(screen.getByText(/2 services · 2 products/)).toBeDefined();
    expect(screen.getByText('Welcome to Velnes')).toBeDefined();
    expect(screen.getByText('+100', { selector: '.loy-delta' })).toBeDefined();
    // No enum leaks through.
    expect(screen.queryByText(/registration_bonus|appointment_completed/)).toBeNull();
    // The rules, as words, from the numbers the door sent.
    expect(screen.getByText('How to earn points')).toBeDefined();
    expect(screen.getByText('+100 for your first service, +30 for each additional service')).toBeDefined();
    expect(screen.getByText('+20 per product')).toBeDefined();
    expect(screen.getByText('Choose beyond Standard — another length, an option').nextSibling?.textContent).toBe('+20');
    expect(screen.getByText('Leave a verified review').nextSibling?.textContent).toBe('+50');
  });
});
