import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

/**
 * Where the person is: measured honestly, asked once, and the *answer*
 * remembered — never the place.
 */

const SKOPJE = { lat: 41.9981, lng: 21.4254 };
const BITOLA = { lat: 41.0314, lng: 21.3347 };

/** The session the provider reads: signed out by default, some tests
 *  sign in. The real hook needs a router and a token; this one needs
 *  neither and lets a test say what the account already knows. */
const session = vi.hoisted(() => ({
  signedIn: false,
  profile: null as null | { locationAllowed: boolean | null },
  api: vi.fn(async () => ({})),
}));
vi.mock('./api/session.js', () => ({ useSession: () => session }));

const { GeoProvider, distanceKm, distanceLbl, useUserLocation } = await import('./geo.js');

beforeEach(() => {
  session.signedIn = false;
  session.profile = null;
  session.api.mockClear();
});
afterEach(() => {
  // This suite runs without vitest globals, so nothing unmounts itself.
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('distance', () => {
  it('measures the real thing', () => {
    // Skopje to Bitola is ~108 km by air; the road is longer, which is
    // why this is labelled "from you" and not "travel time".
    expect(Math.round(distanceKm(SKOPJE, BITOLA))).toBe(108);
    expect(distanceKm(SKOPJE, SKOPJE)).toBe(0);
  });

  it('says metres up close and kilometres further out', () => {
    expect(distanceLbl(0.23)).toBe('230 m');
    expect(distanceLbl(2.42)).toBe('2,4 km');
  });
});

function Probe() {
  const { status, position, decision, decide, locate } = useUserLocation();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="decision">{decision ?? 'null'}</span>
      <span data-testid="pos">{position ? `${position.lat},${position.lng}` : 'none'}</span>
      <button onClick={() => decide(true)}>allow</button>
      <button onClick={() => decide(false)}>refuse</button>
      <button onClick={() => locate()}>locate</button>
    </div>
  );
}

function mount(ui: ReactNode = <Probe />) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GeoProvider>{ui}</GeoProvider>
    </QueryClientProvider>,
  );
}

/** A device that answers at once with a fix near the Skopje centre. */
function stubGeolocation() {
  const fix = { coords: { latitude: 41.9975, longitude: 21.429, accuracy: 30 } };
  const getCurrentPosition = vi.fn((ok: (p: unknown) => void) => ok(fix));
  const watchPosition = vi.fn(() => 1);
  vi.stubGlobal('navigator', {
    ...navigator,
    geolocation: { getCurrentPosition, watchPosition, clearWatch: vi.fn() },
  });
  return { getCurrentPosition, watchPosition };
}

/** A device that fails every ask the same way. */
function stubFailing(err: { code: number }) {
  const getCurrentPosition = vi.fn(
    (_ok: unknown, fail: (e: unknown) => void, _opts?: PositionOptions) =>
      fail({ ...err, PERMISSION_DENIED: 1 }),
  );
  vi.stubGlobal('navigator', {
    ...navigator,
    geolocation: { getCurrentPosition, watchPosition: vi.fn(), clearWatch: vi.fn() },
  });
  return getCurrentPosition;
}

describe('the decision, not the place', () => {
  it('starts undecided, silent, and with no position', () => {
    const g = stubGeolocation();
    mount();
    expect(screen.getByTestId('decision').textContent).toBe('null');
    expect(screen.getByTestId('status').textContent).toBe('off');
    expect(screen.getByTestId('pos').textContent).toBe('none');
    expect(g.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('allowing locates now and remembers only the yes', async () => {
    const g = stubGeolocation();
    mount();
    fireEvent.click(screen.getByText('allow'));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('on'));
    expect(screen.getByTestId('pos').textContent).toBe('41.9975,21.429');
    expect(g.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('velnes.geo.decision')).toBe('allowed');
    // Nothing about where they stood is written anywhere.
    expect(Object.keys(localStorage)).toEqual(['velnes.geo.decision']);
    // Signed out: nothing goes to the account.
    expect(session.api).not.toHaveBeenCalled();
  });

  it('refusing never touches the device and is remembered as a no', () => {
    const g = stubGeolocation();
    mount();
    fireEvent.click(screen.getByText('refuse'));
    expect(screen.getByTestId('decision').textContent).toBe('refused');
    expect(screen.getByTestId('status').textContent).toBe('off');
    expect(g.getCurrentPosition).not.toHaveBeenCalled();
    expect(localStorage.getItem('velnes.geo.decision')).toBe('refused');
  });

  it('a remembered yes is a decision, not a position: the next visit asks the device afresh', () => {
    localStorage.setItem('velnes.geo.decision', 'allowed');
    const g = stubGeolocation();
    mount();
    expect(screen.getByTestId('decision').textContent).toBe('allowed');
    // The provider itself does not locate — the home page does, on
    // entry. Until then there is no position and nothing was asked.
    expect(screen.getByTestId('pos').textContent).toBe('none');
    expect(g.getCurrentPosition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('locate'));
    expect(g.getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('wipes the keys the old model used to remember a position', () => {
    localStorage.setItem('velnes.geo.on', '1');
    localStorage.setItem('velnes.geo.last', JSON.stringify({ lat: 1, lng: 2 }));
    stubGeolocation();
    mount();
    expect(localStorage.getItem('velnes.geo.on')).toBeNull();
    expect(localStorage.getItem('velnes.geo.last')).toBeNull();
    expect(screen.getByTestId('pos').textContent).toBe('none');
  });

  it('a browser refusal is reported as denied, once, without a retry', async () => {
    const getCurrentPosition = stubFailing({ code: 1 });
    mount();
    fireEvent.click(screen.getByText('allow'));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('denied'));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('a timeout gets one gentler second ask before giving up as unavailable', async () => {
    const getCurrentPosition = stubFailing({ code: 3 });
    mount();
    fireEvent.click(screen.getByText('allow'));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unavailable'));
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(getCurrentPosition.mock.calls[1]?.[2]).toMatchObject({ enableHighAccuracy: false });
  });
});

describe('the decision and the account', () => {
  it('deciding while signed in saves the answer on the account', async () => {
    session.signedIn = true;
    session.profile = { locationAllowed: null };
    stubGeolocation();
    mount();
    fireEvent.click(screen.getByText('refuse'));
    await waitFor(() => expect(session.api).toHaveBeenCalled());
    const [path, init] = session.api.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/me');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ locationAllowed: false });
  });

  it("the account's answer wins on a new device and is written locally", async () => {
    session.signedIn = true;
    session.profile = { locationAllowed: false };
    stubGeolocation();
    mount();
    await waitFor(() => expect(screen.getByTestId('decision').textContent).toBe('refused'));
    expect(localStorage.getItem('velnes.geo.decision')).toBe('refused');
    // Nothing to push up: the account already knows.
    expect(session.api).not.toHaveBeenCalled();
  });

  it('a device that decided while signed out tells the account on sign-in', async () => {
    localStorage.setItem('velnes.geo.decision', 'allowed');
    session.signedIn = true;
    session.profile = { locationAllowed: null };
    stubGeolocation();
    mount();
    await waitFor(() => expect(session.api).toHaveBeenCalledTimes(1));
    const [, init] = session.api.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ locationAllowed: true });
  });
});
