import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.js';
import { setAccessToken } from '@velnes/client';

const LOC = '20000000-0000-4000-8000-000000000001';
const SVC = '60000000-0000-4000-8000-000000000008';
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
  perms: { 'catalog.view': 'business', 'catalog.edit': 'business' },
};

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
      if (path.endsWith('/catalog') && method === 'GET')
        return ok({
          services: [
            {
              id: SVC,
              name: 'Sports massage',
              category: 'Recovery',
              durationMin: 45,
              price: 1900,
              vat: 18,
              status: 'active',
              pos: true,
              online: true,
              prepMin: 5,
              resetMin: 15,
              config: { active: true, price: 1900, durationMin: 45, online: true, pos: true },
              variants: [
                { id: '61000000-0000-4000-8000-000000000801', label: '45 minutes', durationMin: 45, price: 1900, std: true, active: true },
                { id: '61000000-0000-4000-8000-000000000802', label: '60 minutes', durationMin: 60, price: 2400, std: false, active: true },
              ],
              modifiers: [
                {
                  id: '62000000-0000-4000-8000-000000000008',
                  name: 'Oil',
                  type: 'single',
                  required: false,
                  options: [
                    { id: '63000000-0000-4000-8000-000000000017', name: 'Neutral oil', price: 0, durationMin: 0 },
                  ],
                },
              ],
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
      if (path.includes('/catalog/services/') && method === 'PATCH') return ok({ ok: true });
      if (path.includes('/services/') && method === 'PUT') return ok({ ok: true });
      if (path.endsWith('/stock/movements')) return ok({ levels: [] });
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

async function openCatalog() {
  window.history.pushState({}, '', '/catalog');
  localStorage.setItem('velnes.refresh', 'rt');
  render(<App />);
  await waitFor(() => expect(screen.getByText('Sports massage')).toBeDefined());
}

describe('catalog', () => {
  beforeEach(() => {
    localStorage.clear();
    setAccessToken(null);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('groups services by category with the variants badge', async () => {
    mockApi([]);
    await openCatalog();
    expect(screen.getByText('Recovery')).toBeDefined(); // group row
    expect(screen.getByText('2 durations')).toBeDefined();
    expect(screen.getByText('1 option groups')).toBeDefined();
  });

  it('commits an inline price change through the per-location override door', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openCatalog();
    const cell = screen.getByLabelText('Sports massage price');
    await userEvent.clear(cell);
    await userEvent.type(cell, '2000');
    await userEvent.tab();
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === 'PATCH' &&
            c.path.includes(`/catalog/services/${SVC}`) &&
            (c.body as { price: number }).price === 2000,
        ),
      ).toBe(true),
    );
  });

  it('opens the service editor with variants and modifiers and saves through PUT', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openCatalog();
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(await screen.findByDisplayValue('45 minutes')).toBeDefined();
    expect(screen.getByDisplayValue('Oil')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'PUT' && c.path.includes(`/services/${SVC}`)),
      ).toBe(true),
    );
    const body = calls.find((c) => c.method === 'PUT')!.body as {
      variants: unknown[];
      modifiers: { options: unknown[] }[];
    };
    expect(body.variants).toHaveLength(2);
    expect(body.modifiers[0]!.options).toHaveLength(1);
  });

  it('adjusts product stock as a ledger movement', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openCatalog();
    await userEvent.click(screen.getByRole('button', { name: 'Products' }));
    const cell = await screen.findByLabelText('Kinesiology tape roll stock');
    await userEvent.clear(cell);
    await userEvent.type(cell, '44');
    await userEvent.tab();
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.path.endsWith('/stock/movements') &&
            (c.body as { kind: string; qty: number }).kind === 'adjustment' &&
            (c.body as { qty: number }).qty === 3,
        ),
      ).toBe(true),
    );
  });
});
