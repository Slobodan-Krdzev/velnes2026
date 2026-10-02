import type { Appointment } from '@velnes/contracts';
import { Badge, I, Icon } from '@velnes/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { refusalText } from '@velnes/client';
import { useAppointmentChanges, useDecideChange } from '../../api/queries.js';
import { money } from '../../lib/money.js';
import { useToast } from '../../lib/toast.js';

/**
 * A visit's changes in the drawer (Alex, 2026-09-30) — docs/BOOKING-CHANGES.md:
 * the customer's reschedule request with Approve / Decline, the
 * cancellation as a fact, the payment and refund state, and the
 * timeline staff coordinate by. Read-only apart from the two decisions;
 * nothing here edits history or money.
 */

const when = (date: string, time: string) => `${date.slice(8)}.${date.slice(5, 7)} · ${time}`;
const stamp = (iso: string, lang: string) =>
  new Date(iso).toLocaleString(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const HISTORY: Record<string, string> = {
  Created: 'drawer.h.created',
  Requested: 'drawer.h.requested',
  Accepted: 'drawer.h.accepted',
  Declined: 'drawer.h.declined',
  Moved: 'drawer.h.moved',
  'Reschedule requested': 'drawer.h.rsRequested',
  'Reschedule approved': 'drawer.h.rsApproved',
  'Reschedule declined': 'drawer.h.rsDeclined',
  'Reschedule request withdrawn': 'drawer.h.rsWithdrawn',
  'Original appointment kept': 'drawer.h.kept',
  Cancelled: 'drawer.h.cancelled',
  'Refund requested': 'drawer.h.refundRequested',
  'Refund completed': 'drawer.h.refundCompleted',
  'Refund failed': 'drawer.h.refundFailed',
  'Will pay at the venue': 'drawer.h.venue',
  'Treatment started': 'drawer.h.started',
  'Treatment finished': 'drawer.h.finished',
};

export function ChangesPanel({ a, onClose }: { a: Appointment; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const q = useAppointmentChanges(a.id);
  const decide = useDecideChange();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const c = q.data;
  if (!c) return null;
  const r = c.changeRequest;
  return (
    <>
      {r?.status === 'pending' ? (
        <div className="note rs-request" data-testid="change-request">
          <div className="bold">{t('drawer.rsTitle')}</div>
          <div className="grid2" style={{ marginTop: 8 }}>
            <div>
              <span className="stat-label">{t('drawer.rsCurrent')}</span>
              <div className="bold tnum">
                {when(r.originalDate, r.originalTime)} – {r.originalEnd}
              </div>
            </div>
            <div>
              <span className="stat-label">{t('drawer.rsRequested')}</span>
              <div className="bold tnum">
                {when(r.requestedDate, r.requestedTime)} – {r.requestedEnd}
              </div>
            </div>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t('drawer.rsNote')}</div>
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            <button
              className="btn btn-primary"
              style={{ width: '100%' }}
              disabled={decide.isPending}
              onClick={() =>
                void decide
                  .mutateAsync({ id: r.id, action: 'approve' })
                  .then(() => {
                    toast(t('drawer.rsApproved'));
                    onClose();
                  })
                  .catch((e: unknown) => toast(refusalText(t, e)))
              }
            >
              <Icon d={I.check} size={18} /> {t('drawer.rsApprove')}
            </button>
            {declining ? (
              <>
                <textarea className="ta" rows={2} placeholder={t('drawer.declineReason')} value={reason} onChange={(e) => setReason(e.target.value)} />
                <button
                  className="btn btn-subtle"
                  style={{ width: '100%' }}
                  disabled={decide.isPending}
                  onClick={() =>
                    void decide
                      .mutateAsync({ id: r.id, action: 'decline', reason: reason.trim() || undefined })
                      .then(() => {
                        toast(t('drawer.rsDeclined'));
                        onClose();
                      })
                      .catch((e: unknown) => toast(refusalText(t, e)))
                  }
                >
                  {t('drawer.rsDecline')}
                </button>
              </>
            ) : (
              <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => setDeclining(true)}>
                {t('drawer.rsDecline')}
              </button>
            )}
          </div>
        </div>
      ) : r?.status === 'declined' && !r.customerDecision ? (
        <div className="note">{t('drawer.rsAwaitingCustomer', { when: when(r.requestedDate, r.requestedTime) })}</div>
      ) : null}

      {c.cancellation ? (
        <div className="note">
          <Badge tone="danger">{t('cal.cancelled')}</Badge>{' '}
          {t(`drawer.cancelledBy.${c.cancellation.by}`)} · {stamp(c.cancellation.at, i18n.language)}
          {c.cancellation.reason ? <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{c.cancellation.reason}</div> : null}
        </div>
      ) : null}

      {c.payment.status !== 'unpaid' || c.refund ? (
        <div className="grid2">
          <div>
            <span className="stat-label">{t('drawer.payment')}</span>
            <div className="bold">
              {c.payment.status === 'paid' ? `${t('drawer.paidOnline')} · ${money(c.payment.amount ?? 0)}` : t('drawer.payAtVenue')}
            </div>
          </div>
          {c.refund ? (
            <div>
              <span className="stat-label">{t('drawer.refund')}</span>
              <div className="bold">
                <span className={`badge ${c.refund.status === 'refunded' ? 'success' : c.refund.status === 'failed' ? 'danger' : 'warning'}`}>
                  {t(`drawer.refund_${c.refund.status}`)}
                </span>{' '}
                {money(c.refund.amount)}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {c.history.length > 1 ? (
        <div className="field">
          <span>{t('drawer.history')}</span>
          <div className="timeline" data-testid="history">
            {c.history.map((h, i) => {
              const meta = h.meta as { from?: string; to?: string; requested?: string; reason?: string; by?: string };
              const detail =
                h.what === 'Reschedule requested' || h.what === 'Reschedule approved'
                  ? `${meta.from ?? ''} → ${meta.to ?? ''}`
                  : h.what === 'Reschedule declined'
                    ? [meta.requested, meta.reason].filter(Boolean).join(' · ')
                    : h.what === 'Cancelled' && meta.by
                      ? t(`drawer.cancelledBy.${meta.by}`)
                      : '';
              return (
                <div key={i} className="tl-row">
                  <span className="muted tnum" style={{ fontSize: 12 }}>{stamp(h.at, i18n.language)}</span>
                  <span>
                    <b>{HISTORY[h.what] ? t(HISTORY[h.what]!) : h.what}</b>
                    {h.byName ? <span className="muted"> · {h.byName}</span> : null}
                    {detail ? <span className="muted" style={{ display: 'block', fontSize: 12 }}>{detail}</span> : null}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}
