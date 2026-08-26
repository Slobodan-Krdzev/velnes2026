import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.js';
import { setAccessToken } from '@velnes/client';

const LOC = '20000000-0000-4000-8000-000000000001';
const S3 = '60000000-0000-4000-8000-000000000003';
const REC = 'd2000000-0000-4000-8000-000000000001';
const CAP = `${LOC}|2026-08-26|40000000-0000-4000-8000-000000000001|10:00`;

const me = {
  id: '40000000-0000-4000-8000-000000000001',
  name: 'Maria Petrovska',
  access: 'owner',
  roleId: '30000000-0000-4000-8000-000000000001',
  locationIds: [LOC],
  email: 'maria@velnes.mk',
  tenantId: '10000000-0000-4000-8000-000000000001',
  lang: 'en',
  perms: { 'marketing.personal_offers': 'business', 'customers.view_assigned': 'assigned' },
};

const cap = {
  id: CAP, locationId: LOC, date: '2026-08-26',
  empId: '40000000-0000-4000-8000-000000000001', empName: 'Maria Petrovska',
  start: '10:00', blockStart: '10:00', dur: 45, prepMin: 0, resetMin: 10,
  operationalMin: 55, serviceId: S3, serviceName: 'Follow-up session',
  variantId: null, price: 1200, gap: 60,
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
      if (path.includes('/premium/recommendations') && method === 'POST')
        return ok({ offerId: 'e5000000-0000-4000-8000-000000000001' });
      if (path.includes('/premium/recommendations'))
        return ok({
          recommendations: [
            {
              id: REC, locationId: LOC, date: '2026-08-26', start: '10:00', end: '10:45',
              serviceId: S3, serviceName: 'Follow-up session', variantId: null,
              employeeId: me.id, employeeName: 'Maria Petrovska',
              normalPrice: 1200, recPct: 35, recPrice: 780,
              candidates: [
                { cid: '80000000-0000-4000-8000-000000000004', name: 'Marija Angelovska', score: 45, why: ['booked Follow-up session 5×'] },
              ],
              status: 'pending', offerId: null,
            },
          ],
        });
      if (path.includes('/premium/offers')) return ok({ offers: [] });
      if (path.includes('/offers') && method === 'POST')
        return ok({ id: 'f2000000-0000-4000-8000-000000000001' });
      if (path.includes('/offers')) return ok({ offers: [] });
      if (path.includes('/personal-offers')) return ok({ offers: [] });
      if (path.includes('/capacity')) return ok({ slots: [cap], value: 1200 });
      if (path.includes('/discount-codes')) return ok({ codes: [] });
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

async function openMarketing() {
  window.history.pushState({}, '', '/marketing');
  localStorage.setItem('velnes.refresh', 'rt');
  render(<App />);
  await screen.findByText('No offers running');
}

describe('marketing', () => {
  beforeEach(() => {
    localStorage.clear();
    setAccessToken(null);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('offers the empty capacity and creates a two-phase offer through the drawer', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openMarketing();
    expect(await screen.findByText(/still empty today/)).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: /Fill empty slots/ }));
    await screen.findByText('Velnes found these gaps. Untick anything you would rather keep free.');
    expect(screen.getByDisplayValue('Velnes Premium members')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Create offer' }));
    await waitFor(() => {
      const sent = calls.find((c) => c.path.endsWith('/offers') && c.method === 'POST');
      expect(sent).toBeDefined();
      const b = sent!.body as { pickedSlotIds: string[]; vipPct: number; publicOn: boolean };
      expect(b.pickedSlotIds).toEqual([CAP]);
      expect(b.vipPct).toBe(40);
      expect(b.publicOn).toBe(true);
    });
  });

  it('shows the read-only Premium rules and approves a recommendation with its transparent why', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openMarketing();
    await userEvent.click(screen.getByRole('button', { name: 'Velnes Premium' }));
    await screen.findByText('Program rules — set by Velnes, read-only');
    expect(screen.getByText('50%')).toBeDefined(); // the HQ ceiling
    expect(screen.getByText(/booked Follow-up session 5×/)).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path.includes(`/premium/recommendations/${REC}/approve`))).toBe(true),
    );
    expect(await screen.findByText('Approved — the member window is open')).toBeDefined();
  });
});
