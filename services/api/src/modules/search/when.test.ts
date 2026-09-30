import { describe, expect, it } from 'vitest';
import { addDays, daysFor, weekdayOf } from './when.js';

/** The days a "when" word means — pure, so the calendar rules are
 *  written down here rather than discovered on a Sunday. */
describe('the days a word means', () => {
  it('today and tomorrow are one day each', () => {
    expect(daysFor('today', '2026-09-30', 7)).toEqual(['2026-09-30']);
    expect(daysFor('tomorrow', '2026-09-30', 7)).toEqual(['2026-10-01']);
    // Across a month end, in the calendar and not the server's zone.
    expect(daysFor('tomorrow', '2026-10-31', 7)).toEqual(['2026-11-01']);
  });
  it('this weekend is the coming Saturday and Sunday', () => {
    // 2026-09-30 is a Wednesday.
    expect(weekdayOf('2026-09-30')).toBe(2);
    expect(daysFor('weekend', '2026-09-30', 7)).toEqual(['2026-10-03', '2026-10-04']);
    // On a Friday, tomorrow.
    expect(daysFor('weekend', '2026-10-02', 7)).toEqual(['2026-10-03', '2026-10-04']);
    // On a Saturday, the rest of it: today and tomorrow.
    expect(daysFor('weekend', '2026-10-03', 7)).toEqual(['2026-10-03', '2026-10-04']);
    // On a Sunday, what is left of it.
    expect(daysFor('weekend', '2026-10-04', 7)).toEqual(['2026-10-04']);
    // A Monday means the weekend ahead, never the one just gone.
    expect(daysFor('weekend', '2026-10-05', 7)).toEqual(['2026-10-10', '2026-10-11']);
  });
  it('no word is the horizon, today onward', () => {
    expect(daysFor(null, '2026-09-30', 3)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02']);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
