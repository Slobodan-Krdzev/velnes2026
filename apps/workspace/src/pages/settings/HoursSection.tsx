import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BusinessProfileSchema,
  ExceptionSchema,
  HolidayListResponseSchema,
  LocationSchema,
  TimingSuggestionsResponseSchema,
  type Location,
  type ScheduleException,
  type WeekHours,
} from '@velnes/contracts';
import { I, Icon } from '@velnes/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api, get, patch, post } from '@velnes/client';
import { useLocations } from '../../api/queries.js';
import { DateField } from '../../lib/DateField.js';
import { useToast } from '../../lib/toast.js';
import { Field, ToggleRow, useBusiness, WeekHoursEditor } from './bits.js';

/** Settings › Opening hours — the prototype's setHours(): the timing
 *  card, the regular week (the truth the booking gate reads), and the
 *  exceptions tab with the public-holiday review. */

const ExceptionListSchema = z.object({ exceptions: z.array(ExceptionSchema) });
const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = localIso(new Date());

const useExceptions = (locId: string | null) =>
  useQuery({
    queryKey: ['exceptions', locId],
    queryFn: () => get(ExceptionListSchema, `/locations/${locId}/exceptions`),
    enabled: !!locId,
  });
const useHolidays = (locId: string | null) =>
  useQuery({
    queryKey: ['holidays', locId],
    queryFn: () => get(HolidayListResponseSchema, `/locations/${locId}/holidays`),
    enabled: !!locId,
  });

export function HoursSection() {
  const { t } = useTranslation();
  const locations = useLocations();
  const all = locations.data?.locations ?? [];
  const [locId, setLocId] = useState<string | null>(null);
  const [tab, setTab] = useState<'regular' | 'exceptions'>('regular');

  const lid = locId ?? all[0]?.id ?? null;
  const loc = all.find((l) => l.id === lid) ?? null;
  const exceptions = useExceptions(lid);
  const upcoming = (exceptions.data?.exceptions ?? []).filter(
    (x) => (x.endDate ?? x.startDate) >= TODAY,
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {all.length > 1 ? (
        <div className="card">
          <div className="card-header">
            <h2>{t('hset.whichLocation')}</h2>
            <span className="muted" style={{ fontWeight: 500 }}>
              {t('hset.perLocation')}
            </span>
          </div>
          <div style={{ padding: '16px 20px' }}>
            <div className="tabs">
              {all.map((l) => (
                <button
                  key={l.id}
                  className={`tab${lid === l.id ? ' active' : ''}`}
                  onClick={() => setLocId(l.id)}
                >
                  {l.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <TimingCard />

      <div className="tabs tabs-lg">
        <button
          className={`tab${tab === 'regular' ? ' active' : ''}`}
          onClick={() => setTab('regular')}
        >
          {t('hset.regularHours')}
        </button>
        <button
          className={`tab${tab === 'exceptions' ? ' active' : ''}`}
          onClick={() => setTab('exceptions')}
        >
          {t('hset.exceptions')}
          {upcoming.length ? <span className="fbadge">{upcoming.length}</span> : null}
        </button>
      </div>

      {loc ? (
        tab === 'exceptions' ? (
          <ExceptionsTab loc={loc} />
        ) : (
          <RegularTab loc={loc} />
        )
      ) : null}
    </div>
  );
}

/* ── Treatment, preparation and cleanup ───────────────────────── */

function TimingCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const business = useBusiness();
  const suggestions = useQuery({
    queryKey: ['timingSuggestions'],
    queryFn: () => get(TimingSuggestionsResponseSchema, '/timings/suggestions'),
  });

  const on = business.data?.timingEnabled ?? false;
  const n = suggestions.data?.suggestions.length ?? 0;

  const flip = async () => {
    await patch(BusinessProfileSchema, '/business', { timingEnabled: !on });
    toast(t('hset.timingSaved'));
    void qc.invalidateQueries({ queryKey: ['business'] });
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>{t('hset.timingTitle')}</h2>
        <span className="muted" style={{ fontWeight: 500 }}>
          {on ? t('hset.on') : t('hset.off')}
        </span>
      </div>
      <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontWeight: 500, margin: 0 }}>{t('hset.timingIntro')}</p>
        <div className="grid2">
          <div>
            <span className="stat-label">{t('hset.withOn')}</span>
            <p className="muted" style={{ fontWeight: 500, margin: '4px 0 0', fontSize: 13 }}>
              {t('hset.withOnBody')}
            </p>
          </div>
          <div>
            <span className="stat-label">{t('hset.withOff')}</span>
            <p className="muted" style={{ fontWeight: 500, margin: '4px 0 0', fontSize: 13 }}>
              {t('hset.withOffBody')}
            </p>
          </div>
        </div>
        <ToggleRow
          label={t('hset.timingToggle')}
          hint={
            t('hset.timingToggleHint') +
            (n ? ` · ${t('hset.suggestionsWaiting', { n })}` : '')
          }
          on={on}
          onChange={() => void flip()}
        />
        {!on ? (
          <p className="mo-card warm" style={{ fontWeight: 600, margin: 0 }}>
            {t('hset.backToBack')}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ── The regular week ─────────────────────────────────────────── */

const STD_WEEK: WeekHours = {
  '0': [['09:00', '19:00']], '1': [['09:00', '19:00']], '2': [['09:00', '19:00']],
  '3': [['09:00', '19:00']], '4': [['09:00', '19:00']], '5': [['09:00', '15:00']],
  '6': null,
};

function RegularTab({ loc }: { loc: Location }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [hours, setHours] = useState<WeekHours>(loc.hours ?? STD_WEEK);
  const [cancel, setCancel] = useState(loc.cancelHours);
  const [error, setError] = useState<string | null>(null);
  // Re-seed the draft whenever the location under the editor changes.
  const [seededFor, setSeededFor] = useState(loc.id);
  if (seededFor !== loc.id) {
    setSeededFor(loc.id);
    setHours(loc.hours ?? STD_WEEK);
    setCancel(loc.cancelHours);
  }

  const save = async () => {
    setError(null);
    try {
      await patch(LocationSchema, `/locations/${loc.id}`, { hours, cancelHours: cancel });
      toast(t('hset.hoursSaved'));
      void qc.invalidateQueries({ queryKey: ['locations'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="card">
        <div className="card-header">
          <h2>
            {t('hset.workingHours')} · {loc.name}
          </h2>
          <span className="muted" style={{ fontWeight: 500 }}>
            {t('hset.fallbackWeek')}
          </span>
          <button className="btn btn-primary btn-sm" onClick={() => void save()}>
            {t('cset.saveChanges')}
          </button>
        </div>
        <WeekHoursEditor hours={hours} onChange={setHours} />
        {error ? (
          <p role="alert" style={{ padding: '0 20px', color: 'var(--danger)', fontWeight: 600 }}>
            {error}
          </p>
        ) : null}
        <p className="muted" style={{ padding: '14px 20px', fontWeight: 500, fontSize: 12 }}>
          {t('hset.weekFoot')}
        </p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>{t('hset.onlineBooking')}</h2>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ToggleRow
            label={t('hset.obLet')}
            hint={t('hset.obLetHint')}
            on={loc.online}
            disabled
            onChange={() => undefined}
          />
          <ToggleRow
            label={t('hset.obDeposit')}
            hint={t('hset.obDepositHint')}
            on={false}
            disabled
            onChange={() => undefined}
          />
          <Field label={t('hset.cancelWindow')} hint={t('hset.cancelWindowHint')}>
            <input
              className="input"
              type="number"
              value={cancel}
              style={{ width: 160 }}
              onChange={(e) => setCancel(Number(e.target.value))}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

/* ── Exceptions ───────────────────────────────────────────────── */

const dateShort = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const excRangeLabel = (x: ScheduleException) => {
  const a = x.startDate;
  const b = x.endDate ?? x.startDate;
  if (a === b) return dateShort(a);
  return `${dateShort(a)} – ${dateShort(b)}`;
};

function ExceptionsTab({ loc }: { loc: Location }) {
  const { t } = useTranslation();
  const exceptions = useExceptions(loc.id);
  const [showPast, setShowPast] = useState(false);
  const [adding, setAdding] = useState(false);
  const [holidayPanel, setHolidayPanel] = useState(false);

  const all = exceptions.data?.exceptions ?? [];
  const up = all
    .filter((x) => (x.endDate ?? x.startDate) >= TODAY)
    .sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  const past = all
    .filter((x) => (x.endDate ?? x.startDate) < TODAY)
    .sort((a, b) => (a.startDate > b.startDate ? -1 : 1));
  const next = up[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <HolidayCard loc={loc} openPanel={() => setHolidayPanel(true)} />
      <div className="card">
        <div className="card-header">
          <h2>{t('hset.daysDifferent')}</h2>
          <span className="muted" style={{ fontWeight: 500 }}>
            {up.length
              ? `${t('hset.upcomingCount', { n: up.length })}${next ? ` · ${t('hset.nextIs', { date: excRangeLabel(next) })}` : ''}`
              : t('hset.regularApplies')}
          </span>
          <button className="btn btn-primary btn-sm btn-add" onClick={() => setAdding(true)}>
            {t('cal.add')} <Icon d={I.plus} size={18} w={2.5} />
          </button>
        </div>
        {up.length ? (
          <ExcTable rows={up} loc={loc} />
        ) : (
          <div
            style={{
              padding: '28px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              alignItems: 'flex-start',
            }}
          >
            <span className="bold">{t('hset.noExceptions')}</span>
            <span className="muted" style={{ fontWeight: 500 }}>
              {t('hset.noExceptionsSub', { name: loc.name })}
            </span>
            <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}>
              {t('hset.addException')}
            </button>
          </div>
        )}
        {past.length ? (
          <>
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--line)' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowPast(!showPast)}>
                {showPast ? t('hset.hidePast', { n: past.length }) : t('hset.showPast', { n: past.length })}
              </button>
            </div>
            {showPast ? <ExcTable rows={past} loc={loc} /> : null}
          </>
        ) : null}
      </div>
      {adding ? <ExceptionEditor loc={loc} onClose={() => setAdding(false)} /> : null}
      {holidayPanel ? <HolidayPanel loc={loc} onClose={() => setHolidayPanel(false)} /> : null}
    </div>
  );
}

function ExcTable({ rows, loc }: { rows: ScheduleException[]; loc: Location }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const del = async (id: string) => {
    await api(z.object({ ok: z.literal(true) }), `/locations/${loc.id}/exceptions/${id}`, {
      method: 'DELETE',
    });
    toast(t('hset.exceptionDeleted'));
    void qc.invalidateQueries({ queryKey: ['exceptions', loc.id] });
    void qc.invalidateQueries({ queryKey: ['holidays', loc.id] });
  };
  return (
    <div className="matrix-wrap">
      <table>
        <thead>
          <tr>
            <th>{t('hset.date')}</th>
            <th>{t('eset.status')}</th>
            <th>{t('hset.hours')}</th>
            <th>{t('hset.reason')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.id}>
              <td className="bold tnum" style={{ whiteSpace: 'nowrap' }}>
                {excRangeLabel(x)}
                {x.source === 'PUBLIC_HOLIDAY' ? (
                  <span className="badge tag-wide" style={{ marginLeft: 6 }}>
                    {t('hset.publicHoliday')}
                  </span>
                ) : null}
              </td>
              <td>
                <span className={`badge ${x.type === 'CLOSED' ? 'warning' : 'accent'} tag-wide`}>
                  {x.type === 'CLOSED' ? t('hset.closed') : t('hset.customHours')}
                </span>
              </td>
              <td className="tnum">
                {x.type === 'CLOSED'
                  ? '—'
                  : (x.periods ?? []).map((p) => `${p[0]}–${p[1]}`).join(', ')}
              </td>
              <td>{x.reason || '—'}</td>
              <td className="right">
                <span className="rowact">
                  <button className="btn btn-ghost btn-sm" onClick={() => void del(x.id)}>
                    {t('common.delete')}
                  </button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExceptionEditor({ loc, onClose }: { loc: Location; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [range, setRange] = useState(false);
  const [from, setFrom] = useState(TODAY);
  const [to, setTo] = useState(TODAY);
  const [closed, setClosed] = useState(true);
  const [periods, setPeriods] = useState<[string, string][]>([['10:00', '14:00']]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    try {
      await post(ExceptionSchema, `/locations/${loc.id}/exceptions`, {
        startDate: from,
        endDate: range ? to : null,
        type: closed ? 'CLOSED' : 'CUSTOM_HOURS',
        ...(closed ? {} : { periods }),
        ...(reason ? { reason } : {}),
      });
      toast(t('hset.exceptionSaved'));
      void qc.invalidateQueries({ queryKey: ['exceptions', loc.id] });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div className="scrim on" onClick={onClose} />
      <aside className="panel open" role="dialog" aria-modal="true">
        <div className="panel-head plain">
          <div>
            <h2>{t('hset.newException')}</h2>
            <div className="sub">{loc.name}</div>
          </div>
          <button className="iconbtn" aria-label={t('common.close')} onClick={onClose}>
            <Icon d={I.x} size={22} w={2.2} />
          </button>
        </div>
        <div className="panel-body">
          <div className="field">
            <span>{t('hset.whichDates')}</span>
            <div className="chips">
              <button className={`chip${range ? '' : ' on'}`} onClick={() => setRange(false)}>
                {t('hset.singleDate')}
              </button>
              <button className={`chip${range ? ' on' : ''}`} onClick={() => setRange(true)}>
                {t('hset.dateRange')}
              </button>
            </div>
          </div>
          <div className="grid2">
            <Field label={range ? t('hset.startDate') : t('hset.date')} req>
              <DateField
                value={from}
                label={range ? t('hset.startDate') : t('hset.date')}
                onChange={setFrom}
              />
            </Field>
            {range ? (
              <Field label={t('hset.endDate')} req hint={t('hset.endDateHint')}>
                <DateField value={to} min={from} label={t('hset.endDate')} onChange={setTo} />
              </Field>
            ) : null}
          </div>
          <div className="field">
            <span>{t('hset.whatHappens')}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button className={`checkrow rankrow${closed ? ' on' : ''}`} onClick={() => setClosed(true)}>
                <span className={`check${closed ? ' on' : ''}`}>
                  <Icon d={I.check} size={14} w={3.5} />
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                  <span className="l">{t('hset.closedAllDay')}</span>
                  <span className="h">{t('hset.closedAllDayHint')}</span>
                </span>
              </button>
              <button className={`checkrow rankrow${closed ? '' : ' on'}`} onClick={() => setClosed(false)}>
                <span className={`check${closed ? '' : ' on'}`}>
                  <Icon d={I.check} size={14} w={3.5} />
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                  <span className="l">{t('hset.customHours')}</span>
                  <span className="h">{t('hset.customHoursHint')}</span>
                </span>
              </button>
            </div>
          </div>
          {!closed ? (
            <div className="field">
              <span>{t('hset.hoursThatDay')}</span>
              <div className="dayperiods">
                {periods.map((p, j) => (
                  <div key={j} className="periodrow">
                    <input
                      className="input"
                      type="time"
                      value={p[0]}
                      style={{ width: 124 }}
                      aria-label={t('hset.periodStart', { day: t('hset.date'), n: j + 1 })}
                      onChange={(e) =>
                        setPeriods(periods.map((q, k) => (k === j ? [e.target.value, q[1]] : q)))
                      }
                    />
                    <span className="muted">–</span>
                    <input
                      className="input"
                      type="time"
                      value={p[1]}
                      style={{ width: 124 }}
                      aria-label={t('hset.periodEnd', { day: t('hset.date'), n: j + 1 })}
                      onChange={(e) =>
                        setPeriods(periods.map((q, k) => (k === j ? [q[0], e.target.value] : q)))
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <Field label={t('hset.reason')} hint={t('hset.reasonHint')}>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {error ? (
            <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>
              {error}
            </p>
          ) : null}
        </div>
        <div className="panel-foot">
          <button className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => void save()}>
            {t('hset.saveException')}
          </button>
        </div>
      </aside>
    </>
  );
}

/* ── Public holidays ──────────────────────────────────────────── */

function HolidayCard({ loc, openPanel }: { loc: Location; openPanel: () => void }) {
  const { t } = useTranslation();
  const holidays = useHolidays(loc.id);
  const list = holidays.data?.holidays ?? [];
  const pending = list.filter((h) => h.state === 'open' && h.date >= TODAY);
  const applied = list.filter((h) => h.state === 'applied').length;
  const next = pending[0];

  return (
    <div className="card">
      <div className="card-header">
        <h2>{t('hset.publicHolidays')}</h2>
        <span className="muted" style={{ fontWeight: 500 }}>
          🇲🇰 {t('hset.mkFromLocation')}
        </span>
      </div>
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="holiday-state">
          <span className="holiday-num">{pending.length}</span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span className="bold">
              {pending.length === 1 ? t('hset.holidayNotSetup') : t('hset.holidaysNotSetup')}
            </span>
            <span className="muted" style={{ fontWeight: 500 }}>
              {applied
                ? t('hset.alreadyApplied', { n: applied, name: loc.name })
                : t('hset.nothingApplied', { name: loc.name })}{' '}
              {next ? t('hset.nextHoliday', { date: dateShort(next.date), name: next.name }) : ''}
            </span>
          </span>
        </div>
        <p className="muted" style={{ fontWeight: 500 }}>
          <strong>{t('hset.notClosedAnything')}</strong> {t('hset.holidayExplain')}
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-secondary" onClick={openPanel}>
            {t('hset.reviewHolidays')}
          </button>
          <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>
            {t('hset.youChoose')}
          </span>
        </div>
      </div>
    </div>
  );
}

function HolidayPanel({ loc, onClose }: { loc: Location; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [year, setYear] = useState<number | undefined>(undefined);
  const holidays = useHolidays(loc.id);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const years = holidays.data?.years ?? [];
  const activeYear =
    year ?? years.find((y) => y.year >= new Date().getFullYear())?.year ?? years[0]?.year;
  const meta = years.find((y) => y.year === activeYear);
  const list = (holidays.data?.holidays ?? []).filter((h) =>
    activeYear ? h.date.startsWith(String(activeYear)) : true,
  );
  const openOnes = list.filter((h) => h.state === 'open');

  const apply = async () => {
    setError(null);
    try {
      for (const id of Object.keys(picked).filter((k) => picked[k]))
        await post(ExceptionSchema, `/locations/${loc.id}/holidays/${id}/apply`, {});
      toast(t('hset.holidaysApplied'));
      setPicked({});
      void qc.invalidateQueries({ queryKey: ['holidays', loc.id] });
      void qc.invalidateQueries({ queryKey: ['exceptions', loc.id] });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const nPicked = Object.values(picked).filter(Boolean).length;

  return (
    <>
      <div className="scrim on" onClick={onClose} />
      <aside className="panel open" role="dialog" aria-modal="true">
        <div className="panel-head plain">
          <div>
            <h2>{t('hset.publicHolidays')}</h2>
            <div className="sub">{loc.name}</div>
          </div>
          <button className="iconbtn" aria-label={t('common.close')} onClick={onClose}>
            <Icon d={I.x} size={22} w={2.2} />
          </button>
        </div>
        <div className="panel-body">
          <div className="note">{t('hset.holidayPanelNote', { name: loc.name })}</div>
          {years.length > 1 ? (
            <div className="tabs">
              {years.map((y) => (
                <button
                  key={y.year}
                  className={`tab${activeYear === y.year ? ' active' : ''}`}
                  onClick={() => setYear(y.year)}
                >
                  {y.year}
                </button>
              ))}
            </div>
          ) : null}
          {meta && !meta.verified ? (
            <div className="note warn">
              {meta.source}. {t('hset.unverifiedNote')}
            </div>
          ) : null}
          <div className="field">
            <span>🇲🇰 {t('hset.northMacedonia')} · {activeYear}</span>
            <span className="hint">
              {t('hset.holidayCount', { total: list.length, open: openOnes.length })}
            </span>
            <div className="card">
              {list.map((h) => {
                const dis = h.state !== 'open';
                const on = picked[h.id] ?? false;
                return (
                  <div key={h.id} className={`rowcard${dis ? ' dim' : ''}`}>
                    {dis ? (
                      <span className="check on">
                        <Icon d={I.check} size={14} w={3.5} />
                      </span>
                    ) : (
                      <button
                        className={`check${on ? ' on' : ''}`}
                        aria-label={h.name}
                        aria-pressed={on}
                        onClick={() => setPicked({ ...picked, [h.id]: !on })}
                      >
                        <Icon d={I.check} size={14} w={3.5} />
                      </button>
                    )}
                    <span className="grow">
                      <span className="t">
                        {dateShort(h.date)} · {h.name}
                      </span>
                      <span className="s">
                        {h.type === 'RELIGIOUS' ? t('hset.religious') : t('hset.publicHoliday')} ·{' '}
                        {t('hset.appliesTo')}: {h.applies}
                        {h.movedFrom ? ` · ${t('hset.movedFrom', { date: dateShort(h.movedFrom) })}` : ''}
                      </span>
                    </span>
                    {h.state === 'applied' ? (
                      <span className="badge success">{t('hset.applied')}</span>
                    ) : h.state === 'covered' ? (
                      <span className="badge">{t('hset.alreadyConfigured')}</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="note">{t('hset.noSecondRule')}</div>
          {error ? (
            <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>
              {error}
            </p>
          ) : null}
        </div>
        <div className="panel-foot">
          <button className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" disabled={!nPicked} onClick={() => void apply()}>
            {t('hset.applySelected', { n: nPicked })}
          </button>
        </div>
      </aside>
    </>
  );
}
