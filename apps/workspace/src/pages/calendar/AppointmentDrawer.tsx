import {
  AppointmentSchema,
  CustomerListResponseSchema,
  type LineQuoteResponseSchema,
  type Appointment,
  type Employee,
} from '@velnes/contracts';
import { Badge, I, Icon } from '@velnes/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { ApiError, get, patch, refusalText } from '@velnes/client';
import {
  useBook,
  useCancelAppointment,
  useEmployees,
  useLineQuote,
  useLocationCatalog,
  useLocations,
} from '../../api/queries.js';
import { DateField } from '../../lib/DateField.js';
import { money } from '../../lib/money.js';
import { useToast } from '../../lib/toast.js';

/** The prototype's appointment drawer (PANELS.appointment): the save
 *  group sits top-right in the panel head, the body runs mode rows →
 *  customer → date → service lines → note → notify, and the foot
 *  carries the running total. Each service line is one `.apptrow`
 *  with its own time input — booking is validated by the one gate on
 *  save, exactly like the prototype's bookingCheck. */

const uuid = () =>
  crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();

type Row = { sid: string; eid: string; start: string; vid: string | null; mods: string[] };
type Quote = z.infer<typeof LineQuoteResponseSchema>;
type Mode = 'single' | 'group' | 'blocked';

/* The calendar's day, in 15-minute steps — the same DAY_START/DAY_END
 * the grid draws. Times already behind the clock are disabled for
 * today: you cannot book the past. */
const DAY_START = 480;
const DAY_END = 1140;
const TIME_OPTIONS: string[] = [];
for (let m = DAY_START; m < DAY_END; m += 15)
  TIME_OPTIONS.push(
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
  );
const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const nowMins = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};
const toMins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** The first slot still bookable on this date — the next quarter hour
 *  for today, the day's opening slot otherwise. */
const firstBookable = (date: string) => {
  if (date !== localIso(new Date())) return '09:00';
  const next = TIME_OPTIONS.find((t) => toMins(t) >= nowMins());
  return next ?? TIME_OPTIONS[TIME_OPTIONS.length - 1]!;
};

export function AppointmentDrawer({
  locationId,
  date: initialDate,
  time: initialTime,
  employeeId: initialEmp,
  appointment,
  employees,
  onClose,
}: {
  locationId: string;
  date: string;
  time: string | null;
  employeeId: string | null;
  appointment: Appointment | null;
  employees: Employee[];
  onClose: () => void;
}) {
  const editing = !!appointment;

  // The prototype squeezes the page while the panel is open.
  useEffect(() => {
    document.body.classList.add('panel-open');
    return () => document.body.classList.remove('panel-open');
  }, []);

  return (
    <>
      <div className="scrim on" onClick={onClose} />
      <aside className="panel open" role="dialog" aria-modal="true">
        {editing && appointment ? (
          <EditBody appointment={appointment} onClose={onClose} />
        ) : (
          <NewAppointment
            locationId={locationId}
            initialDate={initialDate}
            initialTime={initialTime}
            initialEmp={initialEmp}
            employees={employees}
            onClose={onClose}
          />
        )}
      </aside>
    </>
  );
}

/* ── New appointment — the prototype's lade, verbatim ─────────── */

function NewAppointment({
  locationId,
  initialDate,
  initialTime,
  initialEmp,
  employees,
  onClose,
}: {
  locationId: string;
  initialDate: string;
  initialTime: string | null;
  initialEmp: string | null;
  employees: Employee[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const catalog = useLocationCatalog(locationId);
  const customers = useQuery({
    queryKey: ['customers', 'drawer'],
    queryFn: () => get(CustomerListResponseSchema, '/customers?limit=100'),
  });
  const book = useBook();

  const services = (catalog.data?.services ?? []).filter((s) => s.config.active);
  const firstSid = services[0]?.id ?? '';
  // Default to the first employee who works at THIS location — the
  // alphabetical first may belong to another branch and every untouched
  // attempt would refuse with "not at this location".
  const firstEid =
    initialEmp ?? employees.find((e) => e.locationIds.includes(locationId))?.id ?? 'any';

  const [mode, setMode] = useState<Mode>('single');
  const [customerId, setCustomerId] = useState<string>('');
  const [date, setDate] = useState(initialDate);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [quotes, setQuotes] = useState<Record<number, Quote>>({});
  const [notify, setNotify] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The first row exists the moment the catalog answers — service and
  // employee default to the first of each, like the prototype's state
  // reset on open; a clicked slot carries its time and column. The
  // customer select likewise starts on the first customer.
  if (rows === null && firstSid) {
    // A clicked slot carries its time — unless that slot already lies
    // behind the clock, in which case the next bookable one steps in.
    const wanted =
      initialTime &&
      !(initialDate === localIso(new Date()) && toMins(initialTime) < nowMins())
        ? initialTime
        : firstBookable(initialDate);
    setRows([{ sid: firstSid, eid: firstEid, start: wanted, vid: null, mods: [] }]);
  }
  // Skip blacklisted customers for the default — the gate would refuse
  // the untouched form before anyone typed a thing.
  const firstCust =
    customers.data?.customers.find((c) => !c.blacklisted)?.id ??
    customers.data?.customers[0]?.id ??
    '';
  if (!customerId && firstCust) setCustomerId(firstCust);
  const rowList = rows ?? [];

  const touch = () => setDirty(true);
  const setRow = (i: number, next: Row) => {
    touch();
    setRows(rowList.map((r, j) => (j === i ? next : r)));
  };

  const total = rowList.reduce(
    (s, _, i) => ({
      price: s.price + (quotes[i]?.price ?? 0),
      min: s.min + (quotes[i]?.treatmentMin ?? 0),
    }),
    { price: 0, min: 0 },
  );

  const submit = async () => {
    setError(null);
    const created: string[] = [];
    try {
      for (const r of rowList) {
        const res = await book.mutateAsync({
          key: uuid(),
          locationId,
          serviceId: r.sid,
          date,
          time: r.start,
          employeeId: r.eid as 'any',
          variantId: r.vid,
          modifierOptionIds: r.mods,
          ...(customerId ? { customerId } : {}),
          source: 'staff',
          deposit: 0,
        });
        created.push(res.appointment.id);
      }
      onClose();
    } catch (e) {
      // The prototype rolls the whole set back when one line refuses.
      for (const id of created)
        await patch(AppointmentSchema, `/appointments/${id}`, { status: 'cancelled' }).catch(
          () => undefined,
        );
      const reason = refusalText(t, e);
      setError(reason);
      // The prototype toasts the refusal — the body may be scrolled
      // past the inline line, the toast is always in view.
      toast(reason);
    }
  };

  const meta: Record<Mode, { title: string; save: string }> = {
    single: { title: t('drawer.title.new'), save: t('drawer.bookAppointment') },
    group: { title: t('drawer.modeGroup'), save: t('drawer.bookGroup') },
    blocked: { title: t('drawer.modeBlocked'), save: t('drawer.blockTime') },
  };
  // Booking is an action, not an edit: the lade opens fully pre-filled,
  // so the button arms the moment there is something bookable. A
  // disabled primary looks clickable in this design — a dead button
  // here is exactly what the prototype's own principle forbids.
  const canSave = mode === 'single' && !!customerId && rowList.length > 0;

  return (
    <>
      <div className="panel-head">
        <div className="panel-topbar">
          <span className={`panel-status${dirty ? ' warn' : ''}`}>
            {dirty ? t('drawer.statusUnsaved') : t('drawer.statusSaved')}
          </span>
          <div className="panel-actions">
            <span className="panel-endgroup">
              <button
                className="btn btn-primary"
                disabled={!canSave || book.isPending}
                onClick={() => void submit()}
              >
                {book.isPending ? t('drawer.booking') : meta[mode].save}
              </button>
              <button className="panel-x" aria-label={t('common.close')} onClick={onClose}>
                <Icon d={I.x} size={20} />
              </button>
            </span>
          </div>
        </div>
        <div className="panel-ident">
          <div className="panel-idtext">
            <h2>
              {meta[mode].title}
              <button className="panel-rename" aria-label={t('drawer.rename')}>
                <Icon d={I.pencil} size={18} w={2} />
              </button>
            </h2>
            <p className="sub">{t(`drawer.subtitle.${mode}`)}</p>
          </div>
        </div>
      </div>

      <div className="panel-body">
        <div className="appt-modes">
          {(['group', 'blocked'] as const).map((k) => (
            <label key={k} className={`appt-mode${mode === k ? ' on' : ''}`}>
              <input
                type="checkbox"
                checked={mode === k}
                onChange={() => {
                  touch();
                  setMode(mode === k ? 'single' : k);
                }}
              />
              <span className="grow">
                <span className="t">{t(`drawer.mode${k === 'group' ? 'Group' : 'Blocked'}`)}</span>
                <span className="s">
                  {t(`drawer.mode${k === 'group' ? 'Group' : 'Blocked'}Sub`)}
                </span>
              </span>
            </label>
          ))}
        </div>

        {mode !== 'single' ? (
          <div className="note">{t('drawer.modePending')}</div>
        ) : (
          <>
            <label className="field">
              <span>
                {t('drawer.customer')}
                <span className="req">*</span>
              </span>
              <select
                className="select"
                style={{ width: '100%' }}
                value={customerId}
                onChange={(e) => {
                  touch();
                  setCustomerId(e.target.value);
                }}
              >
                {(customers.data?.customers ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>
                {t('drawer.date')}
                <span className="req">*</span>
              </span>
              <DateField
                value={date}
                min={localIso(new Date())}
                label={t('drawer.date')}
                onChange={(next) => {
                  touch();
                  setDate(next);
                  // Moving onto today pushes past start times forward.
                  const floor = firstBookable(next);
                  setRows(
                    rowList.map((r) =>
                      next === localIso(new Date()) && toMins(r.start) < toMins(floor)
                        ? { ...r, start: floor }
                        : r,
                    ),
                  );
                }}
              />
              <span className="hint">{t('drawer.dateHint')}</span>
            </label>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span style={{ fontWeight: 600 }}>{t('drawer.services')}</span>
              {rowList.map((r, i) => (
                <ApptRow
                  key={i}
                  row={r}
                  index={i}
                  locationId={locationId}
                  services={services}
                  employees={employees}
                  removable={rowList.length > 1}
                  onChange={(next) => setRow(i, next)}
                  date={date}
                  onRemove={() => {
                    touch();
                    setRows(rowList.filter((_, j) => j !== i));
                    setQuotes((q) => {
                      const next: Record<number, Quote> = {};
                      Object.entries(q).forEach(([k, v]) => {
                        const n = Number(k);
                        if (n < i) next[n] = v;
                        else if (n > i) next[n - 1] = v;
                      });
                      return next;
                    });
                  }}
                  onQuote={(quote) => setQuotes((q) => ({ ...q, [i]: quote }))}
                />
              ))}
              <button
                className="btn btn-subtle"
                style={{ width: 'fit-content' }}
                onClick={() => {
                  touch();
                  setRows([
                    ...rowList,
                    { sid: firstSid, eid: firstEid, start: firstBookable(date), vid: null, mods: [] },
                  ]);
                }}
              >
                <Icon d={I.plus} size={20} /> {t('drawer.addService')}
              </button>
            </div>

            <label className="field">
              <span>{t('drawer.note')}</span>
              <textarea className="input" placeholder={t('drawer.notePlaceholder')} onChange={touch} />
            </label>

            <button
              className="checkrow"
              onClick={() => {
                touch();
                setNotify(!notify);
              }}
            >
              <span className={`check${notify ? ' on' : ''}`}>
                <Icon d={I.check} size={14} w={3.5} />
              </span>
              <span style={{ fontWeight: 500 }}>{t('drawer.notify')}</span>
            </button>

            {error ? (
              <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>
                {error}
              </p>
            ) : null}
          </>
        )}
      </div>

      {mode === 'single' ? (
        <div className="panel-foot">
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="stat-label">{t('drawer.total')}</span>
            <span className="tnum" style={{ fontSize: 18, fontWeight: 700 }}>
              {money(total.price)} · {total.min} min
            </span>
          </div>
        </div>
      ) : null}
    </>
  );
}

/* One service line — the prototype's apptRowMarkup. */
function ApptRow({
  row,
  index,
  locationId,
  date,
  services,
  employees,
  removable,
  onChange,
  onRemove,
  onQuote,
}: {
  row: Row;
  index: number;
  locationId: string;
  date: string;
  services: NonNullable<ReturnType<typeof useLocationCatalog>['data']>['services'];
  employees: Employee[];
  removable: boolean;
  onChange: (next: Row) => void;
  onRemove: () => void;
  onQuote: (q: Quote) => void;
}) {
  const { t } = useTranslation();
  const service = services.find((s) => s.id === row.sid) ?? null;
  const variants = service?.variants.filter((v) => v.active) ?? [];
  const stdVid = variants.find((v) => v.std)?.id ?? null;
  const selVid = row.vid ?? stdVid;

  const quote = useLineQuote(
    row.sid
      ? {
          serviceId: row.sid,
          locationId,
          variantId: row.vid,
          modifierOptionIds: row.mods,
          employeeId: row.eid === 'any' ? null : row.eid,
        }
      : null,
  );
  // Deliberately keyed on the quote alone — onQuote is a fresh closure
  // every parent render and would loop the effect.
  useEffect(() => {
    if (quote.data) onQuote(quote.data);
  }, [quote.data]);

  return (
    <div className="apptrow">
      <select
        className="select"
        style={{ width: '100%' }}
        value={row.sid}
        aria-label={`${t('drawer.service')} ${index + 1}`}
        onChange={(e) => onChange({ ...row, sid: e.target.value, vid: null, mods: [] })}
      >
        {services.map((s) => {
          const vars = s.variants.filter((v) => v.active);
          const from = vars.length ? Math.min(...vars.map((v) => v.price)) : null;
          return (
            <option key={s.id} value={s.id}>
              {s.name}
              {from !== null
                ? ` · ${t('drawer.from')} ${money(from)}`
                : ` · ${s.config.durationMin} min`}
            </option>
          );
        })}
      </select>
      <select
        className="select"
        style={{ width: '100%' }}
        value={row.eid}
        aria-label={`${t('drawer.employee')} ${index + 1}`}
        onChange={(e) => onChange({ ...row, eid: e.target.value })}
      >
        <option value="any">{t('drawer.anyEmployee')}</option>
        {employees.map((em) => (
          <option key={em.id} value={em.id}>
            {em.name}
          </option>
        ))}
      </select>
      <div style={{ display: 'flex', gap: 8 }}>
        <select
          className="select tnum"
          value={row.start}
          style={{ flex: 1 }}
          aria-label={`${t('drawer.time')} ${index + 1}`}
          onChange={(e) => onChange({ ...row, start: e.target.value })}
        >
          {TIME_OPTIONS.map((tOpt) => (
            <option
              key={tOpt}
              value={tOpt}
              disabled={date === localIso(new Date()) && toMins(tOpt) < nowMins()}
            >
              {tOpt}
            </option>
          ))}
        </select>
        <button
          className="btn btn-subtle btn-icon"
          disabled={!removable}
          aria-label={t('drawer.removeService')}
          onClick={onRemove}
        >
          <Icon d={I.minus} size={20} />
        </button>
      </div>
      {variants.length ? (
        <div className="span2" style={{ gridColumn: '1/-1' }}>
          <span className="stat-label">{t('drawer.durationLabel')}</span>
          <div className="chips">
            {variants.map((v) => (
              <button
                key={v.id}
                className={`chip${selVid === v.id ? ' on' : ''}`}
                onClick={() => onChange({ ...row, vid: v.id })}
              >
                {v.label} · {money(v.price)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {service && service.modifiers.length ? (
        <div className="span2" style={{ gridColumn: '1/-1' }}>
          {service.modifiers.map((g) => (
            <div key={g.id} style={{ marginTop: 6 }}>
              <span className="stat-label">
                {g.name}
                {g.required ? <span className="req">*</span> : null}
                <span className="muted" style={{ textTransform: 'none', fontWeight: 500 }}>
                  {' '}
                  · {g.type === 'single' ? t('drawer.pickOne') : t('drawer.pickAny')}
                </span>
              </span>
              <div className="chips">
                {g.options.map((o) => {
                  const on = row.mods.includes(o.id);
                  const next = on
                    ? row.mods.filter((x) => x !== o.id)
                    : g.type === 'single'
                      ? [...row.mods.filter((x) => !g.options.some((oo) => oo.id === x)), o.id]
                      : [...row.mods, o.id];
                  return (
                    <button
                      key={o.id}
                      className={`chip${on ? ' on' : ''}`}
                      onClick={() => onChange({ ...row, mods: next })}
                    >
                      {o.name}
                      {o.price ? ` · ${o.price > 0 ? '+' : '−'}${money(Math.abs(o.price))}` : ''}
                      {o.durationMin
                        ? ` · ${o.durationMin > 0 ? '+' : '−'}${Math.abs(o.durationMin)} min`
                        : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {service && (variants.length || service.modifiers.length) && quote.data ? (
        <div className="span2" style={{ gridColumn: '1/-1' }}>
          <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>
            {t('drawer.thisLine', { price: money(quote.data.price), min: quote.data.treatmentMin })}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/* ── The appointment detail panel — the prototype's apptDetailMeta ── */

const SOURCE_KEYS: Record<string, string> = {
  marketplace: 'source.marketplace',
  widget: 'source.widget',
  link: 'source.link',
  staff: 'source.staff',
  pos: 'source.pos',
  phone: 'source.phone',
  walkin: 'source.walkin',
  google: 'source.google',
  instagram: 'source.instagram',
  api: 'source.api',
};

/** The prototype's apptEditable: only what is still to come moves.
 *  Today counts until the end time. */
function apptEditable(a: Appointment): boolean {
  if (a.kind !== 'appointment' || a.status === 'cancelled') return false;
  const today = localIso(new Date());
  if (a.date > today) return true;
  if (a.date < today) return false;
  return toMins(a.end) > nowMins();
}

function EditBody({ appointment: a, onClose }: { appointment: Appointment; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const cancel = useCancelAppointment();
  const employees = useEmployees();
  const locations = useLocations();
  const [editing, setEditing] = useState(false);

  const empName = employees.data?.employees.find((e) => e.id === a.employeeId)?.name ?? '—';
  const locName = locations.data?.locations.find((l) => l.id === a.locationId)?.name ?? '—';
  const editable = apptEditable(a);

  if (editing) return <RescheduleBody a={a} back={() => setEditing(false)} onClose={onClose} />;

  return (
    <>
      <div className="panel-head plain">
        <div>
          <h2>{a.title}</h2>
          <p className="sub">
            {a.start} – {a.end} · {a.serviceName ?? a.kind}
          </p>
        </div>
        <div className="panel-actions">
          <span className="panel-status">{t('drawer.statusSaved')}</span>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              toast(t('drawer.markedArrived'));
              onClose();
            }}
          >
            {t('drawer.markArrived')}
          </button>
          <button className="iconbtn" aria-label={t('common.close')} onClick={onClose}>
            <Icon d={I.x} size={20} />
          </button>
        </div>
      </div>
      <div className="panel-body">
        <div className="grid2">
          <div>
            <span className="stat-label">{t('drawer.employee')}</span>
            <div className="bold">
              {empName}
              {a.anyEmp ? (
                <span className="muted" style={{ display: 'block', fontSize: 12, fontWeight: 500 }}>
                  {t('drawer.noPreferenceHad')}
                </span>
              ) : null}
            </div>
          </div>
          <div>
            <span className="stat-label">{t('drawer.status')}</span>
            <div>
              <span className="badge success">{a.status}</span>
            </div>
          </div>
          <div>
            <span className="stat-label">{t('drawer.price')}</span>
            <div className="bold tnum">{money(a.price)}</div>
          </div>
          <div>
            <span className="stat-label">{t('drawer.location')}</span>
            <div className="bold">{locName}</div>
          </div>
          <div>
            <span className="stat-label">{t('drawer.bookedThrough')}</span>
            <div className="bold">{t(SOURCE_KEYS[a.source] ?? 'source.unknown')}</div>
          </div>
          {a.variantLabel ? (
            <div>
              <span className="stat-label">{t('drawer.durationChosen')}</span>
              <div className="bold">{a.variantLabel}</div>
            </div>
          ) : null}
        </div>
        {a.modifierNames.length ? (
          <div className="field">
            <span>{t('drawer.options')}</span>
            <div className="chips">
              {a.modifierNames.map((n) => (
                <span key={n} className="chip">
                  {n}
                </span>
              ))}
            </div>
            <span className="hint">{t('drawer.optionsHint')}</span>
          </div>
        ) : null}
        {a.source === 'marketplace' ? <div className="note">{t('drawer.marketplaceNote')}</div> : null}
        {a.kind === 'appointment' && a.status !== 'cancelled' ? (
          <button
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={() => {
              onClose();
              navigate('/till', { state: { payAppt: a.id } });
            }}
          >
            <Icon d={I.register} size={18} /> {t('drawer.takePayment')} · {money(a.price)}
          </button>
        ) : null}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {editable ? (
            <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
              {t('drawer.editAppt')}
            </button>
          ) : null}
          {a.customerId ? (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                onClose();
                navigate(`/customers/${a.customerId}`);
              }}
            >
              {t('drawer.openProfile')}
            </button>
          ) : null}
          {a.status !== 'cancelled' ? (
            <button
              className="btn btn-subtle btn-sm"
              onClick={() =>
                void cancel
                  .mutateAsync(a.id)
                  .then(() => toast(t('drawer.cancelled')))
                  .catch((e: unknown) =>
                    toast(
                      e instanceof ApiError && e.status === 404
                        ? t('drawer.gone')
                        : refusalText(t, e),
                    ),
                  )
                  .finally(onClose)
              }
            >
              {t('drawer.cancelBooking')}
            </button>
          ) : (
            <Badge tone="danger">{t('cal.cancelled')}</Badge>
          )}
        </div>
        {a.kind === 'appointment' && a.status !== 'cancelled' && !editable ? (
          <div className="note">{t('drawer.alreadyStarted')}</div>
        ) : null}
      </div>
    </>
  );
}

/* Rescheduling — the fields the one PATCH door moves: date, time and
 * employee. Service and price never change here; that is the catalog's
 * job at booking time. */
function RescheduleBody({
  a,
  back,
  onClose,
}: {
  a: Appointment;
  back: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const employees = useEmployees();
  const [date, setDate] = useState(a.date);
  const [time, setTime] = useState(a.start);
  const [employeeId, setEmployeeId] = useState(a.employeeId ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    try {
      await patch(AppointmentSchema, `/appointments/${a.id}`, {
        date,
        time,
        ...(employeeId ? { employeeId } : {}),
      });
      void qc.invalidateQueries({ queryKey: ['appointments'] });
      toast(t('drawer.rescheduled'));
      onClose();
    } catch (e) {
      // A 404 means the calendar showed a ghost — the appointment was
      // recreated or removed underneath us. Refresh and close.
      if (e instanceof ApiError && e.status === 404) {
        void qc.invalidateQueries({ queryKey: ['appointments'] });
        toast(t('drawer.gone'));
        onClose();
        return;
      }
      const reason = refusalText(t, e);
      setError(reason);
      toast(reason);
    }
  };

  return (
    <>
      <div className="panel-head plain">
        <div>
          <h2>{a.title}</h2>
          <p className="sub">
            {a.serviceName ?? a.kind} · {t('drawer.editAppt')}
          </p>
        </div>
        <div className="panel-actions">
          <button className="btn btn-primary btn-sm" onClick={() => void save()}>
            {t('cset.saveChanges')}
          </button>
          <button className="iconbtn" aria-label={t('common.close')} onClick={onClose}>
            <Icon d={I.x} size={20} />
          </button>
        </div>
      </div>
      <div className="panel-body">
        <label className="field">
          <span>
            {t('drawer.date')}
            <span className="req">*</span>
          </span>
          <DateField
            value={date}
            min={localIso(new Date())}
            label={t('drawer.date')}
            onChange={setDate}
          />
          <span className="hint">{t('drawer.moveHint')}</span>
        </label>
        <label className="field">
          <span>{t('drawer.time')}</span>
          <select className="select tnum" value={time} onChange={(e) => setTime(e.target.value)}>
            {TIME_OPTIONS.map((tOpt) => (
              <option
                key={tOpt}
                value={tOpt}
                disabled={date === localIso(new Date()) && toMins(tOpt) < nowMins()}
              >
                {tOpt}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('drawer.employee')}</span>
          <select
            className="select"
            style={{ width: '100%' }}
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            {(employees.data?.employees ?? []).map((em) => (
              <option key={em.id} value={em.id}>
                {em.name}
              </option>
            ))}
          </select>
        </label>
        <div className="note">{t('drawer.repriceNote')}</div>
        {error ? (
          <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>
            {error}
          </p>
        ) : null}
        <button className="btn btn-ghost btn-sm" style={{ width: 'fit-content' }} onClick={back}>
          {t('common.cancel')}
        </button>
      </div>
    </>
  );
}
