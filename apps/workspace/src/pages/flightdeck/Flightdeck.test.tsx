import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, queryClient } from '../../App.js';
import { setAccessToken } from '@velnes/client';

const LOC = '20000000-0000-4000-8000-000000000001';
const EMP = '40000000-0000-4000-8000-000000000001';
const PROD = '70000000-0000-4000-8000-000000000006';

const me = {
  id: EMP,
  name: 'Maria Petrovska',
  access: 'owner',
  roleId: '30000000-0000-4000-8000-000000000001',
  locationIds: [LOC],
  email: 'maria@velnes.mk',
  tenantId: '10000000-0000-4000-8000-000000000001',
  lang: 'en',
  perms: {},
};

const payload = {
  greetingName: 'Maria',
  onboarding: {
    show: false,
    doneCount: 5,
    totalCount: 5,
    locationCount: 1,
    steps: [
      { key: 'services', done: true, count: 12, actionTarget: 'catalog' },
      { key: 'products', done: true, count: 6, actionTarget: 'catalog' },
      { key: 'team', done: true, count: 4, actionTarget: 'settings' },
      { key: 'hours', done: true, count: 1, actionTarget: 'settings' },
      { key: 'suppliers', done: true, count: 1, actionTarget: 'suppliers' },
    ],
  },
  legalPending: { taxId: false, vat: false },
  pulse: {
    capacityPct: 62, bookedToday: 5, totalSlots: 8, revenueToday: 41800,
    revenueTarget: 40000, newCustomers: 14, newCustomersDeltaPct: 12,
    avgSpend: 2140, avgSpendDeltaPct: 8,
  },
  memberRecs: { count: 2, value: 3400 },
  hero: {
    kind: 'capacity', when: 'tomorrow', date: '2026-09-06', locationId: LOC,
    openSlots: 4, fromTime: '10:00', toTime: '15:00', potential: 9400, memberCount: 6,
  },
  opportunities: [
    {
      key: 'quiet-regulars', icon: 'users', title: 'Bring back quiet regulars',
      detail: '19 regulars have not booked in over 60 days.', value: 9400,
      actionLabel: 'See who they are', actionTarget: 'customers',
    },
  ],
  kumo: { text: 'Tuesday mornings are historically your quietest hours.', actionTarget: 'marketing', ai: false },
  snapshot: { bookedToday: 5, totalSlots: 8, onlineToday: 2, noShows: 1, noShowPct: 2, revenue: 41800, productSales: 6300 },
  staff: [{ employeeId: EMP, name: 'Maria Petrovska', value: 5200 }],
  inventory: [{ id: PROD, name: 'Posture support brace', stock: 0, soldOut: true }],
  provider: 'rules',
};

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (path.endsWith('/auth/me')) return ok(me);
      if (path.includes('/flightdeck')) return ok(payload);
      if (path.includes('/timings/suggestions')) return ok({ suggestions: [] });
      if (path.includes('/requests/pending')) return ok(pendingRequests);
      if (path.includes('/locations'))
        return ok({
          locations: [
            {
              id: LOC, name: 'Centar', city: 'Skopje', address: 'x', tz: 'Europe/Skopje',
              phone: null, rooms: 3, invPrefix: 'CEN-', online: true, cancelHours: 24,
              opened: null, lifecycle: 'ACTIVE', hours: null,
            },
          ],
        });
      return new Response('{}', { status: 404 });
    }),
  );
}
/** What waits for the salon (2026-10-01): two bookings, one reschedule. */
const pendingRequests = {
  bookings: [
    { id: 'aaaaaaaa-0000-4000-8000-000000000001', locationId: LOC, locationName: 'Centar', customerName: 'Slobodan Krdzev', serviceName: 'Mans Haircut', employeeName: 'Maria Petrovska', date: '2026-10-01', time: '17:30', end: '18:00', price: 500, source: 'client', requestedAt: '2026-10-01T10:00:00.000Z', productUnits: 0 },
    { id: 'aaaaaaaa-0000-4000-8000-000000000002', locationId: LOC, locationName: 'Centar', customerName: 'Ana D', serviceName: 'Beard trim', employeeName: null, date: '2026-10-02', time: '09:00', end: '09:20', price: 300, source: 'client', requestedAt: '2026-10-01T11:00:00.000Z', productUnits: 2 },
  ],
  reschedules: [
    { id: 'bbbbbbbb-0000-4000-8000-000000000001', appointmentId: 'aaaaaaaa-0000-4000-8000-000000000003', status: 'pending', originalDate: '2026-10-01', originalTime: '13:30', originalEnd: '14:00', requestedDate: '2026-10-01', requestedTime: '17:30', requestedEnd: '18:00', requestedAt: '2026-09-30T10:00:00.000Z', resolvedAt: null, resolvedByName: null, declineReason: null, customerDecision: null, decidedAt: null, locationId: LOC, locationName: 'Centar', customerName: 'Slobodan Krdzev', serviceName: 'Фарбање Мажи', employeeName: 'Maria Petrovska' },
  ],
};

async function openHome() {
  window.history.pushState({}, '', '/');
  localStorage.setItem('velnes.refresh', 'rt');
  render(<App />);
  await waitFor(() =>
    expect(screen.getByText(/Good (morning|afternoon|evening), Maria/)).toBeDefined(),
  );
}

describe('flightdeck', () => {
  beforeEach(() => {
    localStorage.clear();
    queryClient.clear();
    setAccessToken(null);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the pulse, the priority hero, opportunities and the fold', async () => {
    mockApi();
    await openHome();
    // Pulse — the requests waiting take the average spend's place, and
    // lead to the Requests screen.
    expect(screen.getByText('62%')).toBeDefined();
    expect(screen.getByText('Capacity today')).toBeDefined();
    expect(screen.queryByText('Average spend')).toBeNull();
    const rq = await screen.findByTestId('fd-requests');
    await waitFor(() => expect(rq.textContent).toContain('3'));
    expect(rq.textContent).toContain('Requests waiting');
    expect(rq.textContent).toContain('2 booking · 1 reschedule');
    // Member-rec hero + priority hero
    expect(screen.getByText('2 member opportunities are waiting')).toBeDefined();
    expect(screen.getByText("Fill tomorrow's remaining capacity")).toBeDefined();
    // Opportunity
    expect(screen.getByText('Bring back quiet regulars')).toBeDefined();
    expect(screen.getByRole('button', { name: 'See who they are' })).toBeDefined();
    // Side: stock decision
    expect(screen.getByText('Stock that needs a decision')).toBeDefined();
    expect(screen.getByText(/Sold out/)).toBeDefined();
    // Below the fold
    expect(screen.getByText('Today at a glance')).toBeDefined();
    expect(screen.getByText('Retail and upsell per person')).toBeDefined();
    expect(screen.getByText('Insight from Kumo')).toBeDefined();
    rq.click();
    await waitFor(() => expect(window.location.pathname).toBe('/requests'));
  });

  it('shows the quiet hero when nothing is on fire', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const path = String(url);
        const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
        if (path.endsWith('/auth/me')) return ok(me);
        if (path.includes('/flightdeck'))
          return ok({ ...payload, hero: { kind: 'quiet' }, memberRecs: { count: 0, value: 0 }, opportunities: [], kumo: null });
        if (path.includes('/timings/suggestions')) return ok({ suggestions: [] });
        if (path.includes('/locations'))
          return ok({ locations: [{ id: LOC, name: 'Centar', city: 'Skopje', address: 'x', tz: 'Europe/Skopje', phone: null, rooms: 3, invPrefix: 'CEN-', online: true, cancelHours: 24, opened: null, lifecycle: 'ACTIVE', hours: null }] });
        return new Response('{}', { status: 404 });
      }),
    );
    await openHome();
    expect(screen.getByText('Nothing is on fire')).toBeDefined();
  });
});
