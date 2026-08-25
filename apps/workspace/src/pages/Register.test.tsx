import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.js';

/** The classic registration wizard: eight steps, validated per step,
 *  one draft POSTed whole to the anonymous door. */

function mockApi(calls: { method: string; path: string; body?: unknown }[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      const method = init?.method ?? 'GET';
      if (method !== 'GET')
        calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (path.includes('/registrations') && method === 'POST')
        return new Response(
          JSON.stringify({
            id: 'd0000000-0000-4000-8000-000000000001',
            status: 'pending_review',
            resubmitToken: 'e0000000-0000-4000-8000-000000000001',
          }),
          { status: 200 },
        );
      return new Response('{}', { status: 404 });
    }),
  );
}

async function fill(label: string, value: string) {
  await userEvent.type(screen.getByLabelText(label), value);
}

describe('the salon registration wizard', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.pushState({}, '', '/register');
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('validates each step and refuses to advance with missing facts', async () => {
    mockApi([]);
    render(<App />);
    await screen.findByText('Create your salon');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Your name is missing')).toBeDefined();
  });

  it('walks all eight steps and posts the whole draft', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    render(<App />);
    await screen.findByText('Create your salon');

    await fill('Your name', 'Petra Novak');
    await fill('E-mail', 'petra@studionova.mk');
    await fill('Password', 'super-secret');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    await fill('Salon name', 'Studio Nova');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    await fill('Legal name', 'Nova Health DOO');
    await fill('Tax number', 'MK4032011501234');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    await fill('Street', 'Partizanska');
    await fill('City', 'Bitola');
    await userEvent.click(screen.getByTestId('regmap'));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    // Services — the platform's starter templates, grouped.
    await screen.findByText('Physiotherapy session');
    await userEvent.click(screen.getByText('Physiotherapy session'));
    await userEvent.click(screen.getByText('Sports massage'));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    // Gallery (optional) → Team & hours → Review.
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Invite your team');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    await screen.findByText('2 selected');
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }));

    await screen.findByText('Almost there');
    const sent = calls.find((c) => c.path.endsWith('/registrations'));
    expect(sent).toBeDefined();
    const draft = sent!.body as {
      acct: { email: string };
      services: string[];
      loc: { lat: number | null };
      hours: Record<string, { closed: boolean }>;
    };
    expect(draft.acct.email).toBe('petra@studionova.mk');
    expect(draft.services.sort()).toEqual(['physio-session', 'sports-massage']);
    expect(draft.loc.lat).not.toBeNull();
    expect(draft.hours.sun?.closed).toBe(true);
    // The applicant's key back in is kept client-side.
    expect(JSON.parse(localStorage.getItem('velnes.reg') ?? '{}').token).toBe(
      'e0000000-0000-4000-8000-000000000001',
    );
  });
});
