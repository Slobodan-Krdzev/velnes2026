import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { z } from 'zod';
import type { AvailabilityResponseSchema, ClientAppointmentSchema } from '@velnes/contracts';
import { t } from '../../lib/i18n-core.js';
import { i18n } from '../../lib/i18n-core.js';
import { ApiError } from '../../lib/api/client.js';
import { useSession } from '../../lib/api/session.js';
import { dayLbl, fmtMKD } from '../../lib/api/mappers.js';

type Appt = z.infer<typeof ClientAppointmentSchema>;
type Availability = z.infer<typeof AvailabilityResponseSchema>;

/**
 * Booking changes in My Velnes (Alex, 2026-09-30) — docs/BOOKING-CHANGES.md.
 *
 * Everything here renders what the server decided: `canReschedule`,
 * `canCancel`, the deadline, the blocked reason, the request's state.
 * Nothing recomputes the policy from a browser clock. The doors check
 * again at the click, and a refusal is shown by its code.
 */

const refusalText = (e: unknown): string => {
  if (e instanceof ApiError && e.code && i18n.exists(`refusal.${e.code}`)) return t(`refusal.${e.code}`, e.params ?? {});
  return e instanceof ApiError ? e.message : t('c.acc.cancelFailed');
};

/** "Fri, 2 Oct · 15:00" */
export const whenLbl = (date: string, time: string) => `${dayLbl(date)} · ${time}`;

const DAY_NAMES = () => t('c.date.days').split(',');
const MONTHS = () => t('c.date.months').split(',');
function dayChips(offset: number) {
  const out: { iso: string; lbl: string; small: string }[] = [];
  for (let i = offset; i < offset + 4; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const lbl = i === 0 ? t('c.date.today') : i === 1 ? t('c.date.tomorrow') : DAY_NAMES()[d.getDay()]!;
    const small = `${i < 2 ? `${DAY_NAMES()[d.getDay()]} ` : ''}${d.getDate()} ${MONTHS()[d.getMonth()]}`;
    out.push({ iso, lbl, small });
  }
  return out;
}

/* ── The policy, and whether cancelling is open ─────────────────────── */

export function PolicyCard({ a }: { a: Appt }) {
  const blocked = !a.canCancel && a.status !== 'cancelled';
  const hours = a.cancelHours;
  return (
    <div className={`acc-card${blocked ? ' acc-policy-blocked' : ''}`} data-testid="policy">
      <div className="acc-lbl">{t('c.acc.policy')}</div>
      <div className="sm" style={{ color: 'var(--ink)' }}>
        {hours > 0 ? t('c.acc.policyFree', { hours }) : t('c.acc.policyUntilStart')}
      </div>
      {blocked ? (
        <div className="sm acc-blocked" role="status" style={{ marginTop: 8 }}>
          <b>{t('c.acc.cancelClosed')}</b>
          <div>
            {a.cancelBlockedReason === 'started'
              ? t('c.acc.cancelClosedStarted')
              : hours > 0
                ? t('c.acc.cancelClosedWhy', { hours })
                : t('c.acc.cancelClosedStarted')}
          </div>
          <div className="muted">{t('c.acc.cancelClosedContact')}</div>
        </div>
      ) : a.cancelDeadline ? (
        <div className="sm muted" style={{ marginTop: 6 }}>
          {t('c.acc.cancelUntil', { when: new Date(a.cancelDeadline).toLocaleString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) })}
        </div>
      ) : null}
    </div>
  );
}

/* ── Rescheduling ───────────────────────────────────────────────────── */

export function ReschedulePicker({ a, onClose, onSent }: { a: Appt; onClose: () => void; onSent: () => void }) {
  const { api } = useSession();
  const qc = useQueryClient();
  const [dayOffset, setDayOffset] = useState(0);
  const days = useMemo(() => dayChips(dayOffset), [dayOffset]);
  const [date, setDate] = useState(days[0]!.iso);
  const [time, setTime] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!days.some((d) => d.iso === date)) setDate(days[0]!.iso);
  }, [days, date]);
  const slotsQ = useQuery({
    queryKey: ['reschedule-slots', a.id, date],
    queryFn: () => api<Availability>(`/me/appointments/${a.id}/reschedule-slots?date=${date}`),
    staleTime: 30_000,
  });
  const free = (slotsQ.data?.slots ?? []).filter((s) => s.free).map((s) => s.t);
  // The time it already has is not a new time.
  const offered = free.filter((x) => !(date === a.date && x === a.time));

  const send = async () => {
    setBusy(true);
    setErr('');
    try {
      await api(`/me/appointments/${a.id}/reschedule`, { method: 'POST', body: JSON.stringify({ date, time }) });
      await Promise.all([qc.invalidateQueries({ queryKey: ['my-appointments'] }), qc.invalidateQueries({ queryKey: ['my-notifications'] })]);
      onSent();
    } catch (e) {
      setErr(refusalText(e));
      setConfirm(false);
    }
    setBusy(false);
  };

  if (confirm)
    return (
      <div className="acc-card rs-confirm" role="dialog" aria-label={t('c.acc.rsConfirmTitle')}>
        <h3 className="serif">{t('c.acc.rsConfirmTitle')}</h3>
        <div className="acc-kv">
          <span>{t('c.acc.rsCurrent')}</span>
          <b>{whenLbl(a.date, a.time)}</b>
        </div>
        <div className="acc-kv">
          <span>{t('c.acc.rsRequested')}</span>
          <b>{whenLbl(date, time)}</b>
        </div>
        <p className="sm rs-note">
          <b>{t('c.acc.rsOnlyAfter')}</b> {t('c.acc.rsOnlyAfterSub')}
        </p>
        {err ? <div className="acc-err">{err}</div> : null}
        <div className="acc-actions">
          <button className="btn btn-p" disabled={busy} onClick={() => void send()}>
            {busy ? t('c.acc.rsSending') : t('c.acc.rsSend')}
          </button>
          <button className="btn btn-g" disabled={busy} onClick={() => setConfirm(false)}>
            {t('c.acc.back')}
          </button>
        </div>
      </div>
    );

  return (
    <div className="acc-card rs-pick" role="dialog" aria-label={t('c.acc.reschedule')}>
      <h3 className="serif">{t('c.acc.rsTitle')}</h3>
      <div className="sm muted">{t('c.acc.rsSub', { when: whenLbl(a.date, a.time) })}</div>
      <div className="dayrow" style={{ marginTop: 12 }}>
        <button className="daychip daychip--cal" onClick={() => setDayOffset(Math.max(0, dayOffset - 4))} aria-label={t('c.sal.earlier')} disabled={dayOffset === 0}>
          ‹
        </button>
        {days.map((day) => (
          <button key={day.iso} className={`daychip${date === day.iso ? ' on' : ''}`} onClick={() => { setDate(day.iso); setTime(''); }}>
            {day.lbl}
            <small>{day.small}</small>
          </button>
        ))}
        <button className="daychip daychip--cal" onClick={() => setDayOffset(dayOffset + 4)} aria-label={t('c.sal.later')}>
          ›
        </button>
      </div>
      <div className="timegrid" style={{ marginTop: 10 }}>
        {offered.map((x) => (
          <button key={x} className={`slot${time === x ? ' on' : ''}`} onClick={() => setTime(x)}>
            {x}
          </button>
        ))}
        {slotsQ.data && !offered.length ? (
          <div className="sm muted" style={{ gridColumn: '1/-1' }}>{t('c.acc.rsNoSlots')}</div>
        ) : null}
      </div>
      {err ? <div className="acc-err">{err}</div> : null}
      <div className="acc-actions">
        <button className="btn btn-p" disabled={!time} onClick={() => setConfirm(true)}>
          {t('c.acc.rsContinue')}
        </button>
        <button className="btn btn-g" onClick={onClose}>
          {t('c.acc.cancel')}
        </button>
      </div>
    </div>
  );
}

/** The request as it stands: waiting, declined (and asking), approved. */
export function RequestCard({ a, onCancelInstead }: { a: Appt; onCancelInstead: () => void }) {
  const { api } = useSession();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const r = a.changeRequest;
  if (!r) return null;
  const act = async (path: string) => {
    setBusy(true);
    setErr('');
    try {
      await api(`/me/appointments/${a.id}/reschedule/${path}`, { method: 'POST' });
      await Promise.all([qc.invalidateQueries({ queryKey: ['my-appointments'] }), qc.invalidateQueries({ queryKey: ['my-notifications'] })]);
    } catch (e) {
      setErr(refusalText(e));
    }
    setBusy(false);
  };
  if (r.status === 'pending')
    return (
      <div className="acc-card rs-pending" role="status">
        <div className="acc-badge warn">{t('c.acc.rsWaiting')}</div>
        <div className="sm" style={{ marginTop: 8 }}>{t('c.acc.rsWaitingSub')}</div>
        <div className="acc-kv" style={{ marginTop: 8 }}>
          <span>{t('c.acc.rsConfirmed')}</span>
          <b>{whenLbl(r.originalDate, r.originalTime)}</b>
        </div>
        <div className="acc-kv">
          <span>{t('c.acc.rsRequested')}</span>
          <b>{whenLbl(r.requestedDate, r.requestedTime)}</b>
        </div>
        {err ? <div className="acc-err">{err}</div> : null}
        <button className="btn btn-g" style={{ width: '100%', marginTop: 8 }} disabled={busy} onClick={() => void act('withdraw')}>
          {t('c.acc.rsWithdraw')}
        </button>
      </div>
    );
  if (r.status === 'declined' && !r.customerDecision)
    return (
      <div className="acc-card rs-declined" role="alertdialog" aria-label={t('c.acc.rsDeclined')}>
        <div className="acc-badge off">{t('c.acc.rsDeclined')}</div>
        <div className="sm" style={{ marginTop: 8 }}>
          {t('c.acc.rsDeclinedSub', { when: whenLbl(a.date, a.time) })}
          {r.declineReason ? <div className="muted" style={{ marginTop: 4 }}>{t('c.acc.rsTheirNote', { reason: r.declineReason })}</div> : null}
        </div>
        <div className="sm" style={{ marginTop: 10, fontWeight: 700 }}>{t('c.acc.rsWhatNow')}</div>
        {!a.canCancel ? (
          <div className="sm acc-blocked" role="status" style={{ marginTop: 6 }}>
            {a.cancelHours > 0 ? t('c.acc.cancelClosedWhy', { hours: a.cancelHours }) : t('c.acc.cancelClosedStarted')}
          </div>
        ) : null}
        {err ? <div className="acc-err">{err}</div> : null}
        <div className="acc-actions">
          <button className="btn btn-p" disabled={busy} onClick={() => void act('keep')}>
            {t('c.acc.rsKeep')}
          </button>
          {a.canCancel ? (
            <button className="btn btn-g" disabled={busy} onClick={onCancelInstead}>
              {t('c.acc.cancelAppt')}
            </button>
          ) : null}
        </div>
      </div>
    );
  if (r.status === 'approved')
    return (
      <div className="acc-card rs-approved" role="status">
        <div className="acc-badge ok">{t('c.acc.rsApproved')}</div>
        <div className="acc-kv" style={{ marginTop: 8 }}>
          <span>{t('c.acc.rsOriginally')}</span>
          <b>{whenLbl(r.originalDate, r.originalTime)}</b>
        </div>
        <div className="acc-kv">
          <span>{t('c.acc.rsNewTime')}</span>
          <b>{whenLbl(r.requestedDate, r.requestedTime)}</b>
        </div>
        <div className="sm muted" style={{ marginTop: 6 }}>{t('c.acc.rsApprovedSub')}</div>
      </div>
    );
  return null;
}

/* ── Cancelling ─────────────────────────────────────────────────────── */

export function CancelConfirm({ a, onClose, onDone }: { a: Appt; onClose: () => void; onDone: () => void }) {
  const { api } = useSession();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const cancel = async () => {
    setBusy(true);
    setErr('');
    try {
      await api(`/me/appointments/${a.id}/cancel`, { method: 'POST', body: JSON.stringify({}) });
      await Promise.all([qc.invalidateQueries({ queryKey: ['my-appointments'] }), qc.invalidateQueries({ queryKey: ['my-notifications'] })]);
      onDone();
    } catch (e) {
      setErr(refusalText(e));
      // The door said no: the page follows the door.
      await qc.invalidateQueries({ queryKey: ['my-appointments'] });
    }
    setBusy(false);
  };
  return (
    <div className="acc-card cx-confirm" role="alertdialog" aria-label={t('c.acc.cxTitle')}>
      <h3 className="serif">{t('c.acc.cxTitle')}</h3>
      <div className="sm" style={{ marginTop: 6 }}>
        <b>{a.serviceName}</b>
        <div className="muted">{a.salonName}</div>
        <div style={{ marginTop: 4 }}>{whenLbl(a.date, a.time)}</div>
      </div>
      <p className="sm" style={{ marginTop: 10 }}>{t('c.acc.cxWarn')}</p>
      {a.payment.status === 'paid' ? <p className="sm muted">{t('c.acc.cxRefundNote')}</p> : null}
      {err ? <div className="acc-err">{err}</div> : null}
      <div className="acc-actions">
        <button className="btn btn-g" disabled={busy} onClick={onClose}>
          {t('c.acc.cxKeep')}
        </button>
        <button className="btn btn-danger" disabled={busy} onClick={() => void cancel()}>
          {busy ? t('c.acc.cxBusy') : t('c.acc.cancelAppt')}
        </button>
      </div>
    </div>
  );
}

/* ── Money, and what happened ───────────────────────────────────────── */

export function PaymentLines({ a }: { a: Appt }) {
  if (a.payment.status === 'unpaid' && !a.refund) return null;
  return (
    <>
      {a.payment.status !== 'unpaid' ? (
        <div className="acc-kv">
          <span>{t('c.acc.payment')}</span>
          <b>{a.payment.status === 'paid' ? t('c.acc.paidOnline') : t('c.acc.payAtSalon')}</b>
        </div>
      ) : null}
      {a.refund ? (
        <div className="acc-kv">
          <span>{t('c.acc.refund')}</span>
          <b>
            {t(`c.acc.refund_${a.refund.status}`)} · {fmtMKD(a.refund.amount)}
          </b>
        </div>
      ) : null}
    </>
  );
}

const HISTORY_KEYS: Record<string, string> = {
  Created: 'c.acc.h.created',
  Requested: 'c.acc.h.requested',
  Accepted: 'c.acc.h.accepted',
  Declined: 'c.acc.h.declined',
  'Reschedule requested': 'c.acc.h.rsRequested',
  'Reschedule approved': 'c.acc.h.rsApproved',
  'Reschedule declined': 'c.acc.h.rsDeclined',
  'Reschedule request withdrawn': 'c.acc.h.rsWithdrawn',
  'Original appointment kept': 'c.acc.h.kept',
  Cancelled: 'c.acc.h.cancelled',
  'Refund requested': 'c.acc.h.refundRequested',
  'Refund completed': 'c.acc.h.refundCompleted',
  'Refund failed': 'c.acc.h.refundFailed',
  'Will pay at the venue': 'c.acc.h.venue',
  Moved: 'c.acc.h.moved',
};

/** A simple activity section — never the full audit. */
export function VisitHistory({ a }: { a: Appt }) {
  const rows = a.history.filter((h) => HISTORY_KEYS[h.what]);
  if (rows.length < 2) return null;
  return (
    <div className="acc-card">
      <div className="acc-lbl">{t('c.acc.activity')}</div>
      {rows.map((h, i) => {
        const meta = h.meta as { from?: string; to?: string; by?: string; requested?: string };
        const detail =
          h.what === 'Reschedule requested' || h.what === 'Reschedule approved'
            ? `${meta.from ?? ''} → ${meta.to ?? ''}`
            : h.what === 'Reschedule declined'
              ? meta.requested ?? ''
              : h.what === 'Cancelled'
                ? meta.by === 'customer' ? t('c.acc.h.byYou') : meta.by === 'salon' ? t('c.acc.h.bySalon') : ''
                : '';
        return (
          <div className="acc-kv" key={i}>
            <span>{new Date(h.at).toLocaleString(i18n.language, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            <b>
              {t(HISTORY_KEYS[h.what]!)}
              {detail ? <span className="muted" style={{ display: 'block', fontWeight: 500 }}>{detail}</span> : null}
            </b>
          </div>
        );
      })}
    </div>
  );
}
