import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { setAccessToken } from '@velnes/client';

const mariaMe = {
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
  },
};

const anaMe = {
  ...mariaMe,
  id: '40000000-0000-4000-8000-000000000002',
  name: 'Ana Dimitrova',
  access: 'staff',
  perms: {
    'appointments.view_own': 'own',
    'pos.checkout': 'location',
    'reports.view_own': 'own',
  },
};

function mockApi(me: object) {
  // Mutable, like the real server: PATCH persists the language.
  let current = { ...me } as { lang: string };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      const ok = (body: unknown) =>
        new Response(JSON.stringify(body), { status: 200 });
      if (path.endsWith('/auth/login') && init?.method === 'POST')
        return ok({ accessToken: 'at', refreshToken: 'rt', employee: current });
      if (path.endsWith('/auth/me') && init?.method === 'PATCH') {
        const { lang } = JSON.parse(String(init.body)) as { lang: string };
        current = { ...current, lang };
        return ok(current);
      }
      if (path.endsWith('/auth/me')) return ok(current);
      if (path.endsWith('/auth/logout')) return ok({});
      return new Response('{}', { status: 404 });
    }),
  );
}

describe('workspace shell', () => {
  beforeEach(() => {
    localStorage.clear();
    setAccessToken(null);
    window.history.pushState({}, '', '/login');
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('logs in and shows the permission-gated navigation', async () => {
    mockApi(mariaMe);
    render(<App />);
    await userEvent.type(await screen.findByLabelText('Email'), 'maria@velnes.mk');
    await userEvent.type(screen.getByLabelText('Password'), 'velnes-demo');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByTitle('Maria Petrovska')).toBeDefined());
    expect(screen.getByLabelText('Settings')).toBeDefined(); // owner sees it
    expect(screen.getByLabelText('Cash register')).toBeDefined();
  });

  it('hides areas the role does not allow', async () => {
    mockApi(anaMe);
    render(<App />);
    await userEvent.type(await screen.findByLabelText('Email'), 'ana@velnes.mk');
    await userEvent.type(screen.getByLabelText('Password'), 'velnes-demo');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByTitle('Ana Dimitrova')).toBeDefined());
    expect(screen.queryByLabelText('Settings')).toBeNull();
    expect(screen.queryByLabelText('Catalog')).toBeNull();
    expect(screen.getByLabelText('Calendar')).toBeDefined();
  });

  it('switches the whole chrome to Macedonian and Albanian', async () => {
    mockApi(mariaMe);
    render(<App />);
    await userEvent.type(await screen.findByLabelText('Email'), 'maria@velnes.mk');
    await userEvent.type(screen.getByLabelText('Password'), 'velnes-demo');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByLabelText('Calendar')).toBeDefined());

    // Language lives in the avatar (environment) menu, prototype-style.
    await userEvent.click(screen.getByTitle('Maria Petrovska'));
    await userEvent.click(screen.getByRole('button', { name: 'Македонски' }));
    await waitFor(() => expect(screen.getByLabelText('Календар')).toBeDefined());
    expect(screen.getByLabelText('Каса')).toBeDefined();

    await userEvent.click(screen.getByTitle('Maria Petrovska'));
    await userEvent.click(screen.getByRole('button', { name: 'Shqip' }));
    await waitFor(() => expect(screen.getByLabelText('Kalendari')).toBeDefined());
    expect(screen.getByLabelText('Arka')).toBeDefined();
  });

  it('shows the login error for wrong credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'INVALID_CREDENTIALS' }), { status: 401 }),
      ),
    );
    render(<App />);
    await userEvent.type(await screen.findByLabelText('Email'), 'maria@velnes.mk');
    await userEvent.type(screen.getByLabelText('Password'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('That email and password do not match');
  });
});
