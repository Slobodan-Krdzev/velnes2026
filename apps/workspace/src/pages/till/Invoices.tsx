import { InvoiceListResponseSchema, InvoiceSchema, type Invoice } from '@velnes/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { I, Icon } from '@velnes/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { get, post } from '@velnes/client';
import { money } from '../../lib/money.js';
import { useToast } from '../../lib/toast.js';
import { useSession } from '@velnes/client';

const TONE: Record<string, string> = { Paid: 'success', Refunded: 'danger' };

export function InvoicesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useSession();
  const [method, setMethod] = useState('all');
  const [open, setOpen] = useState<Invoice | null>(null);
  const [reason, setReason] = useState('');

  const invoices = useQuery({
    queryKey: ['invoices'],
    queryFn: () => get(InvoiceListResponseSchema, '/invoices?limit=100'),
  });
  const rows = (invoices.data?.invoices ?? []).filter(
    (i) => method === 'all' || i.method === method,
  );

  const refund = async () => {
    if (!open || !reason) return;
    const updated = await post(InvoiceSchema, `/invoices/${open.id}/refund`, { reason });
    setOpen(updated);
    setReason('');
    toast(t('till.refunded'));
    void qc.invalidateQueries({ queryKey: ['invoices'] });
  };

  return (
    <>
      <button className="backlink" onClick={() => navigate('/till')}>
        <Icon d={I.arrowleft} size={16} /> {t('till.backToRegister')}
      </button>
      <div className="toolbar toolbar-row">
        <div className="filters">
          <select
            className="select"
            aria-label={t('till.method')}
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            {['all', 'Card', 'Cash', 'Gift card', 'Bank transfer'].map((m) => (
              <option key={m} value={m}>
                {m === 'all' ? t('till.allMethods') : m}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="card">
        {rows.length === 0 ? (
          <div className="empty">
            <h3>{t('till.noInvoices')}</h3>
            <p>{t('till.noInvoicesSub')}</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('till.invoice')}</th>
                <th>{t('drawer.date')}</th>
                <th>{t('drawer.customer')}</th>
                <th className="sec">{t('drawer.employee')}</th>
                <th className="sec">{t('till.method')}</th>
                <th>{t('till.status')}</th>
                <th className="right">{t('till.total')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className="clickable" onClick={() => setOpen(i)}>
                  <td className="bold tnum">{i.number}</td>
                  <td className="muted tnum">{i.date}</td>
                  <td>{i.customerName}</td>
                  <td className="muted sec">{i.employeeName}</td>
                  <td className="muted sec">{i.method}</td>
                  <td>
                    <span className={`badge ${TONE[i.status] ?? ''}`}>{i.status}</span>
                  </td>
                  <td className="right bold tnum">{money(i.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open ? (
        <div className="overlay" onClick={() => setOpen(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{open.number}</h2>
            </div>
            <div className="modal-body" style={{ display: 'grid', gap: 14 }}>
              <div className="grid2">
                <div>
                  <span className="stat-label">{t('drawer.customer')}</span>
                  <div className="bold">{open.customerName}</div>
                </div>
                <div>
                  <span className="stat-label">{t('drawer.date')}</span>
                  <div className="bold tnum">{open.date}</div>
                </div>
                <div>
                  <span className="stat-label">{t('drawer.employee')}</span>
                  <div className="bold">{open.employeeName}</div>
                </div>
                <div>
                  <span className="stat-label">{t('till.method')}</span>
                  <div className="bold">{open.method}</div>
                </div>
              </div>
              <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-control)' }}>
                {open.lines.map((l, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      borderBottom: '1px solid var(--line)',
                    }}
                  >
                    <span style={{ fontWeight: 500 }}>
                      {l.qty} × {l.description}
                    </span>
                    <span className="tnum" style={{ fontWeight: 600 }}>
                      {money(l.qty * l.unitPrice)}
                    </span>
                  </div>
                ))}
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px' }}
                >
                  <span className="bold">{t('till.total')}</span>
                  <span className="bold tnum">{money(open.total)}</span>
                </div>
              </div>
              {open.status === 'Paid' && can('pos.refund') ? (
                <label className="field">
                  <span>{t('till.refundReason')}</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      className="input"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <button
                      className="btn btn-primary"
                      style={{ background: 'var(--danger)' }}
                      disabled={!reason}
                      onClick={() => void refund()}
                    >
                      {t('till.refund')}
                    </button>
                  </div>
                </label>
              ) : null}
            </div>
            <button className="modal-close" aria-label={t('common.close')} onClick={() => setOpen(null)}>
              <Icon d={I.x} size={20} />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
