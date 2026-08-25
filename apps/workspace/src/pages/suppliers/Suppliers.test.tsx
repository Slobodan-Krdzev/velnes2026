import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.js';
import { setAccessToken } from '@velnes/client';

const LOC = '20000000-0000-4000-8000-000000000001';
const SUP1 = 'd1000000-0000-4000-8000-000000000001';
const SP1 = 'd2000000-0000-4000-8000-000000000001';
const PO = 'd4000000-0000-4000-8000-000000000009';

const me = {
  id: '40000000-0000-4000-8000-000000000001',
  name: 'Maria Petrovska',
  access: 'owner',
  roleId: '30000000-0000-4000-8000-000000000001',
  locationIds: [LOC],
  email: 'maria@velnes.mk',
  tenantId: '10000000-0000-4000-8000-000000000001',
  lang: 'en',
  perms: { 'suppliers.manage': 'business' },
};

const supplier = (over: Record<string, unknown> = {}) => ({
  id: SUP1, name: 'BeautyPro MK', type: 'Distributor', territory: 'North Macedonia',
  verified: true, minOrder: 6000, lead: '2–3 business days', terms: '30 days invoice',
  contact: '', manager: 'Vesna', rating: 4.6, products: 7,
  status: 'connected', customerNo: 'MK-4821', connected: '2026-08-04',
  share: { orders: true }, locationIds: [LOC], ...over,
});

const spRow = {
  id: SP1, supplierId: SUP1, brand: 'Thera-Band', name: 'Thera-Band resistance set, 3 levels',
  sku: 'TB-SET-03', ean: '', size: '3 bands', pack: 6, buy: 550, rrp: 990, vat: 18,
  moq: 1, stock: 240, lead: '2 days', use: 'both', category: 'Home exercise', descr: '',
  sample: false, linkedProductId: '70000000-0000-4000-8000-000000000001',
};

const order = (status: string) => ({
  id: PO, ref: 'CEN-0044', supplierId: SUP1, supplierName: 'BeautyPro MK',
  locationId: LOC, status, byName: 'Maria Petrovska', expected: '2026-08-30',
  track: 'MK-PARCEL-90002', createdAt: '2026-08-26T09:00:00.000Z',
  lines: [{ id: 'e9000000-0000-4000-8000-000000000001', supplierProductId: SP1,
    name: 'Thera-Band resistance set, 3 levels', sku: 'TB-SET-03',
    qty: 12, price: 550, free: 2, recv: 0, dmg: 0 }],
  total: 6600,
});

function mockApi(calls: { method: string; path: string; body?: unknown }[], orderStatus = 'shipped') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      const method = init?.method ?? 'GET';
      if (method !== 'GET')
        calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (path.endsWith('/auth/me')) return ok(me);
      if (path.includes('/suppliers') && path.includes('/catalog')) return ok({ products: [spRow] });
      if (path.includes('/suppliers')) return ok({ suppliers: [supplier(), supplier({ id: 'd1000000-0000-4000-8000-000000000003', name: 'Adriatic Beauty Group', status: 'available', customerNo: '', products: 1 })] });
      if (path.includes('/purchase-orders') && path.includes('/receive'))
        return ok(order('partdelivered'));
      if (path.includes('/purchase-orders') && method === 'POST') return ok(order('submitted'));
      if (path.includes('/purchase-orders')) return ok({ orders: [order(orderStatus)] });
      if (path.includes('/supplier-promotions'))
        return ok({
          promotions: [
            {
              id: 'f5000000-0000-4000-8000-000000000001', supplierId: SUP1, supplierName: 'BeautyPro MK',
              brand: 'Thera-Band', title: 'Buy 10 resistance sets, receive 2 free', kind: 'bxgy',
              productIds: [SP1], starts: '2026-08-01', ends: '2026-08-31', minOrder: 0,
              usageLimit: 400, terms: 'Applies per order line.', audience: 'Connected salons only',
              value: 2, per: 10,
            },
          ],
        });
      if (path.includes('/locations'))
        return ok({
          locations: [
            {
              id: LOC, name: 'Centar', city: 'Skopje', address: 'x', tz: 'Europe/Skopje',
              phone: null, rooms: 3, invPrefix: 'CEN-', online: true, cancelHours: 24,
              opened: null, lifecycle: 'ACTIVE',
            },
          ],
        });
      return new Response('{}', { status: 404 });
    }),
  );
}

async function openSuppliers() {
  window.history.pushState({}, '', '/suppliers');
  localStorage.setItem('velnes.refresh', 'rt');
  render(<App />);
  await screen.findAllByText('BeautyPro MK');
}

describe('suppliers', () => {
  beforeEach(() => {
    localStorage.clear();
    setAccessToken(null);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists connected and available suppliers with the honest connect note', async () => {
    mockApi([]);
    await openSuppliers();
    expect(screen.getByText(/customer number MK-4821/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Request connection' })).toBeDefined();
    expect(screen.getByText(/A supplier never sees your salon until you connect/)).toBeDefined();
  });

  it('builds an order: minimum gate, then submit posts the lines', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openSuppliers();
    await userEvent.click(screen.getByRole('button', { name: 'New order' }));
    await screen.findByText(/Buy 10 resistance sets/);
    const submitBtn = screen.getByRole('button', { name: /Minimum/ });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true);
    const qtyInput = screen.getByLabelText(/Qty Thera-Band/);
    await userEvent.clear(qtyInput);
    await userEvent.type(qtyInput, '12');
    await userEvent.click(screen.getByRole('button', { name: 'Submit order' }));
    await waitFor(() => {
      const sent = calls.find((c) => c.path.endsWith('/purchase-orders') && c.method === 'POST');
      expect(sent).toBeDefined();
      const b = sent!.body as { lines: { qty: number }[]; submit: boolean };
      expect(b.lines[0]!.qty).toBe(12);
      expect(b.submit).toBe(true);
    });
  });

  it('receives a shipped order with counts — damaged and missing stay out of stock', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls, 'shipped');
    await openSuppliers();
    await userEvent.click(screen.getByRole('button', { name: 'Orders' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Receive' }));
    await screen.findByText('Count what actually arrived');
    expect(screen.getByText(/incl. 2 free/)).toBeDefined();
    const recvInput = screen.getByLabelText(/Received Thera-Band/);
    await userEvent.clear(recvInput);
    await userEvent.type(recvInput, '12');
    expect(screen.getByText('2', { selector: 'td.bold' })).toBeDefined(); // missing
    await userEvent.click(screen.getByRole('button', { name: 'Confirm receipt' }));
    await waitFor(() => {
      const sent = calls.find((c) => c.path.includes('/receive'));
      expect(sent).toBeDefined();
      expect((sent!.body as { lines: { received: number }[] }).lines[0]!.received).toBe(12);
    });
  });
});
