import { useQuery } from '@tanstack/react-query';
import {
  BusinessProfileSchema,
  BusinessSettingsSchema,
  type WeekHours,
} from '@velnes/contracts';
import { I, Icon } from '@velnes/ui';
import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { get } from '@velnes/client';

/** Shared pieces of the Settings sections — the prototype's field(),
 *  togglerow(), hoursWeekRows() and availSummary() as components. */

export const useBusiness = () =>
  useQuery({ queryKey: ['business'], queryFn: () => get(BusinessProfileSchema, '/business') });

export const useBusinessSettings = () =>
  useQuery({
    queryKey: ['businessSettings'],
    queryFn: () => get(BusinessSettingsSchema, '/business-settings'),
  });

export function Field({
  label,
  req,
  hint,
  span,
  children,
}: {
  label: string;
  req?: boolean;
  hint?: string;
  span?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`field${span ? ' span2' : ''}`}>
      <span>
        {label}
        {req ? <span className="req">*</span> : null}
      </span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function Toggle({
  on,
  label,
  disabled,
  onChange,
}: {
  on: boolean;
  label: string;
  disabled?: boolean | undefined;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      className={`toggle${on ? ' on' : ''}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span className="knob" />
    </button>
  );
}

export function ToggleRow({
  label,
  hint,
  on,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  on: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="togglerow">
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="l">{label}</span>
        {hint ? <span className="h">{hint}</span> : null}
      </span>
      <Toggle on={on} label={label} disabled={disabled} onChange={onChange} />
    </div>
  );
}

export function Checkrow({
  on,
  label,
  hint,
  onToggle,
}: {
  on: boolean;
  label: string;
  hint?: string;
  onToggle: () => void;
}) {
  return (
    <button className={`checkrow rankrow${on ? ' on' : ''}`} onClick={onToggle}>
      <span className={`check${on ? ' on' : ''}`}>
        <Icon d={I.check} size={14} w={3.5} />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <span className="l">{label}</span>
        {hint ? <span className="h">{hint}</span> : null}
      </span>
    </button>
  );
}

/* ── Weekly hours ──────────────────────────────────────────────
   The prototype's shape: weekday "0"(Mon)…"6"(Sun) → periods | null. */

export const WEEK_KEYS = [
  'week.mon',
  'week.tue',
  'week.wed',
  'week.thu',
  'week.fri',
  'week.sat',
  'week.sun',
] as const;

type Period = [string, string];
const DAY_END = 1140; // 19:00, the prototype's booking-day end
const WH_BREAK = 60;
const WH_MINPART = 60;
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export const whList = (h: Period[] | null | undefined): Period[] => h ?? [];

/** The prototype's whAdd: extend the day, or split it around a break.
 *  Returns null when there is no room for another period. */
export function whAdd(h: Period[] | null | undefined): Period[] | null {
  const l = whList(h);
  const last = l[l.length - 1];
  if (!last) return [['09:00', '13:00']];
  const na = mins(last[1]) + WH_BREAK;
  if (na + WH_MINPART <= DAY_END)
    return l.concat([[hhmm(na), hhmm(Math.min(na + 240, DAY_END))]]);
  const a = mins(last[0]);
  const b = mins(last[1]);
  if (b - a < WH_BREAK + WH_MINPART * 2) return null;
  const mid = Math.floor((a + b) / 2 / 30) * 30;
  const from = Math.max(a + WH_MINPART, mid - WH_BREAK / 2);
  const to = Math.min(b - WH_MINPART, from + WH_BREAK);
  return l.slice(0, -1).concat([
    [hhmm(a), hhmm(from)],
    [hhmm(to), hhmm(b)],
  ]);
}

/** "5 days · 09:00–19:00 · split shifts" — the prototype's summary. */
export function availSummary(hours: WeekHours | null | undefined, t: TFunction): string {
  const on = Array.from({ length: 7 }, (_, i) => whList(hours?.[String(i)] as Period[] | null))
    .filter((l) => l.length);
  if (!on.length) return t('eset.noDays');
  const from = on.map((l) => l[0]![0]).sort()[0];
  const to = on
    .map((l) => l[l.length - 1]![1])
    .sort()
    .slice(-1)[0];
  const split = on.some((l) => l.length > 1);
  return `${t('eset.daysCount', { n: on.length })} · ${from}–${to}${split ? ` · ${t('eset.splitShifts')}` : ''}`;
}

/** The prototype's hoursWeekRows — controlled. `variant` picks the
 *  settings-page toggle rows or the employee panel's checkbox rows. */
export function WeekHoursEditor({
  hours,
  onChange,
  variant = 'toggle',
  timeWidth = 128,
}: {
  hours: WeekHours;
  onChange: (next: WeekHours) => void;
  variant?: 'toggle' | 'checkbox';
  timeWidth?: number;
}) {
  const { t } = useTranslation();
  const set = (day: number, list: Period[] | null) =>
    onChange({ ...hours, [String(day)]: list });
  return (
    <>
      {WEEK_KEYS.map((key, i) => {
        const list = whList(hours[String(i)] as Period[] | null);
        const open = list.length > 0;
        const day = t(key);
        const room = whAdd(list) !== null;
        const dayToggle = (next: boolean) =>
          set(i, next ? [['09:00', '19:00']] : null);
        const setPeriod = (j: number, k: 0 | 1, v: string) => {
          const copy = list.map((p) => [...p] as Period);
          copy[j]![k] = v;
          set(i, copy);
        };
        return (
          <div key={key} className={`hoursrow${list.length > 1 ? ' split' : ''}`}>
            {variant === 'checkbox' ? (
              <label style={{ display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={open}
                  aria-label={day}
                  onChange={(e) => dayToggle(e.target.checked)}
                />
                <span className="day">{day}</span>
              </label>
            ) : (
              <>
                <span className="day">{day}</span>
                <Toggle on={open} label={day} onChange={dayToggle} />
              </>
            )}
            {open ? (
              <>
                <div className="dayperiods" style={variant === 'checkbox' ? { marginLeft: 16 } : undefined}>
                  {list.map((pr, j) => (
                    <div key={j} className="periodrow">
                      <input
                        className="input"
                        type="time"
                        value={pr[0]}
                        style={{ width: timeWidth }}
                        aria-label={t('hset.periodStart', { day, n: j + 1 })}
                        onChange={(e) => setPeriod(j, 0, e.target.value)}
                      />
                      <span className="muted">–</span>
                      <input
                        className="input"
                        type="time"
                        value={pr[1]}
                        style={{ width: timeWidth }}
                        aria-label={t('hset.periodEnd', { day, n: j + 1 })}
                        onChange={(e) => setPeriod(j, 1, e.target.value)}
                      />
                      {list.length > 1 ? (
                        <button
                          className="btn btn-subtle btn-icon btn-sm"
                          aria-label={t('hset.removePeriod')}
                          onClick={() => set(i, list.filter((_, k) => k !== j))}
                        >
                          <Icon d={I.minus} size={18} w={2.5} />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
                {room ? (
                  <button
                    className="btn btn-subtle btn-sm wh-add"
                    onClick={() => set(i, whAdd(list))}
                  >
                    <Icon d={I.plus} size={18} w={2.5} /> {t('hset.addPeriod')}
                  </button>
                ) : null}
              </>
            ) : (
              <span className="muted" style={{ fontWeight: 500 }}>
                {variant === 'checkbox' ? t('eset.notWorking') : t('hset.closed')}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}
