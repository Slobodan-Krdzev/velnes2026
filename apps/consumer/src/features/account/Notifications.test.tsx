import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, qc } from '../../App.js';

/** Notifications (Alex, 2026-10-01): a tap opens the entry in place —
 *  the moment, the appointment it concerns — and a button leads on. */
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const profile = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', email: 'ana@example.com', emailVerified: true, first: 'Ana', last: 'D', phone: null, dob: null,
  lang: 'en', avatar: null, since: '2026-09-01', personalisedResults: true, locationAllowed: null, loyaltyPoints: 0,
};
const appointment = {
  id: ID, ref: 'AAAAAAAA', salonName: 'Slobos Cutz', salonSlug: 'slobos-cutz', locationName: 'Centar', locationAddress: 'x', lat: null, lng: null,
  serviceName: 'Children Haircut', employeeName: 'Slobodan', date: '2030-01-10', time: '14:00', end: '14:30', durationMin: 30, price: 500, status: 'booked', paid: false,
  cancelHours: 24, completed: false, canReview: false, review: null, serviceId: null, employeeId: null, locationId: null, variantId: null, modifierOptionIds: [],
  canReschedule: true, canCancel: true, cancelDeadline: null, cancelBlockedReason: null, changeRequest: null, cancellation: null,
  payment: { status: 'unpaid', method: null, amount: null }, refund: null, history: [],
};
const notifications = [
  { id: 'n0000000-0000-4000-8000-000000000001', kind: 'appointment', title: 'Your reschedule was approved', body: 'Slobos Cutz approved your new appointment time: Fri 10 Jan · 14:00.', refType: 'appointment', refId: ID, read: false, at: '2026-10-01T10:00:00.000Z' },
  { id: 'n0000000-0000-4000-8000-000000000002', kind: 'loyalty', title: 'You earned 100 Velnes points', body: 'Your appointment at Slobos Cutz earned you 100 loyalty points.', refType: 'loyalty', refId: ID, read: true, at: '2026-09-30T10:00:00.000Z' },
  { id: 'n0000000-0000-4000-8000-000000000003', kind: 'account', title: 'Password changed', body: 'The password for ana@example.com was changed.', refType: 'general', refId: null, read: true, at: '2026-09-29T10:00:00.000Z' },
];
const posted: string[] = [];

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.includes('/client/me/notifications/read')) {
        posted.push(String(init?.body));
        return ok({ ok: true });
      }
      if (url.includes('/client/me/notifications')) return ok({ notifications, unread: 1 });
      if (url.includes('/client/me/appointments')) return ok({ appointments: [appointment] });
      if (url.includes('/client/me/loyalty')) return ok({ balance: 100, rules: { version: 1, registration: 100, firstService: 100, additionalService: 30, productUnit: 20, variantUpgrade: 20, review: 50 }, entries: [] });
      if (url.includes('/client/me/offers')) return ok({ offers: [] });
      if (url.includes('/client/me/salons')) return ok({ salons: [] });
      if (url.includes('/client/me/favourites')) return ok({ salons: [], services: [], pros: [] });
      if (url.includes('/client/me')) return ok(profile);
      return ok({ categories: [], salons: [], services: [], towns: [], suggestions: [], how: 'default' });
    }),
  );
}

describe('notifications', () => {
  beforeEach(() => {
    posted.length = 0;
    mockApi();
    localStorage.setItem('velnes.client.token', 'tok');
    window.history.replaceState({}, '', '/account/notifs');
  });
  afterEach(() => {
    cleanup();
    qc.clear();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('a tap opens the entry in place with the appointment and a button that leads on; the tap itself goes nowhere', async () => {
    render(<App />);
    const row = await screen.findByRole('button', { name: /Your reschedule was approved/ });
    fireEvent.click(row);
    const detail = await screen.findByTestId('notif-detail');
    expect(window.location.pathname).toBe('/account/notifs');
    expect(within(detail).getByText('Children Haircut')).toBeDefined();
    expect(within(detail).getByText(/Slobos Cutz · Centar · Slobodan/)).toBeDefined();
    expect(within(detail).getByText('2030-01-10 · 14:00–14:30')).toBeDefined();
    // Opening marked it read, once.
    await waitFor(() => expect(posted).toEqual([JSON.stringify({ id: notifications[0]!.id })]));
    fireEvent.click(within(detail).getByRole('button', { name: /View appointment/ }));
    await waitFor(() => expect(window.location.pathname).toBe(`/account/appointments/${ID}`));
  });

  it('a loyalty entry leads to the points; a general one opens with no button; a second tap closes', async () => {
    render(<App />);
    const loy = await screen.findByRole('button', { name: /You earned 100 Velnes points/ });
    fireEvent.click(loy);
    let detail = await screen.findByTestId('notif-detail');
    expect(within(detail).getByRole('button', { name: /View points/ })).toBeDefined();
    expect(posted).toEqual([]); // already read: nothing to mark
    fireEvent.click(screen.getByRole('button', { name: /Password changed/ }));
    detail = await screen.findByTestId('notif-detail');
    expect(within(detail).queryByRole('button')).toBeNull();
    expect(screen.getAllByTestId('notif-detail')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Password changed/ }));
    await waitFor(() => expect(screen.queryByTestId('notif-detail')).toBeNull());
  });
});
