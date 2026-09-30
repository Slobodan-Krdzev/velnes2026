import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '@velnes/client';
import { App } from '../../App.js';

/**
 * The workspace's Reviews page (Alex, 2026-09-30): the salon's score
 * and parts, each professional's own, the list with the names the
 * salon knows — read-only, and only for those who may see reviews.
 */
const LOC = '20000000-0000-4000-8000-000000000001';
const ANA = '40000000-0000-4000-8000-000000000002';
const owner = {
  id: '40000000-0000-4000-8000-000000000001', name: 'Maria Petrovska', access: 'owner', roleId: '30000000-0000-4000-8000-000000000001',
  locationIds: [LOC], email: 'maria@velnes.mk', tenantId: '10000000-0000-4000-8000-000000000001', lang: 'en',
  perms: { 'reviews.view': 'business', 'appointments.view_own': 'own', 'users.manage': 'business' },
};
const staff = { ...owner, id: ANA, name: 'Ana Dimitrova', access: 'staff', perms: { 'appointments.view_own': 'own' } };
const summary = {
  avg: 4.5, count: 2, service: 4.5, timing: 4, cleanliness: 5, distribution: [0, 0, 0, 1, 1],
  employees: [{ id: ANA, name: 'Ana Dimitrova', avg: 4, count: 2 }],
  locations: [{ id: LOC, name: 'Centar', avg: 4.5, count: 2 }],
};
const review = (id: string, overall: number, body: string | null) => ({
  id, appointmentId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', overall, service: 5, timing: 4, cleanliness: 5, professional: 5, body,
  bodyStatus: 'published', ratingStatus: 'valid', customerName: 'Katerina Ilievska', serviceName: 'Sports massage', employeeId: ANA, employeeName: 'Ana Dimitrova',
  locationId: LOC, locationName: 'Centar', appointmentDate: '2026-09-20', at: '2026-09-21T10:00:00.000Z',
});
const seen: string[] = [];

function mockApi(me: object) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      seen.push(`${init?.method ?? 'GET'} ${path.replace(/^.*\/api\/v1/, '')}`);
      const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (path.endsWith('/auth/me')) return ok(me);
      if (path.endsWith('/reviews/summary')) return ok(summary);
      if (path.includes('/reviews?')) return ok({ reviews: [review('11111111-1111-4111-8111-111111111111', 4.7, 'Great massage and very clean salon.'), review('22222222-2222-4222-8222-222222222222', 4.3, null)], total: 2, offset: 0, limit: 20 });
      if (path.endsWith('/locations')) return ok({ locations: [{ id: LOC, name: 'Centar', city: 'Skopje', address: 'x', tz: 'Europe/Skopje', phone: null, rooms: 2, invPrefix: null, online: true, cancelHours: 24, opened: null, lifecycle: 'ACTIVE', hours: null }] });
      return new Response('{}', { status: 404 });
    }),
  );
}

describe('the reviews page', () => {
  beforeEach(() => {
    seen.length = 0;
    localStorage.clear();
    setAccessToken(null);
    localStorage.setItem('velnes.refresh', 'rt');
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the score, the parts, the professionals and the reviews, and offers nothing to change', async () => {
    mockApi(owner);
    window.history.pushState({}, '', '/reviews');
    render(<App />);
    await screen.findByText('2 verified reviews');
    expect(screen.getAllByText('4.5').length).toBeGreaterThan(0);
    expect(screen.getByText('Great massage and very clean salon.', { exact: false })).toBeTruthy();
    expect(screen.getAllByText('Katerina Ilievska').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ana Dimitrova').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /delete|hide|remove/i })).toBeNull();
    // The sidebar has the door, and the search knows it.
    expect(screen.getByLabelText('Reviews')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Search Velnes' }), 'ratings');
    await waitFor(() => expect(within(screen.getByRole('listbox', { name: 'Destinations' })).getAllByRole('option')[0]!.textContent).toContain('Reviews'));
  });

  it('is not offered to staff without the permission', async () => {
    mockApi(staff);
    window.history.pushState({}, '', '/calendar');
    render(<App />);
    await screen.findByLabelText('Calendar');
    expect(screen.queryByLabelText('Reviews')).toBeNull();
    expect(seen.some((s) => s.includes('/reviews'))).toBe(false);
  });
});
