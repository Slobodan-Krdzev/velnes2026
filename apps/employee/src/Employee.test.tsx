import { setAccessToken } from '@velnes/client';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';

const LOC = '20000000-0000-4000-8000-000000000001';
const ANA = '40000000-0000-4000-8000-000000000002';
const today = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

const me = {
  id: ANA,
  name: 'Ana Dimitrova',
  access: 'staff',
  roleId: '30000000-0000-4000-8000-000000000004',
  locationIds: [LOC],
  email: 'ana@velnes.mk',
  tenantId: '10000000-0000-4000-8000-000000000001',
  lang: 'en',
  perms: { 'appointments.view_own': 'own', 'pos.checkout': 'location' },
};

const mineAppt = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  locationId: LOC,
  date: today,
  start: '10:00',
  end: '11:00',
  kind: 'appointment',
  status: 'confirmed',
  title: 'Katerina Stojanovska',
  serviceId: '60000000-0000-4000-8000-000000000004',
  serviceName: 'Rehab training',
  serviceCategory: 'Rehab',
  variantId: null,
  variantLabel: null,
  modifierNames: [],
  employeeId: ANA,
  anyEmp: false,
  customerId: null,
  price: 1500,
  durationMin: 60,
  prepMin: 0,
  resetMin: 10,
  basis: 'catalog',
  source: 'staff',
};
const otherAppt = { ...mineAppt, id: 'aaaaaaaa-0000-4000-8000-000000000002', employeeId: '40000000-0000-4000-8000-000000000001', title: 'Someone Else' };

function mockApi(calls: { method: string; path: string; body?: unknown }[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      const method = init?.method ?? 'GET';
      if (method !== 'GET')
        calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (path.endsWith('/auth/me')) return ok(me);
      if (path.includes('/auth/login'))
        return ok({ accessToken: 'at', refreshToken: 'rt', employee: me });
      if (path.includes('/appointments?')) return ok({ appointments: [mineAppt, otherAppt] });
      if (path.includes('/events')) return ok({ ok: true });
      if (path.endsWith('/catalog')) return ok({ services: [], products: [] });
      if (path.includes('/locations'))
        return ok({
          locations: [
            {
              id: LOC, name: 'Aerodrom', city: 'Skopje', address: 'x', tz: 'Europe/Skopje',
              phone: null, rooms: 2, invPrefix: 'AER-', online: true, cancelHours: 24,
              opened: null, lifecycle: 'ACTIVE',
            },
          ],
        });
      if (path.endsWith('/sales') && method === 'POST')
        return ok({
          invoice: {
            id: 'bbbbbbbb-0000-4000-8000-000000000001', number: 'AER-2026-0002',
            date: today, locationId: LOC, customerName: 'Katerina Stojanovska',
            employeeName: 'Ana Dimitrova', method: 'Card', status: 'Paid', total: 1500, lines: [],
          },
          checkoutId: 'cccccccc-0000-4000-8000-000000000001',
          checkoutStatus: 'PAID',
          transactions: [],
          total: 1500,
          pointsEarned: 0,
          shortages: [],
        });
      return new Response('{}', { status: 404 });
    }),
  );
}

describe('employee app', () => {
  beforeEach(() => {
    localStorage.clear();
    setAccessToken(null);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('signs in and shows only my own agenda', async () => {
    mockApi([]);
    localStorage.setItem('velnes.refresh', 'rt');
    render(<App />);
    await waitFor(() => expect(screen.getByText('Katerina Stojanovska')).toBeDefined());
    expect(screen.queryByText('Someone Else')).toBeNull(); // not mine
    expect(screen.getByText('My day')).toBeDefined();
  });

  it('start/finish treatment posts the two timing events, then checks out to the till', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    localStorage.setItem('velnes.refresh', 'rt');
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Start treatment' }));
    await waitFor(() =>
      expect(
        calls.some((c) => (c.body as { what?: string })?.what === 'Treatment started'),
      ).toBe(true),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Finish treatment' }));
    await waitFor(() =>
      expect(
        calls.some((c) => (c.body as { what?: string })?.what === 'Treatment finished'),
      ).toBe(true),
    );
    // Check out rings the appointment up on the mobile till.
    await userEvent.click(await screen.findByRole('button', { name: 'Check out' }));
    expect(await screen.findByText('Rehab training')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Take payment' }));
    await userEvent.click(screen.getByRole('button', { name: 'Card' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path.endsWith('/sales'))).toBe(true),
    );
    const sale = calls.find((c) => c.path.endsWith('/sales'))!.body as {
      lines: { kind: string }[];
      employeeId: string;
    };
    expect(sale.lines[0]!.kind).toBe('appointment');
    expect(sale.employeeId).toBe(ANA);
  });
});
