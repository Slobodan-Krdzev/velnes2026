import type { BookingRequestRow, ChangeRequestRow } from '@velnes/contracts';
import { I, Icon } from '@velnes/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { refusalText } from '@velnes/client';
import { useDecideChange, useDecideRequest, usePendingRequests } from '../../api/queries.js';
import { money } from '../../lib/money.js';
import { useToast } from '../../lib/toast.js';

/**
 * Requests (Alex, 2026-10-01): everything a customer is waiting on the
 * salon for, on one screen — booking requests to accept or decline, and
 * reschedule requests to approve or decline — answered here through the
 * same doors the calendar drawer uses, or opened in the calendar to see
 * the day around them. Reached from the flight deck's card.
 */
export function RequestsPage() {
  const { t } = useTranslation();
  const q = usePendingRequests();
  const d = q.data;
  return (
    <div className="requests" style={{ display: 'grid', gap: 20 }}>
      <div>
        <h1 style={{ margin: 0 }}>{t('rq.title')}</h1>
        <p className="muted" style={{ margin: '4px 0 0' }}>{t('rq.sub')}</p>
      </div>
      <div className="card" style={{ overflow: 'hidden' }} data-testid="rq-bookings">
        <div className="card-header">
          <h2>{t('rq.bookings')}</h2>
          <span className="muted">{d ? d.bookings.length : '…'}</span>
        </div>
        {d && d.bookings.length === 0 ? (
          <div className="empty" style={{ padding: 24 }}>
            <p>{t('rq.noneBookings')}</p>
          </div>
        ) : (
          d?.bookings.map((b) => <BookingRow key={b.id} b={b} />)
        )}
      </div>
      <div className="card" style={{ overflow: 'hidden' }} data-testid="rq-reschedules">
        <div className="card-header">
          <h2>{t('rq.reschedules')}</h2>
          <span className="muted">{d ? d.reschedules.length : '…'}</span>
        </div>
        {d && d.reschedules.length === 0 ? (
          <div className="empty" style={{ padding: 24 }}>
            <p>{t('cal.noRequests')}</p>
          </div>
        ) : (
          d?.reschedules.map((r) => <RescheduleRow key={r.id} r={r} />)
        )}
      </div>
    </div>
  );
}

const when = (date: string, time: string) => `${date.slice(8, 10)}.${date.slice(5, 7)} · ${time}`;

/** The decline, with its optional note — the same shape in both lists. */
function Decline({ busy, onDecline }: { busy: boolean; onDecline: (reason: string | undefined) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open)
    return (
      <button className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
        {t('drawer.decline')}
      </button>
    );
  return (
    <span style={{ display: 'grid', gap: 6, minWidth: 220 }}>
      <textarea className="ta" rows={2} placeholder={t('drawer.declineReason')} value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className="btn btn-subtle btn-sm" disabled={busy} onClick={() => onDecline(reason.trim() || undefined)}>
        {t('drawer.decline')}
      </button>
    </span>
  );
}

function BookingRow({ b }: { b: BookingRequestRow }) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const decide = useDecideRequest();
  return (
    <div className="rq-row" data-testid="rq-booking" style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '12px 20px', borderTop: '1px solid var(--line)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="bold">{b.customerName}</div>
        <div className="muted" style={{ fontSize: 13 }}>
          {b.serviceName} · {when(b.date, b.time)}–{b.end} · {b.locationName}
          {b.employeeName ? ` · ${b.employeeName}` : ''} · {money(b.price)}
          {b.productUnits ? ` · ${t('rq.products', { n: b.productUnits })}` : ''}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>{t('rq.askedAt', { when: b.requestedAt.slice(0, 16).replace('T', ' ') })}</div>
      </div>
      <button className="btn btn-subtle btn-sm" onClick={() => navigate('/calendar', { state: { appointment: b.id } })}>
        <Icon d={I.calendar} size={16} /> {t('rq.open')}
      </button>
      <button
        className="btn btn-primary btn-sm"
        disabled={decide.isPending}
        onClick={() =>
          void decide
            .mutateAsync({ id: b.id, decision: 'accept' })
            .then(() => toast(t('drawer.accepted')))
            .catch((e: unknown) => toast(refusalText(t, e)))
        }
      >
        <Icon d={I.check} size={16} /> {t('drawer.accept')}
      </button>
      <Decline
        busy={decide.isPending}
        onDecline={(reason) =>
          void decide
            .mutateAsync({ id: b.id, decision: 'decline', reason })
            .then(() => toast(t('drawer.declined')))
            .catch((e: unknown) => toast(refusalText(t, e)))
        }
      />
    </div>
  );
}

function RescheduleRow({ r }: { r: ChangeRequestRow }) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const decide = useDecideChange();
  return (
    <div className="rq-row" data-testid="rq-reschedule" style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '12px 20px', borderTop: '1px solid var(--line)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="bold">{r.customerName}</div>
        <div className="muted" style={{ fontSize: 13 }}>
          {r.serviceName} · {r.locationName}
          {r.employeeName ? ` · ${r.employeeName}` : ''}
        </div>
        <div className="tnum" style={{ fontSize: 13 }}>
          {when(r.originalDate, r.originalTime)}–{r.originalEnd} → <b>{when(r.requestedDate, r.requestedTime)}–{r.requestedEnd}</b>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>{t('rq.askedAt', { when: r.requestedAt.slice(0, 16).replace('T', ' ') })}</div>
      </div>
      <button className="btn btn-subtle btn-sm" onClick={() => navigate('/calendar', { state: { appointment: r.appointmentId } })}>
        <Icon d={I.calendar} size={16} /> {t('rq.open')}
      </button>
      <button
        className="btn btn-primary btn-sm"
        disabled={decide.isPending}
        onClick={() =>
          void decide
            .mutateAsync({ id: r.id, action: 'approve' })
            .then(() => toast(t('drawer.rsApproved')))
            .catch((e: unknown) => toast(refusalText(t, e)))
        }
      >
        <Icon d={I.check} size={16} /> {t('drawer.rsApprove')}
      </button>
      <Decline
        busy={decide.isPending}
        onDecline={(reason) =>
          void decide
            .mutateAsync({ id: r.id, action: 'decline', reason })
            .then(() => toast(t('drawer.rsDeclined')))
            .catch((e: unknown) => toast(refusalText(t, e)))
        }
      />
    </div>
  );
}
