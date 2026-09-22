import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CapacityResponseSchema,
  DiscountCodeListSchema,
  DiscountCodeRowSchema,
  MemberRecListSchema,
  OFFER_DEFAULTS,
  OfferListSchema,
  PersonalOfferListSchema,
  PREMIUM_RULES,
  PremiumOfferListSchema,
  type CapacitySlot,
  type MemberRecSchema,
} from '@velnes/contracts';
import { I, Icon, NumInput } from '@velnes/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api, ApiError, get, patch, post, useSession } from '@velnes/client';
import { Toggle } from '../settings/bits.js';
import { useLocations } from '../../api/queries.js';
import { money } from '../../lib/money.js';
import { useToast } from '../../lib/toast.js';

/** viewMarketing: discounts, offers (last-minute + personal),
 *  Velnes Premium (rules, recommendations, staged member offers).
 *  Waiting list, loyalty config, reviews, campaigns and product
 *  testing keep their honest empty states until their engines land. */

const TABS = [
  ['discounts', 'mkt.tabDiscounts'],
  ['offers', 'mkt.tabOffers'],
  ['waiting', 'mkt.tabWaiting'],
  ['loyalty', 'mkt.tabLoyalty'],
  ['premium', 'mkt.tabPremium'],
  ['reviews', 'mkt.tabReviews'],
  ['campaigns', 'mkt.tabCampaigns'],
] as const;

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dateShort = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
};
const nowM = () => new Date().getHours() * 60 + new Date().getMinutes();
const mins = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function MarketingPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('offers');
  return (
    <>
      <div className="toolbar">
        <div className="toolbar-context">
          <span className="k">{t('nav.marketing')}</span>
        </div>
        <div className="toolbar-actions" />
      </div>
      <div className="card">
        <div style={{ padding: '16px 20px 0' }}>
          <div className="tabs">
            {TABS.map(([k, label]) => (
              <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
                {t(label)}
              </button>
            ))}
          </div>
        </div>
        {tab === 'discounts' ? <Discounts /> : null}
        {tab === 'offers' ? <Offers /> : null}
        {tab === 'premium' ? <Premium /> : null}
        {tab === 'waiting' ? <Soon body={t('mkt.waitingSoon')} /> : null}
        {tab === 'loyalty' ? <Soon body={t('mkt.loyaltySoon')} /> : null}
        {tab === 'reviews' ? <Soon body={t('mkt.reviewsSoon')} /> : null}
        {tab === 'campaigns' ? <Soon body={t('mkt.campaignsSoon')} /> : null}
      </div>
    </>
  );
}

function Soon({ body }: { body: string }) {
  const { t } = useTranslation();
  return (
    <div className="empty">
      <h3>{t('mkt.comingLater')}</h3>
      <p>{body}</p>
    </div>
  );
}

function Discounts() {
  const { t } = useTranslation();
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const act = can('marketing.personal_offers');
  const q = useQuery({
    queryKey: ['discountCodes'],
    queryFn: () => get(DiscountCodeListSchema, '/discount-codes'),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['discountCodes'] });
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [n, setN] = useState({ code: '', type: 'Percentage' as 'Percentage' | 'Fixed amount', value: 10, starts: today, ends: in30, limit: 0 });
  const tone: Record<string, string> = { Active: 'success', Scheduled: 'info', Expired: '', Off: 'warning' };
  const statusLbl: Record<string, string> = {
    Active: t('mkt.statusActive'),
    Scheduled: t('mkt.statusScheduled'),
    Expired: t('mkt.statusExpired'),
    Off: t('mkt.statusOff'),
  };
  const create = async () => {
    setErr(null);
    setBusy('new');
    try {
      await post(DiscountCodeRowSchema, '/discount-codes', {
        code: n.code,
        type: n.type,
        value: n.value,
        starts: n.starts,
        ends: n.ends,
        usageLimit: n.limit > 0 ? n.limit : null,
      });
      toast(t('mkt.codeCreated'));
      setN({ ...n, code: '', value: 10, limit: 0 });
      setOpen(false);
      refresh();
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 409 ? t('mkt.codeExists') : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const flip = async (id: string, on: boolean) => {
    setBusy(id);
    try {
      await patch(DiscountCodeRowSchema, `/discount-codes/${id}`, { active: on });
      toast(on ? t('mkt.codeOn') : t('mkt.codeOff'));
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const remove = async (id: string) => {
    setBusy(id);
    try {
      await api(z.object({ ok: z.literal(true) }), `/discount-codes/${id}`, { method: 'DELETE' });
      toast(t('mkt.codeDeleted'));
      refresh();
    } catch (e) {
      toast(e instanceof ApiError && e.status === 409 ? t('mkt.codeInUse') : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const codes = q.data?.codes ?? [];
  return (
    <div className="stacked" style={{ gap: 16 }}>
      <div className="hstack" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <p className="muted" style={{ margin: 0 }}>{t('mkt.codesLead')}</p>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 12.5 }}>{t('mkt.codeWhere')}</p>
        </div>
        {act ? (
          <button className={`btn ${open ? 'btn-secondary' : 'btn-primary'}`} onClick={() => setOpen((o) => !o)}>
            <Icon d={open ? I.x : I.plus} size={16} /> {open ? t('mkt.cancel') : t('mkt.newCode')}
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="card" style={{ padding: 16 }}>
          <div className="grid2" style={{ gap: 12, maxWidth: 720 }}>
            <label className="field">
              <span>{t('mkt.code')}</span>
              <input className="input tnum" placeholder={t('mkt.codePh')} value={n.code} onChange={(e) => setN({ ...n, code: e.target.value.toUpperCase() })} />
            </label>
            <label className="field">
              <span>{t('mkt.codeType')}</span>
              <select className="select" value={n.type} onChange={(e) => setN({ ...n, type: e.target.value as 'Percentage' | 'Fixed amount' })}>
                <option value="Percentage">{t('mkt.percent')}</option>
                <option value="Fixed amount">{t('mkt.fixed')}</option>
              </select>
            </label>
            <label className="field">
              <span>{t('mkt.value')}{n.type === 'Percentage' ? ' (%)' : ' (MKD)'}</span>
              <NumInput value={n.value} onValue={(v) => setN({ ...n, value: v })} />
            </label>
            <label className="field">
              <span>{t('mkt.usageLimit')}</span>
              <NumInput value={n.limit} onValue={(v) => setN({ ...n, limit: v })} />
              <span className="hint">0 = {t('mkt.unlimited')}</span>
            </label>
            <label className="field">
              <span>{t('mkt.from')}</span>
              <input className="input" type="date" value={n.starts} onChange={(e) => setN({ ...n, starts: e.target.value })} />
            </label>
            <label className="field">
              <span>{t('mkt.until')}</span>
              <input className="input" type="date" value={n.ends} onChange={(e) => setN({ ...n, ends: e.target.value })} />
            </label>
          </div>
          {err ? <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600, margin: '10px 0 0' }}>{err}</p> : null}
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-primary" disabled={busy === 'new' || n.code.trim().length < 3 || n.value <= 0} onClick={() => void create()}>
              {t('mkt.createCode')}
            </button>
          </div>
        </div>
      ) : null}
      {codes.length === 0 && !q.isLoading ? (
        <p className="muted">{t('mkt.noCodes')}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t('mkt.code')}</th>
              <th>{t('mkt.discount')}</th>
              <th className="right">{t('mkt.used')}</th>
              <th>{t('mkt.runs')}</th>
              <th>{t('mkt.status')}</th>
              <th className="right">{t('mkt.on')} / {t('mkt.off')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {codes.map((d) => (
              <tr key={d.id} style={{ opacity: d.active ? 1 : 0.6 }}>
                <td className="bold tnum">{d.code}</td>
                <td className="bold tnum">{d.type === 'Percentage' ? `${d.value}%` : money(d.value)}</td>
                <td className="right muted tnum">
                  {d.used} / {d.usageLimit ?? '∞'}
                </td>
                <td className="muted tnum">
                  {dateShort(d.starts)} → {dateShort(d.ends)}
                </td>
                <td>
                  <span className={`badge ${tone[d.status]}`}>{statusLbl[d.status] ?? d.status}</span>
                </td>
                <td className="right">
                  <Toggle on={d.active} label={`${d.code} ${d.active ? t('mkt.on') : t('mkt.off')}`} disabled={!act || busy === d.id} onChange={(on) => void flip(d.id, on)} />
                </td>
                <td className="right">
                  {act && d.used === 0 ? (
                    <button className="btn btn-subtle btn-sm" disabled={busy === d.id} onClick={() => void remove(d.id)}>
                      {t('mkt.deleteCode')}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Offers() {
  const { t } = useTranslation();
  const { can } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const locations = useLocations();
  const [drawer, setDrawer] = useState(false);
  const loc = (locations.data?.locations ?? []).find((l) => l.lifecycle === 'ACTIVE');
  const offers = useQuery({ queryKey: ['lmOffers'], queryFn: () => get(OfferListSchema, '/offers') });
  const personal = useQuery({
    queryKey: ['allPersonalOffers'],
    queryFn: () => get(PersonalOfferListSchema, '/personal-offers'),
  });
  const capacity = useQuery({
    queryKey: ['capacity', loc?.id, todayIso()],
    queryFn: () => get(CapacityResponseSchema, `/capacity?locationId=${loc!.id}&date=${todayIso()}`),
    enabled: !!loc,
  });
  const decide = async (id: string, action: 'cancel' | 'redeem') => {
    try {
      await post(z.object({ ok: z.literal(true) }), `/personal-offers/${id}/${action}`, {});
      void qc.invalidateQueries({ queryKey: ['allPersonalOffers'] });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'failed');
    }
  };

  const rows = offers.data?.offers ?? [];
  const caps = capacity.data?.slots ?? [];
  const phaseLiveNow = (p: { startsAt: string; endsAt: string | null }) =>
    (!p.startsAt || nowM() >= mins(p.startsAt)) && (!p.endsAt || nowM() < mins(p.endsAt));
  const tone: Record<string, string> = { live: 'success', expired: '', cancelled: 'danger', redeemed: 'accent' };

  return (
    <>
      {rows.length === 0 ? (
        <div className="empty">
          <h3>{t('mkt.noOffers')}</h3>
          <p>
            {caps.length && loc
              ? t('mkt.capacityHint', {
                  n: caps.length,
                  loc: loc.name,
                  value: money(capacity.data?.value ?? 0),
                })
              : t('mkt.noCapacity')}
          </p>
          {caps.length && can('marketing.personal_offers') ? (
            <button className="btn btn-primary" onClick={() => setDrawer(true)}>
              {t('mkt.fillSlots')} <Icon d={I.plus} size={20} w={2.5} />
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>{t('mkt.offer')}</th>
                <th>{t('mkt.slots')}</th>
                <th>{t('mkt.phaseNow')}</th>
                <th>{t('mkt.phases')}</th>
                <th className="right">{t('mkt.normalValue')}</th>
                <th>{t('mkt.status')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const slotCaps = o.slotIds.map((id) => o.slots[id]).filter(Boolean) as CapacitySlot[];
                const nu = o.phases.find(phaseLiveNow);
                return (
                  <tr key={o.id}>
                    <td className="bold">
                      {locations.data?.locations.find((l) => l.id === o.locationId)?.name ?? '—'}
                      <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                        {dateShort(o.date)}
                      </span>
                    </td>
                    <td className="tnum">{slotCaps.length}</td>
                    <td>
                      {nu ? (
                        <span className="badge accent">
                          {nu.discountType === 'fixed_promo_price'
                            ? t('mkt.price')
                            : `−${nu.discountValue}%`}
                        </span>
                      ) : (
                        <span className="muted">{t('mkt.betweenPhases')}</span>
                      )}
                    </td>
                    <td>
                      {o.phases.map((p, i) => (
                        <span key={i} className="muted" style={{ display: 'block', fontSize: 12 }}>
                          {p.startsAt || t('mkt.now')}–{p.endsAt ?? t('mkt.eachStart')} ·{' '}
                          {p.audience === 'PUBLIC' ? t('mkt.everyone') : t('mkt.audienceFixed')} ·{' '}
                          {p.discountValue}%
                        </span>
                      ))}
                    </td>
                    <td className="right bold tnum">
                      {money(slotCaps.reduce((n, c) => n + c.price, 0))}
                    </td>
                    <td>
                      <span className={`badge ${o.status === 'live' ? 'success' : ''}`}>
                        {o.status === 'live' ? t('mkt.live') : o.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="note" style={{ margin: '16px 20px' }}>
            {t('mkt.offerNote')}
          </div>
        </>
      )}

      <div style={{ padding: '20px 20px 0', borderTop: '1px solid var(--line)', marginTop: 8 }}>
        <div className="stat-label">{t('mkt.personalOffers')}</div>
      </div>
      {(personal.data?.offers ?? []).length ? (
        <table>
          <thead>
            <tr>
              <th>{t('mkt.customer')}</th>
              <th>{t('mkt.service')}</th>
              <th className="right">{t('mkt.price')}</th>
              <th>{t('mkt.valid')}</th>
              <th>{t('mkt.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {personal.data!.offers.map((p) => (
              <tr key={p.id} className={p.status === 'live' ? '' : 'dim'}>
                <td className="bold">{p.customerName ?? '—'}</td>
                <td className="muted">{p.serviceName}</td>
                <td className="right tnum">
                  <s className="muted">{money(p.normalPrice)}</s> <strong>{money(p.specialPrice)}</strong>
                </td>
                <td className="muted tnum">{dateShort(p.validUntil)}</td>
                <td>
                  <span className={`badge ${tone[p.status] ?? ''}`}>{p.status}</span>
                </td>
                <td className="right">
                  {can('marketing.personal_offers') && p.status === 'live' ? (
                    <span style={{ display: 'inline-flex', gap: 6 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => void decide(p.id, 'redeem')}>
                        {t('mkt.redeemOverride')}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => void decide(p.id, 'cancel')}>
                        {t('mkt.cancel')}
                      </button>
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted" style={{ padding: '8px 20px 20px', fontWeight: 500 }}>
          {t('mkt.noPersonal')}
        </p>
      )}

      {drawer && loc ? (
        <OfferDrawer
          locId={loc.id}
          caps={caps}
          close={() => setDrawer(false)}
          done={() => {
            setDrawer(false);
            toast(t('mkt.offerCreated'));
            void qc.invalidateQueries({ queryKey: ['lmOffers'] });
          }}
        />
      ) : null}
    </>
  );
}

function OfferDrawer({
  locId,
  caps,
  close,
  done,
}: {
  locId: string;
  caps: CapacitySlot[];
  close: () => void;
  done: () => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string[]>(caps.map((c) => c.id));
  const [vipPct, setVipPct] = useState<number>(OFFER_DEFAULTS.vipPct);
  const [publicPct, setPublicPct] = useState<number>(OFFER_DEFAULTS.publicPct);
  const [publicOn, setPublicOn] = useState(true);
  const [vipFrom] = useState(hhmm(Math.max(480, nowM())));
  const [vipUntil, setVipUntil] = useState(hhmm(Math.min(1139, nowM() + OFFER_DEFAULTS.vipUntilMin)));
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    try {
      await post(z.object({ id: z.uuid() }), '/offers', {
        locationId: locId,
        date: todayIso(),
        pickedSlotIds: picked,
        vipPct,
        vipFrom,
        vipUntil,
        publicOn,
        publicPct,
      });
      done();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'failed');
    }
  };

  return (
    <div className="panel-wrap open">
      <div className="scrim" onClick={close} />
      <aside className="panel">
        <div className="panel-head">
          <div>
            <h2>{t('mkt.capacityTitle')}</h2>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={close}>
            ✕
          </button>
        </div>
        <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p className="muted" style={{ fontWeight: 500 }}>
            {t('mkt.capacityLead')}
          </p>
          <table style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-control)' }}>
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>{t('mkt.time')}</th>
                <th>{t('mkt.bestFit')}</th>
                <th>{t('mkt.who')}</th>
                <th className="right">{t('mkt.normalPrice')}</th>
              </tr>
            </thead>
            <tbody>
              {caps.map((c) => {
                const on = picked.includes(c.id);
                return (
                  <tr key={c.id} className={on ? '' : 'dim'}>
                    <td>
                      <button
                        className={`check ${on ? 'on' : ''}`}
                        aria-label={`Include ${c.start}`}
                        onClick={() =>
                          setPicked((p) => (on ? p.filter((x) => x !== c.id) : [...p, c.id]))
                        }
                      >
                        <Icon d={I.check} size={14} w={3.5} />
                      </button>
                    </td>
                    <td className="bold tnum">{c.start}</td>
                    <td>
                      {c.serviceName}
                      <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                        {c.dur} {t('mkt.minutesShort')}
                      </span>
                    </td>
                    <td>{c.empName.split(' ')[0]}</td>
                    <td className="right bold tnum">{money(c.price)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="stat-label">{t('mkt.membersFirst')}</div>
          <div className="grid2">
            <label className="field">
              <span>{t('mkt.audience')}</span>
              <input className="input" value={t('mkt.audienceFixed')} disabled />
              <span className="hint">{t('mkt.audienceHint')}</span>
            </label>
            <label className="field">
              <span>{t('mkt.discount')}</span>
              <NumInput className="input" min={0} max={100} value={vipPct} onValue={setVipPct} />
            </label>
            <label className="field">
              <span>{t('mkt.from')}</span>
              <input className="input" type="time" value={vipFrom} disabled />
            </label>
            <label className="field">
              <span>{t('mkt.until')}</span>
              <input
                className="input"
                type="time"
                value={vipUntil}
                onChange={(e) => setVipUntil(e.target.value)}
              />
            </label>
          </div>
          <div className="note">
            {t('mkt.phase1Note', { pct: vipPct, n: picked.length, until: vipUntil })}
          </div>

          <div className="stat-label">{t('mkt.thenEveryone')}</div>
          <div className="togglerow">
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span className="l">{t('mkt.publicToggle')}</span>
              <span className="h">{t('mkt.publicToggleSub')}</span>
            </span>
            <button
              className={`toggle ${publicOn ? 'on' : ''}`}
              role="switch"
              aria-checked={publicOn}
              onClick={() => setPublicOn((v) => !v)}
            >
              <span className="knob" />
            </button>
          </div>
          {publicOn ? (
            <>
              <div className="grid2">
                <label className="field">
                  <span>{t('mkt.discount')}</span>
                  <NumInput className="input" min={0} max={100} value={publicPct} onValue={setPublicPct} />
                </label>
                <label className="field">
                  <span>{t('mkt.from')}</span>
                  <input className="input" type="time" value={vipUntil} disabled />
                </label>
              </div>
              <div className="note">{t('mkt.phase2Note', { pct: publicPct, until: vipUntil })}</div>
            </>
          ) : (
            <p className="muted" style={{ fontWeight: 500 }}>
              {t('mkt.membersOnly')}
            </p>
          )}
          {error ? (
            <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>
              {error}
            </p>
          ) : null}
        </div>
        <div className="panel-foot">
          <button className="btn btn-secondary" onClick={close}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" disabled={!picked.length} onClick={() => void create()}>
            {t('mkt.createOffer')}
          </button>
        </div>
      </aside>
    </div>
  );
}

function Premium() {
  const { t } = useTranslation();
  const { can } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const locations = useLocations();
  const loc = (locations.data?.locations ?? []).find((l) => l.lifecycle === 'ACTIVE');
  const recs = useQuery({
    queryKey: ['memberRecs', loc?.id],
    queryFn: () =>
      get(MemberRecListSchema, `/premium/recommendations${loc ? `?locationId=${loc.id}` : ''}`),
    enabled: !!loc,
  });
  const offers = useQuery({
    queryKey: ['premiumOffers'],
    queryFn: () => get(PremiumOfferListSchema, '/premium/offers'),
  });
  const act = can('marketing.personal_offers');
  const R = PREMIUM_RULES;

  const decideRec = async (id: string, action: 'approve' | 'decline') => {
    try {
      await post(z.object({ offerId: z.uuid().nullable() }), `/premium/recommendations/${id}/${action}`, {});
      toast(t(action === 'approve' ? 'mkt.approved' : 'mkt.declined'));
      void qc.invalidateQueries({ queryKey: ['memberRecs'] });
      void qc.invalidateQueries({ queryKey: ['premiumOffers'] });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'failed');
    }
  };
  const advance = async (id: string) => {
    try {
      await post(z.object({ stage: z.number() }), `/premium/offers/${id}/advance`, {});
      void qc.invalidateQueries({ queryKey: ['premiumOffers'] });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'failed');
    }
  };

  const pend = (recs.data?.recommendations ?? []).filter((r) => r.status === 'pending');
  const pmos = offers.data?.offers ?? [];
  const stageLabel = (o: (typeof pmos)[number]) =>
    o.stage === 1
      ? t('mkt.stage1', { name: o.candidates[0]?.name.split(' ')[0] ?? '—', min: R.priorityMin })
      : o.stage === 2
        ? t('mkt.stage2', { n: Math.max(0, o.candidates.length - 1), min: R.escalationMin })
        : o.stage === 3
          ? t('mkt.stage3')
          : t('mkt.windowClosed');

  const recRow = (r: z.infer<typeof MemberRecSchema>) => {
    const top = r.candidates[0]!;
    return (
      <div className="card" style={{ padding: '16px 20px' }} key={r.id}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontWeight: 700 }}>
              {r.serviceName} · {dateShort(r.date)} {r.start}–{r.end}{' '}
              <span className="muted" style={{ fontWeight: 500 }}>
                · {r.employeeName ?? t('mkt.noPreference')}
              </span>
            </div>
            <div className="muted" style={{ fontSize: 13, fontWeight: 500 }}>
              <s>{money(r.normalPrice)}</s> <strong>{money(r.recPrice)}</strong> (−{r.recPct}%,{' '}
              {t('mkt.withinCeiling', { max: R.maxDiscountPct })}) · {t('mkt.bestMatch')}:{' '}
              <strong>{top.name}</strong> ({t('mkt.score')} {top.score})
            </div>
            <details style={{ marginTop: 4 }}>
              <summary className="muted" style={{ fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                {t('mkt.why', { name: top.name.split(' ')[0] })}
              </summary>
              <div className="muted" style={{ fontSize: 12, fontWeight: 500, paddingTop: 4 }}>
                {top.why.join(' · ') || t('mkt.noSignals')}
              </div>
            </details>
            <div className="note" style={{ marginTop: 8 }}>
              {t('mkt.preview', {
                name: top.name.split(' ')[0],
                service: r.serviceName,
                date: dateShort(r.date),
                start: r.start,
                normal: money(r.normalPrice),
                special: money(r.recPrice),
                min: R.priorityMin,
              })}
            </div>
          </div>
          {act ? (
            <span style={{ display: 'inline-flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={() => void decideRec(r.id, 'approve')}>
                {t('mkt.approve')}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => void decideRec(r.id, 'decline')}>
                {t('mkt.decline')}
              </button>
            </span>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="grid4">
        <div className="stat">
          <span className="stat-label">{t('mkt.membersAtSalon')}</span>
          <span className="stat-value">—</span>
          <span className="stat-hint">{t('mkt.atThisSalon')}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t('mkt.loyaltyBonus')}</span>
          <span className="stat-value">×{R.loyaltyMult}</span>
          <span className="stat-hint">{t('mkt.onEveryPurchase')}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t('mkt.pendingRecs')}</span>
          <span className="stat-value">{pend.length}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t('mkt.rulesVersion')}</span>
          <span className="stat-value">{R.version}</span>
          <span className="stat-hint">{t('mkt.acceptedAtReg')}</span>
        </div>
      </div>

      <div className="card" style={{ padding: '16px 20px' }}>
        <div className="stat-label" style={{ marginBottom: 8 }}>
          {t('mkt.rulesTitle')}
        </div>
        <div className="kv">
          <span className="k">{t('mkt.maxDiscount')}</span>
          <span className="v tnum">{R.maxDiscountPct}%</span>
        </div>
        <div className="kv">
          <span className="k">{t('mkt.minLead')}</span>
          <span className="v tnum">
            {R.minLeadMin} {t('mkt.minBefore')}
          </span>
        </div>
        <div className="kv">
          <span className="k">{t('mkt.priorityWindow')}</span>
          <span className="v tnum">{t('mkt.priorityDetail', { p: R.priorityMin, e: R.escalationMin })}</span>
        </div>
        <div className="kv">
          <span className="k">{t('mkt.publicFallback')}</span>
          <span className="v">{R.publicFallback ? t('mkt.fallbackOn') : t('mkt.fallbackOff')}</span>
        </div>
        <div className="note">{t('mkt.rulesNote', { v: R.version })}</div>
      </div>

      <div>
        <div className="stat-label" style={{ marginBottom: 8 }}>
          {t('mkt.recommendations')}
        </div>
        {pend.length ? (
          pend.map(recRow)
        ) : (
          <p className="muted" style={{ fontWeight: 500 }}>
            {t('mkt.noRecs')}
          </p>
        )}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="card-header">
          <h2>{t('mkt.memberOffers')}</h2>
        </div>
        {pmos.length ? (
          <table>
            <thead>
              <tr>
                <th>{t('mkt.slot')}</th>
                <th className="right">{t('mkt.price')}</th>
                <th>{t('mkt.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pmos.map((o) => (
                <tr key={o.id} className={o.status === 'live' ? '' : 'dim'}>
                  <td className="bold">
                    {o.serviceName}
                    <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                      {dateShort(o.date)} {o.start}–{o.end}
                    </span>
                  </td>
                  <td className="right tnum">
                    <s className="muted">{money(o.normalPrice)}</s> <strong>{money(o.price)}</strong>
                  </td>
                  <td>
                    {o.status === 'live' ? (
                      <>
                        <span className="badge accent">{t('mkt.stage', { n: o.stage })}</span>
                        <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                          {stageLabel(o)}
                        </span>
                      </>
                    ) : (
                      <span className="badge">{o.status}</span>
                    )}
                  </td>
                  <td className="right">
                    {act && o.status === 'live' ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => void advance(o.id)}>
                        {t('mkt.advanceDemo')}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted" style={{ padding: '8px 20px 20px', fontWeight: 500 }}>
            {t('mkt.approveFirst')}
          </p>
        )}
      </div>

      <div className="note">{t('mkt.testingSoon')}</div>
    </div>
  );
}
