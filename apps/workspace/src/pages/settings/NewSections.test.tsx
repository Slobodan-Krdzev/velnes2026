import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.js';
import { setAccessToken } from '@velnes/client';

/** The eight settings sections added for prototype parity — each one
 *  drives its real door: /business, /business-settings, the location
 *  PATCH, the employee PATCH and the exceptions/holidays endpoints. */

const LOC = '20000000-0000-4000-8000-000000000001';
const EMP = '40000000-0000-4000-8000-000000000002';
const SVC = '60000000-0000-4000-8000-000000000001';

const me = {
  id: '40000000-0000-4000-8000-000000000001',
  name: 'Maria Petrovska',
  access: 'owner',
  roleId: '30000000-0000-4000-8000-000000000001',
  locationIds: [LOC],
  email: 'maria@velnes.mk',
  tenantId: '10000000-0000-4000-8000-000000000001',
  lang: 'en',
  perms: {
    'locations.manage': 'business',
    'users.manage': 'business',
    'roles.manage': 'business',
    'ranking.manage': 'business',
    'widget.manage': 'business',
    'customers.view_business': 'business',
    'payments.manage': 'business',
  },
};

const business = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Velnes Fizio Centar',
  country: 'North Macedonia',
  vat: 'MK4080012345678',
  slug: 'velnes-fizio',
  address: 'Partizanski Odredi 14',
  city: 'Skopje',
  phone: '+389 2 3112 940',
  description: 'Physiotherapy in Skopje.',
  gallery: [{ id: 'g1', name: 'Front desk', img: null, tone: '#6f7357' }],
  timingEnabled: true,
  legal: {
    name: 'Velnes Studio DOOEL Skopje',
    taxId: 'MK4080012345678',
    status: 'verified',
    merchantId: 'MCH-2201',
    provider: 'Halkbank',
    accountStatus: 'active',
  },
};

const settingsDoc = {
  ranking: { criteria: ['rank_reviews', 'rank_upsellcount'] },
  customers: {
    groups: [
      { name: 'New', discountPct: 0 },
      { name: 'VIP', discountPct: 10 },
    ],
    forms: { consult: true, intake: false },
  },
  sales: { defaultVat: 18, autoReceipt: true, allowDiscounts: true, roundCash: false },
  marketplace: {
    listed: true, pitch: 'Physio in the centre', description: '', categories: ['Physiotherapy'],
    showPrices: true, showTeam: true, showReviews: true, autoConfirm: true,
    depositNew: false, depositPct: 10, minLead: '2 hours', cancelUntil: '24 hours before',
  },
};

const hours = {
  '0': [['09:00', '19:00']], '1': [['09:00', '19:00']], '2': [['09:00', '19:00']],
  '3': [['09:00', '19:00']], '4': [['09:00', '19:00']], '5': [['09:00', '15:00']],
  '6': null,
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
      if (path.includes('/business-settings')) {
        if (method === 'PATCH') {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return ok({ ...settingsDoc, ...body });
        }
        return ok(settingsDoc);
      }
      if (path.endsWith('/business') || (path.includes('/business') && method === 'PATCH'))
        return ok(business);
      if (path.includes('/timings/suggestions')) return ok({ suggestions: [] });
      if (path.includes('/exceptions')) return ok({ exceptions: [] });
      if (path.includes('/holidays'))
        return ok({
          years: [{ year: 2026, verified: true, source: 'Official gazette' }],
          holidays: [
            {
              id: 'mk-2026-10-11', date: '2026-10-11', name: 'Revolution Day',
              type: 'NATIONAL', applies: 'Everyone', movedFrom: null, state: 'open',
            },
          ],
        });
      if (path.includes('/locations') && path.includes('/catalog'))
        return ok({
          services: [
            {
              id: SVC, name: 'Rehab training', category: 'Rehab', durationMin: 45,
              price: 1500, vat: 18, status: 'active', pos: true, online: true,
              prepMin: 0, resetMin: 10,
              config: { active: true, price: 1500, durationMin: 45, online: true, pos: true },
              variants: [], modifiers: [],
            },
          ],
          products: [],
        });
      if (path.includes(`/locations/${LOC}`) && method === 'PATCH')
        return ok({
          id: LOC, name: 'Centar', city: 'Skopje', address: 'Macedonia Street 21',
          tz: 'Europe/Skopje', phone: null, rooms: 3, invPrefix: 'CEN-', online: true,
          cancelHours: 48, opened: null, lifecycle: 'ACTIVE', hours,
        });
      if (path.includes('/locations') && method === 'GET')
        return ok({
          locations: [
            {
              id: LOC, name: 'Centar', city: 'Skopje', address: 'Macedonia Street 21',
              tz: 'Europe/Skopje', phone: null, rooms: 3, invPrefix: 'CEN-', online: true,
              cancelHours: 24, opened: null, lifecycle: 'ACTIVE', hours,
            },
          ],
        });
      if (path.includes(`/employees/${EMP}`) && method === 'PATCH') {
        return ok({
          id: EMP, name: 'Ana Dimitrova', roleTitle: 'Senior rehab coach',
          email: 'ana@velnes.mk', phone: null, access: 'staff', roleId: null, bookable: true,
          status: 'active', color: 'clay', locationIds: [LOC], skillServiceIds: [SVC],
          hours, twofaEnabled: false, lastActive: null,
        });
      }
      if (path.includes('/employees'))
        return ok({
          employees: [
            {
              id: EMP, name: 'Ana Dimitrova', roleTitle: 'Rehab coach', email: 'ana@velnes.mk',
              phone: null, access: 'staff', roleId: null, bookable: true, status: 'active',
              color: 'clay', locationIds: [LOC], skillServiceIds: [],
              hours: { ...hours, '0': null }, twofaEnabled: false, lastActive: null,
            },
          ],
        });
      if (path.includes('/roles')) return ok({ roles: [] });
      if (path.includes('/audit'))
        return ok({
          entries: [
            {
              id: '90000000-0000-4000-8000-000000000001', ts: '2026-08-05T09:14:00.000Z',
              actorName: 'Maria Petrovska', roleName: 'Owner', businessName: 'Velnes',
              locationName: '—', action: 'Changed the price of Rehab training',
              object: 'Service · Rehab training', before: '', after: '', source: 'Web', reason: '',
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
  await waitFor(() => expect(screen.getByRole('button', { name: 'General' })).toBeDefined());
}

describe('settings — the eight parity sections', () => {
  beforeEach(() => {
    localStorage.clear();
    setAccessToken(null);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('General: real language choice, the accounts pointer and the activity log', async () => {
    mockApi([]);
    await openSettings();
    expect(screen.getByLabelText('Language')).toBeDefined();
    await screen.findByText('Changed the price of Rehab training');
    // The pointer card jumps to Schedules & services.
    await userEvent.click(screen.getByRole('button', { name: 'Open Employees' }));
    await screen.findByText('What each access level may do');
  });

  it('Company: edits the card through PATCH /business and shows the HQ legal block read-only', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Company' }));
    await screen.findByText('Velnes Studio DOOEL Skopje');
    expect(screen.getByText('Managed by Revelapps HQ', { exact: false })).toBeDefined();
    const desc = screen.getByLabelText('Public description');
    await userEvent.clear(desc);
    await userEvent.type(desc, 'Updated.');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      const call = calls.find((c) => c.method === 'PATCH' && c.path.endsWith('/business'));
      expect((call?.body as { description: string }).description).toBe('Updated.');
    });
  });

  it('Ranking: toggles a criterion through the settings document, never below one', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Ranking settings' }));
    await screen.findByText('2 of 6 in use');
    await userEvent.click(screen.getByRole('button', { name: /Total turnover/ }));
    await waitFor(() => {
      const call = calls.find((c) => c.path.endsWith('/business-settings'));
      expect((call?.body as { ranking: { criteria: string[] } }).ranking.criteria).toEqual([
        'rank_reviews',
        'rank_upsellcount',
        'rank_turnover',
      ]);
    });
  });

  it('Opening hours: saves the week and the cancellation window through the location door', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Opening hours' }));
    await screen.findByText('Working hours · Centar');
    // Open Sunday, then save.
    await userEvent.click(screen.getByRole('switch', { name: 'Sun' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      const call = calls.find((c) => c.method === 'PATCH' && c.path.includes(`/locations/${LOC}`));
      const body = call?.body as { hours: Record<string, unknown>; cancelHours: number };
      expect(body.hours['6']).toEqual([['09:00', '19:00']]);
      expect(body.cancelHours).toBe(24);
    });
  });

  it('Opening hours: the exceptions tab shows the honest holiday card', async () => {
    mockApi([]);
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Opening hours' }));
    await screen.findByText('Working hours · Centar');
    await userEvent.click(screen.getByRole('button', { name: 'Exceptions' }));
    await screen.findByText('Velnes has not closed anything.');
    expect(screen.getByText('No schedule exceptions')).toBeDefined();
    // The review panel lists the open holiday with its applies-to line.
    await userEvent.click(screen.getByRole('button', { name: 'Review holidays' }));
    await screen.findByText(/Applies to: Everyone/);
  });

  it('Schedules & services: the team table summarizes availability and the panel saves through the employee door', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Schedules & services' }));
    await screen.findByText('What each access level may do');
    expect(screen.getByText('5 days · 09:00–19:00')).toBeDefined(); // Ana, Monday off
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await screen.findByText('Services this person provides');
    await userEvent.click(screen.getByRole('checkbox', { name: /Rehab training/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      const call = calls.find((c) => c.method === 'PATCH' && c.path.includes(`/employees/${EMP}`));
      const body = call?.body as { skillServiceIds: string[]; hours: Record<string, unknown> };
      expect(body.skillServiceIds).toEqual([SVC]);
      expect(body.hours['0']).toBeNull();
    });
  });

  it('Customers & Sales: groups and register toggles write their settings sections', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Customers' }));
    await screen.findByText('Customer groups');
    expect(screen.getByText('VIP')).toBeDefined();
    expect(screen.getByText('10%')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Sales' }));
    await screen.findByText('Default VAT rate');
    await userEvent.click(
      screen.getByRole('switch', { name: 'Round cash payments to the nearest 5 denars' }),
    );
    await waitFor(() => {
      const call = calls.find((c) => c.path.endsWith('/business-settings'));
      expect((call?.body as { sales: { roundCash: boolean } }).sales.roundCash).toBe(true);
    });
  });

  it('Marketplace: stores choices honestly marked as waiting for search & discovery', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Online marketplace' }));
    await screen.findByText('Your listing');
    expect(screen.getByText(/stored now and honored when/)).toBeDefined();
    expect(screen.getByLabelText(/Commission/)).toHaveProperty('disabled', true);
    await userEvent.click(screen.getByRole('switch', { name: 'Show prices' }));
    await waitFor(() => {
      const call = calls.find((c) => c.path.endsWith('/business-settings'));
      expect((call?.body as { marketplace: { showPrices: boolean } }).marketplace.showPrices).toBe(
        false,
      );
    });
  });
});
