import type { Location } from '@velnes/contracts';
import { I, Icon } from '@velnes/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api, post } from '@velnes/client';
import type { ResolvedProduct } from './Catalog.js';

const OkSchema = z.object({ ok: z.literal(true) });
const IdSchema = z.object({ id: z.string() });
const LevelsSchema = z.object({ levels: z.array(z.unknown()) });

export function ProductPanel({
  product,
  locations,
  categories,
  onSaved,
  onClose,
}: {
  product: ResolvedProduct | null;
  locations: Location[];
  categories: string[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const editing = !!product;
  const [name, setName] = useState(product?.name ?? '');
  const [category, setCategory] = useState(product?.category ?? categories[0] ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [price, setPrice] = useState(product?.config.price ?? 0);
  const [active, setActive] = useState(product?.config.active ?? true);
  const [adjustQty, setAdjustQty] = useState('');
  const [transferQty, setTransferQty] = useState('');
  const [fromLoc, setFromLoc] = useState(locations[0]?.id ?? '');
  const [toLoc, setToLoc] = useState(locations[1]?.id ?? locations[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.add('panel-open');
    return () => document.body.classList.remove('panel-open');
  }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { name, category: category || null, sku: sku || null, price, active };
      if (editing && product)
        await api(OkSchema, `/products/${product.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
      else await post(IdSchema, '/products', body);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const move = async (kind: 'adjustment' | 'transfer') => {
    if (!product) return;
    setError(null);
    try {
      if (kind === 'adjustment')
        await post(LevelsSchema, '/stock/movements', {
          kind: 'adjustment',
          productId: product.id,
          locationId: fromLoc,
          qty: Number(adjustQty),
          note: 'Manual adjustment',
        });
      else
        await post(LevelsSchema, '/stock/movements', {
          kind: 'transfer',
          productId: product.id,
          fromLocationId: fromLoc,
          toLocationId: toLoc,
          qty: Number(transferQty),
        });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div className="scrim on" onClick={onClose} />
      <aside className="panel open" role="dialog" aria-modal="true">
        <div className="panel-head plain">
          <div>
            <h2>{editing ? name : t('catalog.newProduct')}</h2>
            {editing && product?.own ? <div className="sub">{t('catalog.inTheRoom')}</div> : null}
          </div>
          <button className="iconbtn" aria-label={t('common.close')} onClick={onClose}>
            <Icon d={I.x} size={22} w={2.2} />
          </button>
        </div>
        <div className="panel-body">
          <div className="grid2">
            <label className="field">
              <span>{t('catalog.name')}<span className="req">*</span></span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span>{t('catalog.category')}</span>
              <input
                className="input"
                list="prod-cats"
                value={category ?? ''}
                onChange={(e) => setCategory(e.target.value)}
              />
              <datalist id="prod-cats">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <label className="field">
              <span>SKU</span>
              <input className="input" value={sku ?? ''} onChange={(e) => setSku(e.target.value)} />
            </label>
            <label className="field">
              <span>{t('catalog.price')}</span>
              <input
                className="input tnum"
                type="number"
                value={price}
                disabled={product?.own}
                onChange={(e) => setPrice(Number(e.target.value))}
              />
            </label>
          </div>
          {!product?.own ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              Active
            </label>
          ) : null}

          {editing ? (
            <>
              <div className="field">
                <span>{t('catalog.adjustStock')}</span>
                <span className="hint">{t('catalog.adjustHint')}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    className="select"
                    value={fromLoc}
                    aria-label={t('catalog.location')}
                    onChange={(e) => setFromLoc(e.target.value)}
                  >
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input tnum"
                    style={{ width: 100 }}
                    type="number"
                    placeholder="+/−"
                    value={adjustQty}
                    onChange={(e) => setAdjustQty(e.target.value)}
                  />
                  <button
                    className="btn btn-secondary"
                    disabled={!Number(adjustQty)}
                    onClick={() => void move('adjustment')}
                  >
                    {t('till.apply')}
                  </button>
                </div>
              </div>
              {locations.length > 1 ? (
                <div className="field">
                  <span>{t('catalog.transfer')}</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select
                      className="select"
                      value={fromLoc}
                      aria-label="from"
                      onChange={(e) => setFromLoc(e.target.value)}
                    >
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                    <Icon d={I.right} size={16} />
                    <select
                      className="select"
                      value={toLoc}
                      aria-label="to"
                      onChange={(e) => setToLoc(e.target.value)}
                    >
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                    <input
                      className="input tnum"
                      style={{ width: 90 }}
                      type="number"
                      min={1}
                      value={transferQty}
                      aria-label="quantity"
                      onChange={(e) => setTransferQty(e.target.value)}
                    />
                    <button
                      className="btn btn-secondary"
                      disabled={!Number(transferQty) || fromLoc === toLoc}
                      onClick={() => void move('transfer')}
                    >
                      {t('catalog.transferBtn')}
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {error ? (
            <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>
              {error}
            </p>
          ) : null}
        </div>
        <div className="panel-foot">
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" disabled={busy || !name} onClick={() => void save()}>
            {t('common.save')}
          </button>
        </div>
      </aside>
    </>
  );
}
