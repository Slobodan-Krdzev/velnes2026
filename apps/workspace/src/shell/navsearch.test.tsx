import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '@velnes/client';
import type { PermKey } from '@velnes/contracts';
import { createI18n } from '@velnes/i18n';
import { search } from '@velnes/navsearch';
import { App } from '../App.js';
import { WORKSPACE_INDEX, WORKSPACE_NAV, type WsCtx } from './navsearch.js';

/**
 * The workspace's navigation search (Alex, 2026-09-30): the registry
 * answers intent in four spellings, hides what the viewer may not open,
 * and the dialog behind the top-bar icon does it with the keyboard.
 */
const all: WsCtx = { can: () => true, locations: [{ id: 'L1' }] };
const top = (q: string, ctx: WsCtx = all) => search(WORKSPACE_INDEX, q, ctx)[0]?.entry.id;
const ids = (q: string, ctx: WsCtx = all) => search(WORKSPACE_INDEX, q, ctx).map((r) => r.entry.id);

describe('the workspace registry', () => {
  it('names every destination once, with a title in three languages', () => {
    const en = createI18n('en');
    const mk = createI18n('mk');
    const sq = createI18n('sq');
    for (const e of WORKSPACE_NAV) {
      for (const k of [e.title, ...e.crumbs]) {
        expect(en.t(k), k).not.toBe(k);
        expect(mk.t(k), k).not.toBe(k);
        expect(sq.t(k), k).not.toBe(k);
      }
    }
  });

  it.each([
    ['amenities', 'ws.settings.amenities'], ['promeni pogodnosti', 'ws.settings.amenities'], ['погодности', 'ws.settings.amenities'], ['wifi', 'ws.settings.amenities'], ['parking', 'ws.settings.amenities'], ['lehtësirat', 'ws.settings.amenities'], ['Free Wi-Fi', 'ws.settings.amenities'],
    ['working hours', 'ws.settings.hours'], ['работно време', 'ws.settings.hours'], ['rabotno vreme', 'ws.settings.hours'], ['orari i punës', 'ws.settings.hours'], ['change opening hours', 'ws.settings.hours'],
    ['holidays', 'ws.settings.exceptions'], ['празници', 'ws.settings.exceptions'], ['praznici', 'ws.settings.exceptions'], ['festat', 'ws.settings.exceptions'],
    ['employees', 'ws.settings.team'], ['вработени', 'ws.settings.team'], ['vraboteni', 'ws.settings.team'], ['punonjësit', 'ws.settings.team'],
    ['add worker', 'ws.settings.invite'], ['dodadi vraboten', 'ws.settings.invite'], ['shto punonjës', 'ws.settings.invite'],
    ['services', 'ws.catalog.services'], ['услуги', 'ws.catalog.services'], ['uslugi', 'ws.catalog.services'], ['shërbimet', 'ws.catalog.services'], ['treatments', 'ws.catalog.services'],
    ['gallery', 'ws.settings.gallery'], ['salon photos', 'ws.settings.gallery'], ['галерија', 'ws.settings.gallery'], ['sliki', 'ws.settings.gallery'], ['fotot e sallonit', 'ws.settings.gallery'],
    ['cancellation policy', 'ws.settings.cancel'], ['откажување', 'ws.settings.cancel'], ['otkazuvanje', 'ws.settings.cancel'], ['anulimi', 'ws.settings.cancel'],
    ['instagram', 'ws.settings.socials'], ['social media', 'ws.settings.socials'], ['социјални мрежи', 'ws.settings.socials'],
    ['phone number', 'ws.settings.company'], ['salon address', 'ws.settings.company'], ['телефонски број', 'ws.settings.company'],
    ['accept cards', 'ws.settings.sales'], ['плаќања', 'ws.settings.sales'], ['plakanja', 'ws.settings.sales'], ['pagesat', 'ws.settings.sales'],
    ['bookings', 'ws.calendar'], ['календар', 'ws.calendar'], ['kalendari', 'ws.calendar'],
    ['discount codes', 'ws.marketing.discounts'], ['kodovi za popust', 'ws.marketing.discounts'],
    ['invoices', 'ws.invoices'], ['фактури', 'ws.invoices'],
  ])('%s → %s', (q, id) => {
    expect(top(q)).toBe(id);
  });

  it('ranks the specific over the broad', () => {
    expect(ids('location')[0]).toBe('ws.settings.locations');
    expect(ids('amenities')).not.toContain('ws.settings');
    expect(ids('change working hours')[0]).toBe('ws.settings.hours');
  });

  it('tolerates typos', () => {
    expect(top('amenites')).toBe('ws.settings.amenities');
    expect(top('pogodnsti')).toBe('ws.settings.amenities');
    expect(top('rabtno vreme')).toBe('ws.settings.hours');
    expect(top('employes')).toBe('ws.settings.team');
  });

  it('hides what the viewer cannot open, however they ask', () => {
    const staff: WsCtx = { can: (k: PermKey) => k === 'appointments.view_own' || k === 'pos.checkout', locations: [{ id: 'L1' }] };
    for (const q of ['payments', 'sales', 'плаќања', 'plakanja', 'pagesat', 'Sales', 'accept cards']) expect(ids(q, staff)).not.toContain('ws.settings.sales');
    for (const q of ['amenities', 'погодности', 'employees', 'settings']) expect(ids(q, staff).some((id) => id.startsWith('ws.settings'))).toBe(false);
    expect(top('bookings', staff)).toBe('ws.calendar');
  });

  it('deep-links: one location goes straight to its panel, several go to the list', () => {
    const e = WORKSPACE_NAV.find((x) => x.id === 'ws.settings.amenities')!;
    const go = e.go as (c: WsCtx) => { path: string };
    expect(go(all).path).toBe('/settings?tab=locations&edit=L1&focus=amenities');
    expect(go({ ...all, locations: [{ id: 'L1' }, { id: 'L2' }] }).path).toBe('/settings?tab=locations&focus=amenities');
    const paths = WORKSPACE_NAV.map((x) => (typeof x.go === 'function' ? x.go(all) : x.go).path!);
    expect(paths.every((p) => p.startsWith('/'))).toBe(true);
    expect(paths.filter((p) => p === '/settings').length).toBe(1);
  });
});

// ── The dialog ────────────────────────────────────────────────────
const me = {
  id: '40000000-0000-4000-8000-000000000001',
  name: 'Maria Petrovska',
  access: 'owner',
  roleId: '30000000-0000-4000-8000-000000000001',
  locationIds: ['20000000-0000-4000-8000-000000000001'],
  email: 'maria@velnes.mk',
  tenantId: '10000000-0000-4000-8000-000000000001',
  lang: 'en',
  perms: {
    'appointments.view_own': 'own',
    'pos.checkout': 'business',
    'catalog.view': 'business',
    'customers.view_assigned': 'assigned',
    'reports.view_own': 'own',
    'users.manage': 'business',
    'locations.manage': 'business',
    'roles.manage': 'business',
  },
};

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (path.endsWith('/auth/login') && init?.method === 'POST') return ok({ accessToken: 'at', refreshToken: 'rt', employee: me });
      if (path.endsWith('/auth/me')) return ok(me);
      if (path.endsWith('/locations'))
        return ok({
          locations: [
            {
              id: '20000000-0000-4000-8000-000000000001', name: 'Centar', city: 'Skopje', address: 'Macedonia Street 21',
              tz: 'Europe/Skopje', phone: null, rooms: 3, invPrefix: 'CEN-', online: true,
              cancelHours: 24, opened: null, lifecycle: 'ACTIVE', hours: null,
            },
          ],
        });
      return new Response('{}', { status: 404 });
    }),
  );
}

async function signIn() {
  render(<App />);
  await userEvent.type(await screen.findByLabelText('Email'), 'maria@velnes.mk');
  await userEvent.type(screen.getByLabelText('Password'), 'velnes-demo');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(screen.getByTitle('Maria Petrovska')).toBeDefined());
  // The location list is what the one-location deep link reads.
  await screen.findByText('Centar');
}

describe('the search dialog in the shell', () => {
  beforeEach(() => {
    localStorage.clear();
    setAccessToken(null);
    window.history.pushState({}, '', '/login');
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('opens from the icon with the field focused, shows quick links, and Escape returns the focus', async () => {
    mockApi();
    await signIn();
    const btn = screen.getByRole('button', { name: 'Search' });
    await userEvent.click(btn);
    const dialog = await screen.findByRole('dialog', { name: 'Search Velnes' });
    const input = within(dialog).getByRole('combobox');
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(within(dialog).getByText('Quick links')).toBeDefined();
    expect(within(dialog).getAllByRole('option').length).toBeGreaterThan(2);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Search Velnes' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(btn));
  });

  it('types in Macedonian Latin, reads the result in English, and Enter navigates to the deep link', async () => {
    mockApi();
    await signIn();
    await userEvent.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Search Velnes' });
    await userEvent.type(within(dialog).getByRole('combobox'), 'promeni pogodnosti');
    const first = within(dialog).getAllByRole('option')[0]!;
    expect(within(first).getByText('Amenities')).toBeDefined();
    expect(within(first).getByText('Settings › Locations › Amenities')).toBeDefined();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/settings?tab=locations&edit=20000000-0000-4000-8000-000000000001&focus=amenities'));
    expect(screen.queryByRole('dialog', { name: 'Search Velnes' })).toBeNull();
  });

  it('arrow keys move the selection and a click on a result navigates', async () => {
    mockApi();
    await signIn();
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    const dialog = await screen.findByRole('dialog', { name: 'Search Velnes' });
    await userEvent.type(within(dialog).getByRole('combobox'), 'location');
    const options = within(dialog).getAllByRole('option');
    expect(options[0]!.getAttribute('aria-selected')).toBe('true');
    await userEvent.keyboard('{ArrowDown}');
    expect(within(dialog).getAllByRole('option')[1]!.getAttribute('aria-selected')).toBe('true');
    await userEvent.keyboard('{ArrowUp}');
    expect(within(dialog).getAllByRole('option')[0]!.getAttribute('aria-selected')).toBe('true');
    await userEvent.click(within(dialog).getAllByRole('option')[0]!);
    await waitFor(() => expect(window.location.search).toBe('?tab=locations'));
  });

  it('says so when nothing matches', async () => {
    mockApi();
    await signIn();
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    const dialog = await screen.findByRole('dialog', { name: 'Search Velnes' });
    await userEvent.type(within(dialog).getByRole('combobox'), 'qqqqzzzz');
    expect(within(dialog).getByText('No matching destination')).toBeDefined();
  });
});
