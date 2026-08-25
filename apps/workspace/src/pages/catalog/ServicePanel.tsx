import type { Location } from '@velnes/contracts';
import { I, Icon } from '@velnes/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api, post } from '@velnes/client';
import type { ResolvedService } from './Catalog.js';

const OkSchema = z.object({ ok: z.literal(true) });
const IdSchema = z.object({ id: z.string() });

interface VariantRow {
  id?: string | undefined;
  label: string;
  durationMin: number;
  price: number;
  std: boolean;
}
interface OptionRow {
  id?: string | undefined;
  name: string;
  price: number;
  durationMin: number;
}
interface GroupRow {
  id?: string | undefined;
  name: string;
  type: 'single' | 'multi';
  required: boolean;
  options: OptionRow[];
}

export function ServicePanel({
  service,
  locations,
  categories,
  onSaved,
  onClose,
}: {
  service: ResolvedService | null;
  locations: Location[];
  categories: string[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const editing = !!service;
  const [name, setName] = useState(service?.name ?? '');
  const [category, setCategory] = useState(service?.category ?? categories[0] ?? '');
  const [price, setPrice] = useState(service?.price ?? 0);
  const [duration, setDuration] = useState(service?.durationMin ?? 30);
  const [vat, setVat] = useState(service?.vat ?? 18);
  const [status, setStatus] = useState(service?.status ?? 'active');
  const [online, setOnline] = useState(service?.online ?? true);
  const [pos, setPos] = useState(service?.pos ?? true);
  const [prepMin, setPrepMin] = useState<number | null>(service?.prepMin ?? null);
  const [resetMin, setResetMin] = useState<number | null>(service?.resetMin ?? null);
  const [variants, setVariants] = useState<VariantRow[]>(
    (service?.variants ?? []).map((v) => ({
      id: v.id,
      label: v.label,
      durationMin: v.durationMin,
      price: v.price,
      std: v.std,
    })),
  );
  const [groups, setGroups] = useState<GroupRow[]>(
    (service?.modifiers ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      type: g.type,
      required: g.required,
      options: g.options.map((o) => ({
        id: o.id,
        name: o.name,
        price: o.price,
        durationMin: o.durationMin,
      })),
    })),
  );
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
      const body = {
        name,
        category: category || null,
        durationMin: duration,
        price,
        vat,
        status,
        pos,
        online,
        prepMin,
        resetMin,
        variants,
        modifiers: groups,
      };
      if (editing && service)
        await api(OkSchema, `/services/${service.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
      else await post(IdSchema, '/services', body);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const patchLoc = async (locId: string, patch: Record<string, unknown>) => {
    if (!service) return;
    await api(OkSchema, `/locations/${locId}/catalog/services/${service.id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  };

  return (
    <>
      <div className="scrim on" onClick={onClose} />
      <aside className="panel open" role="dialog" aria-modal="true">
        <div className="panel-head plain">
          <div>
            <h2>{editing ? name : t('catalog.newService')}</h2>
            {editing ? <div className="sub">{category}</div> : null}
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
                list="svc-cats"
                value={category ?? ''}
                onChange={(e) => setCategory(e.target.value)}
              />
              <datalist id="svc-cats">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <label className="field">
              <span>{t('catalog.price')}</span>
              <input
                className="input tnum"
                type="number"
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span>{t('catalog.duration')}</span>
              <input
                className="input tnum"
                type="number"
                step={5}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span>{t('catalog.prep')}</span>
              <input
                className="input tnum"
                type="number"
                value={prepMin ?? ''}
                placeholder="0"
                onChange={(e) => setPrepMin(e.target.value === '' ? null : Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span>{t('catalog.reset')}</span>
              <input
                className="input tnum"
                type="number"
                value={resetMin ?? ''}
                placeholder="10"
                onChange={(e) =>
                  setResetMin(e.target.value === '' ? null : Number(e.target.value))
                }
              />
            </label>
            <label className="field">
              <span>VAT %</span>
              <input
                className="input tnum"
                type="number"
                value={vat}
                onChange={(e) => setVat(Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span>{t('till.status')}</span>
              <select
                className="select"
                value={status}
                onChange={(e) => setStatus(e.target.value as 'active' | 'draft')}
              >
                <option value="active">Active</option>
                <option value="draft">Draft</option>
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 18 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
              <input type="checkbox" checked={online} onChange={(e) => setOnline(e.target.checked)} />
              {t('catalog.online')}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
              <input type="checkbox" checked={pos} onChange={(e) => setPos(e.target.checked)} />
              {t('catalog.onTill')}
            </label>
          </div>

          <div className="field">
            <span>{t('catalog.variants')}</span>
            <span className="hint">{t('catalog.variantsHint')}</span>
            {variants.map((v, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  className="input"
                  style={{ flex: 2 }}
                  value={v.label}
                  placeholder={t('catalog.variantLabel')}
                  onChange={(e) =>
                    setVariants((a) => a.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                  }
                />
                <input
                  className="input tnum"
                  style={{ width: 80 }}
                  type="number"
                  step={5}
                  value={v.durationMin}
                  aria-label="minutes"
                  onChange={(e) =>
                    setVariants((a) =>
                      a.map((x, j) => (j === i ? { ...x, durationMin: Number(e.target.value) } : x)),
                    )
                  }
                />
                <input
                  className="input tnum"
                  style={{ width: 100 }}
                  type="number"
                  value={v.price}
                  aria-label="price"
                  onChange={(e) =>
                    setVariants((a) =>
                      a.map((x, j) => (j === i ? { ...x, price: Number(e.target.value) } : x)),
                    )
                  }
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                  <input
                    type="radio"
                    name="std-variant"
                    checked={v.std}
                    onChange={() =>
                      setVariants((a) => a.map((x, j) => ({ ...x, std: j === i })))
                    }
                  />
                  {t('catalog.standard')}
                </label>
                <button
                  className="btn btn-subtle btn-sq"
                  aria-label={t('common.delete')}
                  onClick={() => setVariants((a) => a.filter((_, j) => j !== i))}
                >
                  <Icon d={I.trash} size={16} />
                </button>
              </div>
            ))}
            <button
              className="btn btn-secondary btn-sm"
              style={{ justifySelf: 'start' }}
              onClick={() =>
                setVariants((a) => [
                  ...a,
                  { label: '', durationMin: duration, price, std: a.length === 0 },
                ])
              }
            >
              <Icon d={I.plus} size={16} /> {t('catalog.addVariant')}
            </button>
          </div>

          <div className="field">
            <span>{t('catalog.modifiers')}</span>
            <span className="hint">{t('catalog.modifiersHint')}</span>
            {groups.map((g, gi) => (
              <div
                key={gi}
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r-control)',
                  padding: 12,
                  display: 'grid',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    className="input"
                    style={{ flex: 1 }}
                    value={g.name}
                    placeholder={t('catalog.groupName')}
                    onChange={(e) =>
                      setGroups((a) => a.map((x, j) => (j === gi ? { ...x, name: e.target.value } : x)))
                    }
                  />
                  <select
                    className="select"
                    value={g.type}
                    aria-label="type"
                    onChange={(e) =>
                      setGroups((a) =>
                        a.map((x, j) =>
                          j === gi ? { ...x, type: e.target.value as 'single' | 'multi' } : x,
                        ),
                      )
                    }
                  >
                    <option value="single">{t('catalog.single')}</option>
                    <option value="multi">{t('catalog.multi')}</option>
                  </select>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={g.required}
                      onChange={(e) =>
                        setGroups((a) =>
                          a.map((x, j) => (j === gi ? { ...x, required: e.target.checked } : x)),
                        )
                      }
                    />
                    {t('catalog.required')}
                  </label>
                  <button
                    className="btn btn-subtle btn-sq"
                    aria-label={t('common.delete')}
                    onClick={() => setGroups((a) => a.filter((_, j) => j !== gi))}
                  >
                    <Icon d={I.trash} size={16} />
                  </button>
                </div>
                {g.options.map((o, oi) => (
                  <div key={oi} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      className="input"
                      style={{ flex: 2 }}
                      value={o.name}
                      placeholder={t('catalog.optionName')}
                      onChange={(e) =>
                        setGroups((a) =>
                          a.map((x, j) =>
                            j === gi
                              ? {
                                  ...x,
                                  options: x.options.map((y, k) =>
                                    k === oi ? { ...y, name: e.target.value } : y,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                    <input
                      className="input tnum"
                      style={{ width: 90 }}
                      type="number"
                      value={o.price}
                      aria-label="option price"
                      onChange={(e) =>
                        setGroups((a) =>
                          a.map((x, j) =>
                            j === gi
                              ? {
                                  ...x,
                                  options: x.options.map((y, k) =>
                                    k === oi ? { ...y, price: Number(e.target.value) } : y,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                    <input
                      className="input tnum"
                      style={{ width: 70 }}
                      type="number"
                      value={o.durationMin}
                      aria-label="option minutes"
                      onChange={(e) =>
                        setGroups((a) =>
                          a.map((x, j) =>
                            j === gi
                              ? {
                                  ...x,
                                  options: x.options.map((y, k) =>
                                    k === oi ? { ...y, durationMin: Number(e.target.value) } : y,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                    <button
                      className="btn btn-subtle btn-sq"
                      aria-label={t('common.delete')}
                      onClick={() =>
                        setGroups((a) =>
                          a.map((x, j) =>
                            j === gi
                              ? { ...x, options: x.options.filter((_, k) => k !== oi) }
                              : x,
                          ),
                        )
                      }
                    >
                      <Icon d={I.trash} size={16} />
                    </button>
                  </div>
                ))}
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ justifySelf: 'start' }}
                  onClick={() =>
                    setGroups((a) =>
                      a.map((x, j) =>
                        j === gi
                          ? {
                              ...x,
                              options: [...x.options, { name: '', price: 0, durationMin: 0 }],
                            }
                          : x,
                      ),
                    )
                  }
                >
                  <Icon d={I.plus} size={16} /> {t('catalog.addOption')}
                </button>
              </div>
            ))}
            <button
              className="btn btn-secondary btn-sm"
              style={{ justifySelf: 'start' }}
              onClick={() =>
                setGroups((a) => [
                  ...a,
                  {
                    name: '',
                    type: 'single',
                    required: false,
                    options: [{ name: '', price: 0, durationMin: 0 }],
                  },
                ])
              }
            >
              <Icon d={I.plus} size={16} /> {t('catalog.addGroup')}
            </button>
          </div>

          {editing && service ? (
            <div className="field">
              <span>{t('catalog.perLocation')}</span>
              <span className="hint">{t('catalog.perLocationHint')}</span>
              <table style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-control)' }}>
                <thead>
                  <tr>
                    <th>{t('catalog.location')}</th>
                    <th className="right">{t('catalog.price')}</th>
                    <th className="right">{t('catalog.duration')}</th>
                    <th className="right">{t('catalog.online')}</th>
                    <th className="right">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {locations.map((l) => (
                    <LocRow key={l.id} l={l} service={service} patchLoc={patchLoc} />
                  ))}
                </tbody>
              </table>
              <span className="hint">{t('catalog.historyNote')}</span>
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
          <button className="btn btn-primary" disabled={busy || !name} onClick={() => void save()}>
            {t('common.save')}
          </button>
        </div>
      </aside>
    </>
  );
}

function LocRow({
  l,
  service,
  patchLoc,
}: {
  l: Location;
  service: ResolvedService;
  patchLoc: (locId: string, patch: Record<string, unknown>) => Promise<void>;
}) {
  // The resolved config we hold is for the primary location; other
  // rows start from the master values and commit overrides on change.
  const [cfg, setCfg] = useState({
    price: service.config.price,
    durationMin: service.config.durationMin,
    online: service.config.online,
    active: service.config.active,
  });
  const commit = (patch: Partial<typeof cfg>) => {
    setCfg((c) => ({ ...c, ...patch }));
    void patchLoc(l.id, patch);
  };
  return (
    <tr className={cfg.active ? '' : 'dim'}>
      <td className="bold">
        {l.name}
        <span className="muted" style={{ display: 'block', fontSize: 12 }}>
          {l.city ?? ''}
        </span>
      </td>
      <td className="right">
        <input
          className="cell num bold"
          type="number"
          defaultValue={cfg.price}
          aria-label={`${l.name} price`}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (v !== cfg.price) commit({ price: v });
          }}
        />
      </td>
      <td className="right">
        <input
          className="cell num"
          type="number"
          step={5}
          defaultValue={cfg.durationMin}
          aria-label={`${l.name} duration`}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (v !== cfg.durationMin) commit({ durationMin: v });
          }}
        />
      </td>
      <td className="right">
        <span className="rowact">
          <button
            className={`toggle${cfg.online ? ' on' : ''}`}
            role="switch"
            aria-checked={cfg.online}
            aria-label={`${l.name} online`}
            onClick={() => commit({ online: !cfg.online })}
          >
            <span className="knob" />
          </button>
        </span>
      </td>
      <td className="right">
        <span className="rowact">
          <button
            className={`toggle${cfg.active ? ' on' : ''}`}
            role="switch"
            aria-checked={cfg.active}
            aria-label={`${l.name} active`}
            onClick={() => commit({ active: !cfg.active })}
          >
            <span className="knob" />
          </button>
        </span>
      </td>
    </tr>
  );
}
