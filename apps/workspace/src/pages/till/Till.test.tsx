import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.js';
import { setAccessToken } from '../../api/client.js';

const LOC = '20000000-0000-4000-8000-000000000001';
const SVC = '60000000-0000-4000-8000-000000000004';
const PROD = '70000000-0000-4000-8000-000000000003';

const me = {
  id: '40000000-0000-4000-8000-000000000001',
  name: 'Maria Petrovska',
  access: 'owner',
  roleId: '30000000-0000-4000-8000-000000000001',
  locationIds: [LOC],
  email: 'maria@velnes.mk',
  tenantId: '10000000-0000-4000-8000-000000000001',
  lang: 'en',
  perms: { 'pos.checkout': 'business', 'pos.refund': 'business' },
};

function mockApi(sales: { body: unknown }[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (path.endsWith('/auth/me')) return ok(me);
      if (path.includes('/locations') && path.endsWith('/catalog'))
        return ok({
          services: [
            {
              id: SVC,
              name: 'Rehab training',
              category: 'Rehab',
              durationMin: 60,
              price: 1500,
              vat: 18,
              status: 'active',
              pos: true,
              online: true,
              prepMin: null,
              resetMin: null,
              config: { active: true, price: 1500, durationMin: 60, online: true, pos: true },
              variants: [],
              modifiers: [],
            },
          ],
          products: [
            {
              id: PROD,
              name: 'Kinesiology tape roll',
              category: 'Recovery aids',
              sku: 'VEL-TAPE-5M',
              vat: 18,
              own: false,
              config: { active: true, price: 550, pos: true, stock: 41, lowStock: 2 },
            },
          ],
        });
      if (path.includes('/locations'))
        return ok({
          locations: [
            {
              id: LOC, name: 'Centar', city: 'Skopje', address: 'x', tz: 'Europe/Skopje',
              phone: null, rooms: 3, invPrefix: 'CEN-2026-', online: true, cancelHours: 24,
              opened: null, lifecycle: 'ACTIVE',
            },
          ],
        });
      if (path.includes('/appointments?')) return ok({ appointments: [] });
      if (path.endsWith('/sales') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { method: string };
        sales.push({ body });
        return ok({
          invoice: {
            id: 'bbbbbbbb-0000-4000-8000-000000000001',
            number: 'CEN-2026-0414',
            date: '2026-08-25',
            locationId: LOC,
            customerName: 'Walk-in',
            employeeName: 'Maria Petrovska',
            method: body.method,
            status: 'Paid',
            total: 2050,
            lines: [],
          },
          checkoutId: 'cccccccc-0000-4000-8000-000000000001',
          checkoutStatus: 'PARTIALLY_PAID',
          transactions: [],
          total: 2050,
          pointsEarned: 0,
          shortages: [],
        });
      }
      return new Response('{}', { status: 404 });
    }),
  );
}

async function openTill() {
  window.history.pushState({}, '', '/till');
  localStorage.setItem('velnes.refresh', 'rt');
  render(<App />);
  await waitFor(() => expect(screen.getByText('Receipt')).toBeDefined());
}

describe('cash register', () => {
  beforeEach(() => {
    localStorage.clear();
    setAccessToken(null);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('rings up tiles and totals the receipt like the prototype', async () => {
    mockApi([]);
    await openTill();
    // Today's is empty → switch to Services / Products.
    await userEvent.click(screen.getByRole('button', { name: 'Services' }));
    await userEvent.click(await screen.findByRole('button', { name: /Rehab training/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Products' }));
    await userEvent.click(await screen.findByRole('button', { name: /Kinesiology tape roll/ }));
    const plusButtons = screen.getAllByRole('button', { name: 'One more' });
    await userEvent.click(plusButtons[plusButtons.length - 1]!); // the tape line
    // 1500 + 2×550 = 2600 on the pay button.
    expect(screen.getByRole('button', { name: /Pay/ }).textContent).toContain('2.600');
  });

  it('completes a cash sale through POST /sales and toasts the invoice number', async () => {
    const sales: { body: unknown }[] = [];
    mockApi(sales);
    await openTill();
    await userEvent.click(screen.getByRole('button', { name: 'Services' }));
    await userEvent.click(await screen.findByRole('button', { name: /Rehab training/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Cash' }));
    await waitFor(() => expect(sales).toHaveLength(1));
    const body = sales[0]!.body as { method: string; lines: unknown[]; locationId: string };
    expect(body.method).toBe('Cash');
    expect(body.locationId).toBe(LOC);
    expect(body.lines).toHaveLength(1);
    // Toast carries the invoice number; the not-ready seller is surfaced.
    const toast = await screen.findByRole('status');
    expect(toast.textContent).toContain('CEN-2026-0414');
  });
});
