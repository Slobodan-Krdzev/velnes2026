import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BILLING_LANGS, BillingInvoiceListSchema, BillingInvoiceSchema, BillingLogoSchema, type BillingInvoice, type BillingIssueProblem, type BillingLang } from '@velnes/contracts';
import { I, Icon } from '@velnes/ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, api, get, getBlob, patch, post, useSession } from '@velnes/client';
import { moneyMinor, pctBp } from '../../lib/money.js';
import { useToast } from '../../lib/toast.js';

/**
 * Accounting invoices (phase 2, 2026-10-06; issuing phase 3,
 * 2026-10-07) — docs/INVOICING.md. The legal documents a legal entity
 * issues — not the till's receipts, which live under the cash
 * register. The list shows drafts and issued documents; the detail is
 * the preview of a draft, or the issued document itself: numbered,
 * frozen, with its history. Every figure is the server's; nothing is
 * computed here, and nothing is issued from optimistic state — the
 * page waits for the server's answer.
 */
const STATUS_TABS = ['all', 'draft', 'issued', 'unpaid', 'paid', 'credited'] as const;
type StatusTab = (typeof STATUS_TABS)[number];
const LIVE_TABS: StatusTab[] = ['all', 'draft', 'issued'];
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());

const dateShort = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
};

export function AccountingInvoicesPage() {
  const { id } = useParams<{ id?: string }>();
  return id ? <DocDetail id={id} /> : <InvoiceList />;
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

const when = (iso: string) => iso.slice(0, 16).replace('T', ' ');

function DocDetail({ id }: { id: string }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['billingInvoice', id], queryFn: () => get(BillingInvoiceSchema, `/billing/invoices/${id}`) });
  const logo = useQuery({
    queryKey: ['billingInvoiceLogo', id, q.data?.issuer.logoSha256 ?? null],
    queryFn: () => api(BillingLogoSchema.nullable(), `/billing/invoices/${id}/logo`).catch(() => null),
    enabled: !!q.data,
  });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<BillingIssueProblem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One key per attempt from this screen: a retry after a lost answer
  // sends the same key and gets the same issued document back.
  const issueKey = useMemo(() => newKey(), []);
  const [pdfBusy, setPdfBusy] = useState<'preview' | 'download' | null>(null);
  const d = q.data;
  if (!d) return null;

  /** The canonical PDF: the same bytes for both; only what the browser does with them differs. */
  const openPdf = async (mode: 'preview' | 'download') => {
    setPdfBusy(mode);
    setError(null);
    try {
      const blob = await getBlob(`/billing/invoices/${id}/pdf${mode === 'download' ? '?download=1' : ''}`);
      const url = URL.createObjectURL(blob);
      if (mode === 'preview') window.open(url, '_blank', 'noopener');
      else {
        const a = document.createElement('a');
        a.href = url;
        a.download = `invoice-${d.number ?? id}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      void qc.invalidateQueries({ queryKey: ['billingInvoice', id] });
    } catch (e) {
      setError(t('inv.pdfFailed', { message: e instanceof Error ? e.message : String(e) }));
    } finally {
      setPdfBusy(null);
    }
  };
  const setLang = async (lang: BillingLang) => {
    setError(null);
    try {
      const doc = await patch(BillingInvoiceSchema, `/billing/invoices/${id}`, { lang });
      qc.setQueryData(['billingInvoice', id], doc);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const cur = d.currency;
  const m = (v: number) => moneyMinor(v, cur);
  const issued = d.status === 'issued';
  const mayIssue = d.status === 'draft' && can('billing.issue');
  const ready = d.issueReadiness;

  const issue = async () => {
    setBusy(true);
    setError(null);
    setBlocked(null);
    try {
      const doc = await post(BillingInvoiceSchema, `/billing/invoices/${id}/issue`, { key: issueKey });
      qc.setQueryData(['billingInvoice', id], doc);
      void qc.invalidateQueries({ queryKey: ['billingInvoices'] });
      void qc.invalidateQueries({ queryKey: ['billingInvoiceLogo', id] });
      setConfirming(false);
      toast?.(t('inv.issuedToast', { number: doc.number ?? '' }));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ISSUE_BLOCKED') {
        // The server's list, verbatim: the body carried `problems`.
        setBlocked(problemsOf(e) ?? []);
      } else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const problemLine = (p: BillingIssueProblem) =>
    `${t(`inv.part.${p.part}`)}: ${t(`inv.f.${p.field}`, { defaultValue: p.field })} — ${t(`inv.reason.${p.reason}`)}`;

  return (
    <>
      <div className="toolbar toolbar-row">
        <button className="btn btn-ghost" onClick={() => nav('/invoices')}>
          <Icon d={I.arrowleft} size={16} /> {t('inv.back')}
        </button>
        <div className="toolbar-actions" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {d.status === 'draft' && can('billing.issue') ? (
            <span className={`muted ${ready.ready ? '' : 'warn'}`} style={{ fontSize: 13 }} data-testid="issue-readiness">
              {ready.ready ? t('inv.issueReady') : t('inv.issueNotReady', { count: ready.problems.length })}
            </span>
          ) : null}
          {mayIssue ? (
            <button className="btn btn-primary" onClick={() => setConfirming(true)} data-testid="issue-btn">
              {t('inv.issue')}
            </button>
          ) : null}
          {issued ? (
            <>
              <button className="btn btn-secondary" onClick={() => void openPdf('preview')} disabled={pdfBusy !== null} data-testid="pdf-preview">
                {t('inv.previewPdf')}
              </button>
              <button className="btn btn-primary" onClick={() => void openPdf('download')} disabled={pdfBusy !== null} data-testid="pdf-download">
                {t('inv.downloadPdf')}
              </button>
            </>
          ) : null}
          <span className={`badge ${d.status === 'draft' ? 'warning' : 'success'}`} data-testid="doc-status">{t(`inv.status.${d.status}`)}</span>
        </div>
      </div>

      {d.status === 'draft' && !can('billing.issue') ? (
        <div className="note" style={{ marginBottom: 12 }}>{t('inv.noIssueRight')}</div>
      ) : null}
      {error ? <div className="note warn" style={{ marginBottom: 12 }}>{error}</div> : null}
      {blocked && !confirming ? (
        <div className="note warn" style={{ marginBottom: 12 }} data-testid="issue-blocked">
          <div className="bold">{t('inv.issueBlocked')}</div>
          <ul style={{ margin: '6px 0 0 18px' }}>{blocked.map((p, i) => <li key={i}>{problemLine(p)}</li>)}</ul>
        </div>
      ) : null}

      <div className="card" data-testid="draft-preview">
        <div className="card-header">
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            {logo.data?.dataUrl ? <img src={logo.data.dataUrl} alt="" data-testid="doc-logo" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }} /> : null}
            <div>
              <h2>{issued ? t('inv.docTitleIssued') : t('inv.docTitle')}</h2>
              <span className={issued ? 'bold tnum' : 'muted'} data-testid="doc-number" style={issued ? { fontSize: 16 } : undefined}>{d.number ?? t('inv.draftNumber')}</span>
            </div>
          </div>
          <div className="muted tnum" style={{ textAlign: 'right', fontSize: 13 }}>
            {d.issueDate ? <div>{t('inv.issueDate')}: <b>{dateShort(d.issueDate)}</b></div> : null}
            <div>{t('inv.supplyDate')}: <b>{dateShort(d.supplyDate)}</b></div>
            {d.dueDate ? <div>{t('inv.dueDate')}: <b>{dateShort(d.dueDate)}</b></div> : null}
            {d.origin ? <div>{t('inv.fromSale', { number: d.origin.saleNumber, date: dateShort(d.origin.saleDate) })}</div> : null}
            <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
              <label htmlFor="inv-lang">{t('inv.lang')}:</label>
              {d.status === 'draft' && can('billing.create') ? (
                <select id="inv-lang" className="input" value={d.lang} onChange={(e) => void setLang(e.target.value as BillingLang)} title={t('inv.langHint')} style={{ width: 'auto', padding: '2px 6px' }}>
                  {BILLING_LANGS.map((l) => (
                    <option key={l} value={l}>{t(`inv.lang.${l}`)}</option>
                  ))}
                </select>
              ) : (
                <b data-testid="doc-lang">{t(`inv.lang.${d.lang}`)}</b>
              )}
            </div>
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
                {!issued && !d.buyerCompleteness.complete ? (
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

        <div className={`note ${issued ? '' : ''}`} style={{ margin: '0 20px 20px' }} data-testid="doc-note">
          {issued ? t('inv.issuedNote') : t('inv.draftNote')}
          {d.notes ? <div style={{ marginTop: 6 }}>{d.notes}</div> : null}
          <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
            {t('inv.createdBy', { name: d.createdBy.name, when: when(d.createdAt) })}
            {!issued && d.updatedAt !== d.createdAt ? ` · ${t('inv.updatedBy', { name: d.updatedBy.name, when: when(d.updatedAt) })}` : ''}
            {issued && d.issuedBy && d.issuedAt ? ` · ${t('inv.issuedBy', { name: d.issuedBy.name, when: when(d.issuedAt) })}` : ''}
          </div>
          {issued && d.pdfSha256 ? (
            <div className="muted tnum" style={{ marginTop: 4, fontSize: 11, wordBreak: 'break-all' }} data-testid="pdf-sha">
              {t('inv.pdfSha')}: {d.pdfSha256}
            </div>
          ) : null}
        </div>

        {d.events.length ? (
          <div style={{ padding: '0 20px 20px' }} data-testid="doc-history">
            <span className="stat-label">{t('inv.history')}</span>
            <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
              {d.events.map((e) => (
                <li key={e.id} className="muted" style={{ fontSize: 13 }}>
                  <span className="tnum">{when(e.at)}</span> · {t(`inv.ev.${e.kind}`, { number: String(e.data.number ?? '') })}{e.actorName ? ` · ${e.actorName}` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {confirming ? (
        <IssueModal
          doc={d}
          busy={busy}
          blocked={blocked}
          problemLine={problemLine}
          onIssue={() => void issue()}
          onClose={() => {
            if (!busy) setConfirming(false);
          }}
        />
      ) : null}
    </>
  );
}

/** The structured problems of a 422 from the issue door, if the body carried them. */
function problemsOf(e: ApiError): BillingIssueProblem[] | null {
  const raw = e.body?.problems;
  return Array.isArray(raw) ? (raw as BillingIssueProblem[]) : null;
}

function IssueModal({
  doc,
  busy,
  blocked,
  problemLine,
  onIssue,
  onClose,
}: {
  doc: BillingInvoice;
  busy: boolean;
  blocked: BillingIssueProblem[] | null;
  problemLine: (p: BillingIssueProblem) => string;
  onIssue: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const problems = blocked ?? doc.issueReadiness.problems;
  const warnings = doc.issueReadiness.warnings;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="issue-title" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="issue-title">{t('inv.issueTitle')}</h2>
        </div>
        <div className="modal-body" style={{ display: 'grid', gap: 12 }}>
          <p style={{ margin: 0 }}>{t('inv.issueWarning')}</p>
          <div className="muted" style={{ fontSize: 13 }}>
            <div>{doc.issuer.legalName} → {doc.buyer?.name ?? t('inv.walkIn')}</div>
            <div className="tnum">{t('inv.total')}: {moneyMinor(doc.totals.grossMinor, doc.currency)} · {t('inv.supplyDate')}: {dateShort(doc.supplyDate)}</div>
          </div>
          {problems.length ? (
            <div className="note warn" data-testid="issue-problems">
              <div className="bold">{t('inv.issueBlocked')}</div>
              <ul style={{ margin: '6px 0 0 18px' }}>{problems.map((p, i) => <li key={i}>{problemLine(p)}</li>)}</ul>
            </div>
          ) : null}
          {warnings.length ? (
            <div className="note" data-testid="issue-warnings">
              {warnings.map((w, i) => <div key={i}>{t(`inv.warn.${w.code}`, w.params)}</div>)}
            </div>
          ) : null}
        </div>
        <div className="modal-foot" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={onIssue} disabled={busy || problems.length > 0} data-testid="issue-confirm">
            {busy ? t('inv.issueBusy') : t('inv.issueConfirm')}
          </button>
        </div>
        <button className="modal-close" aria-label={t('common.close')} onClick={onClose} disabled={busy}>
          <Icon d={I.x} size={20} />
        </button>
      </div>
    </div>
  );
}
