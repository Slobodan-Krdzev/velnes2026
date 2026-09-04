import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
  role: 'sr_owner',
  supplierId: SUP1,
  supplierName: 'BeautyPro MK',
};

const order = (status: string, id = PO, ref = 'CEN-0042') => ({
  id, ref, supplierId: SUP1, supplierName: 'BeautyPro MK',
  salonName: 'Velnes Fizio Centar', locationName: null,
  locationId: '20000000-0000-4000-8000-000000000001', status,
  byName: 'Maria Petrovska', expected: '2026-08-30', track: 'MK-PARCEL-90009',
  createdAt: '2026-08-26T09:00:00.000Z',
  lines: [{ id: 'e9000000-0000-4000-8000-000000000001', supplierProductId: 'd2000000-0000-4000-8000-000000000001',
    name: 'Thera-Band resistance set, 3 levels', sku: 'TB-SET-03', qty: 12, price: 550, free: 2, recv: 0, dmg: 0 }],
  total: 6600,
});
const DELIVERED = 'd4000000-0000-4000-8000-000000000002';

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
      if (path.includes('/portal/notifications'))
        return ok({
          notifications: [{
            id: 'a0000000-0000-4000-8000-000000000001', kind: 'order',
            title: 'New order CEN-0043', body: 'Velnes Fizio Centar placed CEN-0043 · 5500 ден — accept it in the portal',
            refId: 'd4000000-0000-4000-8000-000000000003', createdAt: '2026-08-27T09:00:00.000Z',
          }],
        });
      if (path.includes('/portal/dashboard'))
        return ok({
          supplierName: 'BeautyPro MK', supplierType: 'Distributor', brands: ['Thera-Band', 'CureTape'],
          salons: 3, openOrders: 2, orderValue30: 4820, repeatRate: 67, trainingSeats: null,
          products: 7, pendingConnections: 1,
          payments: { legalEntity: 'BeautyPro MK DOO', merchantId: 'MID-90417-BP', provider: 'CaSys (demo)', settlement: 'MK07 …8842', status: 'active' },
          bestSelling: [{ name: 'Thera-Band resistance set, 3 levels', value: 6600 }],
          recentOrders: [{
            id: 'd4000000-0000-4000-8000-000000000003', ref: 'CEN-0043', salonName: 'Velnes Fizio Centar',
            createdAt: '2026-08-27T09:00:00.000Z', total: 5500, status: 'submitted',
          }],
          requests: [{
            businessId: '10000000-0000-4000-8000-000000000009', name: 'Spa Ohrid', city: 'Ohrid',
            locations: 1, note: 'No existing customer number', shares: 'orders, stock and training registrations',
          }],
          attention: [],
        });
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
      if (path.includes('/portal/orders'))
        return ok({
          orders: [
            order('processing'),
            order('delivered', DELIVERED, 'AER-0031'),
            order('submitted', 'd4000000-0000-4000-8000-000000000003', 'CEN-0043'),
          ],
        });
      if (path.includes('/portal/catalog') && method === 'GET')
        return ok({
          products: [{
            id: 'd2000000-0000-4000-8000-000000000001', supplierId: SUP1, brand: 'Thera-Band',
            name: 'Thera-Band resistance set, 3 levels', sku: 'TB-SET-03', ean: '3474636975918', size: '3 levels',
            pack: 6, buy: 550, rrp: 990, vat: 18, moq: 1, stock: 240, lead: '2 days', use: 'both',
            category: 'Rehab', descr: '', sample: false, active: true, linkedProductId: null,
          }],
        });
      if (path.includes('/portal/catalog')) return ok({ id: 'new', ok: true, updated: 1 });
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

  it('shows the notifications bell and the newest-orders dashboard card', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await signIn();
    // The dashboard's newest-orders card lists the recent order.
    expect(screen.getByText('Newest orders')).toBeDefined();
    expect(screen.getAllByText('CEN-0043').length).toBeGreaterThan(0);
    // The bell opens the notification feed.
    await userEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('New order CEN-0043')).toBeDefined();
    // Clicking the notification jumps to that exact order's detail.
    await userEvent.click(screen.getByText('New order CEN-0043'));
    expect(await screen.findByText('Order lines')).toBeDefined();
    expect(screen.getByText('Order details')).toBeDefined();
  });

  it('accepts and declines an order from its detail panel (decline needs a reason)', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await signIn();
    await userEvent.click(screen.getByRole('button', { name: 'Orders' }));
    await screen.findByText('CEN-0043');
    // Open the submitted order's detail via its Details button.
    const row = screen.getByText('CEN-0043').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Details' }));
    await screen.findByText('Order lines');

    // Decline requires a reason before it will send.
    await userEvent.click(screen.getByRole('button', { name: 'Decline' }));
    await userEvent.click(screen.getByRole('button', { name: 'Decline order' }));
    expect(calls.some((c) => c.method === 'POST' && c.path.includes('/transitions'))).toBe(false);
    await userEvent.type(screen.getByPlaceholderText(/out of stock/), 'No stock this month');
    await userEvent.click(screen.getByRole('button', { name: 'Decline order' }));
    await waitFor(() => {
      const sent = calls.find((c) => c.method === 'POST' && c.path.includes('/transitions'));
      expect(sent?.body).toMatchObject({ to: 'cancelled', reason: 'No stock this month' });
    });
  });

  it('catalog: availability toggle, edit panel with delete, and bulk update', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await signIn();
    await userEvent.click(screen.getByRole('button', { name: 'Catalog' }));
    await screen.findByText('Thera-Band resistance set, 3 levels');

    // The row availability toggle removes the product from ordering.
    await userEvent.click(screen.getByRole('switch'));
    await waitFor(() => {
      const sent = calls.find((c) => c.method === 'PATCH' && c.path.includes('/portal/catalog/'));
      expect((sent?.body as { active: boolean }).active).toBe(false);
    });

    // Edit opens the panel with a Delete product action.
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(await screen.findByText('Official product data')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Delete product' })).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Delete product' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path.includes('/portal/catalog/'))).toBe(true),
    );

    // Bulk update applies a percentage across the catalog.
    await userEvent.click(screen.getByRole('button', { name: 'Bulk update' }));
    await screen.findByText('Bulk price update');
    await userEvent.type(screen.getByPlaceholderText(/5 or -10/), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => {
      const sent = calls.find((c) => c.method === 'POST' && c.path.includes('/portal/catalog/bulk'));
      expect(sent?.body).toMatchObject({ target: 'buy', percent: 10 });
    });
  });

  it('exports the connected salons to CSV', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    // jsdom lacks the Blob URL plumbing the download uses.
    const createUrl = vi.fn(() => 'blob:mock');
    const revokeUrl = vi.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createUrl;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeUrl;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await signIn();
    await userEvent.click(screen.getByRole('button', { name: 'Salons' }));
    await screen.findByText('Velnes Fizio Centar');
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeUrl).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Exported 2 salons/)).toBeDefined();
    clickSpy.mockRestore();
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

  it('searches and filters the orders table', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await signIn();
    await userEvent.click(screen.getByRole('button', { name: 'Orders' }));
    await screen.findByText('CEN-0042');
    expect(screen.getByText('AER-0031')).toBeDefined();

    // Search narrows to the matching ref.
    await userEvent.type(screen.getByPlaceholderText(/Search order/), 'AER');
    expect(screen.queryByText('CEN-0042')).toBeNull();
    expect(screen.getByText('AER-0031')).toBeDefined();

    // Searching by value (both orders total 6600) matches on price.
    await userEvent.clear(screen.getByPlaceholderText(/Search order/));
    await userEvent.type(screen.getByPlaceholderText(/Search order/), '6,600');
    expect(screen.getByText('CEN-0042')).toBeDefined();
    expect(screen.getByText('AER-0031')).toBeDefined();
    await userEvent.clear(screen.getByPlaceholderText(/Search order/));

    // Clearing the search and filtering by status keeps only delivered.
    await userEvent.clear(screen.getByPlaceholderText(/Search order/));
    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'delivered');
    expect(screen.queryByText('CEN-0042')).toBeNull();
    expect(screen.getByText('AER-0031')).toBeDefined();

    // A non-matching search shows the honest no-match line.
    await userEvent.type(screen.getByPlaceholderText(/Search order/), 'nothing-here');
    expect(await screen.findByText(/No orders match/)).toBeDefined();
  });

  it('opens the full order details / invoice view from a finished order', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await signIn();
    await userEvent.click(screen.getByRole('button', { name: 'Orders' }));
    await screen.findByText('AER-0031');
    // The delivered order offers an Invoice; opening it shows the full
    // order with its total and the honest fiscalization note.
    await userEvent.click(screen.getByRole('button', { name: 'Invoice' }));
    expect(await screen.findByText('Order lines')).toBeDefined();
    expect(screen.getByText('MK-PARCEL-90009')).toBeDefined();
    // The line total and order total (12 × 550 = 6600) both render.
    expect(screen.getAllByText((c) => /6[.,\s]600/.test(c)).length).toBeGreaterThan(0);
    expect(screen.getByText(/fiscalization provider decision/)).toBeDefined();
  });
});
