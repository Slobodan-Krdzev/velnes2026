import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.js';
import { setAccessToken } from '@velnes/client';

const C1 = '80000000-0000-4000-8000-000000000001';
const LOC = '20000000-0000-4000-8000-000000000001';
const S3 = '60000000-0000-4000-8000-000000000003';

const me = {
  id: '40000000-0000-4000-8000-000000000001',
  name: 'Maria Petrovska',
  access: 'owner',
  roleId: '30000000-0000-4000-8000-000000000001',
  locationIds: [LOC],
  email: 'maria@velnes.mk',
  tenantId: '10000000-0000-4000-8000-000000000001',
  lang: 'en',
  perms: {
    'customers.view_business': 'business',
    'customers.edit': 'business',
    'marketing.personal_offers': 'business',
    'billing.create': 'business',
  },
};

let billingRows: Record<string, unknown>[] = [];
const billingIdentity = (body: Record<string, unknown>) => ({
  id: 'bb000000-0000-4000-8000-000000000001', customerId: C1, kind: 'person', name: '', address: '', city: '', zip: '', country: 'North Macedonia',
  edb: '', vatRegNo: '', email: '', phone: '', consentElectronicAt: null, consentHistory: [], createdAt: '2026-10-06T10:00:00.000Z', updatedAt: '2026-10-06T10:00:00.000Z',
  ...body,
});

const profile = {
  id: C1, name: 'Katerina Stojanovska', email: 'katerina.s@example.com',
  phone: '+389 70 221 884', group: 'Regulars', since: '2022-03-14',
  visits: 38, spend: 98500, points: 320, prepaid: 2700, blacklisted: false,
  noShows: 0, note: 'Prefers Maria.', birthday: null, tags: [],
  premium: { status: 'active', since: '2026-04-01', renews: '2026-12-01' },
  isPremium: true,
};

const insights = {
  seeded: true,
  totals: { visits: 10, spend: 18000, avgSpend: 1800, firstDate: '2026-01-01', lastDate: '2026-07-26' },
  firstVisit: { date: '2026-01-01', rows: [{ serviceId: S3, service: 'Physiotherapy session', employeeId: null, employeeName: 'Maria Petrovska', start: '10:00', end: '10:45', amount: 1800 }], amount: 1800 },
  lastVisit: { date: '2026-07-26', rows: [{ serviceId: S3, service: 'Physiotherapy session', employeeId: null, employeeName: 'Maria Petrovska', start: '10:00', end: '10:45', amount: 1800 }], amount: 1800 },
  services: [{ serviceId: S3, name: 'Physiotherapy session', count: 10, spend: 18000, pct: 100 }],
  products: [],
  times: [{ hour: 10, count: 10 }],
  weekdays: [{ wd: 2, count: 10 }],
  employees: [{ empId: me.id, name: 'Maria Petrovska', count: 10, pct: 100 }],
  cadence: { medianGapDays: 14, sampleSize: 9, trend: null, steady: true },
  overdueDays: 16,
  lapsedServices: [],
  favoriteService: { serviceId: S3, name: 'Physiotherapy session', count: 10, spend: 18000, pct: 100 },
  favoriteProduct: null,
  retention: 'at_risk',
};

function mockApi(calls: { method: string; path: string; body?: unknown }[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      const method = init?.method ?? 'GET';
      if (method !== 'GET')
        calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (path.endsWith('/auth/me')) return ok(me);
      if (path.includes('/billing/customers') && path.endsWith('/consent') && method === 'POST') {
        const b = JSON.parse(String(init?.body)) as { granted: boolean; note: string };
        billingRows = billingRows.map((r) => ({ ...r, consentElectronicAt: b.granted ? '2026-10-06T12:00:00.000Z' : null, consentHistory: [{ id: 'ce000000-0000-4000-8000-000000000001', granted: b.granted, at: '2026-10-06T12:00:00.000Z', actorName: 'Maria Petrovska', note: b.note }] }));
        return ok(billingRows[0]);
      }
      if (path.includes('/billing/customers') && method === 'POST') {
        billingRows = [billingIdentity(JSON.parse(String(init?.body)) as Record<string, unknown>)];
        return ok(billingRows[0]);
      }
      if (path.includes('/billing/customers')) return ok({ customers: billingRows });
      if (path.includes('/customers?'))
        return ok({
          customers: [
            {
              id: C1, name: 'Katerina Stojanovska', email: 'katerina.s@example.com',
              phone: '+389 70 221 884', group: 'Regulars', visits: 38, spend: 98500,
              points: 320, blacklisted: false, noShows: 0,
            },
          ],
        });
      if (path.includes(`/customers/${C1}/insights`)) return ok(insights);
      if (path.includes(`/customers/${C1}/appointments`))
        return ok({
          upcoming: [
            { id: 'a0000000-0000-4000-8000-000000000001', date: '2030-01-10', start: '10:00', end: '10:30', serviceName: 'Follow-up session', locationName: 'Centar', employeeName: 'Maria Petrovska', status: 'booked', source: 'client', price: 1200, cancelledBy: null },
          ],
          history: [
            { id: 'a0000000-0000-4000-8000-000000000002', date: '2026-09-22', start: '10:00', end: '10:45', serviceName: 'Sports massage', locationName: 'Centar', employeeName: 'Elena Ristova', status: 'cancelled', source: 'client', price: 1900, cancelledBy: 'customer' },
            { id: 'a0000000-0000-4000-8000-000000000003', date: '2026-09-12', start: '09:00', end: '09:30', serviceName: 'Follow-up session', locationName: 'Centar', employeeName: 'Maria Petrovska', status: 'confirmed', source: 'staff', price: 1200, cancelledBy: null },
            { id: 'a0000000-0000-4000-8000-000000000004', date: '2026-09-05', start: '09:00', end: '09:30', serviceName: 'Follow-up session', locationName: 'Centar', employeeName: 'Maria Petrovska', status: 'cancelled', source: 'staff', price: 1200, cancelledBy: 'salon' },
          ],
          stats: { total: 4, completed: 1, upcoming: 1, cancelledByCustomer: 1, cancelledBySalon: 1, noShows: 0 },
        });
      if (path.includes(`/customers/${C1}/offers`) && method === 'POST')
        return ok({
          id: 'b1000000-0000-4000-8000-000000000001', customerId: C1, serviceId: S3,
          serviceName: 'Follow-up session', variantId: null, locationId: LOC,
          specialPrice: 900, normalPrice: 1200, validUntil: '2026-09-10',
          intent: 'win_back', status: 'live', createdAt: '2026-08-26T10:00:00.000Z',
        });
      if (path.includes(`/customers/${C1}/offers`)) return ok({ offers: [] });
      if (path.includes(`/customers/${C1}`)) return ok(profile);
      if (path.includes('/locations') && path.includes('/catalog'))
        return ok({
          services: [
            { id: S3, name: 'Follow-up session', config: { active: true, price: 1200 } },
          ],
          products: [],
        });
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

async function openList() {
  window.history.pushState({}, '', '/customers');
  localStorage.setItem('velnes.refresh', 'rt');
  render(<App />);
  await screen.findByText('Katerina Stojanovska');
}

describe('customers', () => {
  beforeEach(() => {
    localStorage.clear();
    setAccessToken(null);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists customers with spend for the business scope and toggles booking through PATCH', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openList();
    expect(screen.getByText(/98[.,\u00A0 ]?500/)).toBeDefined();
    await userEvent.click(screen.getByRole('switch'));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === 'PATCH' && (c.body as { blacklisted?: boolean }).blacklisted === true,
        ),
      ).toBe(true),
    );
  });

  it('shows the profile: KPIs, retention, Premium tab read-only', async () => {
    mockApi([]);
    await openList();
    await userEvent.click(screen.getByRole('button', { name: 'View' }));
    await screen.findByText('Lifetime spend');
    expect(screen.getAllByText('At-risk customer').length).toBeGreaterThan(0);
    expect(screen.getByText('Velnes Premium', { selector: '.badge' })).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Velnes Premium' }));
    expect(await screen.findByText('Member since')).toBeDefined();
    expect(screen.getByText('×1.5')).toBeDefined();
  });

  it('the appointments tab counts cancellations by actor and names who cancelled each visit', async () => {
    mockApi([]);
    await openList();
    await userEvent.click(screen.getByRole('button', { name: 'View' }));
    await screen.findByText('Lifetime spend');
    const stats = await screen.findByTestId('appt-stats');
    expect(within(stats).getByText('Completed').nextSibling?.textContent).toBe('1');
    expect(within(stats).getByText('Cancelled by customer').nextSibling?.textContent).toBe('1');
    expect(within(stats).getByText('1 by the salon')).toBeDefined();
    expect(within(stats).getByText('No-shows').nextSibling?.textContent).toBe('0');
    expect(screen.getAllByText('Cancelled by customer', { selector: '.badge' }).length).toBe(1);
    expect(screen.getAllByText('Cancelled by salon', { selector: '.badge' }).length).toBe(1);
  });

  it('creates a personal offer through the Actions menu', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openList();
    await userEvent.click(screen.getByRole('button', { name: 'View' }));
    await screen.findByText('Lifetime spend');
    await userEvent.click(screen.getByRole('button', { name: /Actions/ }));
    await userEvent.click(await screen.findByText('Create personal offer'));
    await screen.findByText('Special price');
    expect(screen.getByText(/normally/)).toBeDefined();
    await userEvent.type(screen.getByRole('spinbutton'), '900');
    await userEvent.click(screen.getByRole('button', { name: 'Create offer' }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.path.includes(`/customers/${C1}/offers`) &&
            (c.body as { specialPrice?: number }).specialPrice === 900,
        ),
      ).toBe(true),
    );
  });

  it('Billing details: a company identity for the customer is created through its own door and consent is an explicit, recorded act', async () => {
    billingRows = [];
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openList();
    await userEvent.click(screen.getByRole('button', { name: 'View' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Billing details' }));
    await screen.findByText('No billing details yet.');
    await userEvent.click(screen.getByRole('button', { name: 'Add billing details' }));
    await userEvent.click(screen.getByRole('button', { name: 'A company' }));
    await userEvent.type(screen.getByLabelText(/Legal company name/), 'Nova Health DOO');
    await userEvent.type(screen.getByLabelText(/Street and number/), 'Bul. Ilinden 5');
    await userEvent.type(screen.getByLabelText(/^City/), 'Skopje');
    await userEvent.type(screen.getByLabelText(/Tax number/), '4030026512399');
    await userEvent.click(screen.getByRole('button', { name: 'Save billing details' }));
    await waitFor(() => {
      const call = calls.find((c) => c.method === 'POST' && c.path.endsWith('/billing/customers'));
      expect(call?.body).toMatchObject({ customerId: C1, kind: 'company', name: 'Nova Health DOO', edb: '4030026512399' });
    });
    // The customer profile itself was never patched by this.
    expect(calls.some((c) => c.method === 'PATCH' && c.path.endsWith(`/customers/${C1}`))).toBe(false);
    await screen.findByTestId('billing-details');
    expect(screen.getByTestId('consent-state').textContent).toBe('No consent on record');
    await userEvent.type(screen.getByPlaceholderText('Note (how it was given)'), 'Signed form');
    await userEvent.click(screen.getByRole('button', { name: 'Record consent' }));
    await waitFor(() => expect(screen.getByTestId('consent-state').textContent).toContain('Consent given on'));
    const consent = calls.find((c) => c.path.endsWith('/consent'));
    expect(consent?.body).toEqual({ granted: true, note: 'Signed form' });
    expect(screen.getByText(/given · Maria Petrovska · Signed form/)).toBeDefined();
  });
});
