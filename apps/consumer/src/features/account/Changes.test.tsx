import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, qc } from '../../App.js';

/**
 * Booking changes in My Velnes (Alex, 2026-09-30): the reschedule is a
 * request with a confirmation that says so; a pending one shows as
 * waiting; a declined one asks keep-or-cancel; a closed window shows
 * why instead of a button; cancelling takes a confirmation.
 */
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const profile = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', email: 'ana@example.com', emailVerified: true, first: 'Ana', last: 'D', phone: null, dob: null,
  lang: 'en', avatar: null, since: '2026-09-01', personalisedResults: true, locationAllowed: null,
};
const base = {
  id: ID, ref: 'AAAAAAAA', salonName: 'Velnes Fizio Centar', salonSlug: 'velnes-fizio', locationName: 'Centar', locationAddress: 'Makedonija 12', lat: null, lng: null,
  serviceName: 'Sports massage', employeeName: 'Maria Petrovska', date: '2030-01-10', time: '15:00', end: '15:45', durationMin: 45, price: 1800, status: 'booked', paid: false,
  cancelHours: 24, completed: false, canReview: false, review: null, serviceId: null, employeeId: null, locationId: null, variantId: null, modifierOptionIds: [],
  canReschedule: true, canCancel: true, cancelDeadline: '2030-01-09T14:00:00.000Z', cancelBlockedReason: null, changeRequest: null, cancellation: null,
  payment: { status: 'unpaid', method: null, amount: null }, refund: null, history: [{ at: '2026-09-29T10:00:00.000Z', what: 'Created', byName: 'Ana D', source: 'client', meta: {} }],
};
const request = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', appointmentId: ID, status: 'pending', originalDate: '2030-01-10', originalTime: '15:00', originalEnd: '15:45',
  requestedDate: '2030-01-11', requestedTime: '12:00', requestedEnd: '12:45', requestedAt: '2026-09-30T10:00:00.000Z', resolvedAt: null, resolvedByName: null,
  declineReason: null, customerDecision: null, decidedAt: null,
};
let appointment: Record<string, unknown> = { ...base };
const posted: { url: string; body: unknown }[] = [];

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (url.includes(`/client/me/appointments/${ID}/reschedule-slots`))
        return ok({ slots: [{ t: '11:00', emp: null, free: false }, { t: '12:00', emp: null, free: true }, { t: '12:30', emp: null, free: true }] });
      if (url.includes(`/client/me/appointments/${ID}/reschedule`) && init?.method === 'POST') {
        posted.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
        appointment = { ...appointment, canReschedule: false, changeRequest: request };
        return ok(request);
      }
      if (url.includes(`/client/me/appointments/${ID}/cancel`) && init?.method === 'POST') {
        posted.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
        appointment = { ...appointment, status: 'cancelled', canCancel: false, canReschedule: false, cancelBlockedReason: 'cancelled', cancellation: { at: '2026-09-30T11:00:00.000Z', by: 'customer', reason: null } };
        return ok({ ok: true });
      }
      if (url.includes('/client/me/appointments')) return ok({ appointments: [appointment] });
      if (url.includes('/client/me/notifications')) return ok({ notifications: [], unread: 0 });
      if (url.includes('/client/me/offers')) return ok({ offers: [] });
      if (url.includes('/client/me/salons')) return ok({ salons: [] });
      if (url.includes('/client/me/favourites')) return ok({ salons: [], services: [], pros: [] });
      if (url.includes('/client/me')) return ok(profile);
      return ok({ categories: [], salons: [], services: [], towns: [], suggestions: [], how: 'default' });
    }),
  );
}

async function openDetail() {
  localStorage.setItem('velnes.client.token', 'tok');
  window.history.replaceState({}, '', `/account/appointments/${ID}`);
  render(<App />);
  await screen.findByText('Booking reference');
}

describe('booking changes', () => {
  beforeEach(() => {
    posted.length = 0;
    appointment = { ...base };
    mockApi();
  });
  afterEach(() => {
    cleanup();
    qc.clear();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('a reschedule is a request: pick a free time, read that nothing changes until approval, send — then it shows as waiting', async () => {
    await openDetail();
    expect(screen.getByText('Free cancellation up to 24 hours before your appointment.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Reschedule' }));
    const picker = await screen.findByRole('dialog', { name: 'Reschedule' });
    // Only free times are offered; the busy 11:00 is not.
    expect(await within(picker).findByRole('button', { name: '12:00' })).toBeDefined();
    expect(within(picker).queryByRole('button', { name: '11:00' })).toBeNull();
    expect(within(picker).getByRole('button', { name: 'Continue' })).toHaveProperty('disabled', true);
    fireEvent.click(within(picker).getByRole('button', { name: '12:00' }));
    fireEvent.click(within(picker).getByRole('button', { name: 'Continue' }));
    const confirm = await screen.findByRole('dialog', { name: 'Request a new time' });
    expect(within(confirm).getByText('Current appointment')).toBeDefined();
    expect(within(confirm).getByText('Requested time')).toBeDefined();
    expect(within(confirm).getByText('Your appointment will only change after the salon approves your request.')).toBeDefined();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Request reschedule' }));
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]!.body).toMatchObject({ time: '12:00' });
    expect(await screen.findByText('Request sent')).toBeDefined();
    await screen.findByText('Reschedule requested');
    expect(screen.getAllByText('Waiting for salon approval').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Withdraw request' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Reschedule' })).toBeNull();
  });

  it('a declined request asks: keep the original, or cancel — and only keep when the window has closed', async () => {
    appointment = { ...base, canReschedule: false, changeRequest: { ...request, status: 'declined', declineReason: 'Fully booked that day', resolvedAt: '2026-09-30T11:00:00.000Z', resolvedByName: 'Ana Dimitrova' } };
    await openDetail();
    const ask = await screen.findByRole('alertdialog', { name: 'Reschedule not approved' });
    expect(within(ask).getByText(/still booked for/)).toBeDefined();
    expect(within(ask).getByText(/Fully booked that day/)).toBeDefined();
    expect(within(ask).getByRole('button', { name: 'Keep original appointment' })).toBeDefined();
    expect(within(ask).getByRole('button', { name: 'Cancel appointment' })).toBeDefined();
    cleanup();
    qc.clear();
    appointment = { ...appointment, canCancel: false, cancelBlockedReason: 'too_late' };
    await openDetail();
    const ask2 = await screen.findByRole('alertdialog', { name: 'Reschedule not approved' });
    expect(within(ask2).getByRole('button', { name: 'Keep original appointment' })).toBeDefined();
    expect(within(ask2).queryByRole('button', { name: 'Cancel appointment' })).toBeNull();
    expect(within(ask2).getByText(/24 hours before/)).toBeDefined();
  });

  it('a closed window shows why, with no cancel button; an open one cancels only after a confirmation', async () => {
    appointment = { ...base, canCancel: false, cancelBlockedReason: 'too_late' };
    await openDetail();
    expect(screen.getByText('Cancellation is no longer available')).toBeDefined();
    expect(screen.getByText(/allows cancellations up to 24 hours before/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Cancel appointment' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reschedule' })).toBeDefined();
    cleanup();
    qc.clear();
    appointment = { ...base };
    await openDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel appointment' }));
    const dlg = await screen.findByRole('alertdialog', { name: 'Cancel appointment?' });
    expect(posted.length).toBe(0);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Keep appointment' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel appointment' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel appointment' }));
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]!.url).toContain('/cancel');
    await screen.findAllByText('Cancelled');
    expect(screen.getByText('by you')).toBeDefined();
  });
});
