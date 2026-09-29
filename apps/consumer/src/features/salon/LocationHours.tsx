import { useTranslation } from 'react-i18next';
import type { WeekHours } from '@velnes/contracts';
import { i18n, t } from '../../lib/i18n-core.js';

/**
 * A location's week on the salon page (Alex, 2026-09-29): Monday to
 * Sunday, each day's periods or "Closed", today marked. The template the
 * salon set — booking asks the availability door, which also knows
 * exceptions and holidays; this is what the door says the door hours are.
 * Nothing when the location has no week set.
 */

/** Weekday "0" is Monday, as the template is keyed. */
const DAYS = ['0', '1', '2', '3', '4', '5', '6'] as const;

/** Today as the template's index: JS Sunday=0 → Monday=0. */
export function todayIndex(now = new Date()): number {
  return (now.getDay() + 6) % 7;
}

/** A short weekday name in the viewer's language — 2026-06-01 was a Monday. */
export function dayName(index: number, lang = i18n.language): string {
  const d = new Date(2026, 5, 1 + index);
  try {
    return new Intl.DateTimeFormat(lang, { weekday: 'short' }).format(d);
  } catch {
    return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][index]!;
  }
}

export function LocationHours({ hours, now }: { hours: WeekHours | null; now?: Date }) {
  useTranslation();
  if (!hours) return null;
  const today = todayIndex(now);
  return (
    <div className="lochours">
      <h3>{t('c.sal.hours')}</h3>
      <dl>
        {DAYS.map((k, i) => {
          const periods = hours[k];
          const on = i === today;
          return (
            <div key={k} className={`lh-row${on ? ' today' : ''}`}>
              <dt>
                {dayName(i)}
                {on ? <span className="lh-today">{t('c.date.today')}</span> : null}
              </dt>
              <dd>{periods && periods.length ? periods.map(([a, b]) => `${a}–${b}`).join(', ') : t('c.sal.closedDay')}</dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
