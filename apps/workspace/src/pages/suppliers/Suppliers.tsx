import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PurchaseOrderListSchema,
  PurchaseOrderSchema,
  SupplierListSchema,
  SupplierProductListSchema,
  SalonPromotionListSchema,
  SupplierMediaListSchema,
  type PurchaseOrder,
  type SupplierMedia,
  type SalonPromotion,
  type Supplier,
} from '@velnes/contracts';
import { I, Icon, NumInput } from '@velnes/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { ApiError, get, getBlob, post, useSession } from '@velnes/client';
import { useLocations } from '../../api/queries.js';
import { money } from '../../lib/money.js';
import { useToast } from '../../lib/toast.js';

/** The salon side of the supplier chain: suppliers, their catalogs,
 *  orders and deliveries (the prototype's SUP_TABS). Academy keeps
 *  its honest empty state until the trainings engine lands. */

const TABS = [
  ['suppliers', 'sup.tabSuppliers'],
  ['catalog', 'sup.tabCatalog'],
  ['promotions', 'sup.tabPromotions'],
  ['orders', 'sup.tabOrders'],
  ['deliveries', 'sup.tabDeliveries'],
  ['academy', 'sup.tabAcademy'],
] as const;
type Tab = (typeof TABS)[number][0];

const dateShort = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
};
const useSuppliers = () =>
  useQuery({ queryKey: ['suppliers'], queryFn: () => get(SupplierListSchema, '/suppliers') });
const useOrders = () =>
  useQuery({ queryKey: ['purchaseOrders'], queryFn: () => get(PurchaseOrderListSchema, '/purchase-orders') });
const useSupCatalog = (id: string | null) =>
  useQuery({
    queryKey: ['supCatalog', id],
    queryFn: () => get(SupplierProductListSchema, `/suppliers/${id}/catalog`),
    enabled: !!id,
  });

const statusKey: Record<string, string> = {
  draft: 'sup.statusDraft', approval: 'sup.statusApproval', submitted: 'sup.statusSubmitted',
  accepted: 'sup.statusAccepted', partial: 'sup.statusPartial', processing: 'sup.statusProcessing',
  shipped: 'sup.statusShipped', partdelivered: 'sup.statusPartdelivered',
  delivered: 'sup.statusDelivered', cancelled: 'sup.statusCancelled', disputed: 'sup.statusDisputed',
};

export function SuppliersPage() {
  const { t } = useTranslation();
  // `?tab=orders` from the navigation search names the tab to open.
  const [params] = useSearchParams();
  const urlTab = params.get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(urlTab && TABS.some(([id]) => id === urlTab) ? urlTab : 'suppliers');
  const [drafting, setDrafting] = useState<string | null>(null); // supplier id
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);

  if (drafting)
    return (
      <OrderDraft
        supplierId={drafting}
        done={() => {
          setDrafting(null);
          setTab('orders');
        }}
        cancel={() => setDrafting(null)}
      />
    );
  if (receiving)
    return <Receive order={receiving} done={() => setReceiving(null)} />;

  return (
    <>
      <div className="toolbar toolbar-row">
        <div className="filters">
          <div className="cat-tabs">
            {TABS.map(([k, label]) => (
              <button key={k} className={`ttab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>
                {t(label)}
              </button>
            ))}
          </div>
        </div>
        <div className="toolbar-actions" />
      </div>
      {tab === 'suppliers' ? <SuppliersTab startOrder={setDrafting} /> : null}
      {tab === 'catalog' ? <CatalogTab /> : null}
      {tab === 'promotions' ? <PromotionsTab startOrder={setDrafting} openId={params.get('promo')} /> : null}
      {tab === 'orders' ? <OrdersTab receive={setReceiving} /> : null}
      {tab === 'deliveries' ? <DeliveriesTab receive={setReceiving} /> : null}
      {tab === 'academy' ? (
        <div className="card">
          <div className="empty">
            <h3>{t('sup.academySoon')}</h3>
            <p>{t('sup.academySub')}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}

function SupplierRow({
  s,
  startOrder,
}: {
  s: Supplier;
  startOrder: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { can } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const locations = useLocations();
  const [mediaOf, setMediaOf] = useState<Supplier | null>(null);
  const locName = (id: string) => locations.data?.locations.find((l) => l.id === id)?.name ?? '—';

  const connect = async () => {
    try {
      await post(z.object({ ok: z.literal(true) }), `/suppliers/${s.id}/connect`, {});
      toast(t('sup.requestSent'));
      void qc.invalidateQueries({ queryKey: ['suppliers'] });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'failed');
    }
  };

  return (
    <div className="rowcard">
      <span className={`mark ${s.status === 'connected' ? 'on' : ''}`} style={s.avatar ? { padding: 0, overflow: 'hidden' } : undefined}>
        {s.avatar ? (
          <img src={s.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
        ) : (
          s.name[0]
        )}
      </span>
      <span className="grow">
        <span className="t">
          {s.name}{' '}
          {s.verified ? (
            <span className="badge success">{t('sup.verified')}</span>
          ) : (
            <span className="badge warning">{t('sup.notVerified')}</span>
          )}
        </span>
        <span className="s">
          {s.type} · {s.territory} · {t('sup.productsN', { n: s.products })}
          {s.status === 'connected' ? ` · ${t('sup.customerNo', { no: s.customerNo })}` : ''}
        </span>
        <span className="s">
          {s.status === 'connected'
            ? t('sup.deliversTo', {
                locs: s.locationIds.map(locName).join(', ') || '—',
                min: money(s.minOrder),
                lead: s.lead,
                terms: s.terms,
              })
            : s.status === 'pending'
              ? t('sup.waitingSub')
              : t('sup.minLine', { min: money(s.minOrder), lead: s.lead, terms: s.terms })}
        </span>
      </span>
      {s.status === 'connected' ? (
        <span className="acts">
          <button className="btn btn-secondary btn-sm" onClick={() => setMediaOf(s)} data-testid={`media-${s.id}`}>
            {t('sup.media.button')}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => startOrder(s.id)}>
            {t('sup.newOrder')}
          </button>
        </span>
      ) : s.status === 'pending' ? (
        <span className="badge warning">{t('sup.pending')}</span>
      ) : can('suppliers.manage') ? (
        <button className="btn btn-primary btn-sm" onClick={() => void connect()}>
          {t('sup.requestConnection')}
        </button>
      ) : null}
      {mediaOf ? <MediaModal supplier={mediaOf} onClose={() => setMediaOf(null)} /> : null}
    </div>
  );
}

/** A connected supplier's printed catalogs (2026-10-07): the PDFs it
 *  published, opened in a new tab through the session like the invoice. */
function MediaModal({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const files = useQuery({
    queryKey: ['supplier-media', supplier.id],
    queryFn: () => get(SupplierMediaListSchema, `/suppliers/${supplier.id}/media`),
  });
  const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const when = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' });
  const open = async (f: SupplierMedia) => {
    const blob = await getBlob(`/suppliers/${supplier.id}/media/${f.id}/file`);
    window.open(URL.createObjectURL(blob), '_blank', 'noopener');
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="media-title" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 id="media-title">{t('sup.media.title', { name: supplier.name })}</h2>
            <span className="muted" style={{ fontWeight: 500 }}>{t('sup.media.sub')}</span>
          </div>
        </div>
        <div className="modal-body" style={{ display: 'grid', gap: 8 }} data-testid="media-list">
          {files.isLoading ? (
            <p className="muted" style={{ margin: 0 }}>{t('sup.media.loading')}</p>
          ) : !files.data || files.data.files.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>{t('sup.media.empty')}</p>
          ) : (
            files.data.files.map((f) => (
              <button key={f.id} type="button" className="rowcard" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', textAlign: 'left', width: '100%' }} onClick={() => void open(f)} data-testid="media-file">
                <Icon d={I.note} size={18} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="t" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                  <span className="s muted" style={{ fontSize: 12 }}>{size(f.sizeBytes)} · {when(f.createdAt)}</span>
                </span>
                <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{t('sup.media.openPdf')}</span>
              </button>
            ))
          )}
        </div>
        <div className="modal-foot" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>{t('sup.promoClose')}</button>
        </div>
        <button className="modal-close" aria-label={t('sup.promoClose')} onClick={onClose}>
          <Icon d={I.x} size={20} />
        </button>
      </div>
    </div>
  );
}

function SuppliersTab({ startOrder }: { startOrder: (id: string) => void }) {
  const { t } = useTranslation();
  const q = useSuppliers();
  const all = q.data?.suppliers ?? [];
  const connected = all.filter((s) => s.status === 'connected');
  const pending = all.filter((s) => s.status === 'pending');
  const available = all.filter((s) => s.status === 'available');
  return (
    <div className="stacked">
      <div className="card">
        <div className="card-header">
          <h2>{t('sup.connected')}</h2>
          <span className="muted" style={{ fontWeight: 500 }}>
            {t('sup.connectedSub')}
          </span>
        </div>
        {connected.length ? (
          connected.map((s) => <SupplierRow key={s.id} s={s} startOrder={startOrder} />)
        ) : (
          <div className="empty">
            <h3>{t('sup.noConnected')}</h3>
            <p>{t('sup.noConnectedSub')}</p>
          </div>
        )}
      </div>
      {pending.length ? (
        <div className="card">
          <div className="card-header">
            <h2>{t('sup.waiting')}</h2>
          </div>
          {pending.map((s) => (
            <SupplierRow key={s.id} s={s} startOrder={startOrder} />
          ))}
        </div>
      ) : null}
      <div className="card">
        <div className="card-header">
          <h2>{t('sup.available')}</h2>
          <span className="muted" style={{ fontWeight: 500 }}>
            {t('sup.availableSub')}
          </span>
        </div>
        {available.map((s) => (
          <SupplierRow key={s.id} s={s} startOrder={startOrder} />
        ))}
        <div className="note" style={{ margin: '16px 20px' }}>
          {t('sup.connectNote')}
        </div>
      </div>
    </div>
  );
}

function CatalogTab() {
  const { t } = useTranslation();
  const suppliers = useSuppliers();
  const connected = (suppliers.data?.suppliers ?? []).filter((s) => s.status === 'connected');
  const [picked, setPicked] = useState<string | null>(null);
  const supId = picked ?? connected[0]?.id ?? null;
  const catalog = useSupCatalog(supId);
  const rows = catalog.data?.products ?? [];
  const cats = [...new Set(rows.map((p) => p.category))];
  return (
    <div className="card">
      <div className="card-header">
        <h2>{t('sup.tabCatalog')}</h2>
        <div className="chips">
          {connected.map((s) => (
            <button key={s.id} className={`chip ${supId === s.id ? 'on' : ''}`} onClick={() => setPicked(s.id)}>
              {s.name}
            </button>
          ))}
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>{t('sup.product')}</th>
            <th className="right">{t('sup.buy')}</th>
            <th className="right">{t('sup.rrp')}</th>
            <th className="right">{t('sup.pack')}</th>
            <th className="right">{t('sup.moq')}</th>
            <th className="right">{t('sup.supStock')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {cats.map((cat) => (
            <>
              <tr key={cat}>
                <td colSpan={7} className="section-label" style={{ background: 'var(--surface-muted)' }}>
                  {cat}
                </td>
              </tr>
              {rows
                .filter((p) => p.category === cat)
                .map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span className="bold">{p.name}</span>{' '}
                      {p.sample ? <span className="badge accent">{t('sup.sample')}</span> : null}
                      {p.linkedProductId ? (
                        <span className="badge success">{t('sup.inYourCatalog')}</span>
                      ) : null}
                      <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                        {p.brand} · {p.sku} · {p.size}
                      </span>
                    </td>
                    <td className="right bold tnum">{p.buy ? money(p.buy) : '—'}</td>
                    <td className="right muted tnum">{p.rrp ? money(p.rrp) : '—'}</td>
                    <td className="right tnum">{p.pack}</td>
                    <td className="right tnum">{p.moq}</td>
                    <td className={`right tnum ${p.stock === 0 ? 'bold' : ''}`} style={p.stock === 0 ? { color: 'var(--danger)' } : undefined}>
                      {p.stock}
                    </td>
                    <td />
                  </tr>
                ))}
            </>
          ))}
        </tbody>
      </table>
      <div className="note" style={{ margin: '16px 20px' }}>
        {t('sup.pricesYours')}
      </div>
    </div>
  );
}

/** The invoice PDF (Alex, 2026-10-06): fetched with the session's
 *  token and opened in a new tab — a plain link could not carry it. */
async function openInvoicePdf(orderId: string) {
  const blob = await getBlob(`/purchase-orders/${orderId}/invoice.pdf`);
  window.open(URL.createObjectURL(blob), '_blank', 'noopener');
}

function OrderRow({
  o,
  receive,
  onApproved,
}: {
  o: PurchaseOrder;
  receive: (o: PurchaseOrder) => void;
  onApproved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const locations = useLocations();
  const approve = async () => {
    try {
      await post(PurchaseOrderSchema, `/purchase-orders/${o.id}/transitions`, { to: 'submitted' });
      toast(t('sup.approvedToast'));
      onApproved();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'failed');
    }
  };
  const tone =
    o.status === 'delivered'
      ? 'success'
      : o.status === 'disputed' || o.status === 'cancelled'
        ? 'danger'
        : o.status === 'approval'
          ? 'warning'
          : 'info';
  return (
    <tr>
      <td>
        <span className="bold">{o.ref}</span>
        <span className="muted" style={{ display: 'block', fontSize: 12 }}>
          {t('sup.by', { name: o.byName })}
        </span>
        {o.status === 'cancelled' && o.supplierNote ? (
          <span style={{ display: 'block', fontSize: 12, color: 'var(--danger)', fontWeight: 500 }}>
            {t('sup.declinedReason', { reason: o.supplierNote })}
          </span>
        ) : null}
      </td>
      <td>{o.supplierName}</td>
      <td className="muted">{locations.data?.locations.find((l) => l.id === o.locationId)?.name ?? '—'}</td>
      <td className="muted tnum">{dateShort(o.createdAt.slice(0, 10))}</td>
      <td className="muted tnum">{o.expected ? dateShort(o.expected) : '—'}</td>
      <td className="right bold tnum">{money(o.total)}</td>
      <td>
        <span className={`badge ${tone}`}>{t(statusKey[o.status] ?? o.status)}</span>
      </td>
      <td className="right">
        {o.status === 'approval' ? (
          <button className="btn btn-primary btn-sm" onClick={() => void approve()}>
            {t('sup.approve')}
          </button>
        ) : o.status === 'shipped' || o.status === 'partdelivered' ? (
          <button className="btn btn-secondary btn-sm" onClick={() => receive(o)}>
            {t('sup.receive')}
          </button>
        ) : o.status === 'delivered' ? (
          <button className="btn btn-secondary btn-sm" onClick={() => void openInvoicePdf(o.id)}>
            {t('sup.invoicePdf')}
          </button>
        ) : null}
      </td>
    </tr>
  );
}

function OrdersTab({ receive }: { receive: (o: PurchaseOrder) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const orders = useOrders();
  const rows = orders.data?.orders ?? [];
  return (
    <div className="card">
      <div className="card-header">
        <h2>{t('sup.purchaseOrders')}</h2>
      </div>
      {rows.length ? (
        <table>
          <thead>
            <tr>
              <th>{t('sup.order')}</th>
              <th>{t('sup.supplier')}</th>
              <th>{t('sup.location')}</th>
              <th>{t('sup.placed')}</th>
              <th>{t('sup.expected')}</th>
              <th className="right">{t('sup.value')}</th>
              <th>{t('sup.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <OrderRow
                key={o.id}
                o={o}
                receive={receive}
                onApproved={() => void qc.invalidateQueries({ queryKey: ['purchaseOrders'] })}
              />
            ))}
          </tbody>
        </table>
      ) : (
        <div className="empty">
          <h3>{t('sup.noOrders')}</h3>
          <p>{t('sup.noOrdersSub')}</p>
        </div>
      )}
    </div>
  );
}

function DeliveriesTab({ receive }: { receive: (o: PurchaseOrder) => void }) {
  const { t } = useTranslation();
  const orders = useOrders();
  const rows = (orders.data?.orders ?? []).filter((o) =>
    ['shipped', 'partdelivered', 'delivered'].includes(o.status),
  );
  if (!rows.length)
    return (
      <div className="card">
        <div className="empty">
          <h3>{t('sup.noDeliveries')}</h3>
          <p>{t('sup.noDeliveriesSub')}</p>
        </div>
      </div>
    );
  return (
    <div className="card">
      {rows.map((o) => (
        <div className="rowcard" key={o.id}>
          <span className={`mark ${o.status === 'delivered' ? 'on' : ''}`}>
            <Icon d={I.invoice} size={20} />
          </span>
          <span className="grow">
            <span className="t">
              {o.ref} · {o.supplierName}
            </span>
            <span className="s">
              {o.expected ? `${t('sup.expected')} ${dateShort(o.expected)}` : ''}{' '}
              {o.track ? `· ${o.track}` : ''}
            </span>
          </span>
          <span className={`badge ${o.status === 'delivered' ? 'success' : 'info'}`}>
            {t(statusKey[o.status] ?? o.status)}
          </span>
          {o.status !== 'delivered' ? (
            <button className="btn btn-primary btn-sm" onClick={() => receive(o)}>
              {t('sup.receive')}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function OrderDraft({
  supplierId,
  done,
  cancel,
}: {
  supplierId: string;
  done: () => void;
  cancel: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const suppliers = useSuppliers();
  const locations = useLocations();
  const catalog = useSupCatalog(supplierId);
  const promos = useQuery({
    queryKey: ['supPromotions'],
    queryFn: () => get(SalonPromotionListSchema, '/supplier-promotions'),
  });
  const [qty, setQty] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const s = suppliers.data?.suppliers.find((x) => x.id === supplierId);
  const loc = (locations.data?.locations ?? []).find((l) => l.lifecycle === 'ACTIVE');
  const rows = (catalog.data?.products ?? []).filter((p) => !p.sample);
  const myPromos = (promos.data?.promotions ?? []).filter((p) => p.supplierId === supplierId);
  const sub = rows.reduce((n, p) => n + (qty[p.id] ?? 0) * p.buy, 0);
  const belowMin = s ? sub < s.minOrder : true;

  const submit = async (asDraft: boolean) => {
    setError(null);
    try {
      await post(PurchaseOrderSchema, '/purchase-orders', {
        supplierId,
        locationId: loc!.id,
        lines: Object.entries(qty)
          .filter(([, n]) => n > 0)
          .map(([supplierProductId, n]) => ({ supplierProductId, qty: n })),
        submit: !asDraft,
      });
      toast(t(asDraft ? 'sup.orderDrafted' : 'sup.orderSubmitted'));
      void qc.invalidateQueries({ queryKey: ['purchaseOrders'] });
      done();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'failed');
    }
  };

  if (!s) return null;
  return (
    <>
      <div className="toolbar">
        <div className="toolbar-context">
          <span className="k">{t('sup.newOrderTitle', { name: s.name })}</span>
          <span className="v tnum">{money(sub)}</span>
        </div>
        <div className="toolbar-actions">
          <button className="btn btn-ghost" onClick={cancel}>
            {t('sup.cancel')}
          </button>
          <button className="btn btn-secondary" onClick={() => void submit(true)}>
            {t('sup.saveDraft')}
          </button>
          <button className="btn btn-primary" disabled={belowMin} onClick={() => void submit(false)}>
            {belowMin ? t('sup.minimumIs', { min: money(s.minOrder) }) : t('sup.submitOrder')}
          </button>
        </div>
      </div>
      <div className="stacked">
        {myPromos.length ? (
          <div className="card">
            <div className="card-header">
              <h2>{t('sup.offersFrom', { name: s.name })}</h2>
            </div>
            {myPromos.map((o) => (
              <div className="rowcard" key={o.id}>
                <span className="mark on">
                  <Icon d={I.tag} size={20} />
                </span>
                <span className="grow">
                  <span className="t">{o.title}</span>
                  <span className="s">{o.terms}</span>
                  <span className="s">
                    {t('sup.until', { date: dateShort(o.ends) })} · {o.audience}
                  </span>
                </span>
              </div>
            ))}
            <div className="note" style={{ margin: '16px 20px' }}>
              {t('sup.offerAuto')}
            </div>
          </div>
        ) : null}
        <div className="card">
          <div className="card-header">
            <h2>{t('sup.products')}</h2>
            <span className="muted" style={{ fontWeight: 500 }}>
              {t('sup.pricesYours')}
            </span>
          </div>
          <table>
            <thead>
              <tr>
                <th>{t('sup.product')}</th>
                <th className="right">{t('sup.buy')}</th>
                <th className="right">{t('sup.supStock')}</th>
                <th className="right">{t('sup.moq')}</th>
                <th className="right">{t('sup.qty')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={p.stock === 0 ? 'dim' : ''}>
                  <td>
                    <span className="bold">{p.name}</span>
                    <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                      {p.sku} · {p.size}
                    </span>
                  </td>
                  <td className="right bold tnum">{money(p.buy)}</td>
                  <td className="right tnum">{p.stock}</td>
                  <td className="right tnum">{p.moq}</td>
                  <td className="right">
                    <NumInput
                      className="input qty-in"
                      min={0}
                      aria-label={`Qty ${p.name}`}
                      value={qty[p.id] ?? 0}
                      disabled={p.stock === 0}
                      onValue={(n) => setQty((q) => ({ ...q, [p.id]: n }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {error ? (
            <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600, padding: '0 20px 16px' }}>
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Receive({ order, done }: { order: PurchaseOrder; done: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [counts, setCounts] = useState<Record<string, { received: number; damaged: number }>>(
    Object.fromEntries(order.lines.map((l) => [l.id, { received: l.qty + l.free, damaged: 0 }])),
  );
  const confirm = async () => {
    try {
      const res = await post(PurchaseOrderSchema, `/purchase-orders/${order.id}/receive`, {
        lines: order.lines.map((l) => ({
          lineId: l.id,
          received: counts[l.id]?.received ?? l.qty + l.free,
          damaged: counts[l.id]?.damaged ?? 0,
        })),
      });
      toast(
        t(res.status === 'delivered' ? 'sup.receivedFull' : 'sup.receivedPart', { ref: order.ref }),
      );
      void qc.invalidateQueries({ queryKey: ['purchaseOrders'] });
      done();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'failed');
    }
  };
  return (
    <>
      <div className="toolbar">
        <div className="toolbar-context">
          <span className="k">{t('sup.receiving', { ref: order.ref })}</span>
          <span className="v">{order.supplierName}</span>
        </div>
        <div className="toolbar-actions">
          <button className="btn btn-ghost" onClick={done}>
            {t('sup.cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => void confirm()}>
            {t('sup.confirmReceipt')}
          </button>
        </div>
      </div>
      <div className="card">
        <div className="card-header">
          <h2>{t('sup.countTitle')}</h2>
          <span className="muted" style={{ fontWeight: 500 }}>
            {t('sup.countSub')}
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th>{t('sup.product')}</th>
              <th className="right">{t('sup.ordered')}</th>
              <th className="right">{t('sup.delivered')}</th>
              <th className="right">{t('sup.damaged')}</th>
              <th className="right">{t('sup.missing')}</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => {
              const c = counts[l.id] ?? { received: l.qty + l.free, damaged: 0 };
              const missing = Math.max(0, l.qty + l.free - c.received);
              return (
                <tr key={l.id}>
                  <td>
                    <span className="bold">{l.name}</span>
                    <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                      {l.sku}
                      {l.free ? ` · ${t('sup.inclFree', { n: l.free })}` : ''}
                    </span>
                  </td>
                  <td className="right tnum">{l.qty + l.free}</td>
                  <td className="right">
                    <NumInput
                      className="input qty-in"
                      min={0}
                      aria-label={`Received ${l.name}`}
                      value={c.received}
                      onValue={(n) => setCounts((x) => ({ ...x, [l.id]: { ...c, received: n } }))}
                    />
                  </td>
                  <td className="right">
                    <NumInput
                      className="input qty-in"
                      min={0}
                      aria-label={`Damaged ${l.name}`}
                      value={c.damaged}
                      onValue={(n) => setCounts((x) => ({ ...x, [l.id]: { ...c, damaged: n } }))}
                    />
                  </td>
                  <td
                    className={`right tnum ${missing ? 'bold' : 'muted'}`}
                    style={missing ? { color: 'var(--warning)' } : undefined}
                  >
                    {missing}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="note" style={{ margin: '16px 20px' }}>
          {t('sup.receiveNote')}
        </div>
      </div>
    </>
  );
}

/** Running promotions from connected suppliers (2026-10-07): the
 *  server's list with its reasons; a row opens the offer; the offer
 *  leads to an order from that supplier. */
function PromotionsTab({ startOrder, openId }: { startOrder: (supplierId: string) => void; openId: string | null }) {
  const { t } = useTranslation();
  const promos = useQuery({ queryKey: ['supPromotions'], queryFn: () => get(SalonPromotionListSchema, '/supplier-promotions') });
  const [open, setOpen] = useState<string | null>(openId);
  const rows = promos.data?.promotions ?? [];
  const current = rows.find((p) => p.id === open) ?? null;
  return (
    <>
      <div className="card">
        <div className="card-header">
          <div>
            <h2>{t('sup.promosTitle')}</h2>
            <span className="muted" style={{ fontWeight: 500 }}>{t('sup.promosSub')}</span>
          </div>
        </div>
        {promos.data && rows.length === 0 ? (
          <p className="muted" style={{ padding: '16px 20px', fontWeight: 500 }}>{t('sup.noPromos')}</p>
        ) : null}
        {rows.map((o) => (
          <button type="button" className="rowcard" key={o.id} onClick={() => setOpen(o.id)} data-testid="salon-promo" style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}>
            <span className={`mark ${o.status === 'running' ? 'on' : ''}`}>
              <Icon d={I.tag} size={20} />
            </span>
            <span className="grow">
              <span className="t">
                {o.title}
                {o.reasons.map((r) => (
                  <span key={r} className={`badge ${r === 'carry' || r === 'ordered_before' ? 'success' : r === 'ending_soon' ? 'warning' : ''}`} style={{ marginLeft: 6 }}>
                    {t(`sup.reason.${r}`)}
                  </span>
                ))}
              </span>
              <span className="s">
                {o.supplierName} · {o.products.map((x) => x.name).join(', ')}
              </span>
              <span className="s">
                {o.status === 'scheduled' ? t('sup.promoStarts', { date: dateShort(o.starts) }) : o.daysLeft === 0 ? t('sup.promoEndsToday') : t('sup.promoEndsIn', { n: o.daysLeft })} · {o.terms || '—'}
              </span>
            </span>
            <Icon d={I.right} size={18} />
          </button>
        ))}
      </div>
      {current ? <PromotionDetail promo={current} onClose={() => setOpen(null)} onOrder={() => startOrder(current.supplierId)} /> : null}
    </>
  );
}

function PromotionDetail({ promo, onClose, onOrder }: { promo: SalonPromotion; onClose: () => void; onOrder: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="promo-title" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 id="promo-title">{promo.title}</h2>
            <span className="muted" style={{ fontWeight: 500 }}>{promo.supplierName} · {promo.brand}</span>
          </div>
        </div>
        <div className="modal-body" style={{ display: 'grid', gap: 12 }} data-testid="salon-promo-detail">
          <div>
            {promo.reasons.map((r) => (
              <span key={r} className={`badge ${r === 'carry' || r === 'ordered_before' ? 'success' : r === 'ending_soon' ? 'warning' : ''}`} style={{ marginRight: 6 }}>
                {t(`sup.reason.${r}`)}
              </span>
            ))}
          </div>
          <div>
            <span className="stat-label">{t('sup.promoProducts')}</span>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {promo.products.map((x) => (
                <li key={x.id}>
                  <span className="bold">{x.name}</span> <span className="muted tnum">· {money(x.buy)}</span>
                  {x.carried ? <span className="badge success" style={{ marginLeft: 6 }}>{t('sup.promoCarried')}</span> : null}
                </li>
              ))}
            </ul>
          </div>
          <div className="muted" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 14px' }}>
            <span>{t('sup.promoPeriod')}</span><span className="tnum">{dateShort(promo.starts)} → {dateShort(promo.ends)}</span>
            <span>{t('sup.promoMinOrder')}</span><span className="tnum">{promo.minOrder ? money(promo.minOrder) : '—'}</span>
            <span>{t('sup.promoTerms')}</span><span>{promo.terms || '—'}</span>
          </div>
          <div className="note">{t('sup.promosSub')}</div>
        </div>
        <div className="modal-foot" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>{t('sup.promoClose')}</button>
          <button className="btn btn-primary" onClick={onOrder} data-testid="promo-order">{t('sup.promoOrderFrom', { name: promo.supplierName })}</button>
        </div>
        <button className="modal-close" aria-label={t('sup.promoClose')} onClick={onClose}>
          <Icon d={I.x} size={20} />
        </button>
      </div>
    </div>
  );
}
