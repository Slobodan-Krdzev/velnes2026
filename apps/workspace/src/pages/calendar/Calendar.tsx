import type { Appointment } from '@velnes/contracts';
import { empColorOf, I, Icon } from '@velnes/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppointments, useEmployees, useLocations } from '../../api/queries.js';
import { useSession } from '@velnes/client';
import { useScope } from '../../shell/Shell.js';
import { AppointmentDrawer } from './AppointmentDrawer.js';

/* The prototype's calendar constants, verbatim. */
export const DAY_START = 480;
export const DAY_END = 1140;
const SLOT = 15;
const DAY_MINUTES = DAY_END - DAY_START;
const dayPct = (m: number) => ((m - DAY_START) / DAY_MINUTES) * 100;
const WEEK_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return localIso(new Date(y!, m! - 1, d! + n));
};
const mondayOf = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y!, m! - 1, d!);
  return addDays(iso, -((dt.getDay() + 6) % 7));
};
const mins = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const dayNum = (iso: string) => Number(iso.slice(8));
const dOf = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
};
const monthShort = (iso: string, lang: string) =>
  dOf(iso).toLocaleDateString(lang, { month: 'short' });
const firstOfMonth = (iso: string) => `${iso.slice(0, 7)}-01`;
const addMonths = (iso: string, n: number) => {
  const d = dOf(firstOfMonth(iso));
  d.setMonth(d.getMonth() + n);
  return localIso(d);
};

const EV_TONE: Record<string, string> = {
  Assessment: 'assess',
  'Manual therapy': 'manual',
  Rehab: 'rehab',
  Recovery: 'recovery',
};
const evTone = (a: Appointment, category: string | null) => {
  if (a.kind === 'note') return 'note';
  if (a.kind === 'absence' || a.kind === 'blocked') return 'off';
  if (a.kind === 'chore') return 'chore';
  return EV_TONE[category ?? ''] ?? 'other';
};

const slots: number[] = [];
for (let m = DAY_START; m < DAY_END; m += SLOT) slots.push(m);

function Event({
  a,
  color,
  category,
  onOpen,
}: {
  a: Appointment;
  color: [string, string, string, string];
  category: string | null;
  onOpen: (a: Appointment) => void;
}) {
  const top = dayPct(mins(a.start));
  const h = ((mins(a.end) - mins(a.start)) / DAY_MINUTES) * 100;
  const paint = a.kind === 'appointment' ? color : null;
  const wrapNeeded = a.kind === 'appointment' && (a.prepMin > 0 || a.resetMin > 0);
  const van = mins(a.start) - a.prepMin;
  const tot = mins(a.end) + a.resetMin;
  return (
    <>
      {wrapNeeded ? (
        <div
          className="ev-wrap"
          style={{
            top: `${dayPct(van)}%`,
            height: `${((tot - van) / DAY_MINUTES) * 100}%`,
            ...(paint ? ({ ['--ev-wrap-bg' as string]: paint[2] } as React.CSSProperties) : {}),
          }}
          title={`${a.prepMin} min set-up, ${a.resetMin} min clean-up`}
        />
      ) : null}
      <button
        className={`event ${a.kind} ev-${evTone(a, category)}${paint ? ' ev-emp' : ''}`}
        style={
          {
            top: `${top}%`,
            height: `${h}%`,
            ...(paint ? { ['--ev-bg']: paint[2], ['--ev-ink']: paint[3] } : {}),
          } as React.CSSProperties
        }
        onClick={() => onOpen(a)}
        title={`${a.title} · ${a.serviceName ?? ''}`}
      >
        <span className="ev-main">
          <span className="ev-head">
            <span className="ev-ic">
              <Icon d={I.calendar} size={16} w={2} />
            </span>
            <span className="ev-t">{a.serviceName ?? a.title}</span>
          </span>
          {h >= 54 ? (
            <span className="ev-line">
              <Icon d={I.clock} size={13} w={2} />
              <span className="tnum">
                {a.start} – {a.end}
              </span>
            </span>
          ) : null}
          {h >= 72 && a.kind === 'appointment' ? (
            <span className="ev-line">
              <Icon d={I.user} size={13} w={2} />
              <span className="ev-clip">{a.title}</span>
            </span>
          ) : null}
        </span>
      </button>
    </>
  );
}

/** The prototype's datePicker(): six rows of seven so the menu never
 *  jumps, dots on days that hold appointments, closed days muted, and
 *  the week view picks the week around the chosen day. */
function DatePicker({
  view,
  date,
  weekStart,
  today,
  locIds,
  hours,
  lang,
  onPick,
}: {
  view: 'day' | 'week';
  date: string;
  weekStart: string;
  today: string;
  locIds: string[];
  hours: Record<string, [string, string][] | null> | null;
  lang: string;
  onPick: (iso: string) => void;
}) {
  const { t } = useTranslation();
  const [first, setFirst] = useState(firstOfMonth(view === 'week' ? weekStart : date));
  const grid = mondayOf(first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(grid, i));
  const monthIx = dOf(first).getMonth();
  const appts = useAppointments(locIds[0] ?? null, grid, addDays(grid, 41));
  const appts2 = useAppointments(locIds[1] ?? null, grid, addDays(grid, 41));
  const merged = [...(appts.data?.appointments ?? []), ...(appts2.data?.appointments ?? [])];
  const busy = (v: string) =>
    merged.some((a) => a.date === v && a.kind === 'appointment' && a.status !== 'cancelled');
  const isOpenDate = (v: string) => {
    if (!hours) return true;
    return hours[String((dOf(v).getDay() + 6) % 7)] != null;
  };
  const selWeek = mondayOf(view === 'week' ? weekStart : date);

  return (
    <div className="menu menu-cal" role="dialog" aria-label={t('cal.pickDate')}>
      <div className="calpick-head">
        <button
          className="btn btn-subtle btn-icon btn-sm"
          aria-label={t('cal.prevMonth')}
          onClick={() => setFirst(addMonths(first, -1))}
        >
          <Icon d={I.left} size={18} w={2.5} />
        </button>
        <span className="calpick-title">
          {dOf(first).toLocaleDateString(lang, { month: 'long' })} {dOf(first).getFullYear()}
        </span>
        <button
          className="btn btn-subtle btn-icon btn-sm"
          aria-label={t('cal.nextMonth')}
          onClick={() => setFirst(addMonths(first, 1))}
        >
          <Icon d={I.right} size={18} w={2.5} />
        </button>
      </div>
      <div className="calpick-grid">
        {(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).map((k) => (
          <span key={k} className="calpick-dow">
            {t(`week.${k}`).slice(0, 1)}
          </span>
        ))}
        {days.map((v) => {
          const out = dOf(v).getMonth() !== monthIx;
          const on = view === 'week' ? mondayOf(v) === selWeek : v === date;
          return (
            <button
              key={v}
              className={`calpick-day${out ? ' out' : ''}${on ? ' on' : ''}${v === today ? ' today' : ''}${isOpenDate(v) ? '' : ' closed'}`}
              aria-current={v === today ? 'date' : 'false'}
              title={v}
              onClick={() => onPick(v)}
            >
              {dayNum(v)}
              {busy(v) ? <span className="calpick-dot" /> : null}
            </button>
          );
        })}
      </div>
      <div className="calpick-foot">
        <span className="muted">
          {view === 'week' ? t('cal.pickWeekHint') : t('cal.dotHint')}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={() => onPick(today)}>
          {t('common.today')}
        </button>
      </div>
    </div>
  );
}

export function CalendarPage() {
  const { t, i18n } = useTranslation();
  const { me } = useSession();
  const { scope } = useScope();
  const locations = useLocations();
  const employees = useEmployees();
  const [view, setView] = useState<'day' | 'week'>('day');
  const [date, setDate] = useState(localIso(new Date()));
  const [filters, setFilters] = useState(false);
  const [pick, setPick] = useState(false);
  const [calEmp, setCalEmp] = useState('all');
  const [drawer, setDrawer] = useState<{
    open: boolean;
    appointment?: Appointment;
    slot?: { date: string; time: string; empId?: string };
  }>({ open: false });

  const myLocs = useMemo(() => {
    const all = locations.data?.locations ?? [];
    return me?.locationIds.length ? all.filter((l) => me.locationIds.includes(l.id)) : all;
  }, [locations.data, me]);
  const scopeLocs = scope === 'all' ? myLocs.map((l) => l.id) : [scope];
  const bookLoc = scope === 'all' ? (myLocs[0]?.id ?? null) : scope;

  const staff = useMemo(
    () =>
      (employees.data?.employees ?? []).filter(
        (e) =>
          e.bookable &&
          e.status === 'active' &&
          e.locationIds.some((id) => scopeLocs.includes(id)) &&
          (calEmp === 'all' || e.id === calEmp),
      ),
    [employees.data, scopeLocs, calEmp],
  );

  const weekStart = mondayOf(date);
  const from = view === 'day' ? date : weekStart;
  const to = view === 'day' ? date : addDays(weekStart, 6);
  // One query per scoped location, merged.
  const appts = useAppointments(scopeLocs[0] ?? null, from, to);
  const appts2 = useAppointments(scopeLocs[1] ?? null, from, to);
  const list = useMemo(
    () =>
      [...(appts.data?.appointments ?? []), ...(appts2.data?.appointments ?? [])].filter(
        (a) => a.status !== 'cancelled' && (calEmp === 'all' || a.employeeId === calEmp),
      ),
    [appts.data, appts2.data, calEmp],
  );

  const today = localIso(new Date());
  const days7 = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const open = (a: Appointment) => setDrawer({ open: true, appointment: a });
  const colorOf = (empId: string | null) =>
    empColorOf(employees.data?.employees.find((e) => e.id === empId)?.color);

  // The prototype's red clock line: it re-places itself once a minute
  // and disappears outside opening hours.
  const [nowMin, setNowMin] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date();
      setNowMin(d.getHours() * 60 + d.getMinutes());
    }, 60_000);
    return () => clearInterval(id);
  }, []);
  const nowTop =
    nowMin < DAY_START || nowMin >= DAY_END ? null : Math.round(dayPct(nowMin) * 1000) / 1000;
  const nowLine =
    nowTop === null ? null : <div className="cal-now" style={{ top: `${nowTop}%` }} />;

  // The grid follows the clock: it opens centered on the red line and
  // slides along whenever the line would drift out of view.
  const calBodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = calBodyRef.current;
    if (!el || nowTop === null) return;
    const todayVisible = view === 'day' ? date === today : days7.includes(today);
    if (!todayVisible) return;
    const lineY = (el.scrollHeight * nowTop) / 100;
    const margin = 40;
    if (lineY < el.scrollTop + margin || lineY > el.scrollTop + el.clientHeight - margin) {
      const target = Math.max(0, lineY - el.clientHeight / 2);
      // jsdom has no element.scrollTo — fall back to the property.
      if (typeof el.scrollTo === 'function') el.scrollTo({ top: target, behavior: 'smooth' });
      else el.scrollTop = target;
    }
    // staff.length: the grid mounts only once employees answer — the
    // first centering must wait for that.
  }, [nowTop, view, date, today, weekStart, staff.length]);

  const gutter = (
    <div className="cal-gutter">
      {nowTop !== null ? (
        <span className="cal-now-label tnum" style={{ top: `${nowTop}%` }}>
          {hhmm(nowMin)}
        </span>
      ) : null}
      {slots.map((m) => (
        <div key={m} className={`cal-time${m % 60 === 0 ? ' hour' : ''}`}>
          <span>{hhmm(m)}</span>
        </div>
      ))}
    </div>
  );

  // A slot behind the clock takes no new booking — the empty cell goes
  // dead. Appointments layered on top stay clickable regardless: what
  // happened is exactly what you want to look up.
  const slotPast = (iso: string, m: number) =>
    iso < today || (iso === today && m < nowMin);
  const cells = (iso: string, empId?: string) =>
    slots.map((m) => (
      <button
        key={m}
        className="cal-cell"
        disabled={slotPast(iso, m)}
        aria-label={`${t('cal.newAppointment')} ${iso} ${hhmm(m)}`}
        onClick={() =>
          setDrawer({ open: true, slot: { date: iso, time: hhmm(m), ...(empId ? { empId } : {}) } })
        }
      />
    ));

  const eventsIn = (iso: string, empId: string) =>
    list
      .filter((a) => a.date === iso && a.employeeId === empId)
      .map((a) => (
        <Event
          key={a.id}
          a={a}
          color={colorOf(a.employeeId)}
          category={a.serviceCategory ?? a.serviceName}
          onOpen={open}
        />
      ));

  return (
    <>
      <div className="toolbar toolbar-cal">
        <div className="filters">
          <button className="btn btn-secondary" onClick={() => setDate(localIso(new Date()))}>
            {t('common.today')}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              className="btn btn-subtle btn-icon"
              aria-label={t('cal.prev')}
              onClick={() => setDate(addDays(date, view === 'week' ? -7 : -1))}
            >
              <Icon d={I.left} size={20} w={2.5} />
            </button>
            <div className="pop">
              <button
                className={`input tnum calpick-btn${pick ? ' open' : ''}`}
                aria-haspopup="dialog"
                aria-expanded={pick}
                aria-label={t('cal.pickDate')}
                onClick={() => setPick((v) => !v)}
              >
                {view === 'week'
                  ? monthShort(weekStart, i18n.language) === monthShort(addDays(weekStart, 6), i18n.language)
                    ? `${dayNum(weekStart)} – ${dayNum(addDays(weekStart, 6))} ${monthShort(weekStart, i18n.language)}`
                    : `${dayNum(weekStart)} ${monthShort(weekStart, i18n.language)} – ${dayNum(addDays(weekStart, 6))} ${monthShort(addDays(weekStart, 6), i18n.language)}`
                  : `${dayNum(date)} ${monthShort(date, i18n.language)}`}
              </button>
              {pick ? (
                <DatePicker
                  view={view}
                  date={date}
                  weekStart={weekStart}
                  today={today}
                  locIds={scopeLocs}
                  hours={myLocs[0]?.hours ?? null}
                  lang={i18n.language}
                  onPick={(v) => {
                    setDate(v);
                    setPick(false);
                  }}
                />
              ) : null}
            </div>
            <button
              className="btn btn-subtle btn-icon"
              aria-label={t('cal.next')}
              onClick={() => setDate(addDays(date, view === 'week' ? 7 : 1))}
            >
              <Icon d={I.right} size={20} w={2.5} />
            </button>
          </div>
          <div className="pop">
            <button
              className={`btn btn-secondary btn-pill${filters ? ' open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={filters}
              onClick={() => setFilters((v) => !v)}
            >
              {t('cal.filters')}
              <span className={`caret${filters ? ' up' : ''}`}>
                <Icon d={I.down} size={18} w={2.2} />
              </span>
            </button>
            {filters ? (
              <div className="menu menu-left menu-wide" role="menu">
                <div className="filterrow">
                  <span className="fi">
                    <Icon d={I.calendar} size={20} />
                  </span>
                  <span className="fl">{t('cal.view')}</span>
                  <select
                    className="select fsel"
                    aria-label={t('cal.view')}
                    value={view}
                    onChange={(e) => setView(e.target.value as 'day' | 'week')}
                  >
                    <option value="week">{t('cal.week')}</option>
                    <option value="day">{t('cal.day')}</option>
                  </select>
                </div>
                <div className="filterrow">
                  <span className="fi">
                    <Icon d={I.users} size={20} />
                  </span>
                  <span className="fl">{t('cal.employeesFilter')}</span>
                  <select
                    className="select fsel"
                    aria-label={t('cal.employeesFilter')}
                    value={calEmp}
                    onChange={(e) => setCalEmp(e.target.value)}
                  >
                    <option value="all">{t('cal.allEmployees')}</option>
                    {(employees.data?.employees ?? [])
                      .filter((e) => e.locationIds.some((id) => scopeLocs.includes(id)))
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setDrawer({ open: true })}>
          {t('cal.add')} <Icon d={I.plus} size={20} w={2.5} />
        </button>
      </div>

      {staff.length === 0 ? (
        <p style={{ padding: 20 }} className="muted">
          {t('cal.noEmployees')}
        </p>
      ) : view === 'week' ? (
        <div className="cal">
          <div className="cal-row">
            <div className="cal-gutter">
              <div className="cal-gutter-head">W</div>
            </div>
            {days7.map((iso, i) => (
              <div key={iso} className="cal-col" style={{ borderLeft: '1px solid var(--line)' }}>
                <div className={`cal-head${iso === today ? ' today' : ''}`}>
                  <span className="dow">{WEEK_DAYS[i]}</span>
                  <span className="dnum">{dayNum(iso)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="cal-body" ref={calBodyRef}>
            <div className="cal-row">
              {gutter}
              {days7.map((iso) => (
                <div key={iso} className={`cal-col${iso === today ? ' today' : ''}`}>
                  {cells(iso)}
                  {staff[0] ? eventsIn(iso, calEmp === 'all' ? (staff[0]?.id ?? '') : calEmp) : null}
                  {iso === today ? nowLine : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="cal">
          <div className="cal-row">
            <div className="cal-gutter">
              <div className="cal-gutter-head tnum">{dayNum(date)}</div>
            </div>
            {staff.map((e) => {
              const c = empColorOf(e.color);
              return (
                <div key={e.id} className="cal-col">
                  <div
                    className="cal-head cal-head-emp"
                    style={{ background: c[2], boxShadow: `inset 0 -3px 0 ${c[3]}` }}
                  >
                    <span className="dow" style={{ color: c[3] }}>
                      {e.name}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="cal-body" ref={calBodyRef}>
            <div className="cal-row">
              {gutter}
              {staff.map((e) => (
                <div key={e.id} className={`cal-col${date === today ? ' today' : ''}`}>
                  {cells(date, e.id)}
                  {eventsIn(date, e.id)}
                  {date === today ? nowLine : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {drawer.open && bookLoc ? (
        <AppointmentDrawer
          locationId={scope === 'all' ? bookLoc : scope}
          date={drawer.slot?.date ?? date}
          time={drawer.slot?.time ?? null}
          employeeId={drawer.slot?.empId ?? null}
          appointment={drawer.appointment ?? null}
          employees={staff}
          onClose={() => setDrawer({ open: false })}
        />
      ) : null}
    </>
  );
}
