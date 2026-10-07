import { ProductPromotionListSchema, ProductPromotionSchema, promoPrice, type ProductPromotion } from '@velnes/contracts';
import { I, Icon } from '@velnes/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, get, post } from '@velnes/client';
import { money } from '../../lib/money.js';
import type { ResolvedProduct } from './Catalog.js';

/**
 * A product's promotion (2026-10-07): the right-hand panel from the
 * catalog table. Shows the live or scheduled one with "End now", lets
 * the salon start a new one (a percentage off, or a promo price, for a
 * period), and lists the history. The effective price is the server's
 * rule (`promoPrice`); the preview here uses the same function.
 */
const dateShort = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
};

export function PromoPanel({ product, onClose, onChanged }: { product: ResolvedProduct; onClose: () => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const list = useQuery({ queryKey: ['productPromotions', product.id], queryFn: () => get(ProductPromotionListSchema, `/products/${product.id}/promotions`) });
  const promotions = list.data?.promotions ?? [];
  const live = promotions.find((p) => p.status === 'running' || p.status === 'scheduled') ?? null;
  const [kind, setKind] = useState<'pct' | 'price'>('pct');
  const [value, setValue] = useState('10');
  const [starts, setStarts] = useState(today);
  const [ends, setEnds] = useState(today);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const regular = product.config.price;
  const n = Number(value) || 0;
  const preview = useMemo(() => (n > 0 ? promoPrice(regular, { kind, value: n }) : null), [regular, kind, n]);
  const valid = n > 0 && (kind === 'pct' ? n <= 90 : n < regular) && ends >= starts && ends >= today;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['productPromotions', product.id] });
    onChanged();
  };
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await post(ProductPromotionSchema, `/products/${product.id}/promotions`, { kind, value: n, starts, ends, note });
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const end = async (p: ProductPromotion) => {
    setBusy(true);
    setError(null);
    try {
      await post(ProductPromotionSchema, `/products/${product.id}/promotions/${p.id}/end`, {});
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const label = (p: ProductPromotion) => (p.kind === 'pct' ? `−${p.value}%` : money(p.value));

  return (
    <>
      <div className="scrim on" onClick={onClose} />
      <aside className="panel open" role="dialog" aria-modal="true" aria-labelledby="promo-panel-title" data-testid="promo-panel">
        <div className="panel-head plain">
          <div>
            <h2 id="promo-panel-title">{t('catalog.promoTitle', { name: product.name })}</h2>
            <div className="sub">{t('catalog.promoSub')}</div>
          </div>
          <button className="iconbtn" aria-label={t('common.close')} onClick={onClose}>
            <Icon d={I.x} size={22} w={2.2} />
          </button>
        </div>
        <div className="panel-body" style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          {live ? (
            <div className="rowcard" data-testid="promo-live">
              <span className="mark on">%</span>
              <span className="grow">
                <span className="t">
                  {label(live)} · {money(promoPrice(regular, live))} <span className="muted" style={{ textDecoration: 'line-through', fontWeight: 500 }}>{money(regular)}</span>
                  <span className={`badge ${live.status === 'running' ? 'success' : 'warning'}`} style={{ marginLeft: 6 }}>{live.status === 'running' ? t('catalog.promoRunning') : t('catalog.promoScheduled')}</span>
                </span>
                <span className="s">
                  {dateShort(live.starts)} → {dateShort(live.ends)}{live.note ? ` · ${live.note}` : ''}
                </span>
                <span className="s muted">{t('catalog.promoEndSub')}</span>
              </span>
              <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void end(live)} data-testid="promo-end">
                {t('catalog.promoEnd')}
              </button>
            </div>
          ) : (
            <>
              <p className="muted" style={{ margin: 0, fontWeight: 500 }}>{t('catalog.promoNone')}</p>
              <div className="grid2">
                <label className="field">
                  <span>{t('catalog.promoKind')}</span>
                  <select className="select" value={kind} onChange={(e) => setKind(e.target.value as 'pct' | 'price')} aria-label={t('catalog.promoKind')}>
                    <option value="pct">{t('catalog.promoPct')}</option>
                    <option value="price">{t('catalog.promoPrice')}</option>
                  </select>
                </label>
                <label className="field">
                  <span>{kind === 'pct' ? t('catalog.promoValuePct') : t('catalog.promoValuePrice')}</span>
                  <input className="input" type="number" min={1} max={kind === 'pct' ? 90 : regular - 1} value={value} onChange={(e) => setValue(e.target.value)} aria-label={kind === 'pct' ? t('catalog.promoValuePct') : t('catalog.promoValuePrice')} />
                </label>
                <label className="field">
                  <span>{t('catalog.promoStarts')}</span>
                  <input className="input" type="date" value={starts} min={today} onChange={(e) => setStarts(e.target.value)} aria-label={t('catalog.promoStarts')} />
                </label>
                <label className="field">
                  <span>{t('catalog.promoEnds')}</span>
                  <input className="input" type="date" value={ends} min={starts} onChange={(e) => setEnds(e.target.value)} aria-label={t('catalog.promoEnds')} />
                </label>
                <label className="field span2">
                  <span>{t('catalog.promoNote')}</span>
                  <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
              </div>
              <div className="note tnum" data-testid="promo-preview">
                {preview !== null ? t('catalog.promoPreview', { regular: money(regular), promo: money(preview) }) : t('catalog.promoOneLive')}
              </div>
            </>
          )}
          {error ? <p className="muted" style={{ color: 'var(--danger, #b3261e)', fontWeight: 600, margin: 0 }}>{error}</p> : null}
          {promotions.filter((p) => p.status === 'ended').length ? (
            <div>
              <span className="stat-label">{t('catalog.promoHistory')}</span>
              <ul className="muted" style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', fontSize: 13, display: 'grid', gap: 4 }}>
                {promotions
                  .filter((p) => p.status === 'ended')
                  .map((p) => (
                    <li key={p.id}>
                      {label(p)} · {dateShort(p.starts)} → {dateShort(p.ends)}{p.endedAt && p.endedAt.slice(0, 10) < p.ends ? ` · ${t('catalog.promoEnded').toLowerCase()} ${dateShort(p.endedAt.slice(0, 10))}` : ''} · {p.createdBy.name}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div className="panel-foot">
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.close')}
          </button>
          {!live ? (
            <button className="btn btn-primary" disabled={busy || !valid} onClick={() => void start()} data-testid="promo-start">
              {t('catalog.promoStart')}
            </button>
          ) : null}
        </div>
      </aside>
    </>
  );
}
