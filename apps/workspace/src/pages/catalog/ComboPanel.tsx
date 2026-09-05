import type { Combo } from '@velnes/contracts';
import { I, Icon, NumInput } from '@velnes/ui';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api, post } from '@velnes/client';
import type { ResolvedProduct, ResolvedService } from './Catalog.js';

const OkSchema = z.object({ ok: z.literal(true) });
const IdSchema = z.object({ id: z.string() });

type SelKey = string; // `${type}|${id}`

/** The prototype's comboPanelBody: name/category/validity/prices, then
 *  a checkbox roster of services and products with per-item quantity.
 *  Selling the combo books the services and deducts the products —
 *  that till wiring is the honest next step; here it is fully editable. */
export function ComboPanel({
  combo,
  services,
  products,
  categories,
  onSaved,
  onDeleted,
  onClose,
}: {
  combo: Combo | null;
  services: ResolvedService[];
  products: ResolvedProduct[];
  categories: string[];
  onSaved: () => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const editing = !!combo;
  const [name, setName] = useState(combo?.name ?? '');
  const [category, setCategory] = useState(combo?.category ?? categories[0] ?? '');
  const [descr, setDescr] = useState(combo?.descr ?? '');
  const [validity, setValidity] = useState(combo?.validity ?? '12 months');
  const [regular, setRegular] = useState(combo?.regular ?? 0);
  const [price, setPrice] = useState(combo?.price ?? 0);
  const [vat, setVat] = useState(combo?.vat ?? 18);
  const [pos, setPos] = useState(combo?.pos ?? true);
  const [sel, setSel] = useState<Record<SelKey, number>>(() =>
    Object.fromEntries((combo?.items ?? []).map((it) => [`${it.type}|${it.id}`, it.qty])),
  );
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.add('panel-open');
    return () => document.body.classList.remove('panel-open');
  }, []);

  const isIn = (k: SelKey) => sel[k] !== undefined;
  const toggleItem = (k: SelKey) =>
    setSel((s) => {
      const next = { ...s };
      if (next[k] !== undefined) delete next[k];
      else next[k] = 1;
      return next;
    });
  const setQty = (k: SelKey, q: number) => setSel((s) => ({ ...s, [k]: Math.max(1, q) }));

  const items = useMemo(
    () =>
      Object.entries(sel).map(([k, qty]) => {
        const [type, id] = k.split('|') as ['service' | 'product', string];
        return { type, id, qty };
      }),
    [sel],
  );

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        name,
        category: category || null,
        descr,
        validity,
        regular,
        price,
        vat,
        pos,
        items,
      };
      if (editing && combo)
        await api(OkSchema, `/combos/${combo.id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await post(IdSchema, '/combos', body);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!combo) return;
    setBusy(true);
    setError(null);
    try {
      await api(OkSchema, `/combos/${combo.id}`, { method: 'DELETE' });
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="scrim on" onClick={onClose} />
      <aside className="panel open" role="dialog" aria-modal="true">
        <div className="panel-head plain">
          <div>
            <h2>{editing ? name : t('catalog.newCombo')}</h2>
          </div>
          <button className="iconbtn" aria-label={t('common.close')} onClick={onClose}>
            <Icon d={I.x} size={22} w={2.2} />
          </button>
        </div>
        <div className="panel-body">
          <div className="grid2">
            <label className="field span2">
              <span>
                {t('catalog.name')}
                <span className="req">*</span>
              </span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field span2">
              <span>{t('catalog.description')}</span>
              <textarea
                className="input"
                style={{ height: 70 }}
                value={descr}
                onChange={(e) => setDescr(e.target.value)}
              />
            </label>
            <label className="field">
              <span>
                {t('catalog.category')}
                <span className="req">*</span>
              </span>
              <select
                className="select"
                style={{ width: '100%' }}
                value={category ?? ''}
                onChange={(e) => setCategory(e.target.value)}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('catalog.validity')}</span>
              <input
                className="input"
                value={validity}
                onChange={(e) => setValidity(e.target.value)}
              />
            </label>
            <label className="field">
              <span>{t('catalog.regularCombined')}</span>
              <NumInput value={regular} onValue={setRegular} />
            </label>
            <label className="field">
              <span>
                {t('catalog.comboSalePrice')}
                <span className="req">*</span>
              </span>
              <NumInput value={price} onValue={setPrice} />
            </label>
            <label className="field">
              <span>{t('catalog.vat')}</span>
              <NumInput value={vat} onValue={setVat} />
            </label>
          </div>

          <div className="field">
            <span>{t('catalog.includedServices')}</span>
            {services.map((sv) => {
              const k = `service|${sv.id}`;
              return (
                <label
                  key={k}
                  className="checkrow"
                  style={{ justifyContent: 'space-between' }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input type="checkbox" checked={isIn(k)} onChange={() => toggleItem(k)} />
                    <span style={{ fontWeight: 500 }}>
                      {sv.name} · {sv.config.durationMin} min
                    </span>
                  </span>
                  <input
                    className="cell num"
                    type="number"
                    min={1}
                    aria-label={`Qty ${sv.name}`}
                    value={sel[k] ?? 1}
                    onChange={(e) => setQty(k, Number(e.target.value))}
                  />
                </label>
              );
            })}
          </div>

          <div className="field">
            <span>{t('catalog.includedProducts')}</span>
            {products.map((pr) => {
              const k = `product|${pr.id}`;
              return (
                <label
                  key={k}
                  className="checkrow"
                  style={{ justifyContent: 'space-between' }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input type="checkbox" checked={isIn(k)} onChange={() => toggleItem(k)} />
                    <span style={{ fontWeight: 500 }}>{pr.name}</span>
                  </span>
                  <input
                    className="cell num"
                    type="number"
                    min={1}
                    aria-label={`Qty ${pr.name}`}
                    value={sel[k] ?? 1}
                    onChange={(e) => setQty(k, Number(e.target.value))}
                  />
                </label>
              );
            })}
            <span className="hint" style={{ fontSize: 12, fontWeight: 500 }}>
              {t('catalog.comboDeductHint')}
            </span>
          </div>

          <div className="togglerow">
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span className="l">{t('catalog.forSaleTill')}</span>
            </span>
            <button
              type="button"
              className={`switch${pos ? ' on' : ''}`}
              role="switch"
              aria-checked={pos}
              aria-label={t('catalog.forSaleTill')}
              onClick={() => setPos((v) => !v)}
            >
              <span className="knob" />
            </button>
          </div>

          {editing ? (
            <div className="field" style={{ marginTop: 8 }}>
              {confirmDelete ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="muted" style={{ fontWeight: 500 }}>
                    {t('catalog.deleteComboConfirm')}
                  </span>
                  <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => void remove()}>
                    {t('common.delete')}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>
                    {t('common.cancel')}
                  </button>
                </div>
              ) : (
                <button className="btn btn-ghost btn-sm danger" onClick={() => setConfirmDelete(true)}>
                  {t('catalog.deleteCombo')}
                </button>
              )}
            </div>
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
          <button
            className="btn btn-primary"
            disabled={busy || !name || items.length === 0 || !price}
            onClick={() => void save()}
          >
            {t('common.save')}
          </button>
        </div>
      </aside>
    </>
  );
}
