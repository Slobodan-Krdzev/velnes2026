import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';

const REG = 'd0000000-0000-4000-8000-000000000001';
const LOC = '20000000-0000-4000-8000-000000000009';
const BIZ = '10000000-0000-4000-8000-000000000001';

const me = { id: 'c0000000-0000-4000-8000-000000000002', name: 'Damjan Kostov', email: 'damjan@revelapps.com', role: 'hq_onboard' };

function mockApi(calls: { method: string; path: string; body?: unknown }[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      const method = init?.method ?? 'GET';
      if (method !== 'GET')
        calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (path.includes('/hq/auth/login'))
        return ok({ accessToken: 'hq-token', user: me });
      if (path.includes('/hq/me')) return ok(me);
      if (path.includes('/hq/registrations') && method === 'GET')
        return ok({
          registrations: [
            {
              id: REG, ts: '2026-08-26T09:00:00.000Z', status: 'pending_review',
              salonName: 'Studio Nova', salonType: 'Physiotherapy',
              ownerName: 'Petra Novak', ownerEmail: 'petra@studionova.mk', city: 'Bitola',
              legalName: 'Nova Health DOO', taxId: 'MK4032011501234',
              emailVerifiedAt: null, hqReason: null, businessId: null,
            },
          ],
        });
      if (path.includes('/approve'))
        return ok({ businessId: BIZ, locationId: LOC, ownerEmail: 'petra@studionova.mk' });
      if (path.includes(`/hq/locations/${LOC}/decision`))
        return ok({ id: LOC, lifecycle: 'APPROVED' });
      if (path.includes(`/hq/locations/${LOC}`))
        return ok({
          id: LOC, name: 'Debar Maalo', businessName: 'Velnes Fizio Centar',
          address: 'Orce Nikolov 55', city: 'Skopje', country: 'North Macedonia',
          phone: null, tz: 'Europe/Skopje', invPrefix: 'DEB-', lifecycle: 'SUBMITTED',
          legal: { id: 'e0000000-0000-4000-8000-000000000001', name: 'Debar Maalo Fizio DOOEL', taxId: 'MK408', status: 'pending' },
          paymentAccount: null, compound: true,
          log: [{ from: 'DRAFT', to: 'SUBMITTED', reason: null }],
        });
      if (path.includes('/hq/locations'))
        return ok({
          locations: [
            {
              id: LOC, name: 'Debar Maalo', businessId: BIZ, businessName: 'Velnes Fizio Centar',
              city: 'Skopje', lifecycle: 'SUBMITTED',
              legalName: 'Debar Maalo Fizio DOOEL', legalStatus: 'pending',
            },
          ],
        });
      if (path.includes('/hq/businesses'))
        return ok({
          businesses: [
            {
              id: BIZ, name: 'Velnes Fizio Centar', slug: 'velnes-fizio',
              ownerName: 'Maria Petrovska', ownerEmail: 'maria@velnes.mk',
              locations: 2, liveLocations: 2, employees: 5,
            },
          ],
        });
      if (path.includes('/hq/audit'))
        return ok({
          entries: [
            {
              id: 'f0000000-0000-4000-8000-000000000001', ts: '2026-08-26T10:00:00.000Z',
              actorName: 'HQ · Damjan Kostov', roleName: '', businessName: '', locationName: '—',
              action: 'Location lifecycle', object: 'Location · Debar Maalo',
              before: 'SUBMITTED', after: 'APPROVED', source: 'Web', reason: null,
              tenantName: 'Velnes Fizio Centar',
            },
          ],
        });
      return new Response('{}', { status: 404 });
    }),
  );
}

async function signIn() {
  render(<App />);
  await userEvent.type(screen.getByLabelText('Email'), 'damjan@revelapps.com');
  await userEvent.type(screen.getByLabelText('Password'), 'velnes-demo');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByText('New registrations');
}

describe('Revelapps HQ', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('signs in and shows the intake table: registrations, new locations, businesses', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await signIn();
    expect(screen.getByText('Studio Nova')).toBeDefined();
    expect(screen.getByText('Awaiting SMTP')).toBeDefined();
    expect(screen.getAllByText('Debar Maalo').length).toBeGreaterThan(0);
    expect(screen.getByText('new — compound')).toBeDefined();
    expect(screen.getByText('velnes.mk/book/velnes-fizio')).toBeDefined();
  });

  it('approves a registration through the door', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await signIn();
    await userEvent.click(screen.getByRole('button', { name: 'Verify & activate' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path.includes(`/hq/registrations/${REG}/approve`))).toBe(true),
    );
  });

  it('opens the compound location review and approves location + entity', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await signIn();
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    await screen.findByText(/Compound review/);
    await userEvent.click(screen.getByRole('button', { name: 'Approve location + entity' }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.path.includes(`/hq/locations/${LOC}/decision`) &&
            (c.body as { action: string }).action === 'approve',
        ),
      ).toBe(true),
    );
  });

  it('request changes without a reason never reaches the API', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await signIn();
    await userEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Send back' }));
    expect(
      calls.some((c) => c.path.includes('request-changes')),
    ).toBe(false);
    expect(await screen.findByText(/needs a reason/)).toBeDefined();
  });
});
