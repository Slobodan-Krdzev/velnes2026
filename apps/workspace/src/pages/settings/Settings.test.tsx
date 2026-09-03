import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.js';
import { setAccessToken } from '@velnes/client';

const LOC1 = '20000000-0000-4000-8000-000000000001';
const LOC2 = '20000000-0000-4000-8000-000000000002';
const ROLE = '30000000-0000-4000-8000-000000000004';
const ROLE2 = '30000000-0000-4000-8000-000000000005';

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
      if (path.endsWith('/auth/preview'))
        return ok({
          accessToken: 'preview-token',
          employee: {
            id: '40000000-0000-4000-8000-000000000002', name: 'Ana Dimitrova',
            access: 'staff', roleId: ROLE, roleName: 'Employee', locationIds: [LOC2],
            email: 'ana@velnes.mk', tenantId: me.tenantId, lang: 'en',
            // users.manage keeps the borrowed view on Settings, so the
            // test can watch the bar without mocking the flightdeck.
            perms: { 'users.manage': 'business' },
          },
        });
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
            opened: null, lifecycle: 'ACTIVE', hours: null,
          },
        });
      if (path.includes('/customers')) return ok({ customers: [], total: 42 });
      if (path.includes('/copy-setup')) return ok({ ok: true });
      if (path.includes('/catalog')) return ok({ services: [], products: [] });
      if (path.includes('/timings')) return ok({ timingEnabled: false, rows: [] });
      if (/\/locations\/[^/]+$/.test(path) && method === 'PATCH')
        return ok({
          id: LOC1, name: 'Centar', city: 'Skopje', address: 'Macedonia Street 21',
          tz: 'Europe/Skopje', phone: null, rooms: 3, invPrefix: 'CEN-', online: true,
          cancelHours: 24, opened: null, lifecycle: 'ACTIVE', hours: null,
        });
      if (path.includes('/locations') && method === 'GET')
        return ok({
          locations: [
            {
              id: LOC1, name: 'Centar', city: 'Skopje', address: 'Macedonia Street 21',
              tz: 'Europe/Skopje', phone: null, rooms: 3, invPrefix: 'CEN-', online: true,
              cancelHours: 24, opened: null, lifecycle: 'ACTIVE', hours: null,
            },
            {
              id: LOC2, name: 'Aerodrom', city: 'Skopje', address: 'Jane Sandanski 82',
              tz: 'Europe/Skopje', phone: null, rooms: 2, invPrefix: 'AER-', online: false,
              cancelHours: 24, opened: null, lifecycle: 'APPROVED', hours: null,
            },
          ],
        });
      if (path.includes('/employees') && method === 'PATCH') return ok({
        id: '40000000-0000-4000-8000-000000000002', name: 'Ana Dimitrova', roleTitle: 'Rehab coach',
        email: 'ana@velnes.mk', phone: null, access: 'staff', roleId: ROLE, bookable: false,
        status: 'active', color: 'clay', locationIds: [LOC2], skillServiceIds: [], hours: null, twofaEnabled: false, lastActive: null,
      });
      if (path.includes('/employees'))
        return ok({
          employees: [
            {
              id: '40000000-0000-4000-8000-000000000002', name: 'Ana Dimitrova',
              roleTitle: 'Rehab coach', email: 'ana@velnes.mk', phone: null, access: 'staff',
              roleId: ROLE, bookable: true, status: 'active', color: 'clay',
              locationIds: [LOC2], skillServiceIds: [], hours: null, twofaEnabled: false, lastActive: null,
            },
          ],
        });
      if (path.includes('/roles') && method === 'PUT') return ok({ ok: true });
      if (path.endsWith('/roles') && method === 'POST')
        return ok({ id: '30000000-0000-4000-8000-000000000099' });
      if (path.includes('/roles'))
        return ok({
          roles: [
            {
              id: ROLE, name: 'Employee', std: true, locked: false,
              description: 'Their own day and the till.',
              perms: { 'appointments.view_own': 'own', 'pos.checkout': 'location' },
            },
            {
              id: ROLE2, name: 'Front desk', std: true, locked: false,
              description: 'The calendar and the till.',
              perms: { 'appointments.view_location': 'location' },
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
  // The nav now opens on General — walk to Locations first.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Locations' })).toBeDefined());
  await userEvent.click(screen.getByRole('button', { name: 'Locations' }));
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

  it('the Locations section carries all four stats and the central/local card', async () => {
    mockApi([]);
    await openSettings();
    // Customers and Catalog stats next to Locations and Users.
    expect(await screen.findByText('One profile across every location')).toBeDefined();
    expect(screen.getByText('42')).toBeDefined();
    expect(screen.getByText('What is central, what is local')).toBeDefined();
    expect(screen.getByText('Master catalog of services and products')).toBeDefined();
    expect(screen.getByText('Till, cash drawer and payment methods')).toBeDefined();
  });

  it('the row Settings button opens the location panel and saves through the PATCH door', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openSettings();
    // Scope to Centar's row — the sidebar tile is also named Settings.
    const row = (await screen.findByText(/Macedonia Street 21/)).closest('.rowcard') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Settings' }));
    const panel = await screen.findByRole('dialog');
    expect(panel.textContent).toContain('Location settings');
    expect(panel.textContent).toContain('Treatment rooms');
    // Suspend lives in the panel now, not on the table row.
    expect(within(panel).getByRole('button', { name: 'Suspend' })).toBeDefined();
    const nameInput = within(panel).getByLabelText(/Location name/);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Centar West');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === 'PATCH' &&
            c.path.includes(`/locations/${LOC1}`) &&
            (c.body as { name: string }).name === 'Centar West',
        ),
      ).toBe(true),
    );
  });

  it('Suspend in the panel goes through the transitions door', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openSettings();
    const row = (await screen.findByText(/Macedonia Street 21/)).closest('.rowcard') as HTMLElement;
    expect(within(row).queryByRole('button', { name: 'Suspend' })).toBeNull();
    await userEvent.click(within(row).getByRole('button', { name: 'Settings' }));
    const panel = await screen.findByRole('dialog');
    await userEvent.click(within(panel).getByRole('button', { name: 'Suspend' }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.path.includes(`/locations/${LOC1}/transitions`) &&
            (c.body as { to: string }).to === 'SUSPENDED',
        ),
      ).toBe(true),
    );
  });

  it('Copy setup posts the chosen parts through the copy-setup door', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openSettings();
    await userEvent.click(await screen.findByRole('button', { name: 'Copy setup' }));
    const panel = await screen.findByRole('dialog');
    expect(panel.textContent).toContain('What do you want to copy?');
    // Drop one part, keep the rest.
    await userEvent.click(within(panel).getByRole('button', { name: 'Online booking settings' }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Copy setup' }));
    await waitFor(() =>
      expect(
        calls.some((c) => {
          if (!c.path.includes(`/locations/${LOC1}/copy-setup`)) return false;
          const b = c.body as { toLocationId: string; parts: Record<string, boolean> };
          return b.toLocationId === LOC2 && b.parts.services === true && b.parts.widget === false;
        }),
      ).toBe(true),
    );
  });

  it('the Users table changes a role through the employee PATCH door', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Team & access' }));
    // The prototype's table: two-factor, status and last-active read out.
    const sel = await screen.findByLabelText('Role for Ana Dimitrova');
    expect(screen.queryByText('Invite sent')).toBeNull();
    expect(screen.getByText('Never')).toBeDefined();
    await userEvent.selectOptions(sel, ROLE2);
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === 'PATCH' && (c.body as { roleId: string }).roleId === ROLE2,
        ),
      ).toBe(true),
    );
  });

  it('the Users table Edit opens the full employee panel, not just locations', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Team & access' }));
    await screen.findByLabelText('Role for Ana Dimitrova');
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    // The prototype's employeeEdit panel: identity, colour, week, services.
    const panel = await screen.findByRole('dialog');
    expect(panel.textContent).toContain('Calendar colour');
    expect(panel.textContent).toContain('Available for appointments');
    expect(panel.textContent).toContain('Services this person provides');
    // Touch a field so the panel turns dirty, then save through the door.
    await userEvent.type(within(panel).getByLabelText(/^Name/), ' ');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === 'PATCH' &&
            c.path.includes('/employees/') &&
            (c.body as { name: string }).name === 'Ana Dimitrova',
        ),
      ).toBe(true),
    );
  });

  it('Preview access borrows the target session; the black bar exits it', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Team & access' }));
    await screen.findByLabelText('Role for Ana Dimitrova');
    await userEvent.click(screen.getByRole('button', { name: 'Preview access' }));
    // The prototype's previewbar: who, role, where, and the exit.
    expect(await screen.findByText('You are seeing exactly what they see')).toBeDefined();
    expect(
      calls.some(
        (c) =>
          c.path.endsWith('/auth/preview') &&
          (c.body as { employeeId: string }).employeeId ===
            '40000000-0000-4000-8000-000000000002',
      ),
    ).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Exit preview' }));
    await waitFor(() =>
      expect(screen.queryByText('You are seeing exactly what they see')).toBeNull(),
    );
  });

  it('edits a role through the permission matrix with legal scopes only', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Roles & permissions' }));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!);
    // The prototype's right-hand panel, not an inline card.
    const panel = await screen.findByRole('dialog');
    expect(panel.textContent).toContain('Standard role');
    expect(within(panel).getByLabelText(/Role name/)).toBeDefined();
    const sel = await screen.findByLabelText('appointments.view_own');
    // The scope ladder is constrained: own-agenda only offers none/own.
    expect([...sel.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'No access',
      'Own',
    ]);
    await userEvent.selectOptions(screen.getByLabelText('pos.discount'), 'business');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
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

  it('a new role starts as a panel copy of the chosen standard role', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Roles & permissions' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    const panel = await screen.findByRole('dialog');
    expect(panel.textContent).toContain('Create custom role');
    // No permissions before the role exists.
    expect(panel.textContent).toContain('The permissions appear once it exists');
    await userEvent.type(within(panel).getByLabelText(/Role name/), 'Front desk plus');
    await userEvent.click(screen.getByRole('button', { name: 'Create role' }));
    await waitFor(() =>
      expect(
        calls.some((c) => {
          if (c.method !== 'POST' || !c.path.endsWith('/roles')) return false;
          const b = c.body as { name: string; description: string; perms: Record<string, string> };
          return (
            b.name === 'Front desk plus' &&
            b.description === 'Custom role, based on Employee.' &&
            b.perms['appointments.view_own'] === 'own'
          );
        }),
      ).toBe(true),
    );
  });

  it('Duplicate clones a role, with its perms, through the POST door', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Roles & permissions' }));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Duplicate' }))[0]!);
    await waitFor(() =>
      expect(
        calls.some((c) => {
          if (c.method !== 'POST' || !c.path.endsWith('/roles')) return false;
          const b = c.body as { name: string; perms: Record<string, string> };
          return b.name === 'Employee (copy)' && b.perms['appointments.view_own'] === 'own';
        }),
      ).toBe(true),
    );
    // Both mocked roles are standard: Remove never shows for them.
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('the permission matrix writes one scope cell through the PUT door', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Roles & permissions' }));
    // The matrix shows the active group per role; a cell is one write.
    const cell = await screen.findByLabelText('Employee · appointments.create');
    await userEvent.selectOptions(cell, 'business');
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === 'PUT' &&
            c.path.includes(`/roles/${ROLE}`) &&
            (c.body as { perms: Record<string, string> }).perms['appointments.create'] ===
              'business',
        ),
      ).toBe(true),
    );
    // Another group's permissions arrive by tab.
    await userEvent.click(screen.getByRole('button', { name: 'Customers' }));
    expect(await screen.findByText('Export customer data')).toBeDefined();
  });

  it('renders the audit log', async () => {
    mockApi([]);
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Audit log' }));
    expect(await screen.findByText('Price changed')).toBeDefined();
    expect(screen.getByText('1500 ден → 1600 ден')).toBeDefined();
    // Reached through the nav, the log carries no back button.
    expect(screen.queryByRole('button', { name: /Back to Team & access/ })).toBeNull();
  });

  it('the full log opened from Team & access carries a way back', async () => {
    mockApi([]);
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Team & access' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open the full log' }));
    expect(await screen.findByText('Price changed')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: /Back to Team & access/ }));
    // Back on the Users table.
    expect(await screen.findByLabelText('Role for Ana Dimitrova')).toBeDefined();
  });
});
