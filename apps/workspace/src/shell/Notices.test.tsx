import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.js';
import { setAccessToken } from '@velnes/client';

/**
 * Velnes news (Alex, 2026-10-01): a notice newer than the last look at
 * the bell is highlighted — green — until the bell is opened again.
 */
const LOC = '20000000-0000-4000-8000-000000000001';
const me = {
  id: '40000000-0000-4000-8000-000000000001', name: 'Maria Petrovska', access: 'owner', roleId: '30000000-0000-4000-8000-000000000001', locationIds: [LOC],
  email: 'maria@velnes.mk', tenantId: '10000000-0000-4000-8000-000000000001', lang: 'en', perms: {},
};
const notices = [
  { id: 'a0000000-0000-4000-8000-000000000002', kind: 'booking_request', title: 'New booking request from Velnes', body: 'Someone asked for a haircut.', refId: null, createdAt: '2026-10-01T12:00:00.000Z' },
  { id: 'a0000000-0000-4000-8000-000000000001', kind: 'booking_cancelled', title: 'Appointment cancelled', body: 'Someone cancelled.', refId: null, createdAt: '2026-09-30T09:00:00.000Z' },
];

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url).replace(/^.*\/api\/v1/, '');
      const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (path.endsWith('/auth/me')) return ok(me);
      if (path.startsWith('/locations'))
        return ok({ locations: [{ id: LOC, name: 'Centar', city: 'Skopje', address: 'x', tz: 'Europe/Skopje', phone: null, rooms: 3, invPrefix: 'CEN-', online: true, cancelHours: 24, opened: null, lifecycle: 'ACTIVE', hours: null }] });
      if (path.startsWith('/notices')) return ok({ notices });
      return new Response('{}', { status: 404 });
    }),
  );
}

describe('Velnes news', () => {
  beforeEach(() => {
    localStorage.clear();
    setAccessToken(null);
    localStorage.setItem('velnes.refresh', 'rt');
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('notices since the last look are green; opening the bell again clears them', async () => {
    // Last looked between the two notices.
    localStorage.setItem('velnes.noticesSeen', '2026-09-30T20:00:00.000Z');
    mockApi();
    window.history.pushState({}, '', '/calendar');
    render(<App />);
    const bell = await screen.findByRole('button', { name: 'Velnes news' });
    await waitFor(() => expect(bell.querySelector('.dot')).toBeTruthy());
    await userEvent.click(bell);
    const fresh = await screen.findByRole('button', { name: /New booking request from Velnes/ });
    const old = screen.getByRole('button', { name: /Appointment cancelled/ });
    expect(fresh.classList.contains('new')).toBe(true);
    expect(old.classList.contains('new')).toBe(false);
    // The look moved the marker; the next opening shows nothing as new.
    await userEvent.click(bell);
    await userEvent.click(bell);
    const again = await screen.findByRole('button', { name: /New booking request from Velnes/ });
    expect(again.classList.contains('new')).toBe(false);
    expect(bell.querySelector('.dot')).toBeNull();
  });
});
