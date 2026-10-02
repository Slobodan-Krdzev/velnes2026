import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, queryClient } from '../../App.js';
import { setAccessToken } from '@velnes/client';

/**
 * The Requests screen (Alex, 2026-10-01): booking requests and
 * reschedule requests, answered through the doors the drawer uses.
 */
const LOC = '20000000-0000-4000-8000-000000000001';
const A1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const A3 = 'aaaaaaaa-0000-4000-8000-000000000003';
const R1 = 'bbbbbbbb-0000-4000-8000-000000000001';
const me = {
  id: '40000000-0000-4000-8000-000000000001', name: 'Maria Petrovska', access: 'owner', roleId: '30000000-0000-4000-8000-000000000001', locationIds: [LOC],
  email: 'maria@velnes.mk', tenantId: '10000000-0000-4000-8000-000000000001', lang: 'en',
  perms: { 'appointments.view_own': 'own', 'appointments.view_location': 'location', 'appointments.edit': 'location' },
};
const pending = {
  bookings: [
    { id: A1, locationId: LOC, locationName: 'Centar', customerName: 'Slobodan Krdzev', serviceName: 'Mans Haircut', employeeName: 'Maria Petrovska', date: '2026-10-01', time: '17:30', end: '18:00', price: 500, source: 'client', requestedAt: '2026-10-01T10:00:00.000Z', productUnits: 2 },
  ],
  reschedules: [
    { id: R1, appointmentId: A3, status: 'pending', originalDate: '2026-10-01', originalTime: '13:30', originalEnd: '14:00', requestedDate: '2026-10-02', requestedTime: '14:00', requestedEnd: '14:30', requestedAt: '2026-09-30T10:00:00.000Z', resolvedAt: null, resolvedByName: null, declineReason: null, customerDecision: null, decidedAt: null, locationId: LOC, locationName: 'Centar', customerName: 'Ivana Nikolikj', serviceName: 'Фарбање Мажи', employeeName: 'Maria Petrovska' },
  ],
};
const calls: { method: string; path: string; body: string }[] = [];

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url).replace(/^.*\/api\/v1/, '');
      const method = init?.method ?? 'GET';
      calls.push({ method, path, body: String(init?.body ?? '') });
      const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (path.endsWith('/auth/me')) return ok(me);
      if (path.startsWith('/locations'))
        return ok({ locations: [{ id: LOC, name: 'Centar', city: 'Skopje', address: 'x', tz: 'Europe/Skopje', phone: null, rooms: 3, invPrefix: 'CEN-', online: true, cancelHours: 24, opened: null, lifecycle: 'ACTIVE', hours: null }] });
      if (path === '/requests/pending') return ok(pending);
      if (path === `/appointments/${A1}/decide`)
        return ok({ id: A1, locationId: LOC, date: '2026-10-01', start: '17:30', end: '18:00', kind: 'appointment', status: 'booked', title: 'Slobodan Krdzev', serviceId: null, serviceName: 'Mans Haircut', serviceCategory: null, variantId: null, variantLabel: null, modifierNames: [], employeeId: me.id, anyEmp: false, customerId: null, price: 500, durationMin: 30, prepMin: 0, resetMin: 0, basis: null, source: 'client', paid: false, products: [] });
      if (path === `/change-requests/${R1}/approve`) return ok({ ...pending.reschedules[0], status: 'approved' });
      if (path.startsWith('/notices')) return ok({ notices: [] });
      return new Response('{}', { status: 404 });
    }),
  );
}

describe('the Requests screen', () => {
  beforeEach(() => {
    calls.length = 0;
    localStorage.clear();
    queryClient.clear();
    setAccessToken(null);
    localStorage.setItem('velnes.refresh', 'rt');
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists both kinds, accepts a booking and approves a reschedule through their doors, and opens the day in the calendar', async () => {
    mockApi();
    window.history.pushState({}, '', '/requests');
    render(<App />);
    const booking = await screen.findByTestId('rq-booking');
    expect(booking.textContent).toContain('Slobodan Krdzev');
    expect(booking.textContent).toContain('Mans Haircut · 01.10 · 17:30–18:00 · Centar · Maria Petrovska');
    expect(booking.textContent).toContain('2 products');
    const resched = screen.getByTestId('rq-reschedule');
    expect(resched.textContent).toContain('Ivana Nikolikj');
    expect(resched.textContent).toContain('01.10 · 13:30–14:00 → 02.10 · 14:00–14:30');
    await userEvent.click(within(booking).getByRole('button', { name: /Accept request/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === `/appointments/${A1}/decide` && c.body.includes('"accept"'))).toBe(true));
    await userEvent.click(within(resched).getByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === `/change-requests/${R1}/approve`)).toBe(true));
    await userEvent.click(within(booking).getByRole('button', { name: 'Open in calendar' }));
    await waitFor(() => expect(window.location.pathname).toBe('/calendar'));
  });

  it('says so when nothing waits', async () => {
    mockApi();
    pending.bookings.length = 0;
    pending.reschedules.length = 0;
    window.history.pushState({}, '', '/requests');
    render(<App />);
    expect(await screen.findByText('No booking requests waiting.')).toBeDefined();
    expect(screen.getByText('No reschedule requests waiting.')).toBeDefined();
  });
});
