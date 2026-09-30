import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.js';
import { setAccessToken } from '@velnes/client';

/**
 * Booking changes in the workspace (Alex, 2026-09-30): the calendar's
 * requests inbox, the drawer's Approve / Decline on a customer's
 * reschedule request, and cancelled visits kept on the grid, muted,
 * behind a filter that can hide them.
 */
const LOC = '20000000-0000-4000-8000-000000000001';
const SVC = '60000000-0000-4000-8000-000000000003';
const EMP = '40000000-0000-4000-8000-000000000001';
const A1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const A2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const REQ = 'bbbbbbbb-0000-4000-8000-000000000001';
const today = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();
const me = {
  id: EMP, name: 'Maria Petrovska', access: 'owner', roleId: '30000000-0000-4000-8000-000000000001', locationIds: [LOC],
  email: 'maria@velnes.mk', tenantId: '10000000-0000-4000-8000-000000000001', lang: 'en',
  perms: { 'appointments.view_own': 'own', 'appointments.view_location': 'location', 'appointments.edit': 'location', 'appointments.cancel': 'location' },
};
const base = {
  locationId: LOC, date: today, kind: 'appointment', serviceId: SVC, serviceName: 'Follow-up session', serviceCategory: 'Manual therapy',
  variantId: null, variantLabel: null, modifierNames: [], employeeId: EMP, anyEmp: false, customerId: null, price: 1200, durationMin: 30,
  prepMin: 0, resetMin: 10, basis: 'catalog', source: 'client', paid: false,
};
const live = { ...base, id: A1, start: '10:00', end: '10:30', status: 'confirmed', title: 'Katerina Stojanovska' };
const gone = { ...base, id: A2, start: '12:00', end: '12:30', status: 'cancelled', title: 'Ivana Nikolikj' };
const request = {
  id: REQ, appointmentId: A1, status: 'pending', originalDate: today, originalTime: '10:00', originalEnd: '10:30',
  requestedDate: '2030-01-10', requestedTime: '12:00', requestedEnd: '12:30', requestedAt: '2026-09-30T10:00:00.000Z',
  resolvedAt: null, resolvedByName: null, declineReason: null, customerDecision: null, decidedAt: null,
};
const calls: { method: string; path: string }[] = [];

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url).replace(/^.*\/api\/v1/, '');
      const method = init?.method ?? 'GET';
      calls.push({ method, path });
      const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (path.endsWith('/auth/me')) return ok(me);
      if (path.includes('/schedule?')) return ok({ open: true, periods: [['09:00', '19:00']], source: 'regular', reason: null });
      if (path.startsWith('/locations'))
        return ok({ locations: [{ id: LOC, name: 'Centar', city: 'Skopje', address: 'x', tz: 'Europe/Skopje', phone: null, rooms: 3, invPrefix: 'CEN-', online: true, cancelHours: 24, opened: null, lifecycle: 'ACTIVE', hours: null }] });
      if (path.startsWith('/employees'))
        return ok({ employees: [{ id: EMP, name: 'Maria Petrovska', roleTitle: 'Physio', email: 'maria@velnes.mk', phone: null, access: 'owner', roleId: null, bookable: true, status: 'active', color: 'olive', locationIds: [LOC], skillServiceIds: [SVC], hours: null, twofaEnabled: true, lastActive: null }] });
      if (path.startsWith('/appointments?')) return ok({ appointments: [live, gone] });
      if (path === `/appointments/${A1}/changes`)
        return ok({ changeRequest: request, cancellation: null, cancelHours: 24, payment: { status: 'unpaid', method: null, amount: null }, refund: null, history: [
          { at: '2026-09-29T10:00:00.000Z', what: 'Created', byName: 'Katerina Stojanovska', source: 'client', meta: {} },
          { at: '2026-09-30T10:00:00.000Z', what: 'Reschedule requested', byName: 'Katerina Stojanovska', source: 'client', meta: { from: `${today} 10:00`, to: '2030-01-10 12:00' } },
        ] });
      if (path === `/appointments/${A2}/changes`)
        return ok({ changeRequest: null, cancellation: { at: '2026-09-30T09:00:00.000Z', by: 'customer', reason: null }, cancelHours: 24, payment: { status: 'paid', method: 'Online card', amount: 1200 }, refund: { status: 'refunded', amount: 1200, requestedAt: '2026-09-30T09:00:00.000Z', completedAt: '2026-09-30T09:00:05.000Z' }, history: [] });
      if (path === `/appointments/${A1}`) return ok(live);
      if (path.startsWith('/change-requests?')) return ok({ requests: [{ ...request, locationId: LOC, locationName: 'Centar', customerName: 'Katerina Stojanovska', serviceName: 'Follow-up session', employeeName: 'Maria Petrovska' }] });
      if (path === `/change-requests/${REQ}/approve` && method === 'POST') return ok({ ...request, status: 'approved', resolvedByName: 'Maria Petrovska' });
      if (path.startsWith('/customers')) return ok({ customers: [] });
      if (path.startsWith('/notices')) return ok({ notices: [] });
      return new Response('{}', { status: 404 });
    }),
  );
}

describe('booking changes on the calendar', () => {
  beforeEach(() => {
    calls.length = 0;
    localStorage.clear();
    setAccessToken(null);
    localStorage.setItem('velnes.refresh', 'rt');
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('the inbox counts the pending requests and opens the visit; the drawer approves through the door', async () => {
    mockApi();
    window.history.pushState({}, '', '/calendar');
    render(<App />);
    await waitFor(() => expect(screen.getByTitle(/Katerina/)).toBeDefined());
    const pill = screen.getByRole('button', { name: /Requests/ });
    expect(pill.textContent).toContain('1');
    await userEvent.click(pill);
    await userEvent.click(await screen.findByRole('menuitem', { name: /Katerina/ }));
    const card = await screen.findByTestId('change-request');
    expect(within(card).getByText('Reschedule request')).toBeDefined();
    expect(within(card).getByText(/10\.01 · 12:00/)).toBeDefined();
    expect(within(card).getByText(/stays booked until you approve/)).toBeDefined();
    // The timeline staff coordinate by.
    expect(within(screen.getByTestId('history')).getByText('Customer requested reschedule')).toBeDefined();
    await userEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === `/change-requests/${REQ}/approve`)).toBe(true));
  });

  it('cancelled visits stay on the grid, muted, until the filter hides them; their drawer says who cancelled and the refund state', async () => {
    mockApi();
    window.history.pushState({}, '', '/calendar');
    render(<App />);
    await waitFor(() => expect(screen.getByTitle(/Ivana/)).toBeDefined());
    const ev = screen.getByTitle(/Ivana/);
    expect(ev.className).toContain('ev-cancelled');
    await userEvent.click(ev);
    expect(await screen.findByText('Cancelled by the customer', { exact: false })).toBeDefined();
    expect(screen.getByText('Refunded')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await userEvent.click(screen.getByLabelText('Show cancelled'));
    await waitFor(() => expect(screen.queryByTitle(/Ivana/)).toBeNull());
    expect(screen.getByTitle(/Katerina/)).toBeDefined();
  });

  it('the navigation search knows the way to the requests', async () => {
    mockApi();
    window.history.pushState({}, '', '/calendar?requests=1');
    render(<App />);
    await waitFor(() => expect(screen.getByTitle(/Katerina/)).toBeDefined());
    // `?requests=1` opens the inbox on arrival.
    expect(await screen.findByRole('menu', { name: 'Requests' })).toBeDefined();
  });
});
