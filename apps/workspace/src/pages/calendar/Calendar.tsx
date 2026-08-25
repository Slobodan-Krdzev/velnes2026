import type { Appointment } from '@velnes/contracts';
import { empColorOf, I, Icon } from '@velnes/ui';
import { useMemo, useState } from 'react';
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

export function CalendarPage() {
  const { t } = useTranslation();
  const { me } = useSession();
  const { scope } = useScope();
  const locations = useLocations();
  const employees = useEmployees();
  const [view, setView] = useState<'day' | 'week'>('day');
  const [date, setDate] = useState(localIso(new Date()));
  const [filters, setFilters] = useState(false);
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

  const gutter = (
    <div className="cal-gutter">
      {slots.map((m) => (
        <div key={m} className={`cal-time${m % 60 === 0 ? ' hour' : ''}`}>
          <span>{hhmm(m)}</span>
        </div>
      ))}
    </div>
  );

  const cells = (iso: string, empId?: string) =>
    slots.map((m) => (
      <button
        key={m}
        className="cal-cell"
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
            <button className="input tnum calpick-btn" aria-label={t('cal.pickDate')}>
              {view === 'week' ? `${dayNum(weekStart)} – ${dayNum(addDays(weekStart, 6))}` : date}
            </button>
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
          <div className="cal-body">
            <div className="cal-row">
              {gutter}
              {days7.map((iso) => (
                <div key={iso} className={`cal-col${iso === today ? ' today' : ''}`}>
                  {cells(iso)}
                  {staff[0] ? eventsIn(iso, calEmp === 'all' ? (staff[0]?.id ?? '') : calEmp) : null}
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
          <div className="cal-body">
            <div className="cal-row">
              {gutter}
              {staff.map((e) => (
                <div key={e.id} className={`cal-col${date === today ? ' today' : ''}`}>
                  {cells(date, e.id)}
                  {eventsIn(date, e.id)}
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
