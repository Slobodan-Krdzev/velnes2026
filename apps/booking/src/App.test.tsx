import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';

/** The booking flow against a mocked public API — the same shapes the
 *  real doors serve, so the zod parse at the boundary stays honest. */

const LOC1 = '20000000-0000-4000-8000-000000000001';
const LOC2 = '20000000-0000-4000-8000-000000000002';
const SVC = '60000000-0000-4000-8000-000000000003';
const VAR = '61000000-0000-4000-8000-000000000031';
const EMP = '40000000-0000-4000-8000-000000000001';
const WIDGET = 'b0000000-0000-4000-8000-000000000001';

const widget = (lang: 'en' | 'mk' | 'sq' = 'en') => ({
  businessName: 'Velnes Fizio Centar',
  slug: 'velnes-fizio',
  widgetId: WIDGET,
  publishableKey: 'pk_live_velnes_demo',
  name: 'Website widget',
  lang,
  theme: 'light',
  accent: '#6f7357',
  radius: 'soft',
  startStep: 'location',
  deposit: 'none',
  cancelPolicy: 'inherit',
  locations: [
    { id: LOC1, name: 'Centar', city: 'Skopje', address: 'Makedonija 12' },
    { id: LOC2, name: 'Aerodrom', city: 'Skopje', address: 'Jane Sandanski 88' },
  ],
});

const services = {
  services: [
    {
      id: SVC,
      name: 'Relax massage',
      category: 'Massage',
      durationMin: 45,
      price: 1200,
      priceFrom: 900,
      variants: [
        { id: VAR, label: '30 min', durationMin: 30, price: 900, std: false },
        {
          id: '61000000-0000-4000-8000-000000000032',
          label: '45 min',
          durationMin: 45,
          price: 1200,
          std: true,
        },
      ],
      modifiers: [],
      employees: [{ id: EMP, name: 'Maria Petrova' }],
    },
  ],
};

const slots = {
  slots: [
    { t: '10:00', emp: EMP, free: true },
    { t: '10:15', emp: null, free: false },
  ],
};

function mockApi(overrides: Record<string, unknown> = {}) {
  const w = (overrides.widget as object) ?? widget();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      const reply = (body: unknown, status = 200) =>
        ({ ok: status < 400, status, json: async () => body }) as Response;
      if (u.includes('/booking-page/') || u.includes('/widget?')) return reply(w);
      if (u.includes('/services?')) return reply(services);
      if (u.includes('/availability?')) return reply(slots);
      if (u.includes('/holds'))
        return reply(
          (overrides.hold as object) ?? {
            holdId: 'c0000000-0000-4000-8000-000000000001',
            until: new Date(Date.now() + 600_000).toISOString(),
          },
          (overrides.holdStatus as number) ?? 200,
        );
      if (u.includes('/book'))
        return reply({
          ref: 'a1b2c3d4-0000-4000-8000-000000000009',
          date: '2026-09-02',
          time: '10:00',
          end: '10:30',
          serviceName: 'Relax massage',
          locationName: 'Centar',
          employeeName: 'Maria Petrova',
          price: 900,
        });
      throw new Error(`unmocked ${u} ${init?.method ?? 'GET'}`);
    }),
  );
}

describe('the booking page', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  it('walks the whole prototype flow: location → service → time → details → confirm → done', async () => {
    mockApi();
    window.history.pushState({}, '', '/book/velnes-fizio');
    const user = userEvent.setup();
    render(<App />);

    // Location step — both live locations offered, source line shown.
    await screen.findByText('Where would you like to come?');
    expect(screen.getByText('velnes.mk booking link')).toBeDefined();
    await user.click(screen.getByText('Centar'));

    // Service step — grouped by category, "from" price for variants.
    await screen.findByText('What can we do for you?');
    expect(screen.getByText(/from/)).toBeDefined();
    await user.click(screen.getByText('Relax massage'));

    // Time step — variants, professional chips, day rail, slots.
    await screen.findByText('Who and when?');
    expect(screen.getByText('Any professional')).toBeDefined();
    expect(screen.getByText('Maria')).toBeDefined();
    await user.click(screen.getByText('30 min · 900 ден.'));
    const slot = await screen.findByRole('button', { name: '10:00' });
    await user.click(slot);
    expect((screen.getByRole('button', { name: '10:15' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // Details step — the hold countdown is on screen now.
    await screen.findByText('Your details');
    expect(screen.getByText(/This time is held for you/)).toBeDefined();
    await user.type(screen.getByPlaceholderText('Marija Stojanovska'), 'Web Visitor');
    await user.type(screen.getByPlaceholderText('+389 70 000 000'), '+389 70 999 111');
    await user.click(screen.getByText(/cancellation policy/));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // Confirm step — the honest no-provider payment story.
    await screen.findByText('Confirm your booking');
    expect(screen.getByText('No payment up front. You settle everything in the salon.')).toBeDefined();
    expect(screen.getByText('Pay in the salon')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Book the appointment' }));

    // Done — the door's answer, not the client's arithmetic.
    await screen.findByText('Booked, Web');
    expect(screen.getByText('00000009'.toUpperCase().slice(-8))).toBeDefined();
    expect(
      screen.getAllByText(
        (_, el) => el?.classList.contains('v') === true && /10:00–10:30/.test(el?.textContent ?? ''),
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('Maria Petrova')).toBeDefined();
  });

  it('renders a refusal from the hold door as localized text, not a raw error', async () => {
    mockApi({
      holdStatus: 409,
      hold: {
        error: 'REFUSED',
        message: 'Nobody is free at 10:00 on 2026-09-02',
        code: 'NOBODY_FREE',
        params: { time: '10:00', date: '2026-09-02' },
      },
    });
    window.history.pushState({}, '', '/book/velnes-fizio');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Where would you like to come?');
    await user.click(screen.getByText('Centar'));
    await user.click(await screen.findByText('Relax massage'));
    await user.click(await screen.findByRole('button', { name: '10:00' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Nobody is free at 10:00 on 2026-09-02',
    );
  });

  it("speaks the widget's language — a Macedonian widget greets in Macedonian", async () => {
    mockApi({ widget: widget('mk') });
    window.history.pushState({}, '', '/book/velnes-fizio');
    render(<App />);
    await screen.findByText('Каде сакате да дојдете?');
  });
});
