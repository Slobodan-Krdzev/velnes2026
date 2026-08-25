import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';

const SUP1 = 'd1000000-0000-4000-8000-000000000001';
const BIZ = '10000000-0000-4000-8000-000000000001';
const PO = 'd4000000-0000-4000-8000-000000000001';

const user = {
  id: 'd3000000-0000-4000-8000-000000000001',
  name: 'Vesna Todorova',
  email: 'vesna@beautypro.mk',
  role: 'sr_account',
  supplierId: SUP1,
  supplierName: 'BeautyPro MK',
};

const order = (status: string) => ({
  id: PO, ref: 'CEN-0042', supplierId: SUP1, supplierName: 'BeautyPro MK',
  locationId: '20000000-0000-4000-8000-000000000001', status,
  byName: 'Maria Petrovska', expected: '2026-08-30', track: '',
  createdAt: '2026-08-26T09:00:00.000Z',
  lines: [{ id: 'e9000000-0000-4000-8000-000000000001', supplierProductId: 'd2000000-0000-4000-8000-000000000001',
    name: 'Thera-Band resistance set, 3 levels', sku: 'TB-SET-03', qty: 12, price: 550, free: 2, recv: 0, dmg: 0 }],
  total: 6600,
});

function mockApi(calls: { method: string; path: string; body?: unknown }[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      const method = init?.method ?? 'GET';
      if (method !== 'GET')
        calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (path.includes('/portal/auth/login')) return ok({ accessToken: 'portal-token', user });
      if (path.includes('/portal/dashboard'))
        return ok({ salons: 3, openOrders: 2, products: 7, pendingConnections: 1 });
      if (path.includes('/portal/salons'))
        return ok({
          salons: [
            {
              businessId: BIZ, name: 'Velnes Fizio Centar', customerNo: 'MK-4821',
              status: 'connected', connected: '2026-08-04', orders: 3, value: 14820, openOrders: 1, note: '',
            },
            {
              businessId: '10000000-0000-4000-8000-000000000009', name: 'Spa Ohrid', customerNo: '',
              status: 'pending', connected: null, orders: 0, value: 0, openOrders: 0, note: 'No existing customer number',
            },
          ],
        });
      if (path.includes('/portal/connections/')) return ok({ ok: true });
      if (path.includes('/portal/orders/') && method === 'POST') return ok(order('shipped'));
      if (path.includes('/portal/orders')) return ok({ orders: [order('processing')] });
      if (path.includes('/portal/catalog')) return ok({ products: [] });
      if (path.includes('/portal/promotions')) return ok({ promotions: [] });
      return new Response('{}', { status: 404 });
    }),
  );
}

async function signIn() {
  render(<App />);
  await userEvent.type(screen.getByLabelText('Email'), 'vesna@beautypro.mk');
  await userEvent.type(screen.getByLabelText('Password'), 'velnes-demo');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByText('Connected salons');
}

describe('the supplier portal', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('signs in and shows the dashboard with the pending connection request', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await signIn();
    expect(screen.getByText('BeautyPro MK')).toBeDefined();
    expect(await screen.findByText('Spa Ohrid')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path.includes('/portal/connections/') && c.path.endsWith('/accept'))).toBe(true),
    );
  });

  it('ships a processing order with its tracking number', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await signIn();
    await userEvent.click(screen.getByRole('button', { name: 'Orders' }));
    await screen.findByText('CEN-0042');
    await userEvent.type(screen.getByPlaceholderText('Tracking number'), 'MK-PARCEL-90009');
    await userEvent.click(screen.getByRole('button', { name: 'Ship' }));
    await waitFor(() => {
      const sent = calls.find((c) => c.path.includes(`/portal/orders/${PO}/transitions`));
      expect(sent).toBeDefined();
      expect((sent!.body as { to: string; track: string }).to).toBe('shipped');
      expect((sent!.body as { track: string }).track).toBe('MK-PARCEL-90009');
    });
  });
});
