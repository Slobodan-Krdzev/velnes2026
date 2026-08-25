import { useQueryClient } from '@tanstack/react-query';
import { I, Icon } from '@velnes/ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { post, api } from '@velnes/client';
import { useLocationCatalog, useLocations } from '../../api/queries.js';
import { money } from '../../lib/money.js';
import { useToast } from '../../lib/toast.js';
import { useSession } from '@velnes/client';
import { useScope } from '../../shell/Shell.js';
import { ProductPanel } from './ProductPanel.js';
import { ServicePanel } from './ServicePanel.js';
import { z } from 'zod';

const CAT_TABS: [string, string][] = [
  ['services', 'Services'],
  ['products', 'Products'],
  ['categories', 'Categories'],
  ['combos', 'Combos'],
];

const OkSchema = z.object({ ok: z.literal(true) });

export type ResolvedService = NonNullable<
  ReturnType<typeof useLocationCatalog>['data']
>['services'][number];
export type ResolvedProduct = NonNullable<
  ReturnType<typeof useLocationCatalog>['data']
>['products'][number];

const statusBadge = (o: { status?: string; config: { pos: boolean } }) =>
  o.status === 'draft' ? (
    <span className="badge warning">Draft</span>
  ) : !o.config.pos ? (
    <span className="badge">Not on till</span>
  ) : null;

export function CatalogPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const { me } = useSession();
  const { scope } = useScope();
  const locations = useLocations();
  const [tab, setTab] = useState('services');
  const [panel, setPanel] = useState<
    | { kind: 'service'; id: string | null }
    | { kind: 'product'; id: string | null }
    | null
  >(null);

  const myLocs = useMemo(() => {
    const all = locations.data?.locations ?? [];
    return me?.locationIds.length ? all.filter((l) => me.locationIds.includes(l.id)) : all;
  }, [locations.data, me]);
  const oneLoc = scope !== 'all' ? scope : myLocs.length === 1 ? (myLocs[0]?.id ?? null) : null;
  const viewLoc = oneLoc ?? myLocs[0]?.id ?? null;
  const catalog = useLocationCatalog(viewLoc);
  // The second location's catalog, for multi-location summaries.
  const catalog2 = useLocationCatalog(
    !oneLoc && myLocs.length > 1 ? (myLocs[1]?.id ?? null) : null,
  );

  const services = catalog.data?.services ?? [];
  const products = catalog.data?.products ?? [];
  const svcCats = [...new Set(services.map((s) => s.category ?? ''))].filter(Boolean);
  const prodCats = [...new Set(products.map((p) => p.category ?? ''))].filter(Boolean);

  const refresh = () => void qc.invalidateQueries({ queryKey: ['catalog'] });

  const patchOverride = async (serviceId: string, patch: Record<string, unknown>) => {
    if (!viewLoc) return;
    await api(OkSchema, `/locations/${oneLoc ?? viewLoc}/catalog/services/${serviceId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    refresh();
  };
  const putProduct = async (p: ResolvedProduct, patch: Record<string, unknown>) => {
    await api(OkSchema, `/products/${p.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: p.name,
        category: p.category,
        sku: p.sku,
        vat: p.vat,
        ...patch,
      }),
    });
    refresh();
  };
  const adjustStock = async (productId: string, to: number, current: number) => {
    const qty = to - current;
    if (!qty || !viewLoc) return;
    await post(z.object({ levels: z.array(z.unknown()) }), '/stock/movements', {
      kind: 'adjustment',
      productId,
      locationId: oneLoc ?? viewLoc,
      qty,
      note: 'Till recount',
    });
    refresh();
  };

  const cfg2 = (id: string) => catalog2.data?.services.find((s) => s.id === id)?.config;
  const svcCell = (s: ResolvedService, f: 'price' | 'durationMin') => {
    if (!oneLoc && myLocs.length > 1) {
      const vals = [...new Set([s.config[f], cfg2(s.id)?.[f] ?? s.config[f]])];
      const txt =
        f === 'price'
          ? vals.map((v) => money(v)).join(' / ')
          : `${vals.join(' / ')} min`;
      return <span className={`tnum${f === 'price' ? ' bold' : ''}`}>{txt}</span>;
    }
    return (
      <>
        <input
          className={`cell num${f === 'price' ? ' bold' : ''}`}
          type="number"
          step={f === 'price' ? 1 : 5}
          defaultValue={s.config[f]}
          aria-label={`${s.name} ${f === 'price' ? 'price' : 'duration'}`}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (v !== s.config[f])
              void patchOverride(s.id, f === 'price' ? { price: v } : { durationMin: v });
          }}
        />
        {f === 'durationMin' ? <span className="muted"> min</span> : null}
      </>
    );
  };

  const svcLocSummary = (s: ResolvedService) => {
    const on = [s.config.active, ...(cfg2(s.id) ? [cfg2(s.id)!.active] : [])].filter(Boolean)
      .length;
    const total = oneLoc ? 1 : myLocs.length;
    if (!on) return <span className="badge">{t('catalog.offEverywhere')}</span>;
    return (
      <span className="muted">
        {on === total ? t('catalog.allLocations') : `${on} of ${total} locations`}
      </span>
    );
  };

  const svcExtras = (s: ResolvedService) => {
    const vs = s.variants.filter((v) => v.active);
    const mods = s.modifiers.length;
    if (!vs.length && !mods) return null;
    const from = vs.length ? Math.min(...vs.map((v) => v.price)) : 0;
    return (
      <span
        className="muted"
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '6px 8px',
          fontSize: 12,
          fontWeight: 500,
        }}
      >
        {vs.length ? (
          <>
            <span className="badge accent">
              {vs.length} {t('catalog.durations')}
            </span>
            <span className="tnum">
              {t('catalog.from')} {money(from)}
            </span>
          </>
        ) : null}
        {mods ? (
          <span className="badge">
            {mods} {t('catalog.optionGroups')}
          </span>
        ) : null}
      </span>
    );
  };

  const toggle = (on: boolean, act: () => void, label: string) => (
    <span className="rowact">
      <button
        className={`toggle${on ? ' on' : ''}`}
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={act}
      >
        <span className="knob" />
      </button>
    </span>
  );

  const servicesPane = (
    <div className="card">
      {services.length === 0 ? (
        <div className="empty">
          <h3>{t('catalog.noServices')}</h3>
          <p>{t('catalog.noServicesSub')}</p>
        </div>
      ) : (
        <table>
          <tbody>
            {svcCats.map((cat) => {
              const list = services.filter((s) => s.category === cat);
              if (!list.length) return null;
              return [
                <tr className="catgroup-row" key={cat}>
                  <td colSpan={6}>
                    <div className="catgroup">
                      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{cat}</span>
                      <span>
                        {list.length} {t('catalog.services')}
                      </span>
                    </div>
                  </td>
                </tr>,
                ...list.map((s) => (
                  <tr key={s.id} className={s.status === 'draft' || !s.config.pos ? 'dim' : ''}>
                    <td>
                      <span className="cellmain">
                        <span className="pthumb ph">{(s.name[0] ?? '?').toUpperCase()}</span>
                        <span className="cellbody">
                          <span className="cellhead">
                            <span className="bold">{s.name}</span> {statusBadge(s)}
                          </span>
                          {svcExtras(s)}
                        </span>
                      </span>
                    </td>
                    <td>{svcCell(s, 'durationMin')}</td>
                    <td className="muted" style={{ fontSize: 13 }}>
                      {svcLocSummary(s)}
                    </td>
                    <td className="right">{svcCell(s, 'price')}</td>
                    <td className="right">
                      {toggle(
                        s.config.pos,
                        () => void patchOverride(s.id, { pos: !s.config.pos }),
                        `${s.name} on till`,
                      )}
                    </td>
                    <td className="right">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setPanel({ kind: 'service', id: s.id })}
                      >
                        {t('common.edit')}
                      </button>
                    </td>
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      )}
    </div>
  );

  const stock2 = (id: string) => catalog2.data?.products.find((p) => p.id === id)?.config.stock;
  const productsPane = (
    <div className="card">
      {products.length === 0 ? (
        <div className="empty">
          <h3>{t('catalog.noProducts')}</h3>
          <p>{t('catalog.noProductsSub')}</p>
        </div>
      ) : (
        <table>
          <tbody>
            {prodCats.map((cat) => {
              const list = products.filter((p) => p.category === cat);
              if (!list.length) return null;
              return [
                <tr className="catgroup-row" key={cat}>
                  <td colSpan={6}>
                    <div className="catgroup">
                      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{cat}</span>
                      <span>
                        {list.length} {t('catalog.products')}
                      </span>
                    </div>
                  </td>
                </tr>,
                ...list.map((p) => (
                  <tr key={p.id} className={p.config.active ? '' : 'dim'}>
                    <td>
                      <span className="cellmain">
                        <span className="pthumb ph">{(p.name[0] ?? '?').toUpperCase()}</span>
                        <span className="cellbody">
                          <span className="cellhead">
                            <span className="bold">{p.name}</span>{' '}
                            {p.config.active ? null : <span className="badge">Off</span>}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="muted">{p.sku ?? '—'}</td>
                    <td className="right">
                      {oneLoc || myLocs.length === 1 ? (
                        <>
                          {p.config.stock === 0 && !p.own ? (
                            <span className="badge danger">{t('catalog.outOfStock')} </span>
                          ) : null}
                          <input
                            className="cell num"
                            type="number"
                            defaultValue={p.config.stock}
                            aria-label={`${p.name} stock`}
                            onBlur={(e) =>
                              void adjustStock(p.id, Number(e.target.value), p.config.stock)
                            }
                          />
                        </>
                      ) : (
                        <>
                          <span className="bold tnum">
                            {p.config.stock + (stock2(p.id) ?? 0)}
                          </span>
                          <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                            {myLocs
                              .slice(0, 2)
                              .map(
                                (l, i) =>
                                  `${l.name.slice(0, 3)} ${i === 0 ? p.config.stock : (stock2(p.id) ?? 0)}`,
                              )
                              .join(' · ')}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="right">
                      {p.own ? (
                        <span className="muted" style={{ fontSize: 12 }}>
                          {t('catalog.notForSale')}
                        </span>
                      ) : (
                        <span className="bold tnum">{money(p.config.price)}</span>
                      )}
                    </td>
                    <td className="right">
                      {p.own ? (
                        <span className="muted" style={{ fontSize: 12 }}>
                          {t('catalog.inTheRoom')}
                        </span>
                      ) : (
                        toggle(
                          p.config.active,
                          () => void putProduct(p, { active: !p.config.active, price: p.config.price }),
                          `${p.name} active`,
                        )
                      )}
                    </td>
                    <td className="right">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setPanel({ kind: 'product', id: p.id })}
                      >
                        {t('common.edit')}
                      </button>
                    </td>
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      )}
    </div>
  );

  const categoriesPane = (
    <div className="card">
      <table>
        <thead>
          <tr>
            <th>{t('catalog.category')}</th>
            <th>{t('catalog.itemType')}</th>
            <th className="right">{t('catalog.items')}</th>
          </tr>
        </thead>
        <tbody>
          {[
            ...svcCats.map((c) => ({
              name: c,
              type: t('catalog.services'),
              n: services.filter((s) => s.category === c).length,
            })),
            ...prodCats.map((c) => ({
              name: c,
              type: t('catalog.products'),
              n: products.filter((p) => p.category === c).length,
            })),
          ].map((r) => (
            <tr key={r.type + r.name}>
              <td className="bold">{r.name}</td>
              <td className="muted">{r.type}</td>
              <td className="right tnum">{r.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ padding: '14px 16px', fontWeight: 500, fontSize: 12 }}>
        {t('catalog.oneLevel')}
      </p>
    </div>
  );

  const combosPane = (
    <div className="card">
      <div className="empty">
        <h3>{t('catalog.noCombos')}</h3>
        <p>{t('catalog.noCombosSub')}</p>
      </div>
    </div>
  );

  return (
    <>
      <div className="toolbar toolbar-row">
        <div className="filters">
          <div className="cat-tabs">
            {CAT_TABS.map(([k, l]) => (
              <button
                key={k}
                className={`ttab${tab === k ? ' on' : ''}`}
                onClick={() => setTab(k)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="toolbar-actions">
          <button className="btn btn-subtle" disabled title={t('catalog.importLater')}>
            <Icon d={I.filter} size={18} w={1.9} /> {t('catalog.importAI')}
          </button>
          {tab === 'services' || tab === 'products' ? (
            <button
              className="btn btn-primary btn-add"
              onClick={() =>
                setPanel({ kind: tab === 'services' ? 'service' : 'product', id: null })
              }
            >
              {t('cal.add')} <Icon d={I.plus} size={20} w={2.5} />
            </button>
          ) : null}
        </div>
      </div>

      {tab === 'services'
        ? servicesPane
        : tab === 'products'
          ? productsPane
          : tab === 'categories'
            ? categoriesPane
            : combosPane}

      {panel?.kind === 'service' && viewLoc ? (
        <ServicePanel
          service={panel.id ? (services.find((s) => s.id === panel.id) ?? null) : null}
          locations={myLocs}
          categories={svcCats}
          onSaved={() => {
            refresh();
            setPanel(null);
            toast(t('catalog.saved'));
          }}
          onClose={() => setPanel(null)}
        />
      ) : null}
      {panel?.kind === 'product' && viewLoc ? (
        <ProductPanel
          product={panel.id ? (products.find((p) => p.id === panel.id) ?? null) : null}
          locations={myLocs}
          categories={prodCats}
          onSaved={() => {
            refresh();
            setPanel(null);
            toast(t('catalog.saved'));
          }}
          onClose={() => setPanel(null)}
        />
      ) : null}
    </>
  );
}
