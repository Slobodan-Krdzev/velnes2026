import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, queryClient } from '../App.js';
import { setAccessToken } from '@velnes/client';

const importResult = {
  source: 'https://skopjephysio.mk/',
  found: ['name', 'address', 'services', 'opening hours'],
  salon: { name: 'Skopje Physio', phone: '+389 2 123 456' },
  legal: { name: 'Skopje Physio DOOEL' },
  loc: { street: 'Bul. Partizanski 12', city: 'Skopje', zip: '1000' },
  serviceNames: ['Physiotherapy session'],
  hours: [{ day: 'mon', open: '09:00', close: '19:00', closed: false }],
};

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes('/registrations/import'))
        return new Response(JSON.stringify(importResult), { status: 200 });
      return new Response('{}', { status: 404 });
    }),
  );
}

async function openOnboarding() {
  window.history.pushState({}, '', '/onboarding');
  render(<App />);
  await screen.findByText(/A head start/);
}

describe('AI-onboarding', () => {
  beforeEach(() => {
    localStorage.clear();
    queryClient.clear();
    setAccessToken(null);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('reads a website, shows what it found, and hands a filled draft to registration', async () => {
    mockApi();
    await openOnboarding();

    await userEvent.type(screen.getByPlaceholderText('yoursalon.mk'), 'skopjephysio.mk');
    await userEvent.click(screen.getByRole('button', { name: 'Read my website' }));

    // Ready stage: it read the salon and its treatments and hours.
    expect(await screen.findByText(/We read/)).toBeDefined();
    expect(screen.getByText('Skopje Physio')).toBeDefined();
    expect(screen.getByText('Business details')).toBeDefined();
    expect(screen.getByText('1 treatments')).toBeDefined();

    // Continue carries the draft into the registration wizard.
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(await screen.findByText('Create your salon')).toBeDefined();

    // Fill the account step (not scrapable) and advance to Salon.
    await userEvent.type(screen.getByLabelText('Your name'), 'Ana Owner');
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@skopjephysio.mk');
    await userEvent.type(screen.getByLabelText('Password'), 'sixchars');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    // The salon name arrived pre-filled from the import.
    await waitFor(() => expect(screen.getByDisplayValue('Skopje Physio')).toBeDefined());
  });
});
