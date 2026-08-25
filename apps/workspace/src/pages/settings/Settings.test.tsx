import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.js';
import { setAccessToken } from '../../api/client.js';

const LOC1 = '20000000-0000-4000-8000-000000000001';
const LOC2 = '20000000-0000-4000-8000-000000000002';
const ROLE = '30000000-0000-4000-8000-000000000004';

const me = {
  id: '40000000-0000-4000-8000-000000000001',
  name: 'Maria Petrovska',
  access: 'owner',
  roleId: '30000000-0000-4000-8000-000000000001',
  locationIds: [LOC1, LOC2],
  email: 'maria@velnes.mk',
  tenantId: '10000000-0000-4000-8000-000000000001',
  lang: 'en',
  perms: { 'locations.manage': 'business', 'users.manage': 'business', 'roles.manage': 'business' },
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
      if (path.includes('/readiness'))
        return ok({
          items: [
            { k: 'legal', label: 'Verified legal entity attached', ok: true },
            { k: 'address', label: 'Location details complete', ok: true },
            { k: 'hours', label: 'Working hours set', ok: true },
            { k: 'service', label: 'At least one active, online-bookable service', ok: true },
            { k: 'staff', label: 'Staff assigned who can deliver a bookable service', ok: true },
          ],
          ok: true,
        });
      if (path.includes('/transitions'))
        return ok({
          location: {
            id: LOC2, name: 'Aerodrom', city: 'Skopje', address: 'x', tz: 'Europe/Skopje',
            phone: null, rooms: 2, invPrefix: 'AER-', online: true, cancelHours: 24,
            opened: null, lifecycle: 'ACTIVE',
          },
        });
      if (path.includes('/locations') && method === 'GET')
        return ok({
          locations: [
            {
              id: LOC1, name: 'Centar', city: 'Skopje', address: 'Macedonia Street 21',
              tz: 'Europe/Skopje', phone: null, rooms: 3, invPrefix: 'CEN-', online: true,
              cancelHours: 24, opened: null, lifecycle: 'ACTIVE',
            },
            {
              id: LOC2, name: 'Aerodrom', city: 'Skopje', address: 'Jane Sandanski 82',
              tz: 'Europe/Skopje', phone: null, rooms: 2, invPrefix: 'AER-', online: false,
              cancelHours: 24, opened: null, lifecycle: 'APPROVED',
            },
          ],
        });
      if (path.includes('/employees') && method === 'PATCH') return ok({
        id: '40000000-0000-4000-8000-000000000002', name: 'Ana Dimitrova', roleTitle: 'Rehab coach',
        email: 'ana@velnes.mk', phone: null, access: 'staff', roleId: ROLE, bookable: false,
        status: 'active', color: 'clay', locationIds: [LOC2], skillServiceIds: [],
      });
      if (path.includes('/employees'))
        return ok({
          employees: [
            {
              id: '40000000-0000-4000-8000-000000000002', name: 'Ana Dimitrova',
              roleTitle: 'Rehab coach', email: 'ana@velnes.mk', phone: null, access: 'staff',
              roleId: ROLE, bookable: true, status: 'active', color: 'clay',
              locationIds: [LOC2], skillServiceIds: [],
            },
          ],
        });
      if (path.includes('/roles') && method === 'PUT') return ok({ ok: true });
      if (path.includes('/roles'))
        return ok({
          roles: [
            {
              id: ROLE, name: 'Employee', std: true, locked: false,
              description: 'Their own day and the till.',
              perms: { 'appointments.view_own': 'own', 'pos.checkout': 'location' },
            },
          ],
        });
      if (path.includes('/audit'))
        return ok({
          entries: [
            {
              id: 'e0000000-0000-4000-8000-000000000001',
              ts: '2026-08-25T09:14:00.000Z',
              actorName: 'Maria Petrovska', roleName: 'Owner', businessName: 'Velnes',
              locationName: '—', action: 'Price changed', object: 'Service · Rehab training',
              before: '1500 ден', after: '1600 ден', source: 'Web', reason: '',
            },
          ],
        });
      return new Response('{}', { status: 404 });
    }),
  );
}

async function openSettings() {
  window.history.pushState({}, '', '/settings');
  localStorage.setItem('velnes.refresh', 'rt');
  render(<App />);
  await waitFor(() => expect(screen.getByText('Centar')).toBeDefined());
}

describe('settings', () => {
  beforeEach(() => {
    localStorage.clear();
    setAccessToken(null);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the readiness checklist on an APPROVED location and activates owner-only', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openSettings();
    expect(await screen.findByText('Verified by Revelapps HQ.')).toBeDefined();
    expect(screen.getByText(/✓ Working hours set/)).toBeDefined();
    const activate = screen.getByRole('button', { name: 'Activate location' });
    await userEvent.click(activate);
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.path.includes(`/locations/${LOC2}/transitions`) &&
            (c.body as { to: string }).to === 'ACTIVE',
        ),
      ).toBe(true),
    );
  });

  it('toggles bookable through the employee PATCH door', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Team & access' }));
    const toggle = await screen.findByRole('switch', { name: 'Ana Dimitrova bookable' });
    await userEvent.click(toggle);
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === 'PATCH' && (c.body as { bookable: boolean }).bookable === false,
        ),
      ).toBe(true),
    );
  });

  it('edits a role through the permission matrix with legal scopes only', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Roles & permissions' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const sel = await screen.findByLabelText('appointments.view_own');
    // The scope ladder is constrained: own-agenda only offers none/own.
    expect([...sel.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'none',
      'own',
    ]);
    await userEvent.selectOptions(screen.getByLabelText('pos.discount'), 'business');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === 'PUT' &&
            c.path.includes(`/roles/${ROLE}`) &&
            (c.body as { perms: Record<string, string> }).perms['pos.discount'] === 'business',
        ),
      ).toBe(true),
    );
  });

  it('renders the audit log', async () => {
    mockApi([]);
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Audit log' }));
    expect(await screen.findByText('Price changed')).toBeDefined();
    expect(screen.getByText('1500 ден → 1600 ден')).toBeDefined();
  });
});
