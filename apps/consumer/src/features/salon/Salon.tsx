import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { t } from '../../lib/i18n-core.js';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { z } from 'zod';
import type { PublicServiceSchema } from '@velnes/contracts';
import { DHeader } from '../../app/chrome.js';
import { fmtMKD, minutesLbl } from '../../lib/api/mappers.js';
import { useSalonDetail, useSalonServices, useVisitSlots } from '../../lib/api/queries.js';
import { useMyOffers } from '../../lib/api/session.js';
import { SalonGallery } from '../../components/SalonGallery.js';
import { FavHeart } from '../discovery/cards.js';
import { useWheelScroll } from '../../lib/useWheelScroll.js';
import { SalonMap } from '../../components/SalonMap.js';
import { IcArr, IcClock, IcPin, IcSpark, IcVok } from '../discovery/cards.js';
import { useBooking } from '../booking/store.js';
import { distanceKm, distanceLbl, useUserLocation } from '../../lib/geo.js';

type PublicService = z.infer<typeof PublicServiceSchema>;

/* Prototype icons, exact markup. */
const IcScissors = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="7" cy="18" r="2.6" /><circle cx="17" cy="18" r="2.6" /><path d="M8.8 16.2 17 4M15.2 16.2 7 4" /></svg>
);
const IcBottle = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3h4M11 3v3.2c0 .9-2.5 1.7-2.5 3.4V19a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2v-9.4c0-1.7-2.5-2.5-2.5-3.4V3" /></svg>
);
const IcCal = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3.5v3M16 3.5v3" /></svg>
);
const IcPerson = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7.2 7.2 0 0 1 14 0" /></svg>
);
const IcChevR = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg>
);
const IcChevD = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9.5l6 6 6-6" /></svg>
);
const IcBolt = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 3 5 13.5h5L11 21l8-10.5h-5z" /></svg>
);
const LocMapSvg = (
  <svg viewBox="0 0 320 110" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="320" height="110" fill="#F0F3E9" />
    <path d="M0 36 C80 24 180 48 320 32" fill="none" stroke="#D6E5EC" strokeWidth="14" strokeLinecap="round" />
    <g stroke="#fff" fill="none" strokeLinecap="round">
      <path d="M32 0 L56 110" strokeWidth="5" />
      <path d="M0 78 L320 64" strokeWidth="5" />
      <path d="M152 0 L172 110" strokeWidth="3" />
      <path d="M242 0 L228 110" strokeWidth="3" />
    </g>
    <g transform="translate(160 50)">
      <path d="M0 19 C-10 6 -13 -2 -13 -6 A13 13 0 1 1 13 -6 C13 -2 10 6 0 19z" fill="#E3673D" />
      <circle cx="0" cy="-5" r="4.6" fill="#FFF9F7" />
    </g>
  </svg>
);

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

const IcStepDone = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-label={t('c.sal.done')}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);

/** The platform's last slot start (`DAY_END` 19:00 minus one 30-min
 *  step). Past it, today has nothing left to offer for anything. */
const LAST_SLOT_MIN = 18 * 60 + 30;
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const DAY_NAMES = () => t('c.date.days').split(',');
const MONTHS = () => t('c.date.months').split(',');

function dayChips(offset: number) {
  const out: { iso: string; lbl: string; small: string }[] = [];
  for (let i = offset; i < offset + 4; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const lbl = i === 0 ? t('c.date.today') : i === 1 ? t('c.date.tomorrow') : DAY_NAMES()[d.getDay()]!;
    const small = `${i < 2 ? `${DAY_NAMES()[d.getDay()]} ` : ''}${d.getDate()} ${MONTHS()[d.getMonth()]}`;
    out.push({ iso, lbl, small });
  }
  return out;
}

/** A treatment card is a toggle: tap to add it to the visit, tap again
 *  to drop it. When it is in the visit and an option is chosen, the
 *  card shows that option's own duration and price. */
function TrCard({
  s,
  on,
  desktop,
  chosen,
  onToggle,
  offer = null,
}: {
  s: PublicService;
  on: boolean;
  desktop: boolean;
  chosen: { durationMin: number; price: number; label: string | null } | null;
  onToggle: () => void;
  /** The salon's promise to this person for this treatment, if any. */
  offer?: number | null;
}) {
  const priceLbl =
    on && chosen
      ? fmtMKD(chosen.price)
      : offer != null
        ? fmtMKD(offer)
        : s.variants.length
          ? t('c.from', { p: fmtMKD(Math.min(s.price, s.priceFrom ?? s.price)) })
          : fmtMKD(s.price);
  return (
    <button className={`tr-card${desktop ? ' dtr' : ''}${on ? ' on' : ''}`} onClick={onToggle}>
      <span className="row1">
        <span className="nm">
          {IcScissors}
          <span className="t">{s.name}</span>
        </span>
        {/* A departure from the prototype, and a necessary one: the
            prototype's Favourites section lists saved services but gives
            nowhere to save one. See docs/FAVOURITES.md. */}
        <FavHeart kind="service" id={s.id} label={s.name} className="fav fav-inline" />
      </span>
      <span className="in2">
        <span>
          {minutesLbl(on && chosen ? chosen.durationMin : s.durationMin)}
          {on && chosen?.label ? ` · ${chosen.label}` : ''}
        </span>
        <b>
          {offer != null ? <span className="tiny-tag" style={{ marginRight: '6px' }}>{t('c.acc.yourPrice')}</span> : null}
          {priceLbl}
        </b>
      </span>
    </button>
  );
}

/** Shared booking state + real data for both environments. */
function useSalonPage() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const detailQ = useSalonDetail(slug);
  const detail = detailQ.data;
  const [locIdx, setLocIdx] = useState(0);
  // An offer link names its location: open there, before anything is
  // priced, so the promise and the page agree from the first paint.
  useEffect(() => {
    const ql = params.get('location');
    if (!ql || !detail) return;
    const i = detail.locations.findIndex((l) => l.id === ql);
    if (i >= 0) setLocIdx(i);
    // On arrival only.
  }, [detail]);
  const location = detail?.locations[locIdx] ?? detail?.locations[0];
  const locationId = location?.id;
  /**
   * The salon's promises to this person, at this location. A line the
   * client holds an offer for is priced at the promise — the booking
   * door prices by customer and will charge exactly that, and a page
   * quoting the public price over a private one would be lying twice.
   * An offer without a variant covers every variant, as the door reads
   * it (`livePersonalOffer`).
   */
  const myOffers = useMyOffers();
  const offerFor = useCallback(
    (serviceId: string, variantId: string | null) =>
      (myOffers.data?.offers ?? []).find(
        (o) =>
          o.locationId === locationId &&
          o.serviceId === serviceId &&
          (!o.variantId || o.variantId === variantId),
      ) ?? null,
    [myOffers.data, locationId],
  );
  const key = detail?.publishableKey;
  const servicesQ = useSalonServices(key, locationId);
  const services = useMemo(() => servicesQ.data?.services ?? [], [servicesQ.data]);
  // The visible four-day window; the calendar chip walks it forward.
  const [dayOffset, setDayOffset] = useState(0);
  /**
   * Today drops out of the row once it has nothing left (Alex,
   * 2026-09-21). Two ways to know: the clock is past the platform's
   * last slot, so nothing could be offered for any visit; or the door
   * has already answered "nothing today" for this visit — its answer
   * is in the salon's own clock and knows the visit's length, which
   * the device clock does not.
   */
  const [clockGone] = useState(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes() >= LAST_SLOT_MIN;
  });
  const [doorGone, setDoorGone] = useState(false);
  const todayGone = clockGone || doorGone;
  const days = useMemo(() => dayChips(dayOffset + (todayGone ? 1 : 0)), [dayOffset, todayGone]);
  // The visit: several treatments in the order they were picked. The
  // prototype's desktop cart is multi-select, and a salon visit really
  // is "haircut then colour" — so the cart is the state, not one id.
  const [cart, setCart] = useState<{ serviceId: string; variantId: string | null; mods: string[] }[]>([]);
  const [empId, setEmpId] = useState('any');
  const [locOpen, setLocOpen] = useState(false);
  const [openVariantFor, setOpenVariantFor] = useState<string | null>(null);
  const [date, setDate] = useState(days[0]!.iso);
  const [time, setTime] = useState('');
  const [allOpen, setAllOpen] = useState(false);
  const [proOpen, setProOpen] = useState(false);
  const [prodOpen, setProdOpen] = useState(false);
  const [cartMin, setCartMin] = useState(false);
  // A slot tapped on the home screen arrives as a link: start the visit
  // with that treatment already in the cart.
  useEffect(() => {
    const qsSvc = params.get('service');
    if (!services.length || cart.length || !qsSvc) return;
    const match = services.find((s) => s.id === qsSvc);
    if (!match) return;
    setCart([{ serviceId: match.id, variantId: null, mods: [] }]);
    const qd = params.get('date');
    const qt = params.get('time');
    if (qd && days.some((d) => d.iso === qd)) setDate(qd);
    if (qt) setTime(qt);
  }, [services, cart.length, params, days]);
  // The day window moved: land on its first day rather than a date that
  // is no longer on screen.
  useEffect(() => {
    if (!days.some((d) => d.iso === date)) setDate(days[0]!.iso);
  }, [days, date]);
  // Every line of the visit, resolved against the catalog.
  const lines = useMemo(
    () =>
      cart
        .map((c) => {
          const svc = services.find((x) => x.id === c.serviceId);
          if (!svc) return null;
          const variant = svc.variants.find((v) => v.id === c.variantId) ?? null;
          const offer = offerFor(svc.id, variant?.id ?? null);
          // The chosen options add to (or take off) the line's price and
          // time — the same sums the door makes, so the summary never
          // promises a number the invoice will not carry.
          const opts = svc.modifiers.flatMap((g) => g.options).filter((o) => c.mods.includes(o.id));
          const modPrice = opts.reduce((n, o) => n + o.price, 0);
          const modMin = opts.reduce((n, o) => n + o.durationMin, 0);
          const missing = svc.modifiers.filter((g) => g.required && !g.options.some((o) => c.mods.includes(o.id)));
          const base = variant ? `${svc.name} · ${variant.label}` : svc.name;
          return {
            ...c,
            svc,
            variant,
            offer,
            opts,
            missing,
            name: opts.length ? `${base} · ${opts.map((o) => o.name).join(', ')}` : base,
            price: Math.max(0, (offer ? offer.specialPrice : (variant?.price ?? svc.price)) + modPrice),
            durationMin: Math.max(5, (variant?.durationMin ?? svc.durationMin) + modMin),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    [cart, services, offerFor],
  );
  const availQ = useVisitSlots({
    key,
    locationId,
    date,
    employeeId: empId,
    items: lines.map((l) => ({ serviceId: l.serviceId, variantId: l.variantId, modifierOptionIds: l.mods })),
  });
  // Required groups nobody has answered yet: the visit cannot be booked
  // until they are, and the button says which one.
  const missing = lines.flatMap((l) => l.missing.map((g) => ({ service: l.svc.name, group: g.name })));
  const free = useMemo(() => (availQ.data?.slots ?? []).filter((s) => s.free).map((s) => s.t), [availQ.data]);
  // The time is the person's to pick — nothing is chosen for them, so
  // "Date & time" is ticked only once they have tapped one (Alex,
  // 2026-09-21). A pick that stopped being free — another day, a hold
  // elsewhere — is dropped, so a stale time can never reach the door.
  // Only once the door has answered: an empty list while it loads is
  // not "your time is gone".
  const answered = availQ.data !== undefined;
  useEffect(() => {
    if (answered && time && !free.includes(time)) setTime('');
  }, [answered, free, time]);
  // An empty answer for today — not "all busy", *nothing offered* — is
  // the door saying the day is over for this visit.
  useEffect(() => {
    if (date === todayIso() && lines.length && availQ.data && availQ.data.slots.length === 0)
      setDoorGone(true);
  }, [date, lines.length, availQ.data]);
  // What the door will actually charge for the visit: every line at the
  // price its own option carries. Never a "from" price.
  const price = lines.reduce((n, l) => n + l.price, 0);
  const durationMin = lines.reduce((n, l) => n + l.durationMin, 0);
  const dayLbl = days.find((d) => d.iso === date)?.lbl ?? date;
  /**
   * Who can actually take this visit.
   *
   * One professional is assigned to the whole appointment, so the list
   * is the intersection across every treatment in the cart, not the
   * first one's staff — somebody who does the facial but not the
   * manicure cannot be booked for a visit containing both, and offering
   * them is offering a booking that cannot happen.
   *
   * With a single treatment chosen this is simply that treatment's
   * staff, which is what it always was.
   */
  const team = lines.length
    ? lines
        .slice(1)
        .reduce(
          (who, l) => who.filter((e) => l.svc.employees.some((x) => x.id === e.id)),
          lines[0]!.svc.employees,
        )
    : [];
  const teamKey = team.map((e) => e.id).join(',');
  // Adding a treatment the chosen professional does not do un-chooses
  // them, rather than leaving a name selected that cannot take the
  // booking.
  useEffect(() => {
    if (empId !== 'any' && !team.some((e) => e.id === empId)) setEmpId('any');
  }, [teamKey, empId]);
  const empName = team.find((e) => e.id === empId)?.name ?? t('c.sal.anyProAvail');
  return {
    slug: slug ?? '',
    detail,
    loaded: Boolean(detailQ.data),
    services,
    days,
    dayOffset,
    nextDays: () => setDayOffset(dayOffset + 4),
    prevDays: () => setDayOffset(Math.max(0, dayOffset - 4)),
    lines,
    cart,
    inCart: (id: string) => cart.some((c) => c.serviceId === id),
    /** The promised price for a treatment here, if this person holds one. */
    offerPrice: (id: string) => offerFor(id, null)?.specialPrice ?? null,
    toggle: (id: string) => {
      setCart((c) =>
        c.some((x) => x.serviceId === id)
          ? c.filter((x) => x.serviceId !== id)
          : [...c, { serviceId: id, variantId: null, mods: [] }],
      );
      setEmpId('any');
      setOpenVariantFor(id);
    },
    remove: (id: string) => setCart((c) => c.filter((x) => x.serviceId !== id)),
    setVariant: (serviceId: string, variantId: string | null) =>
      setCart((c) => c.map((x) => (x.serviceId === serviceId ? { ...x, variantId } : x))),
    /** Toggle one option: a "one choice" group swaps, a stackable one adds. */
    toggleMod: (serviceId: string, group: { type: 'single' | 'multi'; options: { id: string }[] }, optionId: string) =>
      setCart((c) =>
        c.map((x) => {
          if (x.serviceId !== serviceId) return x;
          const on = x.mods.includes(optionId);
          const others = x.mods.filter((m) => !group.options.some((o) => o.id === m));
          const mods =
            group.type === 'single'
              ? on
                ? others
                : [...others, optionId]
              : on
                ? x.mods.filter((m) => m !== optionId)
                : [...x.mods, optionId];
          return { ...x, mods };
        }),
      ),
    missing,
    openVariantFor,
    setOpenVariantFor,
    empId,
    setEmpId,
    empName,
    team,
    price,
    durationMin,
    location,
    locIdx,
    pickLoc: (i: number) => {
      setLocIdx(i);
      // A different location is a different catalog and a different team.
      setCart([]);
      setEmpId('any');
      setLocOpen(false);
    },
    locOpen,
    setLocOpen,
    date,
    setDate,
    dayLbl,
    time,
    setTime,
    free,
    /** The door's own account of a blank day, when it has one. */
    slotsReason: availQ.data?.reason ?? null,
    slotsAnswered: availQ.data !== undefined,
    allOpen,
    setAllOpen,
    proOpen,
    setProOpen,
    prodOpen,
    setProdOpen,
    cartMin,
    setCartMin,
  };
}

type Page = ReturnType<typeof useSalonPage>;

/** What this treatment costs and takes *as chosen* in the visit. */
function chosenOf(p: Page, serviceId: string) {
  const l = p.lines.find((x) => x.serviceId === serviceId);
  return l ? { durationMin: l.durationMin, price: l.price, label: l.variant?.label ?? null } : null;
}

/** The book card core — identical structure in both environments (the
 *  prototype's desktop variant adds .dtr to cards). */
function BookCard({ p, desktop }: { p: Page; desktop: boolean }) {
  // The day row slides under the wheel too, not only by dragging it.
  // Declared before the early return: hooks cannot sit behind one.
  const dayRef = useRef<HTMLDivElement | null>(null);
  useWheelScroll(dayRef);
  const d = p.detail;
  if (!d) return null;
  const head = p.services.slice(0, 4);
  const rest = p.services.slice(4);
  return (
    <div className="card bookcard" style={desktop ? undefined : { margin: '14px 16px 0' }} id={desktop ? undefined : 'm-book'}>
      {/* Each step ticks as it is actually completed: a treatment in the
          visit, then a time tapped. The prototype's "done" state only
          darkened the number; Alex asked for a check mark in its place. */}
      <div className="stepper">
        <span className={`step ${p.lines.length ? 'done' : 'on'}`} data-step="1">
          <span className="n">{p.lines.length ? IcStepDone : 1}</span>{t('c.sal.stepTreatment')}
        </span>
        <span className={`step ${p.lines.length && p.time ? 'done' : p.lines.length ? 'on' : ''}`} data-step="2">
          <span className="n">{p.lines.length && p.time ? IcStepDone : 2}</span>{t('c.sal.stepDate')}
        </span>
        <span className={`step ${p.lines.length && p.time ? 'on' : ''}`} data-step="3">
          <span className="n">3</span>{t('c.sal.stepConfirm')}
        </span>
      </div>
      {d.locations.length > 1 ? (
        <>
          <div className="pro-row" style={{ marginTop: '4px' }}>
            <span className="av">{IcPin}</span>
            <span className="who2">
              <small>{t('c.sal.location')}</small>
              <b>{p.location?.name}</b>
            </span>
            <button className="chg" type="button" onClick={() => p.setLocOpen(!p.locOpen)}>{t('c.sal.choose')}</button>
          </div>
          {p.locOpen ? (
            <div className="pro-grid">
              {d.locations.map((l, i) => (
                <button key={l.id} className={`pro-card${p.locIdx === i ? ' on' : ''}`} onClick={() => p.pickLoc(i)}>
                  <span className="pav any">{IcPin}</span>
                  <span>
                    <b>{l.name}</b>
                    <span className="sm muted">{[l.address, l.city].filter(Boolean).join(', ')}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
      <div className="bk-h" style={desktop ? undefined : { marginTop: '4px' }}>{t('c.sal.step1')}</div>
      <div className="bk-sub spark">
        {IcSpark}
        <span className="muted">{t('c.sal.mostBooked')}</span>
      </div>
      <div className="tr-grid">
        {head.map((s) => (
          <TrCard
            key={s.id}
            s={s}
            desktop={desktop}
            on={p.inCart(s.id)}
            chosen={chosenOf(p, s.id)} offer={p.offerPrice(s.id)}
            onToggle={() => p.toggle(s.id)}
          />
        ))}
      </div>
      {rest.length ? (
        <>
          {p.allOpen ? (
            <div className="tr-grid" style={{ marginTop: '10px' }}>
              {rest.map((s) => (
                <TrCard
                  key={s.id}
                  s={s}
                  desktop={desktop}
                  on={p.inCart(s.id)}
                  chosen={chosenOf(p, s.id)} offer={p.offerPrice(s.id)}
                  onToggle={() => p.toggle(s.id)}
                />
              ))}
            </div>
          ) : null}
          <button className="btn btn-g viewall" onClick={() => p.setAllOpen(!p.allOpen)}>
            {p.allOpen ? t('c.sal.showFewer') : t('c.sal.viewAllN', { n: p.services.length })} {IcArr}
          </button>
        </>
      ) : null}
      {p.lines
        .filter((l) => l.svc.variants.length)
        .map((l) => (
          <div key={l.serviceId}>
            <div className="bk-sub" style={{ marginTop: '14px' }}>
              <span className="muted">{t('c.sal.optionsFor', { name: l.svc.name })}</span>
            </div>
            <div className="pro-grid">
              <button
                className={`pro-card${l.variantId === null ? ' on' : ''}`}
                onClick={() => p.setVariant(l.serviceId, null)}
              >
                <span className="pav any">{IcClock}</span>
                <span>
                  <b>{t('c.sal.standard')}</b>
                  <span className="sm muted">
                    {minutesLbl(l.svc.durationMin)} · {fmtMKD(l.svc.price)}
                  </span>
                </span>
              </button>
              {l.svc.variants.map((v) => (
                <button
                  key={v.id}
                  className={`pro-card${l.variantId === v.id ? ' on' : ''}`}
                  onClick={() => p.setVariant(l.serviceId, v.id)}
                >
                  <span className="pav any">{IcClock}</span>
                  <span>
                    <b>{v.label}</b>
                    <span className="sm muted">
                      {minutesLbl(v.durationMin)} · {fmtMKD(v.price)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      {p.lines
        .filter((l) => l.svc.modifiers.length)
        .map((l) => (
          <div key={`m-${l.serviceId}`}>
            {l.svc.modifiers.map((g) => {
              const unmet = g.required && !g.options.some((o) => l.mods.includes(o.id));
              return (
                <div key={g.id}>
                  <div className="bk-sub" style={{ marginTop: '14px' }}>
                    <span className="muted">
                      {g.name} · {l.svc.name}
                      <small className={unmet ? 'mod-req unmet' : 'mod-req'}>
                        {' '}
                        {g.required ? t('c.sal.groupRequired') : g.type === 'single' ? t('c.sal.groupOne') : t('c.sal.groupMany')}
                      </small>
                    </span>
                  </div>
                  <div className="pro-grid">
                    {g.options.map((o) => {
                      const on = l.mods.includes(o.id);
                      const bits = [
                        o.price ? `${o.price > 0 ? '+' : '−'}${fmtMKD(Math.abs(o.price))}` : '',
                        o.durationMin ? `${o.durationMin > 0 ? '+' : '−'}${Math.abs(o.durationMin)} min` : '',
                      ].filter(Boolean);
                      return (
                        <button
                          key={o.id}
                          className={`pro-card${on ? ' on' : ''}`}
                          aria-pressed={on}
                          onClick={() => p.toggleMod(l.serviceId, g, o.id)}
                        >
                          <span className="pav any">{on ? IcStepDone : IcClock}</span>
                          <span>
                            <b>{o.name}</b>
                            <span className="sm muted">{bits.length ? bits.join(' · ') : t('c.sal.noChange')}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      <div className="pro-row">
        <span className="av">{IcPerson}</span>
        <span className="who2">
          <small>{t('c.sal.professional')}</small>
          <b data-sum="pro">{p.empName}</b>
        </span>
        <button className="chg" type="button" onClick={() => p.setProOpen(!p.proOpen)}>{t('c.sal.choose')}</button>
      </div>
      {p.proOpen ? (
        <div className="pro-grid">
          <button className={`pro-card${p.empId === 'any' ? ' on' : ''}`} onClick={() => p.setEmpId('any')}>
            <span className="pav any">{IcPerson}</span>
            <span>
              <b>{t('c.sal.anyPro')}</b>
              <span className="sm muted">{t('c.sal.firstAvail')}</span>
            </span>
          </button>
          {p.team.map((e) => (
            <span key={e.id} className="pro-wrap">
              <button className={`pro-card${p.empId === e.id ? ' on' : ''}`} onClick={() => p.setEmpId(e.id)}>
                <span className="pav">{initials(e.name)}</span>
                <span>
                  <b>{e.name}</b>
                  <span className="sm muted">{d.team.find((t) => t.id === e.id)?.role ?? ''}</span>
                </span>
              </button>
              {/* Beside the card, not inside it: a button within a
                  button is not valid markup, and the prototype never
                  had to solve this because it had no way to save a pro
                  at all. See docs/FAVOURITES.md. */}
              <FavHeart kind="pro" id={e.id} label={e.name} className="fav fav-pro" />
            </span>
          ))}
        </div>
      ) : null}
      {d.products.length ? (
        <>
          <div
            className="bk-h prod-tg"
            style={{ marginTop: '26px' }}
            role="button"
            tabIndex={0}
            aria-expanded={p.prodOpen}
            onClick={() => p.setProdOpen(!p.prodOpen)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                p.setProdOpen(!p.prodOpen);
              }
            }}
          >
            {d.name} products
            <span className="tiny-tag" style={{ marginLeft: '9px' }}>{t('c.sal.productsN', { n: d.products.length })}</span>
            <span className="chv">{IcChevD}</span>
          </div>
          {p.prodOpen ? (
            <div>
              <div className="bk-sub">
                <span className="muted">{t('c.sal.products')}</span>
              </div>
              <div className="tr-grid">
                {d.products.map((pr) => (
                  <button key={pr.id} className={`tr-card${desktop ? ' dtr' : ''}`} style={{ cursor: 'default' }}>
                    <span className="row1">
                      <span className="nm">
                        {IcBottle}
                        <span className="t">{pr.name}</span>
                      </span>
                    </span>
                    <span className="in2">
                      <span>{t('c.sal.product')}</span>
                      <b>{fmtMKD(pr.price)}</b>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      {/* Nothing to schedule yet: the section is there, and inert, until
          a treatment is in the visit — a day and time for no treatment
          is not a step anyone can complete. Alex, 2026-09-21. */}
      <div className="bk-h" style={{ marginTop: '20px' }}>
        {t('c.sal.step2')}
        {!p.lines.length ? <span className="sm muted bk-hint">{t('c.sal.chooseFirst')}</span> : null}
      </div>
      <div className={p.lines.length ? undefined : 'bk-off'} aria-disabled={!p.lines.length}>
      <div className="dayrow" ref={dayRef}>
        {p.dayOffset > 0 ? (
          <button className="daychip daychip--cal" onClick={p.prevDays} aria-label={t('c.sal.earlier')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 6 8.5 12l6 6" /></svg>
          </button>
        ) : null}
        {p.days.map((day) => (
          <button key={day.iso} className={`daychip${p.date === day.iso ? ' on' : ''}`} onClick={() => p.setDate(day.iso)}>
            {day.lbl}
            <small>{day.small}</small>
          </button>
        ))}
        <button className="daychip daychip--cal" onClick={p.nextDays} aria-label={t('c.sal.later')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 6l6 6-6 6" /></svg>
        </button>
      </div>
      <div className="timegrid">
        {p.free.map((t) => (
          <button key={t} className={`slot${p.time === t ? ' on' : ''}`} onClick={() => p.setTime(t)}>
            {t}
          </button>
        ))}
        {!p.free.length && p.lines.length ? (
          p.slotsReason === 'NOBODY_AT_PACE' ? (
            /* Not a full day — a day nobody fits. The prototype only had
               "try another date"; here that would be every date. */
            <div className="sm bk-why" style={{ gridColumn: '1/-1' }}>
              {t('c.sal.nobodyAtPace', { loc: p.location?.name ?? t('c.sal.thisLocation') })}
              <button type="button" className="btn btn-g" onClick={() => p.setProOpen(true)}>
                {t('c.sal.choosePro')}
              </button>
            </div>
          ) : p.slotsAnswered ? (
            <div className="sm muted" style={{ gridColumn: '1/-1', padding: '8px 2px' }}>{t('c.sal.noTimes')}</div>
          ) : null
        ) : null}
      </div>
      </div>
    </div>
  );
}

function goBook(p: Page, nav: (to: string) => void, setDraft: ReturnType<typeof useBooking>['setDraft']) {
  const d = p.detail;
  const first = p.lines[0];
  if (!d || !first || !p.time || !d.publishableKey || !p.location || p.missing.length) return;
  setDraft({
    slug: p.slug,
    salonName: d.locations.length > 1 ? `${d.name} · ${p.location.name}` : d.name,
    photo: d.gallery[0]?.img ? `url("${d.gallery[0].img}")` : 'var(--ih)',
    publishableKey: d.publishableKey,
    locationId: p.location.id,
    lat: p.location.lat ?? d.lat,
    lng: p.location.lng ?? d.lng,
    items: p.lines.map((l) => ({
      serviceId: l.serviceId,
      variantId: l.variantId,
      modifierOptionIds: l.mods,
      name: l.name,
      durationMin: l.durationMin,
      price: l.price,
    })),
    // The first treatment names the visit for doors that take one.
    serviceId: first.serviceId,
    serviceName: p.lines.map((l) => l.name).join(' + '),
    durationMin: p.durationMin,
    price: p.price,
    variantId: first.variantId,
    employeeId: p.empId,
    employeeName: p.empName,
    date: p.date,
    dayLbl: p.dayLbl,
    time: p.time,
    forWhom: 'self',
    guestName: '',
    email: '',
    name: '',
    phone: '',
  });
  nav('/book/identity');
}

export function Salon() {
  useTranslation();
  const nav = useNavigate();
  const geo = useUserLocation();
  const p = useSalonPage();
  const { setDraft } = useBooking();
  const d = p.detail;
  if (!d) return null;
  const photo = d.gallery[0]?.img ? `url("${d.gallery[0].img}")` : 'var(--ih)';
  const photo2 = d.gallery[1]?.img ? `url("${d.gallery[1].img}")` : 'var(--if)';
  const printedAddress = [d.address, d.city].filter(Boolean).join(', ');
  const mapsUrl = (lat: number | null, lng: number | null) =>
    lat != null && lng != null
      ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${printedAddress} ${d.name}`.trim())}`;
  const showPrice = p.lines.length ? fmtMKD(p.price) : '—';
  const book = () => goBook(p, nav, setDraft);
  const teamCard = (idPrefix: string) => (
    <div className="scard" id={`${idPrefix}-team`}>
      <h2>{t('c.sal.teamAt', { salon: d.name })}</h2>
      <div className="sm muted" style={{ margin: '-8px 0 12px' }}>{t('c.sal.meetTeam')}</div>
      <div className="tsub">{t('c.sal.teamHeading', { salon: d.name })}</div>
      {d.team.map((t) => (
        <button key={t.id} className="trow">
          {t.avatar ? (
            <span className="tav" style={{ backgroundImage: `url("${t.avatar}")`, backgroundSize: 'cover', backgroundPosition: 'center', color: 'transparent' }}>
              {initials(t.name)}
            </span>
          ) : (
            <span className="tav">{initials(t.name)}</span>
          )}
          <span className="ti">
            <b>{t.name}</b>
            <span>{t.role}</span>
          </span>
          {IcChevR}
        </button>
      ))}
    </div>
  );
  // The pin the salon dropped wins on the map; the address text is what
  // we print. They are separate truths and may disagree.
  const pin = p.location?.lat != null && p.location.lng != null ? p.location : d;
  const mapPins =
    pin.lat != null && pin.lng != null
      ? [{ lat: pin.lat, lng: pin.lng, label: d.name, sub: printedAddress, here: true }]
      : [];
  const away =
    geo.position && pin.lat != null && pin.lng != null
      ? distanceLbl(distanceKm(geo.position, { lat: pin.lat, lng: pin.lng }))
      : null;
  const locationCard = (idPrefix: string) => (
    <div className="scard" id={`${idPrefix}-info`}>
      <h2>{t('c.sal.location')}</h2>
      {mapPins.length ? (
        <SalonMap
          pins={mapPins}
          you={geo.position}
          height={190}
          zoom={16}
          radius={12}
          labels={false}
        />
      ) : (
        <div className="locmap">{LocMapSvg}</div>
      )}
      <div className="locrow">
        <span>
          <b style={{ color: 'var(--ink)' }}>{printedAddress}</b>
          {away ? <span className="sm muted">{away} from you</span> : null}
          {!mapPins.length ? (
            <span className="sm muted">{t('c.sal.noPin')}</span>
          ) : null}
        </span>
        <a
          className="readall"
          style={{ margin: '0' }}
          href={mapsUrl(pin.lat ?? null, pin.lng ?? null)}
          target="_blank"
          rel="noreferrer"
        >
          {t('c.sal.directions')}
        </a>
      </div>
    </div>
  );
  /**
   * What stands in for the booking panel when there is nothing to book.
   *
   * A salon is listed here as soon as it publishes a marketplace
   * listing, but it is only bookable once it has a live widget and
   * services it has actually put online. Plenty of imported salons have
   * neither yet — they have a page, a gallery and an address, and no
   * way through.
   *
   * Saying so is the whole point. The alternative is what this page did
   * before: a booking column that silently is not there, which reads as
   * a page that failed to load rather than a salon that has not set up
   * online booking. The phone number is real data the salon published,
   * so it is offered rather than leaving a dead end.
   */
  const notBookableCard = (
    <div className="scard">
      <h2>{t('c.sal.booking')}</h2>
      <p style={{ margin: '0 0 2px', fontSize: '14px' }}>
        {d.name} has not opened online booking on Velnes yet, so there is nothing
        to reserve here for now.
      </p>
      {d.phone ? (
        <p className="sm muted" style={{ margin: '10px 0 0' }}>
          They take bookings by phone:{' '}
          <a href={`tel:${d.phone.replace(/\s+/g, '')}`} style={{ fontWeight: 700 }}>
            {d.phone}
          </a>
        </p>
      ) : (
        <p className="sm muted" style={{ margin: '10px 0 0' }}>
          {t('c.sal.noContact')}
        </p>
      )}
    </div>
  );

  /** Nothing written about itself — plenty of imported listings have
   *  neither a description nor a pitch. A heading over an empty
   *  paragraph is worse than no card. */
  const about = d.description || d.pitch;
  const aboutCard = !about ? null : (
    <div className="scard">
      <h2>{t('c.sal.about', { salon: d.name })}</h2>
      <div className="about2">
        <div>
          <p style={{ margin: '0', fontSize: '14px' }}>{about}</p>
        </div>
        <div className="ph2" style={{ backgroundImage: photo2 }}></div>
      </div>
    </div>
  );
  return (
    <>
      <div className="d-env">
        <DHeader />
        <section data-screen="salon">
          <div className="d-topbar">
            <div className="d-wrap in">
              <div className="pillsearch">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.2-4.2" /></svg>
                <input value={d.name} readOnly />
                <button style={{ border: '0', background: 'none', color: 'var(--muted)' }} onClick={() => nav('/')} aria-label={t('c.res.clear')}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                </button>
              </div>
            </div>
          </div>
          <div className={`d-wrap d-salon${d.bookable ? '' : ' solo'}`}>
            <div>
              <SalonGallery photos={d.gallery} salonName={d.name} variant="gal" fallback={photo} />
              <h1 className="serif" style={{ fontSize: '32px', marginTop: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                {d.name} <span className="vok">{IcVok}</span>
              </h1>
              <div className="sm muted" style={{ marginTop: '6px' }}>
                {IcPin} {[d.address, d.city].filter(Boolean).join(', ')}
              </div>
              {d.pitch ? <p style={{ margin: '12px 0 0', fontSize: '14.5px', maxWidth: '46ch' }}>{d.pitch}</p> : null}
              <div className="badges">
                {d.bookable ? <span className="note">{IcBolt} {t('c.sal.instantBooking')}</span> : null}
                <span className="note">{IcVok} {t('c.sal.verified')}</span>
                <SocialRow socials={d.socials} />
              </div>
              {d.bookable ? null : notBookableCard}
              {aboutCard}
              {d.team.length ? teamCard('d') : null}
              {locationCard('d')}
            </div>
            {d.bookable ? <BookCard p={p} desktop /> : null}
          </div>
          {d.bookable && p.lines.length ? (
            <div className={`dcart${p.cartMin ? ' min' : ''}`} id="dcart">
              <div className="dcart-h">
                {t('c.sal.yourBooking')}
                <button className="dcart-min" aria-label={t('c.sal.minimize')} onClick={() => p.setCartMin(!p.cartMin)}>
                  {IcChevD}
                </button>
              </div>
              {p.cartMin ? (
                <div className="dcart-mini">
                  {p.lines.length} {p.lines.length === 1 ? 'item' : 'items'} · {showPrice}
                </div>
              ) : (
                <div>
                  <div>
                    {p.lines.map((l) => (
                      <div className="dcart-row" key={l.serviceId}>
                        <span className="nm2">
                          {l.svc.name}
                          <span className="sub2">
                            {l.variant ? `${l.variant.label} · ` : ''}
                            {minutesLbl(l.durationMin)}
                          </span>
                        </span>
                        <b style={{ color: 'var(--ink)' }}>{fmtMKD(l.price)}</b>
                        <button
                          className="x"
                          aria-label={t('c.sal.remove', { name: l.svc.name })}
                          onClick={() => p.remove(l.serviceId)}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="dcart-when sm muted">
                    {p.dayLbl} · {p.time || '—'} · {minutesLbl(p.durationMin)} · {p.empName}
                  </div>
                  <div className="dcart-tot">
                    <span>{t('c.sal.total')}</span>
                    <b>{showPrice}</b>
                  </div>
                  <button className="btn btn-p" style={{ width: '100%' }} disabled={!p.lines.length || !p.time || p.missing.length > 0} onClick={book}>
                    {t('c.sal.bookNow')}
                  </button>
                  {!p.lines.length || !p.time || p.missing.length ? (
                    <div className="sm muted" style={{ textAlign: 'center', marginTop: '7px' }}>
                      {!p.lines.length
                        ? t('c.sal.chooseFirstDot')
                        : p.missing.length
                          ? t('c.sal.chooseGroup', { group: p.missing[0]!.group, service: p.missing[0]!.service })
                          : t('c.sal.pickTime')}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}
        </section>
      </div>
      <div className="m-env">
        <section data-screen="salon">
          <div className={d.bookable ? 'm-page has-bar' : 'm-page'}>
            <div className="m-dethead">
              <button className="dh-btn" onClick={() => nav(-1 as never)} aria-label={t('c.sal.back')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H6M11 6l-6 6 6 6" /></svg>
              </button>
              <span className="dh-title">{d.name}</span>
              <span style={{ display: 'flex' }}>
                <button className="dh-btn" aria-label={t('c.sal.save')}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M12 20s-7.4-4.6-7.4-9.4A4.3 4.3 0 0 1 12 8a4.3 4.3 0 0 1 7.4 2.6C19.4 15.4 12 20 12 20z" /></svg>
                </button>
              </span>
            </div>
            <div style={{ height: '12px' }}></div>
            <SalonGallery photos={d.gallery} salonName={d.name} variant="m-gal" fallback={photo} />
            {d.team.length ? (
              <button className="prostrip">
                <span className="avs">
                  {d.team.slice(0, 4).map((t) => (
                    <span key={t.id}>{initials(t.name)}</span>
                  ))}
                </span>
                <span className="tx2">
                  <b>{d.team.length} professionals</b>
                  <span>at {d.name}</span>
                </span>
                {IcChevR}
              </button>
            ) : null}
            <div className="m-salonhead">
              <h1>
                {d.name} <span className="vok">{IcVok}</span>
              </h1>
              <div className="sm muted" style={{ marginTop: '5px' }}>
                {IcPin} {[d.address, d.city].filter(Boolean).join(', ')}
              </div>
              {d.pitch ? <p style={{ margin: '10px 0 0', fontSize: '13.5px' }}>{d.pitch}</p> : null}
              <div className="badges" style={{ gap: '8px 16px' }}>
                {d.bookable ? <span className="note" style={{ fontSize: '12.5px' }}>{IcBolt} {t('c.sal.instantBooking')}</span> : null}
                <span className="note" style={{ fontSize: '12.5px' }}>{IcVok} {t('c.sal.verified')}</span>
                <SocialRow socials={d.socials} />
              </div>
            </div>
            {d.bookable ? <BookCard p={p} desktop={false} /> : notBookableCard}
            {aboutCard}
            {locationCard('m')}
            {d.team.length ? teamCard('m') : null}
            <div style={{ height: '8px' }}></div>
            {d.bookable ? (
              <div className="m-bookbar">
                <div className="r1">
                  <span className="th" style={{ backgroundImage: photo }}></span>
                  <span className="info">
                    <span className="name">
                      {d.name} <span className="vok">{IcVok}</span>
                    </span>
                    <span className="line">
                      {IcCal}
                      <b data-sum="day">{p.dayLbl}</b>
                      <span className="sep">|</span>
                      {IcClock}
                      <b data-sum="time">{p.time || '—'}</b>
                    </span>
                  </span>
                  <span className="tot">
                    <small>{t('c.sal.total')}</small>
                    <b data-sum="price">{showPrice}</b>
                  </span>
                </div>
                <button className="btn btn-p" disabled={!p.lines.length || !p.time || p.missing.length > 0} onClick={book}>
                  {t('c.sal.bookNow')} {IcArr}
                </button>
                {p.missing.length ? (
                  <span className="sm muted">{t('c.sal.chooseGroup', { group: p.missing[0]!.group, service: p.missing[0]!.service })}</span>
                ) : null}
                <span className="safe">{IcVok} {t('c.sal.safe')}</span>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}


/* ── Social links: one icon per network the salon gave, nothing when
   it gave none. Links open in a new tab; the icons are inline SVG. ── */
const SOCIAL_ICONS: Record<string, ReactElement> = {
  website: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>
  ),
  instagram: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>
  ),
  facebook: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 21v-7h2.4l.4-3h-2.8V9.1c0-.9.3-1.5 1.5-1.5h1.5V4.9c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8V11H8v3h2.6v7h2.9z" /></svg>
  ),
  tiktok: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 3c.3 2.3 1.6 3.7 3.8 3.9v3.1c-1.4 0-2.7-.4-3.8-1.2v5.7c0 3.4-2.7 5.9-6 5.5-2.6-.3-4.6-2.4-4.8-5-.3-3.3 2.3-6 5.5-6 .3 0 .7 0 1 .1v3.2c-.3-.1-.6-.2-1-.2-1.4 0-2.5 1.2-2.4 2.6.1 1.2 1.1 2.2 2.3 2.3 1.4.1 2.6-1 2.6-2.4V3h2.8z" /></svg>
  ),
};

function SocialRow({ socials }: { socials: { website: string | null; instagram: string | null; facebook: string | null; tiktok: string | null } }) {
  const links = (['website', 'instagram', 'facebook', 'tiktok'] as const).filter((k) => socials[k]);
  if (!links.length) return null;
  return (
    <span className="sal-social" aria-label={t('c.sal.follow')}>
      {links.map((k) => (
        <a key={k} href={socials[k]!} target="_blank" rel="noopener noreferrer" title={k === 'website' ? t('c.sal.website') : k} aria-label={k === 'website' ? t('c.sal.website') : k}>
          {SOCIAL_ICONS[k]}
        </a>
      ))}
    </span>
  );
}
