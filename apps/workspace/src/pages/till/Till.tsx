import { SaleResponseSchema, ValidateCodeResponseSchema, type SaleLine } from '@velnes/contracts';
import { I, Icon } from '@velnes/ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { post } from '@velnes/client';
import { useAppointments, useLocationCatalog, useLocations } from '../../api/queries.js';
import { money } from '../../lib/money.js';
import { useToast } from '../../lib/toast.js';
import { refusalText } from '@velnes/client';
import { useSession } from '@velnes/client';
import { useScope } from '../../shell/Shell.js';
import { localIso } from '../calendar/Calendar.js';

const uuid = () =>
  crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();

/** The prototype's POS_TYPES bar, verbatim. */
const POS_TYPES: [string, string][] = [
  ['appointments', "Today's"],
  ['services', 'Services'],
  ['products', 'Products'],
  ['combos', 'Packages'],
  ['giftcards', 'Gift cards'],
];

const CAT_ICON: Record<string, string> = {
  Assessment: I.clipboard,
  'Manual therapy': I.hands,
  Rehab: I.dumbbell,
  Recovery: I.pulse,
  'Home exercise': I.dumbbell,
  'Recovery aids': I.bottle,
  Supports: I.package,
};
const TYPE_ICON: Record<string, string> = {
  services: I.hands,
  products: I.dumbbell,
  combos: I.package,
  giftcards: I.giftcard,
  appointments: I.calendar,
};

interface BasketLine {
  key: string;
  kind: 'service' | 'product' | 'appointment';
  refId: string;
  name: string;
  sub?: string | undefined;
  price: number;
  qty: number;
  disc: number;
}
const lineTotal = (l: BasketLine) => Math.max(0, l.price * l.qty - l.disc);

interface Extras {
  tip: number;
  serviceCharge: number;
  cartDiscount: number;
  promo: { code: string; amount: number } | null;
  gift: { code: string; amount: number } | null;
  points: { points: number; worth: number } | null;
}
const noExtras: Extras = {
  tip: 0,
  serviceCharge: 0,
  cartDiscount: 0,
  promo: null,
  gift: null,
  points: null,
};

export function TillPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const { me } = useSession();
  const { scope } = useScope();
  const locations = useLocations();

  const myLocs = useMemo(() => {
    const all = locations.data?.locations ?? [];
    return me?.locationIds.length ? all.filter((l) => me.locationIds.includes(l.id)) : all;
  }, [locations.data, me]);
  // The till stands in ONE location (the prototype's rule).
  const here = scope !== 'all' ? scope : (myLocs[0]?.id ?? null);
  const hereName = myLocs.find((l) => l.id === here)?.name ?? '';

  const catalog = useLocationCatalog(here);
  const today = localIso(new Date());
  const appts = useAppointments(here, today, today);

  const [posType, setPosType] = useState('appointments');
  const [posCategory, setPosCategory] = useState('all');
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [extras, setExtras] = useState<Extras>(noExtras);
  const [modal, setModal] = useState<'payment' | 'actions' | null>(null);
  const [lineDiscFor, setLineDiscFor] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState('Card');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saleKey, setSaleKey] = useState(uuid);
  // Sale-actions scratch inputs.
  const [inTip, setInTip] = useState('');
  const [inDisc, setInDisc] = useState('');
  const [inCharge, setInCharge] = useState('');
  const [inCode, setInCode] = useState('');
  const [inPoints, setInPoints] = useState('');
  const [inLineDisc, setInLineDisc] = useState('');

  const services = (catalog.data?.services ?? []).filter(
    (s) => s.status !== 'draft' && s.config.active && s.config.pos,
  );
  const products = (catalog.data?.products ?? []).filter(
    (p) => !p.own && p.config.active && p.config.pos,
  );
  const todaysAppts = (appts.data?.appointments ?? []).filter(
    (a) => a.kind === 'appointment' && a.status !== 'cancelled',
  );
  const hourOf = (start: string) => `${start.slice(0, 2)}:00`;

  const cats: string[] =
    posType === 'services'
      ? [...new Set(services.map((s) => s.category ?? ''))].filter(Boolean)
      : posType === 'products'
        ? [...new Set(products.map((p) => p.category ?? ''))].filter(Boolean)
        : posType === 'appointments'
          ? [...new Set(todaysAppts.map((a) => hourOf(a.start)))].sort()
          : [];

  interface Tile {
    id: string;
    kind: BasketLine['kind'];
    name: string;
    sub?: string | undefined;
    meta: string;
    price: number;
    letter: string;
  }
  const inCat = (c: string | null) => posCategory === 'all' || c === posCategory;
  let tiles: Tile[] = [];
  if (posType === 'services')
    tiles = services
      .filter((s) => inCat(s.category))
      .map((s) => ({
        id: s.id,
        kind: 'service' as const,
        name: s.name,
        meta: `${s.category ?? ''} · ${s.config.durationMin} min`,
        price: s.config.price,
        letter: s.name[0] ?? '?',
      }));
  if (posType === 'products')
    tiles = products
      .filter((p) => inCat(p.category))
      .map((p) => ({
        id: p.id,
        kind: 'product' as const,
        name: p.name,
        meta: `${p.config.stock} in stock at ${hereName}`,
        price: p.config.price,
        letter: p.name[0] ?? '?',
      }));
  if (posType === 'appointments')
    tiles = todaysAppts
      .filter((a) => inCat(hourOf(a.start)))
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((a) => ({
        id: a.id,
        kind: 'appointment' as const,
        name: a.title,
        sub: a.serviceName ?? undefined,
        meta: `${a.start} · ${a.serviceName ?? ''}`,
        price: a.price,
        letter: a.title[0] ?? '?',
      }));

  const tillQty = (id: string) => basket.reduce((n, l) => n + (l.refId === id ? l.qty : 0), 0);

  const add = (tile: Tile) =>
    setBasket((b) => {
      const existing = b.find((l) => l.refId === tile.id);
      if (existing && tile.kind !== 'appointment')
        return b.map((l) => (l.refId === tile.id ? { ...l, qty: l.qty + 1 } : l));
      if (existing) return b; // an appointment rings up once
      return [
        ...b,
        {
          key: uuid(),
          kind: tile.kind,
          refId: tile.id,
          name: tile.kind === 'appointment' ? (tile.sub ?? tile.name) : tile.name,
          sub: tile.kind === 'appointment' ? tile.name : undefined,
          price: tile.price,
          qty: 1,
          disc: 0,
        },
      ];
    });
  const setQty = (key: string, d: number) =>
    setBasket((b) =>
      b.map((l) => (l.key === key ? { ...l, qty: l.qty + d } : l)).filter((l) => l.qty > 0),
    );
  const removeLine = (key: string) => setBasket((b) => b.filter((l) => l.key !== key));

  const subtotal = basket.reduce((s, l) => s + lineTotal(l), 0);
  const total = Math.max(
    0,
    subtotal +
      extras.tip +
      extras.serviceCharge -
      extras.cartDiscount -
      (extras.points?.worth ?? 0) -
      (extras.gift?.amount ?? 0) -
      (extras.promo?.amount ?? 0),
  );
  const has = basket.length > 0;
  const saleCustomerId =
    todaysAppts.find((a) => basket.some((l) => l.refId === a.id) && a.customerId)?.customerId ??
    null;
  const saleEmployeeId =
    todaysAppts.find((a) => basket.some((l) => l.refId === a.id) && a.employeeId)?.employeeId ??
    null;

  const applyCode = async () => {
    if (!inCode) return;
    const v = await post(ValidateCodeResponseSchema, '/till/validate-code', {
      code: inCode,
      subtotal,
    });
    if (v.kind === 'promo') setExtras((x) => ({ ...x, promo: { code: v.code, amount: v.amount } }));
    else if (v.kind === 'gift')
      setExtras((x) => ({ ...x, gift: { code: v.code, amount: Math.min(v.remaining, total) } }));
    else toast(v.message);
    setInCode('');
  };

  const finish = async (method: string) => {
    if (!here || !has || busy) return;
    setBusy(true);
    setError(null);
    try {
      const lines: SaleLine[] = basket.map((l) =>
        l.kind === 'appointment'
          ? { kind: 'appointment' as const, appointmentId: l.refId, lineDiscount: l.disc }
          : l.kind === 'service'
            ? {
                kind: 'service' as const,
                serviceId: l.refId,
                variantId: null,
                modifierOptionIds: [],
                qty: l.qty,
                lineDiscount: l.disc,
              }
            : { kind: 'product' as const, productId: l.refId, qty: l.qty, lineDiscount: l.disc },
      );
      const res = await post(SaleResponseSchema, '/sales', {
        key: saleKey,
        locationId: here,
        lines,
        method,
        customerId: saleCustomerId,
        employeeId: saleEmployeeId ?? me?.id ?? null,
        tip: extras.tip,
        serviceCharge: extras.serviceCharge,
        cartDiscount: extras.cartDiscount,
        pointsRedeemed: extras.points?.points ?? 0,
        giftCardCode: extras.gift?.code ?? null,
        giftAmount: extras.gift?.amount ?? 0,
        promoCode: extras.promo?.code ?? null,
      });
      setBasket([]);
      setExtras(noExtras);
      setModal(null);
      setSaleKey(uuid());
      toast(
        `${money(res.total)} ${t('till.paidBy')} ${method.toLowerCase()} · ${res.invoice.number}`,
      );
      if (res.checkoutStatus === 'PARTIALLY_PAID')
        setTimeout(() => toast(t('till.partiallyPaid')), 2600);
      if (res.shortages.length)
        setTimeout(() => toast(`${t('till.ranOut')} — ${res.shortages[0]}`), 5200);
    } catch (e) {
      setError(refusalText(t, e));
    } finally {
      setBusy(false);
    }
  };

  const catTile = (id: string, ic: string, label: string, on: boolean, count?: number) => (
    <button key={id} className={`catbtn${on ? ' on' : ''}`} onClick={() => setPosCategory(id)}>
      <span className="catbtn-ic">
        <Icon d={ic} size={22} w={1.8} />
      </span>
      <span className="catbtn-l">{label}</span>
      {count === undefined ? null : (
        <span className={`catbtn-n${count ? '' : ' zero'}`}>{count}</span>
      )}
    </button>
  );
  const inHour = (h: string) => todaysAppts.filter((a) => hourOf(a.start) === h).length;

  const extraRow = (kind: keyof Extras | 'points', label: string, amount: number, sign: string) => (
    <div className="receipt-extra" key={kind + label}>
      <span>{label}</span>
      <span className="x">
        <span className="tnum">
          {sign}
          {money(amount)}
        </span>
        <button
          className="btn btn-subtle btn-sq"
          aria-label={`Remove ${label}`}
          onClick={() =>
            setExtras((x) => ({
              ...x,
              [kind]: kind === 'promo' || kind === 'gift' || kind === 'points' ? null : 0,
            }))
          }
        >
          <Icon d={I.x} size={16} />
        </button>
      </span>
    </div>
  );

  return (
    <>
      <div className="toolbar toolbar-row">
        <div className="filters">
          <div className="cat-tabs">
            {POS_TYPES.map(([k, l]) => (
              <button
                key={k}
                className={`ttab${posType === k ? ' on' : ''}`}
                onClick={() => {
                  setPosType(k);
                  setPosCategory('all');
                }}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="toolbar-actions">
          <button className="btn btn-secondary" onClick={() => navigate('/till/invoices')}>
            {t('till.invoices')}
          </button>
        </div>
      </div>

      <div className={`pos${cats.length ? '' : ' pos-nocats'}`}>
        {cats.length ? (
          <aside className="pos-cats">
            {catTile(
              'all',
              TYPE_ICON[posType] ?? I.grid,
              `All ${POS_TYPES.find((p) => p[0] === posType)?.[1].toLowerCase() ?? ''}`,
              posCategory === 'all',
            )}
            {cats.map((c) =>
              posType === 'appointments'
                ? catTile(c, I.clock, c, posCategory === c, inHour(c))
                : catTile(c, CAT_ICON[c] ?? I.tag, c, posCategory === c),
            )}
          </aside>
        ) : null}

        <div className="pos-items">
          {tiles.length === 0 ? (
            <div className="empty">
              <h3>{t('till.nothingHere')}</h3>
              <p>{t('till.nothingHereSub')}</p>
            </div>
          ) : (
            <div className="pos-grid">
              {tiles.map((tile) => {
                const q = tillQty(tile.id);
                return (
                  <button
                    key={tile.id}
                    className={`pos-tile${q ? ' in-cart' : ''}`}
                    onClick={() => add(tile)}
                  >
                    <span className="ptile-img">
                      <span className="ptile-letter">{tile.letter.toUpperCase()}</span>
                      <span className="ptile-p">{money(tile.price)}</span>
                      {q ? (
                        <span className="ptile-q" aria-label={`${q} on the receipt`}>
                          ×&nbsp;{q}
                        </span>
                      ) : null}
                    </span>
                    <span className="ptile-n">{tile.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="card pos-receipt">
          <div className="card-header">
            <h2>{t('till.receipt')}</h2>
            <span className="badge">{basket.length} {t('till.items')}</span>
          </div>
          <div className={`receipt-body${basket.length > 6 ? ' tight' : ''}`}>
            {basket.length === 0 ? (
              <div className="empty">
                <h3>{t('till.emptyTitle')}</h3>
                <p>{t('till.emptySub')}</p>
              </div>
            ) : (
              basket.map((l) => (
                <div className="bl-row" key={l.key}>
                  <div className="basket-line">
                    <span className="bl-thumb ph">{(l.name[0] ?? '?').toUpperCase()}</span>
                    <div className="bl-name">
                      <div className="bold">{l.name}</div>
                      {l.sub ? <div className="bl-each">{l.sub}</div> : null}
                      <div className="tnum bl-each">{money(l.price)} {t('till.each')}</div>
                      {l.disc ? (
                        <button
                          className="line-disc"
                          onClick={() =>
                            setBasket((b) =>
                              b.map((x) => (x.key === l.key ? { ...x, disc: 0 } : x)),
                            )
                          }
                        >
                          <Icon d={I.tag} size={13} />
                          <span className="tnum">−{money(l.disc)}</span>
                          <Icon d={I.x} size={13} />
                        </button>
                      ) : (
                        <button
                          className="line-disc"
                          style={{ opacity: 0.6 }}
                          aria-label={`Discount ${l.name}`}
                          onClick={() => {
                            setLineDiscFor(l.key);
                            setInLineDisc('');
                          }}
                        >
                          <Icon d={I.tag} size={13} />
                        </button>
                      )}
                    </div>
                    <div className="qty">
                      {l.qty > 1 ? (
                        <button
                          className="btn btn-subtle btn-sq"
                          aria-label="One less"
                          onClick={() => setQty(l.key, -1)}
                        >
                          <Icon d={I.minus} size={16} />
                        </button>
                      ) : (
                        <button
                          className="btn btn-subtle btn-sq bl-bin"
                          aria-label={`Remove ${l.name}`}
                          onClick={() => removeLine(l.key)}
                        >
                          <Icon d={I.trash} size={16} />
                        </button>
                      )}
                      <span>{l.qty}</span>
                      <button
                        className="btn btn-subtle btn-sq"
                        aria-label="One more"
                        onClick={() => setQty(l.key, 1)}
                        disabled={l.kind === 'appointment'}
                      >
                        <Icon d={I.plus} size={16} />
                      </button>
                    </div>
                    <span className="bold tnum bl-sum">
                      {l.disc ? (
                        <>
                          <span className="was tnum">{money(l.price * l.qty)}</span>
                          <br />
                        </>
                      ) : null}
                      {money(lineTotal(l))}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="receipt-foot">
            {extras.cartDiscount ? extraRow('cartDiscount', t('till.discount'), extras.cartDiscount, '−') : null}
            {extras.points
              ? extraRow('points', `${extras.points.points} ${t('till.points')}`, extras.points.worth, '−')
              : null}
            {extras.gift ? extraRow('gift', `${t('till.giftCard')} ${extras.gift.code}`, extras.gift.amount, '−') : null}
            {extras.promo ? extraRow('promo', `${t('till.promo')} ${extras.promo.code}`, extras.promo.amount, '−') : null}
            {extras.serviceCharge
              ? extraRow('serviceCharge', t('till.serviceCharge'), extras.serviceCharge, '+')
              : null}
            {extras.tip ? extraRow('tip', t('till.tip'), extras.tip, '+') : null}
            <div
              style={{
                padding: '16px 20px',
                borderTop: '1px solid var(--line)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {error ? (
                <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>
                  {error}
                </p>
              ) : null}
              <div className="paygrid">
                <button
                  className="btn btn-secondary"
                  style={{ height: 56 }}
                  disabled={!has || busy}
                  onClick={() => void finish('Cash')}
                >
                  {t('till.cash')}
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ height: 56 }}
                  disabled={!has || busy}
                  onClick={() => void finish('Card')}
                >
                  {t('till.card')}
                </button>
              </div>
              <div className="pay-row">
                <button
                  className="btn btn-secondary btn-actions"
                  aria-label={t('till.saleActions')}
                  onClick={() => setModal('actions')}
                >
                  <Icon d={I.dots} size={22} w={2.4} />
                </button>
                <button
                  className="btn btn-primary pay-btn"
                  disabled={!has || busy}
                  onClick={() => setModal('payment')}
                >
                  {t('till.pay')} {money(total)}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {modal === 'payment' ? (
        <div className="overlay" onClick={() => setModal(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{t('till.takePayment')}</h2>
              <p>{money(total)} {t('till.due')}</p>
            </div>
            <div className="modal-body">
              <div className="grid2">
                {['Card', 'Cash', 'Gift card', 'Bank transfer'].map((m) => (
                  <button
                    key={m}
                    className={`picker${payMethod === m ? ' on' : ''}`}
                    style={{ alignItems: 'center' }}
                    onClick={() => setPayMethod(m)}
                  >
                    <span className="n">{m}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-secondary" onClick={() => setModal(null)}>
                {t('till.back')}
              </button>
              <button className="btn btn-primary" disabled={busy} onClick={() => void finish(payMethod)}>
                {t('till.finishSale')}
              </button>
            </div>
            <button className="modal-close" aria-label={t('common.close')} onClick={() => setModal(null)}>
              <Icon d={I.x} size={20} />
            </button>
          </div>
        </div>
      ) : null}

      {modal === 'actions' ? (
        <div className="overlay" onClick={() => setModal(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{t('till.saleActions')}</h2>
            </div>
            <div className="modal-body" style={{ display: 'grid', gap: 14 }}>
              <div className="grid2">
                <label className="field">
                  <span>{t('till.tip')}</span>
                  <input
                    className="input tnum"
                    inputMode="numeric"
                    value={inTip}
                    onChange={(e) => setInTip(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>{t('till.discount')}</span>
                  <input
                    className="input tnum"
                    inputMode="numeric"
                    value={inDisc}
                    onChange={(e) => setInDisc(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>{t('till.serviceCharge')}</span>
                  <input
                    className="input tnum"
                    inputMode="numeric"
                    value={inCharge}
                    onChange={(e) => setInCharge(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>{t('till.pointsToRedeem')}</span>
                  <input
                    className="input tnum"
                    inputMode="numeric"
                    value={inPoints}
                    onChange={(e) => setInPoints(e.target.value)}
                    disabled={!saleCustomerId}
                  />
                </label>
              </div>
              <label className="field">
                <span>{t('till.codeLabel')}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="input"
                    value={inCode}
                    onChange={(e) => setInCode(e.target.value)}
                    placeholder="SUMMER26 · VEL-…"
                  />
                  <button className="btn btn-secondary" onClick={() => void applyCode()}>
                    {t('till.apply')}
                  </button>
                </div>
              </label>
              {!saleCustomerId ? <div className="note">{t('till.pointsNeedCustomer')}</div> : null}
            </div>
            <div className="modal-foot">
              <button
                className="btn btn-primary"
                onClick={() => {
                  setExtras((x) => ({
                    ...x,
                    tip: Number(inTip) || x.tip,
                    cartDiscount: Number(inDisc) || x.cartDiscount,
                    serviceCharge: Number(inCharge) || x.serviceCharge,
                    points:
                      Number(inPoints) > 0
                        ? {
                            points: Number(inPoints),
                            worth: Math.floor(Number(inPoints) / 100) * 300,
                          }
                        : x.points,
                  }));
                  setModal(null);
                }}
              >
                {t('common.save')}
              </button>
            </div>
            <button className="modal-close" aria-label={t('common.close')} onClick={() => setModal(null)}>
              <Icon d={I.x} size={20} />
            </button>
          </div>
        </div>
      ) : null}

      {lineDiscFor ? (
        <div className="overlay" onClick={() => setLineDiscFor(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            style={{ maxWidth: 380 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2>{t('till.lineDiscount')}</h2>
            </div>
            <div className="modal-body">
              <label className="field">
                <span>{t('till.amountOff')}</span>
                <input
                  className="input tnum"
                  inputMode="numeric"
                  value={inLineDisc}
                  onChange={(e) => setInLineDisc(e.target.value)}
                />
              </label>
            </div>
            <div className="modal-foot">
              <button className="btn btn-secondary" onClick={() => setLineDiscFor(null)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const v = Number(inLineDisc) || 0;
                  setBasket((b) =>
                    b.map((x) => (x.key === lineDiscFor ? { ...x, disc: v } : x)),
                  );
                  setLineDiscFor(null);
                }}
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
