import { describe, expect, it } from 'vitest';
import { settledPosition } from './queries.js';

/**
 * The search is keyed on a settled position (Alex, 2026-10-02): a fix
 * that wobbles under 250 m keeps the key, a real move re-keys it.
 */
describe('settledPosition', () => {
  const skopje = { lat: 41.9981, lng: 21.4254 };
  it('rounds a first fix, keeps it through wobble, and moves with the person', () => {
    const first = settledPosition(null, skopje);
    expect(first).toEqual({ lat: 41.998, lng: 21.425 });
    // 80 m north: the same key.
    expect(settledPosition(first, { lat: skopje.lat + 0.0007, lng: skopje.lng })).toBe(first);
    // 600 m east: a new key.
    const moved = settledPosition(first, { lat: skopje.lat, lng: skopje.lng + 0.0072 });
    expect(moved).not.toBe(first);
    expect(moved).toEqual({ lat: 41.998, lng: 21.433 });
    // No fix at all: nothing to key on.
    expect(settledPosition(first, null)).toBeNull();
  });
});
