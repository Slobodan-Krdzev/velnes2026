import type { Appointment } from '@velnes/contracts';
import { Badge, Button } from '@velnes/ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppointments, useDaySchedule, useEmployees, useLocations } from '../../api/queries.js';
import { useSession } from '../../session.js';
import { AppointmentDrawer } from './AppointmentDrawer.js';
import './calendar.css';

export const DAY_START = 480;
export const DAY_END = 1140;
const SPAN = DAY_END - DAY_START;

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

const CAT_TONE: Record<string, string> = {
  'Manual therapy': 'manual',
  Rehab: 'rehab',
  Assessment: 'assess',
  Recovery: 'recovery',
};

function EventBlock({
  a,
  onClick,
}: {
  a: Appointment;
  onClick: (a: Appointment) => void;
}) {
  const start = mins(a.start);
  const tone = CAT_TONE[a.serviceName ?? ''] ?? 'other';
  const top = ((start - a.prepMin - DAY_START) / SPAN) * 100;
  const height = ((a.prepMin + a.durationMin + a.resetMin) / SPAN) * 100;
  const prepPct = (a.prepMin / (a.prepMin + a.durationMin + a.resetMin)) * 100;
  const resetPct = (a.resetMin / (a.prepMin + a.durationMin + a.resetMin)) * 100;
  return (
    <button
      className={`cal-event tone-${tone}${a.status === 'cancelled' ? ' cancelled' : ''}`}
      style={{ top: `${top}%`, height: `${height}%` }}
      onClick={() => onClick(a)}
      title={`${a.title} · ${a.serviceName ?? ''}`}
    >
      {a.prepMin > 0 && <span className="cal-wrap" style={{ height: `${prepPct}%`, top: 0 }} />}
      <span className="cal-event-body">
        <strong>{a.start}</strong> {a.title}
        <span className="cal-event-svc">{a.serviceName ?? a.title}</span>
      </span>
      {a.resetMin > 0 && (
        <span className="cal-wrap" style={{ height: `${resetPct}%`, bottom: 0 }} />
      )}
    </button>
  );
}

export function CalendarPage() {
  const { t } = useTranslation();
  const { me } = useSession();
  const locations = useLocations();
  const employees = useEmployees();
  const [locationId, setLocationId] = useState<string | null>(null);
  const [view, setView] = useState<'day' | 'week'>('day');
  const [date, setDate] = useState(localIso(new Date()));
  const [weekEmp, setWeekEmp] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ open: boolean; appointment?: Appointment }>({
    open: false,
  });

  const myLocs = useMemo(() => {
    const all = locations.data?.locations ?? [];
    return me?.locationIds.length ? all.filter((l) => me.locationIds.includes(l.id)) : all;
  }, [locations.data, me]);
  const loc = locationId ?? myLocs[0]?.id ?? null;

  const cols = useMemo(() => {
    const emps = (employees.data?.employees ?? []).filter(
      (e) => e.bookable && e.status === 'active' && loc && e.locationIds.includes(loc),
    );
    return emps;
  }, [employees.data, loc]);
  const weekEmployee = weekEmp ?? cols[0]?.id ?? null;

  const from = view === 'day' ? date : mondayOf(date);
  const to = view === 'day' ? date : addDays(mondayOf(date), 6);
  const appts = useAppointments(loc, from, to);
  const schedule = useDaySchedule(loc, date);

  const hours = Array.from({ length: (DAY_END - DAY_START) / 60 }, (_, i) => DAY_START + i * 60);
  const days = view === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(mondayOf(date), i)) : [date];

  const eventsFor = (day: string, empId: string) =>
    (appts.data?.appointments ?? []).filter(
      (a) => a.date === day && a.employeeId === empId && a.status !== 'cancelled',
    );

  return (
    <div className="cal">
      <div className="cal-toolbar">
        <select
          className="input cal-loc"
          value={loc ?? ''}
          onChange={(e) => setLocationId(e.target.value)}
          aria-label="Location"
        >
          {myLocs.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <div className="cal-nav">
          <Button variant="secondary" size="sm" onClick={() => setDate(addDays(date, view === 'day' ? -1 : -7))}>
            ‹
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setDate(localIso(new Date()))}>
            {t('common.today')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setDate(addDays(date, view === 'day' ? 1 : 7))}>
            ›
          </Button>
          <span className="cal-date tnum">{view === 'day' ? date : `${from} – ${to}`}</span>
          {schedule.data && !schedule.data.open && view === 'day' ? (
            <Badge tone="danger">{t('cal.closed')}</Badge>
          ) : null}
          {schedule.data?.source === 'exception' && schedule.data.open ? (
            <Badge tone="warning">{t('cal.exception')}</Badge>
          ) : null}
        </div>
        <div className="cal-views">
          <Button
            variant={view === 'day' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setView('day')}
          >
            {t('cal.day')}
          </Button>
          <Button
            variant={view === 'week' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setView('week')}
          >
            {t('cal.week')}
          </Button>
          {view === 'week' ? (
            <select
              className="input cal-loc"
              value={weekEmployee ?? ''}
              onChange={(e) => setWeekEmp(e.target.value)}
            >
              {cols.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          ) : null}
          <Button onClick={() => setDrawer({ open: true })}>{t('cal.newAppointment')}</Button>
        </div>
      </div>

      {cols.length === 0 ? (
        <p className="muted">{t('cal.noEmployees')}</p>
      ) : (
        <div className="cal-grid card">
          <div className="cal-gutter">
            {hours.map((h) => (
              <span key={h} className="cal-hour tnum">
                {String(h / 60).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          {view === 'day'
            ? cols.map((e) => (
                <div key={e.id} className="cal-col">
                  <div className="cal-colhead">{e.name}</div>
                  <div className="cal-colbody">
                    {eventsFor(date, e.id).map((a) => (
                      <EventBlock key={a.id} a={a} onClick={(x) => setDrawer({ open: true, appointment: x })} />
                    ))}
                  </div>
                </div>
              ))
            : days.map((d) => (
                <div key={d} className="cal-col">
                  <div className="cal-colhead tnum">{d.slice(5)}</div>
                  <div className="cal-colbody">
                    {weekEmployee
                      ? eventsFor(d, weekEmployee).map((a) => (
                          <EventBlock key={a.id} a={a} onClick={(x) => setDrawer({ open: true, appointment: x })} />
                        ))
                      : null}
                  </div>
                </div>
              ))}
        </div>
      )}

      {drawer.open && loc ? (
        <AppointmentDrawer
          locationId={loc}
          date={date}
          appointment={drawer.appointment ?? null}
          employees={cols}
          onClose={() => setDrawer({ open: false })}
        />
      ) : null}
    </div>
  );
}
