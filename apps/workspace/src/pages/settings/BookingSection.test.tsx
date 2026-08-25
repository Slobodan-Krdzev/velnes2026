import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.js';
import { setAccessToken } from '@velnes/client';

const LOC1 = '20000000-0000-4000-8000-000000000001';
const WID = 'b0000000-0000-4000-8000-000000000001';

const me = {
  id: '40000000-0000-4000-8000-000000000001',
  name: 'Maria Petrovska',
  access: 'owner',
  roleId: '30000000-0000-4000-8000-000000000001',
  locationIds: [LOC1],
  email: 'maria@velnes.mk',
  tenantId: '10000000-0000-4000-8000-000000000001',
  lang: 'en',
  perms: {
    'locations.manage': 'business',
    'users.manage': 'business',
    'roles.manage': 'business',
    'widget.manage': 'business',
    'integrations.manage': 'business',
  },
};

const widget = (over: Record<string, unknown> = {}) => ({
  id: WID,
  name: 'Website widget',
  publishableKey: 'pk_live_velnes_demo',
  locationIds: [LOC1],
  categories: ['all'],
  lang: 'en',
  theme: 'light',
  accent: '#6f7357',
  radius: '8',
  btnStyle: 'rounded',
  startStep: 'location',
  deposit: 'none',
  cancelPolicy: 'inherit',
  domains: ['velnesstudio.mk'],
  status: 'live',
  bookings: 4,
  ...over,
});

function mockApi(calls: { method: string; path: string; body?: unknown }[]) {
  let current = widget();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (method !== 'GET') calls.push({ method, path, body });
      const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (path.endsWith('/auth/me')) return ok(me);
      if (path.includes('/widgets') && method === 'PATCH') {
        current = { ...current, ...(body as object) };
        return ok(current);
      }
      if (path.includes('/regenerate-key')) {
        current = { ...current, publishableKey: 'pk_live_fresh' };
        return ok(current);
      }
      if (path.includes('/widgets'))
        return ok({ widgets: [current], slug: 'velnes-fizio' });
      if (path.includes('/integration-events'))
        return ok({
          events: [
            {
              id: 'e1000000-0000-4000-8000-000000000001',
              ts: '2026-08-25T10:00:00.000Z',
              widgetId: WID,
              level: 'error',
              code: 'DOMAIN_NOT_ALLOWED',
              msg: 'A request came from https://evil.example.com.',
              fix: 'Add the domain under Settings › Online booking.',
            },
          ],
        });
      if (path.includes('/locations'))
        return ok({
          locations: [
            {
              id: LOC1, name: 'Centar', city: 'Skopje', address: 'Macedonia Street 21',
              tz: 'Europe/Skopje', phone: null, rooms: 3, invPrefix: 'CEN-', online: true,
              cancelHours: 24, opened: null, lifecycle: 'ACTIVE',
            },
          ],
        });
      if (path.includes('/catalog')) return ok({ services: [], products: [] });
      if (path.includes('/availability')) return ok({ slots: [] });
      if (path.includes('/readiness')) return ok({ items: [], ok: true });
      if (path.includes('/employees')) return ok({ employees: [] });
      if (path.includes('/roles')) return ok({ roles: [] });
      if (path.includes('/audit')) return ok({ entries: [] });
      return new Response('{}', { status: 404 });
    }),
  );
}

async function openBooking() {
  window.history.pushState({}, '', '/settings');
  localStorage.setItem('velnes.refresh', 'rt');
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Online booking' }));
}

describe('settings › online booking', () => {
  beforeEach(() => {
    localStorage.clear();
    setAccessToken(null);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the link, the widget list and the integration health feed', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openBooking();
    expect(
      await screen.findByText('Three ways to take bookings from your own website'),
    ).toBeDefined();
    expect(screen.getByDisplayValue(/\/book\/velnes-fizio$/)).toBeDefined();
    expect(screen.getByText(/pk_live_velnes_demo/)).toBeDefined();
    expect(screen.getByText('4 bookings')).toBeDefined();
    // The real event from the feed, with its fix hint.
    expect(screen.getByText('DOMAIN_NOT_ALLOWED')).toBeDefined();
    expect(screen.getByText('1 need attention')).toBeDefined();
  });

  it('edits a widget through the PATCH door: domains and the live toggle', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openBooking();
    await userEvent.click(await screen.findByRole('button', { name: 'Open' }));
    expect(await screen.findByText('Allowed websites')).toBeDefined();

    await userEvent.type(screen.getByPlaceholderText('www.yoursalon.mk'), 'https://Other.mk');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === 'PATCH' &&
            JSON.stringify((c.body as { domains?: string[] }).domains) ===
              JSON.stringify(['velnesstudio.mk', 'other.mk']),
        ),
      ).toBe(true),
    );

    await userEvent.click(screen.getByRole('switch'));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === 'PATCH' && (c.body as { status?: string }).status === 'draft',
        ),
      ).toBe(true),
    );
  });

  it('regenerates the key and shows the new one immediately', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openBooking();
    await userEvent.click(await screen.findByRole('button', { name: 'Open' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Make a new key' }));
    await waitFor(() => expect(screen.getAllByText(/pk_live_fresh/).length).toBeGreaterThan(0));
    expect(calls.some((c) => c.path.includes('/regenerate-key'))).toBe(true);
  });
});
