import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, qc } from '../../App.js';

/**
 * Reviews in My Velnes (Alex, 2026-09-30): a completed visit offers
 * "Write a review", the form wants all four stars before it sends, a
 * sent review shows as given; a scheduled visit offers nothing; a
 * review link opened signed out comes back after sign-in.
 */
const APPT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FUTURE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const profile = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', email: 'ana@example.com', emailVerified: true, first: 'Ana', last: 'D', phone: null, dob: null,
  lang: 'en', avatar: null, since: '2026-09-01', personalisedResults: true, locationAllowed: null,
};
const base = {
  ref: 'AAAAAAAA', salonName: 'Velnes Fizio Centar', salonSlug: 'velnes-fizio', locationName: 'Centar', locationAddress: 'Makedonija 12', lat: null, lng: null,
  serviceName: 'Sports massage', employeeName: 'Maria Petrovska', durationMin: 45, price: 1800, status: 'booked', paid: false, cancelHours: 24,
  serviceId: null, employeeId: null, locationId: null,
};
let appointments: Record<string, unknown>[] = [
  { ...base, id: APPT, date: '2026-09-20', time: '10:00', end: '10:45', completed: true, canReview: true, review: null },
  { ...base, id: FUTURE, date: '2030-01-10', time: '10:00', end: '10:45', completed: false, canReview: false, review: null },
];
const posted: { url: string; body: unknown }[] = [];

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (url.includes('/client/me/appointments/') && url.endsWith('/review') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, number | string>;
        posted.push({ url, body });
        appointments = appointments.map((a) =>
          a.id === APPT ? { ...a, canReview: false, review: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', ...body, body: (body.body as string) ?? null, at: '2026-09-21T10:00:00.000Z' } } : a,
        );
        return ok({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', ...body, at: '2026-09-21T10:00:00.000Z' });
      }
      if (url.includes('/client/me/appointments')) return ok({ appointments });
      if (url.includes('/client/me/notifications')) return ok({ notifications: [], unread: 0 });
      if (url.includes('/client/me/offers')) return ok({ offers: [] });
      if (url.includes('/client/me/salons')) return ok({ salons: [] });
      if (url.includes('/client/me/favourites')) return ok({ favourites: [] });
      if (url.includes('/client/me')) return ok(profile);
      if (url.includes('/client/login')) return ok({ token: 'tok', profile });
      return ok({ categories: [], salons: [], services: [], towns: [], suggestions: [], how: 'default' });
    }),
  );
}

describe('reviewing a visit', () => {
  beforeEach(() => {
    posted.length = 0;
    appointments = appointments.map((a) => (a.id === APPT ? { ...a, canReview: true, review: null } : a));
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

  it('a completed visit offers the review, needs all four stars, and shows the review once sent', async () => {
    localStorage.setItem('velnes.client.token', 'tok');
    window.history.replaceState({}, '', `/account/appointments/${APPT}`);
    render(<App />);
    const open = await screen.findByRole('button', { name: 'Write a review' });
    fireEvent.click(open);
    const form = await screen.findByRole('heading', { name: 'How was your visit?' });
    const submit = screen.getByRole('button', { name: 'Submit review' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    // The language menu is a radiogroup too; the form's four are the stars.
    const groups = screen.getAllByRole('radiogroup').filter((g) => g.classList.contains('stars-in'));
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Service', 'Timing', 'Cleanliness', 'Your professional']);
    for (const [g, star] of [[groups[0]!, 5], [groups[1]!, 4], [groups[2]!, 5]] as const) fireEvent.click(within(g).getByRole('radio', { name: `${star} out of 5 stars` }));
    expect(submit.disabled).toBe(true);
    fireEvent.click(within(groups[3]!).getByRole('radio', { name: '5 out of 5 stars' }));
    expect(submit.disabled).toBe(false);
    fireEvent.change(screen.getByPlaceholderText(/What stood out/), { target: { value: '  Great massage.  ' } });
    fireEvent.click(submit);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.body).toEqual({ service: 5, timing: 4, cleanliness: 5, professional: 5, body: 'Great massage.' });
    expect(form).toBeTruthy();
    await screen.findByText('Thank you — your review is in.');
    await screen.findByText('Your review');
    expect(screen.queryByRole('button', { name: 'Write a review' })).toBeNull();
    expect(screen.getByText('“Great massage.”')).toBeTruthy();
  });

  it('a scheduled visit offers no review, and ?review=1 opens the form on a completed one', async () => {
    localStorage.setItem('velnes.client.token', 'tok');
    window.history.replaceState({}, '', `/account/appointments/${FUTURE}`);
    render(<App />);
    await screen.findByText('Booking reference');
    expect(screen.queryByRole('button', { name: 'Write a review' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'How was your visit?' })).toBeNull();
    cleanup();
    window.history.replaceState({}, '', `/account/appointments/${APPT}?review=1`);
    render(<App />);
    await screen.findByRole('heading', { name: 'How was your visit?' });
  });

  it('a review link opened signed out remembers itself and returns after sign-in', async () => {
    window.history.replaceState({}, '', `/account/appointments/${APPT}?review=1`);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(window.location.pathname).toBe('/login'));
    expect(sessionStorage.getItem('velnes.client.returnTo')).toBe(`/account/appointments/${APPT}?review=1`);
    // Signing in establishes the session; the pending return takes over.
    // The sign-in form's labels are not wired to their inputs; reach the fields by type.
    const inputs = [...document.querySelectorAll<HTMLInputElement>('.auth-wrap input')];
    fireEvent.change(inputs.find((i) => i.type !== 'password')!, { target: { value: 'ana@example.com' } });
    fireEvent.change(inputs.find((i) => i.type === 'password')!, { target: { value: 'velnes-test-12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/account/appointments/${APPT}`));
    expect(window.location.search).toBe('?review=1');
    await screen.findByRole('heading', { name: 'How was your visit?' });
  });
});
