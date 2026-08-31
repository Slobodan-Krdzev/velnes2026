import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.js';
import { setAccessToken } from '@velnes/client';

const LOC = '20000000-0000-4000-8000-000000000001';
const SVC = '60000000-0000-4000-8000-000000000003';
const EMP = '40000000-0000-4000-8000-000000000001';
const CUST = '30000000-0000-4000-8000-000000000001';
const today = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

const me = {
  id: EMP,
  name: 'Maria Petrovska',
  access: 'owner',
  roleId: '30000000-0000-4000-8000-000000000001',
  locationIds: [LOC],
  email: 'maria@velnes.mk',
  tenantId: '10000000-0000-4000-8000-000000000001',
  lang: 'en',
  perms: { 'appointments.view_own': 'own', 'appointments.create': 'business' },
};

const appointment = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  locationId: LOC,
  date: today,
  start: '10:00',
  end: '10:45',
  kind: 'appointment',
  status: 'confirmed',
  title: 'Katerina Stojanovska',
  serviceId: SVC,
  serviceName: 'Follow-up session',
  serviceCategory: 'Manual therapy',
  variantId: null,
  variantLabel: null,
  modifierNames: [],
  employeeId: EMP,
  anyEmp: false,
  customerId: null,
  price: 1200,
  durationMin: 45,
  prepMin: 0,
  resetMin: 10,
  basis: 'catalog',
  source: 'staff',
};

function mockApi(opts: { bookResponse?: () => Response } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (path.endsWith('/auth/me') && init?.method === 'PATCH') {
        const { lang } = JSON.parse(String(init.body)) as { lang: string };
        return ok({ ...me, lang });
      }
      if (path.endsWith('/auth/me')) return ok(me);
      if (path.includes('/auth/login'))
        return ok({ accessToken: 'at', refreshToken: 'rt', employee: me });
      if (path.includes('/locations') && path.endsWith('/catalog'))
        return ok({
          services: [
            {
              id: SVC,
              name: 'Follow-up session',
              category: 'Manual therapy',
              durationMin: 30,
              price: 1200,
              vat: 18,
              status: 'active',
              pos: true,
              online: true,
              prepMin: null,
              resetMin: null,
              config: { active: true, price: 1200, durationMin: 30, online: true, pos: true },
              variants: [],
              modifiers: [],
            },
          ],
          products: [],
        });
      if (path.includes('/schedule?'))
        return ok({ open: true, periods: [['09:00', '19:00']], source: 'regular', reason: null });
      if (path.includes('/locations'))
        return ok({
          locations: [
            {
              id: LOC,
              name: 'Centar',
              city: 'Skopje',
              address: 'x',
              tz: 'Europe/Skopje',
              phone: null,
              rooms: 3,
              invPrefix: 'CEN-',
              online: true,
              cancelHours: 24,
              opened: null,
              lifecycle: 'ACTIVE',
              hours: null,
            },
          ],
        });
      if (path.includes('/employees'))
        return ok({
          employees: [
            {
              id: EMP,
              name: 'Maria Petrovska',
              roleTitle: 'Physio',
              email: 'maria@velnes.mk',
              phone: null,
              access: 'owner',
              roleId: null,
              bookable: true,
              status: 'active',
              color: 'olive',
              locationIds: [LOC],
              skillServiceIds: [SVC],
              hours: null,
            },
          ],
        });
      if (path.includes('/appointments?')) return ok({ appointments: [appointment] });
      if (path.includes('/availability'))
        return ok({ slots: [{ t: '09:00', emp: EMP, free: true }, { t: '09:30', emp: EMP, free: true }] });
      if (path.endsWith('/catalog/line-quote'))
        return ok({
          vid: null,
          label: null,
          price: 1200,
          treatmentMin: 30,
          prepMin: 0,
          resetMin: 10,
          operationalMin: 40,
          basis: 'catalog',
          modNames: [],
          missingRequired: [],
        });
      if (path.includes('/customers'))
        return ok({
          customers: [
            {
              id: CUST, name: 'Katerina Stojanovska', email: null, phone: null, group: 'VIP',
              visits: 10, spend: 40000, points: 320, blacklisted: false, noShows: 0,
            },
          ],
        });
      if (path.endsWith('/appointments') && init?.method === 'POST')
        return opts.bookResponse
          ? opts.bookResponse()
          : ok({ appointment: { ...appointment, id: 'aaaaaaaa-0000-4000-8000-000000000002' } });
      return new Response('{}', { status: 404 });
    }),
  );
}

async function openCalendar() {
  window.history.pushState({}, '', '/calendar');
  localStorage.setItem('velnes.refresh', 'rt');
  render(<App />);
  await waitFor(() => expect(screen.getByTitle(/Katerina/)).toBeDefined());
}

describe('calendar', () => {
  beforeEach(() => {
    localStorage.clear();
    setAccessToken(null);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the day grid with the seeded appointment', async () => {
    mockApi();
    await openCalendar();
    const event = screen.getByTitle(/Katerina/);
    expect(event.className).toContain('ev-manual');
    // A 45-minute block only carries the head row, like the prototype.
    expect(within(event).getByText('Follow-up session')).toBeDefined();
  });

  it('books through the drawer: service → slot → book', async () => {
    mockApi();
    await openCalendar();
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    // The prototype's lade: the Book button sits top-right, disabled
    // until something changes; the line carries its own time input.
    const bookBtn = await screen.findByRole('button', { name: 'Book appointment' });
    expect(bookBtn).toHaveProperty('disabled', true);
    // The customer defaults to the first one, like the prototype; any
    // change arms the save group.
    await waitFor(() =>
      expect(screen.getByLabelText(/Customer/)).toHaveProperty('value', CUST),
    );
    await userEvent.selectOptions(screen.getByLabelText('Employee 1'), 'any');
    expect(screen.getByLabelText('Time 1')).toHaveProperty('value', '09:00');
    // The foot total answers once the line quote lands (the service
    // option also says "30 min", hence the count).
    expect(screen.getByText('Total')).toBeDefined();
    await waitFor(() => expect(screen.getAllByText(/30 min/).length).toBeGreaterThan(1));
    expect(bookBtn).toHaveProperty('disabled', false);
    await userEvent.click(bookBtn);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Book appointment' })).toBeNull(),
    );
  });

  it('renders a structured refusal localized — in Macedonian', async () => {
    mockApi({
      bookResponse: () =>
        new Response(
          JSON.stringify({
            error: 'REFUSED',
            message: 'Maria is already booked 10:00–10:45',
            code: 'EMP_BUSY',
            params: { name: 'Марија', from: '10:00', to: '10:45' },
          }),
          { status: 409 },
        ),
    });
    await openCalendar();
    // Flip the chrome to Macedonian first (avatar menu).
    await userEvent.click(screen.getByTitle('Maria Petrovska'));
    await userEvent.click(screen.getByRole('button', { name: 'Македонски' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Додади' })).toBeDefined(),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Додади' }));
    await userEvent.selectOptions(await screen.findByLabelText('Вработен 1'), 'any');
    await userEvent.click(screen.getByRole('button', { name: 'Закажи термин' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Марија е веќе зафатен(а) 10:00–10:45');
  });
});
