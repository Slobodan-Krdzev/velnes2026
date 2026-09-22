import type { Location } from '@velnes/contracts';
import { I, Icon, NumInput } from '@velnes/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api, post } from '@velnes/client';
import { useEmployees } from '../../api/queries.js';
import { InfoTip } from '../../lib/InfoTip.js';
import { CategoryRequestModal, type ResolvedService } from './Catalog.js';

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
  // Who performs this service — read from the same skills truth the
  // booking gate enforces: no skill rows means "does everything".
  const employees = useEmployees();
  const staff = (employees.data?.employees ?? []).filter((e) => e.status === 'active');
  const performsNow = (e: (typeof staff)[number]) =>
    !service || e.skillServiceIds.length === 0 || e.skillServiceIds.includes(service.id);
  const [everyWorker, setEveryWorker] = useState<boolean | null>(null);
  const [performers, setPerformers] = useState<string[] | null>(null);
  // Resolved once the employees arrive: edit starts from the truth,
  // a new service starts on "every worker".
  const allDo = staff.length > 0 && staff.every(performsNow);
  const everyOn = everyWorker ?? (!editing || allDo);
  const picked = performers ?? staff.filter(performsNow).map((e) => e.id);
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
  const [requestingCat, setRequestingCat] = useState(false);
  const [reqSent, setReqSent] = useState(false);

  useEffect(() => {
    document.body.classList.add('panel-open');
    return () => document.body.classList.remove('panel-open');
  }, []);

  const save = async () => {
    if (groups.some((g) => !g.name.trim())) {
      setError(t('catalog.groupNameMissing'));
      return;
    }
    if (groups.some((g) => g.options.some((o) => !o.name.trim()))) {
      setError(t('catalog.optionNameMissing'));
      return;
    }
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
        performerIds: everyOn ? null : picked,
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
              <span>
                {t('catalog.category')}
                <span className="req">*</span>
              </span>
              {/* The Velnes taxonomy: a salon picks the shelf, it
                  never invents one. */}
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
              <span className="hint">
                {t('catalog.velnesCategoryHint')}{' '}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ padding: '0 4px', height: 'auto' }}
                  onClick={() => setRequestingCat(true)}
                >
                  {reqSent ? t('catalog.requestSentShort') : t('catalog.requestCategory')}
                </button>
              </span>
            </label>
            <label className="field">
              <span>{t('catalog.price')}</span>
              <NumInput value={price} onValue={setPrice} />
            </label>
            <label className="field">
              <span>{t('catalog.duration')}</span>
              <NumInput step={5} value={duration} onValue={setDuration} />
            </label>
            <label className="field">
              <span>{t('catalog.prep')}</span>
              <input
                className="input tnum"
                type="number"
                value={prepMin ?? ''}
                placeholder="0"
                onFocus={(e) => e.currentTarget.select()}
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
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) =>
                  setResetMin(e.target.value === '' ? null : Number(e.target.value))
                }
              />
            </label>
            <label className="field">
              <span>VAT %</span>
              <NumInput value={vat} onValue={setVat} />
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
            <span>{t('catalog.performers')}</span>
            <span className="hint">{t('catalog.performersHint')}</span>
            <button
              className="checkrow"
              type="button"
              onClick={() => {
                setEveryWorker(!everyOn);
                if (everyOn && performers === null)
                  setPerformers(staff.filter(performsNow).map((e) => e.id));
              }}
            >
              <span className={`check${everyOn ? ' on' : ''}`}>
                <Icon d={I.check} size={14} w={3.5} />
              </span>
              <span style={{ fontWeight: 600 }}>{t('catalog.everyWorker')}</span>
            </button>
            {everyOn
              ? null
              : staff.map((e) => {
                  const on = picked.includes(e.id);
                  return (
                    <button
                      key={e.id}
                      className="checkrow"
                      type="button"
                      style={{ marginLeft: 24 }}
                      onClick={() =>
                        setPerformers(on ? picked.filter((x) => x !== e.id) : [...picked, e.id])
                      }
                    >
                      <span className={`check${on ? ' on' : ''}`}>
                        <Icon d={I.check} size={14} w={3.5} />
                      </span>
                      <span style={{ fontWeight: 500 }}>
                        {e.name} <span className="muted">· {e.roleTitle}</span>
                      </span>
                    </button>
                  );
                })}
          </div>

          <div className="field">
            <span className="field-title">
              {t('catalog.variants')}
              <InfoTip title={t('catalog.variants')} label={t('catalog.infoLbl')} body={[t('catalog.variantsInfo1'), t('catalog.variantsInfo2')]} />
            </span>
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
                <NumInput
                  style={{ width: 80 }}
                  step={5}
                  value={v.durationMin}
                  aria-label="minutes"
                  onValue={(n) =>
                    setVariants((a) => a.map((x, j) => (j === i ? { ...x, durationMin: n } : x)))
                  }
                />
                <NumInput
                  style={{ width: 100 }}
                  value={v.price}
                  aria-label="price"
                  onValue={(n) =>
                    setVariants((a) => a.map((x, j) => (j === i ? { ...x, price: n } : x)))
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
            <span className="field-title">
              {t('catalog.modifiers')}
              <InfoTip title={t('catalog.modifiers')} label={t('catalog.infoLbl')} body={[t('catalog.modifiersInfo1'), t('catalog.modifiersInfo2')]} />
            </span>
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
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <label className="field" style={{ flex: 1, margin: 0 }}>
                    <span>{t('catalog.groupName')}<span className="req">*</span></span>
                    <input
                      className="input"
                      value={g.name}
                      placeholder={t('catalog.groupNamePh')}
                      onChange={(e) =>
                        setGroups((a) => a.map((x, j) => (j === gi ? { ...x, name: e.target.value } : x)))
                      }
                    />
                  </label>
                  <button
                    className="btn btn-subtle btn-sq"
                    aria-label={t('common.delete')}
                    title={t('common.delete')}
                    onClick={() => setGroups((a) => a.filter((_, j) => j !== gi))}
                  >
                    <Icon d={I.trash} size={16} />
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <label className="field" style={{ margin: 0, minWidth: 180 }}>
                    <span>{t('catalog.groupType')}</span>
                    <select
                      className="select"
                      value={g.type}
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
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, paddingBottom: 10 }}>
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
                </div>
                <div className="hint" style={{ margin: 0 }}>{t('catalog.optionHint')}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) 110px 100px 36px', gap: 8, fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                  <span>{t('catalog.optionCol')}</span>
                  <span>{t('catalog.optPrice')}</span>
                  <span>{t('catalog.optMin')}</span>
                  <span />
                </div>
                {g.options.map((o, oi) => (
                  <div key={oi} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) 110px 100px 36px', gap: 8, alignItems: 'center' }}>
                    <input
                      className="input"
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
                    <NumInput
                      style={{ width: '100%' }}
                      value={o.price}
                      aria-label={t('catalog.optPrice')}
                      onValue={(n) =>
                        setGroups((a) =>
                          a.map((x, j) =>
                            j === gi
                              ? { ...x, options: x.options.map((y, k) => (k === oi ? { ...y, price: n } : y)) }
                              : x,
                          ),
                        )
                      }
                    />
                    <NumInput
                      style={{ width: '100%' }}
                      value={o.durationMin}
                      aria-label={t('catalog.optMin')}
                      onValue={(n) =>
                        setGroups((a) =>
                          a.map((x, j) =>
                            j === gi
                              ? { ...x, options: x.options.map((y, k) => (k === oi ? { ...y, durationMin: n } : y)) }
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
      {requestingCat ? (
        <CategoryRequestModal
          initialType="services"
          onClose={() => setRequestingCat(false)}
          onSent={() => {
            setRequestingCat(false);
            setReqSent(true);
          }}
        />
      ) : null}
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
