import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PurchaseOrderListSchema,
  PurchaseOrderSchema,
  SupplierListSchema,
  SupplierProductListSchema,
  SupplierPromotionListSchema,
  type PurchaseOrder,
  type Supplier,
} from '@velnes/contracts';
import { I, Icon } from '@velnes/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ApiError, get, post, useSession } from '@velnes/client';
import { useLocations } from '../../api/queries.js';
import { money } from '../../lib/money.js';
import { useToast } from '../../lib/toast.js';

/** The salon side of the supplier chain: suppliers, their catalogs,
 *  orders and deliveries (the prototype's SUP_TABS). Academy keeps
 *  its honest empty state until the trainings engine lands. */

const TABS = [
  ['suppliers', 'sup.tabSuppliers'],
  ['catalog', 'sup.tabCatalog'],
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
  const [tab, setTab] = useState<Tab>('suppliers');
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
      <span className={`mark ${s.status === 'connected' ? 'on' : ''}`}>{s.name[0]}</span>
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
    o.status === 'delivered' ? 'success' : o.status === 'disputed' ? 'danger' : o.status === 'approval' ? 'warning' : 'info';
  return (
    <tr>
      <td>
        <span className="bold">{o.ref}</span>
        <span className="muted" style={{ display: 'block', fontSize: 12 }}>
          {t('sup.by', { name: o.byName })}
        </span>
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
    queryFn: () => get(SupplierPromotionListSchema, '/supplier-promotions'),
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
                    <input
                      className="input qty-in"
                      type="number"
                      min={0}
                      aria-label={`Qty ${p.name}`}
                      value={qty[p.id] ?? 0}
                      disabled={p.stock === 0}
                      onChange={(e) => setQty((q) => ({ ...q, [p.id]: Number(e.target.value) }))}
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
                    <input
                      className="input qty-in"
                      type="number"
                      min={0}
                      aria-label={`Received ${l.name}`}
                      value={c.received}
                      onChange={(e) =>
                        setCounts((x) => ({ ...x, [l.id]: { ...c, received: Number(e.target.value) } }))
                      }
                    />
                  </td>
                  <td className="right">
                    <input
                      className="input qty-in"
                      type="number"
                      min={0}
                      aria-label={`Damaged ${l.name}`}
                      value={c.damaged}
                      onChange={(e) =>
                        setCounts((x) => ({ ...x, [l.id]: { ...c, damaged: Number(e.target.value) } }))
                      }
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
