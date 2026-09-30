import type { When } from '@velnes/contracts';

/**
 * The days a "when" word means — docs/SEARCH.md §10, "When".
 *
 * Pure, like `readNow`: the salon's own calendar day comes in (from
 * `nowAt(locations.tz)`), the dates to ask the calendar about come out,
 * in the order to ask them. "Today" and "tomorrow" are one day each.
 * "This weekend" is the coming Saturday and Sunday — on a Saturday,
 * today and tomorrow; on a Sunday, what is left of it, which is today.
 * A horizon of `n` days is today onward, for "for two" with no day.
 */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday, the platform's own week. */
export function weekdayOf(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function daysFor(when: When | null, today: string, horizonDays: number): string[] {
  if (when === 'today') return [today];
  if (when === 'tomorrow') return [addDays(today, 1)];
  if (when === 'weekend') {
    const wd = weekdayOf(today);
    if (wd === 6) return [today];
    const sat = addDays(today, 5 - wd);
    return [sat, addDays(sat, 1)];
  }
  return Array.from({ length: horizonDays }, (_, i) => addDays(today, i));
}
