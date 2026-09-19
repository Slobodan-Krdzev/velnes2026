import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeoProvider, distanceKm, distanceLbl, useUserLocation } from './geo.js';

/** Where the person is: measured honestly, asked once, and remembered. */

const SKOPJE = { lat: 41.9981, lng: 21.4254 };
const BITOLA = { lat: 41.0314, lng: 21.3347 };

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
  const { status, position } = useUserLocation();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="pos">{position ? `${position.lat},${position.lng}` : 'none'}</span>
    </div>
  );
}

describe('the location the person shared', () => {
  it('picks up a remembered fix without asking again', async () => {
    localStorage.setItem('velnes.geo.on', '1');
    localStorage.setItem(
      'velnes.geo.last',
      JSON.stringify({ lat: 41.9975, lng: 21.429, accuracy: 30, at: Date.now() }),
    );
    const watchPosition = vi.fn(() => 1);
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: { watchPosition, clearWatch: vi.fn(), getCurrentPosition: vi.fn() },
      permissions: undefined,
    });

    render(
      <GeoProvider>
        <Probe />
      </GeoProvider>,
    );
    // The position is there on the first paint — no prompt, no wait.
    expect(screen.getByTestId('pos').textContent).toBe('41.9975,21.429');
    expect(screen.getByTestId('status').textContent).toBe('on');
    // …and it starts following again, because people move.
    await waitFor(() => expect(watchPosition).toHaveBeenCalled());
  });

  it('stays off, and silent, until someone asks for it', () => {
    const watchPosition = vi.fn(() => 1);
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: { watchPosition, clearWatch: vi.fn(), getCurrentPosition: vi.fn() },
      permissions: undefined,
    });
    render(
      <GeoProvider>
        <Probe />
      </GeoProvider>,
    );
    expect(screen.getByTestId('status').textContent).toBe('off');
    expect(screen.getByTestId('pos').textContent).toBe('none');
    // Nothing is watched, so no permission prompt appears on a first visit.
    expect(watchPosition).not.toHaveBeenCalled();
  });
});
