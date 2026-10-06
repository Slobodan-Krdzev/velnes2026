import { useQuery } from '@tanstack/react-query';
import { BillingInvoiceListSchema, BillingInvoiceSchema } from '@velnes/contracts';
import { I, Icon } from '@velnes/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { get } from '@velnes/client';
import { moneyMinor, pctBp } from '../../lib/money.js';

/**
 * Accounting invoices (phase 2, 2026-10-06) — docs/INVOICING.md. The
 * legal documents a legal entity issues — not the till's receipts,
 * which live under the cash register. Today only drafts exist: the
 * list shows them, the detail is the preview of what will be issued.
 * Every figure is the server's; nothing is computed here.
 */
const STATUS_TABS = ['all', 'draft', 'issued', 'unpaid', 'paid', 'credited'] as const;
type StatusTab = (typeof STATUS_TABS)[number];
const LIVE_TABS: StatusTab[] = ['all', 'draft'];

const dateShort = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
};

export function AccountingInvoicesPage() {
  const { id } = useParams<{ id?: string }>();
  return id ? <DraftDetail id={id} /> : <InvoiceList />;
}

function InvoiceList() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [tab, setTab] = useState<StatusTab>('all');
  const [q, setQ] = useState('');
  const query = new URLSearchParams();
  if (tab === 'draft' || tab === 'issued') query.set('status', tab);
  if (q.trim()) query.set('q', q.trim());
  const list = useQuery({
    queryKey: ['billingInvoices', tab, q],
    queryFn: () => get(BillingInvoiceListSchema, `/billing/invoices?${query.toString()}`),
  });
  const rows = list.data?.invoices ?? [];
  return (
    <>
      <div className="toolbar toolbar-row">
        <div className="filters">
          <div className="cat-tabs">
            {STATUS_TABS.map((k) => (
              <button
                key={k}
                className={`ttab ${tab === k ? 'on' : ''}`}
                disabled={!LIVE_TABS.includes(k)}
                title={LIVE_TABS.includes(k) ? undefined : t('inv.tabLater')}
                onClick={() => setTab(k)}
              >
                {t(`inv.tab.${k}`)}
              </button>
            ))}
          </div>
          <input className="input" placeholder={t('inv.searchPh')} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} aria-label={t('inv.searchPh')} />
        </div>
      </div>
      <div className="card">
        <div className="card-header">
          <div>
            <h2>{t('inv.title')}</h2>
            <span className="muted">{t('inv.sub')}</span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => nav('/till/invoices')}>
            {t('inv.toReceipts')}
          </button>
        </div>
        {list.data && !rows.length ? (
          <p className="muted" style={{ padding: 20, fontWeight: 500 }}>{t('inv.none')}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('inv.colNumber')}</th>
                <th>{t('inv.colBuyer')}</th>
                <th>{t('inv.colLocation')}</th>
                <th>{t('inv.colSupply')}</th>
                <th>{t('inv.colSale')}</th>
                <th className="right">{t('inv.colGross')}</th>
                <th>{t('inv.colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/invoices/${r.id}`)}>
                  <td className="bold tnum">{r.number ?? <span className="muted">{t('inv.draftNumber')}</span>}</td>
                  <td>{r.buyerName || <span className="muted">{t('inv.walkIn')}</span>}</td>
                  <td className="muted">{r.locationName}</td>
                  <td className="muted tnum">{dateShort(r.supplyDate)}</td>
                  <td className="muted tnum">{r.saleNumber ?? '—'}</td>
                  <td className="right bold tnum">{moneyMinor(r.totals.grossMinor, r.currency)}</td>
                  <td>
                    <span className={`badge ${r.status === 'draft' ? 'warning' : r.status === 'issued' ? 'success' : 'danger'}`}>{t(`inv.status.${r.status}`)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function DraftDetail({ id }: { id: string }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['billingInvoice', id], queryFn: () => get(BillingInvoiceSchema, `/billing/invoices/${id}`) });
  const d = q.data;
  if (!d) return null;
  const cur = d.currency;
  const m = (v: number) => moneyMinor(v, cur);
  return (
    <>
      <div className="toolbar toolbar-row">
        <button className="btn btn-ghost" onClick={() => nav('/invoices')}>
          <Icon d={I.arrowleft} size={16} /> {t('inv.back')}
        </button>
        <div className="toolbar-actions">
          <span className={`badge ${d.status === 'draft' ? 'warning' : 'success'}`} data-testid="doc-status">{t(`inv.status.${d.status}`)}</span>
        </div>
      </div>
      <div className="card" data-testid="draft-preview">
        <div className="card-header">
          <div>
            <h2>{t('inv.docTitle')}</h2>
            <span className="muted">{d.number ?? t('inv.draftNumber')}</span>
          </div>
          <div className="muted tnum" style={{ textAlign: 'right', fontSize: 13 }}>
            <div>{t('inv.supplyDate')}: <b>{dateShort(d.supplyDate)}</b></div>
            {d.dueDate ? <div>{t('inv.dueDate')}: <b>{dateShort(d.dueDate)}</b></div> : null}
            {d.origin ? <div>{t('inv.fromSale', { number: d.origin.saleNumber, date: dateShort(d.origin.saleDate) })}</div> : null}
          </div>
        </div>

        <div className="grid2" style={{ padding: '0 20px 16px' }}>
          <div>
            <span className="stat-label">{t('inv.issuer')}</span>
            <div className="bold">{d.issuer.legalName}</div>
            {d.issuer.tradingName && d.issuer.tradingName !== d.issuer.legalName ? <div className="muted">{d.issuer.tradingName}</div> : null}
            <div className="muted">{[d.issuer.address, [d.issuer.zip, d.issuer.city].filter(Boolean).join(' '), d.issuer.country].filter(Boolean).join(' · ')}</div>
            <div className="muted tnum">
              {t('inv.edb')} {d.issuer.edb || '—'}
              {d.issuer.vatRegNo ? ` · ${t('inv.vatNo')} ${d.issuer.vatRegNo}` : ''}
              {d.issuer.embs ? ` · ${t('inv.embs')} ${d.issuer.embs}` : ''}
            </div>
            {d.issuer.bankAccount ? <div className="muted tnum">{d.issuer.bankName ? `${d.issuer.bankName} · ` : ''}{d.issuer.bankAccount}</div> : null}
          </div>
          <div>
            <span className="stat-label">{t('inv.buyer')}</span>
            {d.buyer ? (
              <>
                <div className="bold">{d.buyer.name}</div>
                <div className="muted">{[d.buyer.address, [d.buyer.zip, d.buyer.city].filter(Boolean).join(' '), d.buyer.country].filter(Boolean).join(' · ') || (d.buyer.kind === 'person' ? t('inv.personNoAddress') : '')}</div>
                {d.buyer.kind === 'company' ? <div className="muted tnum">{t('inv.edb')} {d.buyer.edb || '—'}{d.buyer.vatRegNo ? ` · ${t('inv.vatNo')} ${d.buyer.vatRegNo}` : ''}</div> : null}
                {!d.buyerCompleteness.complete ? (
                  <div className="note warn" style={{ marginTop: 8 }} data-testid="buyer-incomplete">
                    {t('inv.buyerIncomplete', { fields: d.buyerCompleteness.missing.map((f) => t(`inv.f.${f}`, { defaultValue: f })).join(', ') })}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="muted">{t('inv.walkIn')}</div>
            )}
            <div style={{ marginTop: 10 }}>
              <span className="stat-label">{t('inv.place')}</span>
              <div className="bold">{d.location.name}</div>
              <div className="muted">{[d.location.address, [d.location.zip, d.location.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}</div>
            </div>
          </div>
        </div>

        <table data-testid="draft-lines">
          <thead>
            <tr>
              <th>#</th>
              <th>{t('inv.colItem')}</th>
              <th className="right">{t('inv.colQty')}</th>
              {d.vatRegistered ? <th className="right">{t('inv.colNet')}</th> : null}
              {d.vatRegistered ? <th className="right">{t('inv.colVatRate')}</th> : null}
              {d.vatRegistered ? <th className="right">{t('inv.colVat')}</th> : null}
              <th className="right">{t('inv.colGross')}</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l, i) => (
              <tr key={l.id}>
                <td className="muted tnum">{i + 1}</td>
                <td>
                  <span className="bold">{l.description}</span>
                  {l.allocatedDiscountMinor ? <span className="muted" style={{ display: 'block', fontSize: 12 }}>{t('inv.lineDiscount', { amount: m(l.allocatedDiscountMinor) })}</span> : null}
                </td>
                <td className="right tnum">{(l.qtyMilli / 1000).toLocaleString('mk-MK')}</td>
                {d.vatRegistered ? <td className="right tnum">{m(l.netMinor)}</td> : null}
                {d.vatRegistered ? <td className="right tnum">{pctBp(l.vatRateBp)}</td> : null}
                {d.vatRegistered ? <td className="right tnum">{m(l.vatMinor)}</td> : null}
                <td className="right bold tnum">{m(l.grossMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="grid2" style={{ padding: 20, alignItems: 'start' }}>
          <div>
            {d.vatRegistered ? (
              <table data-testid="vat-breakdown">
                <thead>
                  <tr>
                    <th>{t('inv.colVatRate')}</th>
                    <th className="right">{t('inv.colNet')}</th>
                    <th className="right">{t('inv.colVat')}</th>
                    <th className="right">{t('inv.colGross')}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.vatBreakdown.map((r) => (
                    <tr key={r.rateBp}>
                      <td className="bold">{pctBp(r.rateBp)}</td>
                      <td className="right tnum">{m(r.netMinor)}</td>
                      <td className="right tnum">{m(r.vatMinor)}</td>
                      <td className="right tnum">{m(r.grossMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="note">{t('inv.notVatRegistered')}</div>
            )}
          </div>
          <div data-testid="draft-totals" style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
            {d.totals.discountMinor ? (
              <div className="muted">{t('inv.discounts')}: <span className="tnum">−{m(d.totals.discountMinor)}</span></div>
            ) : null}
            {d.vatRegistered ? <div className="muted">{t('inv.net')}: <span className="tnum">{m(d.totals.netMinor)}</span></div> : null}
            {d.vatRegistered ? <div className="muted">{t('inv.vatTotal')}: <span className="tnum">{m(d.totals.vatMinor)}</span></div> : null}
            <div className="bold" style={{ fontSize: 18 }}>{t('inv.total')}: <span className="tnum">{m(d.totals.grossMinor)}</span></div>
            {d.origin && (d.origin.giftTenderMinor || d.origin.tipMinor) ? (
              <div className="muted" style={{ fontSize: 12, textAlign: 'right' }}>
                {d.origin.giftTenderMinor ? <div>{t('inv.giftTender', { amount: m(d.origin.giftTenderMinor) })}</div> : null}
                {d.origin.tipMinor ? <div>{t('inv.tipExcluded', { amount: m(d.origin.tipMinor) })}</div> : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="note" style={{ margin: '0 20px 20px' }}>
          {t('inv.draftNote')}
          {d.notes ? <div style={{ marginTop: 6 }}>{d.notes}</div> : null}
          <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
            {t('inv.createdBy', { name: d.createdBy.name, when: d.createdAt.slice(0, 16).replace('T', ' ') })}
            {d.updatedAt !== d.createdAt ? ` · ${t('inv.updatedBy', { name: d.updatedBy.name, when: d.updatedAt.slice(0, 16).replace('T', ' ') })}` : ''}
          </div>
        </div>
      </div>
    </>
  );
}
