import { describe, expect, it } from 'vitest';
import { instantAt } from '../scheduling/scheduling.service.js';
import { cancelWindow, type Leg } from './changes.service.js';

/**
 * The cancellation deadline is an instant: the visit's local start in
 * the location's zone, minus the window accepted at booking. Pure, so
 * the zone and DST rules are written down here rather than discovered
 * on the last Sunday of October.
 */
const leg = (date: string, startMin: number, cancelHours: number | null): Leg => ({
  id: 'a', tenantId: 't', locationId: 'l', date, startMin, durationMin: 30, prepMin: 0, resetMin: 0, serviceId: null, variantId: null,
  modifierOptionIds: [], employeeId: null, anyEmp: false, customerId: null, clientUserId: null, status: 'booked', title: 'x', price: 0,
  cancelHours, cancelledAt: null, cancelledBy: null, cancelReason: null, idempotencyKey: null,
});

describe('a local wall time as an instant', () => {
  it('follows the zone across the DST change, both ways', () => {
    // Skopje: CEST (UTC+2) on 24 Oct 2026, CET (UTC+1) from 25 Oct.
    expect(instantAt('Europe/Skopje', '2026-10-24', 600).toISOString()).toBe('2026-10-24T08:00:00.000Z');
    expect(instantAt('Europe/Skopje', '2026-10-25', 600).toISOString()).toBe('2026-10-25T09:00:00.000Z');
    // The spring change: 29 Mar 2026 10:00 is already CEST.
    expect(instantAt('Europe/Skopje', '2026-03-29', 600).toISOString()).toBe('2026-03-29T08:00:00.000Z');
    expect(instantAt('Europe/Skopje', '2026-03-28', 600).toISOString()).toBe('2026-03-28T09:00:00.000Z');
  });
  it('is not the server\'s zone: another location has its own clock', () => {
    expect(instantAt('America/New_York', '2026-07-01', 540).toISOString()).toBe('2026-07-01T13:00:00.000Z');
    expect(instantAt('Asia/Tokyo', '2026-07-01', 540).toISOString()).toBe('2026-07-01T00:00:00.000Z');
    // Midnight, on the day itself.
    expect(instantAt('Europe/Skopje', '2026-07-01', 0).toISOString()).toBe('2026-06-30T22:00:00.000Z');
  });
});

describe('the cancellation window', () => {
  const start = instantAt('Europe/Skopje', '2026-10-02', 900); // Fri 2 Oct, 15:00
  it('24 hours: allowed strictly before start − 24h, blocked from that instant on', () => {
    const w = (now: Date) => cancelWindow([leg('2026-10-02', 900, 24)], 'Europe/Skopje', now);
    const deadline = new Date(start.getTime() - 24 * 3_600_000);
    expect(w(new Date(deadline.getTime() - 60_000)).allowed).toBe(true); // Thu 14:59
    expect(w(deadline).allowed).toBe(false); // Thu 15:00 exactly
    expect(w(new Date(deadline.getTime() + 60_000)).allowed).toBe(false);
    expect(w(new Date(start.getTime() - 5 * 3_600_000)).allowed).toBe(false); // Fri 10:00
    expect(w(deadline).deadline.toISOString()).toBe(deadline.toISOString());
    // Real timestamps, not calendar days: 29 hours before is fine.
    expect(w(new Date(start.getTime() - 29 * 3_600_000)).allowed).toBe(true);
  });
  it('zero hours means until it starts; no snapshot falls back to a day', () => {
    expect(cancelWindow([leg('2026-10-02', 900, 0)], 'Europe/Skopje', new Date(start.getTime() - 60_000)).allowed).toBe(true);
    expect(cancelWindow([leg('2026-10-02', 900, 0)], 'Europe/Skopje', start).allowed).toBe(false);
    expect(cancelWindow([leg('2026-10-02', 900, null)], 'Europe/Skopje', new Date()).hours).toBe(24);
  });
  it('the window follows the visit, so a moved visit gets a moved deadline — with the same snapshot', () => {
    const before = cancelWindow([leg('2026-10-02', 900, 48)], 'Europe/Skopje', new Date());
    const after = cancelWindow([leg('2026-10-03', 720, 48)], 'Europe/Skopje', new Date());
    expect(after.deadline.getTime() - before.deadline.getTime()).toBe((21 * 60) * 60_000);
    expect(after.hours).toBe(48);
  });
});
