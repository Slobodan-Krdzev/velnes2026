import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, qc } from '../../App.js';

/** The profile photo (Alex, 2026-10-01): in the account's General
 *  section with Change and Remove, and on the first sign-up step. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
let profile: Record<string, unknown> = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', email: 'ana@example.com', emailVerified: true, first: 'Ana', last: 'D', phone: null, dob: null,
  lang: 'en', avatar: PNG, since: '2026-09-01', personalisedResults: true, locationAllowed: null, loyaltyPoints: 0,
};
const patched: unknown[] = [];

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.endsWith('/client/me') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        patched.push(body);
        profile = { ...profile, ...body };
        return ok(profile);
      }
      if (url.includes('/client/me/appointments')) return ok({ appointments: [] });
      if (url.includes('/client/me/notifications')) return ok({ notifications: [], unread: 0 });
      if (url.includes('/client/me/offers')) return ok({ offers: [] });
      if (url.includes('/client/me/salons')) return ok({ salons: [] });
      if (url.includes('/client/me/favourites')) return ok({ salons: [], services: [], pros: [] });
      if (url.includes('/client/me/loyalty')) return ok({ balance: 0, rules: { version: 1, registration: 100, firstService: 100, additionalService: 30, productUnit: 20, review: 50 }, entries: [] });
      if (url.includes('/client/me')) return ok(profile);
      return ok({ categories: [], salons: [], services: [], towns: [], suggestions: [], how: 'default' });
    }),
  );
}

describe('the profile photo', () => {
  beforeEach(() => {
    patched.length = 0;
    mockApi();
  });
  afterEach(() => {
    cleanup();
    qc.clear();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('the account shows the photo with Change and Remove; removing saves at once', async () => {
    localStorage.setItem('velnes.client.token', 'tok');
    window.history.replaceState({}, '', '/account/general');
    render(<App />);
    const picker = await screen.findByTestId('avatar-picker');
    expect(within(picker).getByRole('button', { name: 'Change photo' })).toBeDefined();
    fireEvent.click(within(picker).getByRole('button', { name: 'Remove photo' }));
    await waitFor(() => expect(patched).toEqual([{ avatar: null }]));
    expect(await within(picker).findByRole('button', { name: 'Add photo' })).toBeDefined();
    expect(within(picker).getByLabelText('Profile photo')).toHaveProperty('accept', 'image/*');
  });

  it('sign-up offers the photo on the first step, optional', async () => {
    window.history.replaceState({}, '', '/register');
    render(<App />);
    const picker = await screen.findByTestId('avatar-picker');
    expect(within(picker).getByRole('button', { name: 'Add photo' })).toBeDefined();
    expect(screen.getByText(/Optional — salons see it next to your name/)).toBeDefined();
  });
});
