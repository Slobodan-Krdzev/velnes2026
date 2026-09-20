import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { z } from 'zod';
import type { PublicServiceSchema } from '@velnes/contracts';
import { DHeader } from '../../app/chrome.js';
import { fmtMKD, minutesLbl } from '../../lib/api/mappers.js';
import { useSalonDetail, useSalonServices, useVisitSlots } from '../../lib/api/queries.js';
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
const IcCheck = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
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

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayChips(offset: number) {
  const out: { iso: string; lbl: string; small: string }[] = [];
  for (let i = offset; i < offset + 4; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const lbl = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : DAY_NAMES[d.getDay()]!;
    const small = `${i < 2 ? `${DAY_NAMES[d.getDay()]} ` : ''}${d.getDate()} ${MONTHS[d.getMonth()]}`;
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
}: {
  s: PublicService;
  on: boolean;
  desktop: boolean;
  chosen: { durationMin: number; price: number; label: string | null } | null;
  onToggle: () => void;
}) {
  const priceLbl =
    on && chosen
      ? fmtMKD(chosen.price)
      : s.variants.length
        ? `from ${fmtMKD(Math.min(s.price, s.priceFrom ?? s.price))}`
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
        <span className="ok">{IcCheck}</span>
      </span>
      <span className="in2">
        <span>
          {minutesLbl(on && chosen ? chosen.durationMin : s.durationMin)}
          {on && chosen?.label ? ` · ${chosen.label}` : ''}
        </span>
        <b>{priceLbl}</b>
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
  const location = detail?.locations[locIdx] ?? detail?.locations[0];
  const locationId = location?.id;
  const key = detail?.publishableKey;
  const servicesQ = useSalonServices(key, locationId);
  const services = useMemo(() => servicesQ.data?.services ?? [], [servicesQ.data]);
  // The visible four-day window; the calendar chip walks it forward.
  const [dayOffset, setDayOffset] = useState(0);
  const days = useMemo(() => dayChips(dayOffset), [dayOffset]);
  // The visit: several treatments in the order they were picked. The
  // prototype's desktop cart is multi-select, and a salon visit really
  // is "haircut then colour" — so the cart is the state, not one id.
  const [cart, setCart] = useState<{ serviceId: string; variantId: string | null }[]>([]);
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
    setCart([{ serviceId: match.id, variantId: null }]);
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
          return {
            ...c,
            svc,
            variant,
            name: variant ? `${svc.name} · ${variant.label}` : svc.name,
            price: variant?.price ?? svc.price,
            durationMin: variant?.durationMin ?? svc.durationMin,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    [cart, services],
  );
  const availQ = useVisitSlots({
    key,
    locationId,
    date,
    employeeId: empId,
    items: lines.map((l) => ({ serviceId: l.serviceId, variantId: l.variantId })),
  });
  const free = useMemo(() => (availQ.data?.slots ?? []).filter((s) => s.free).map((s) => s.t), [availQ.data]);
  useEffect(() => {
    if (free.length && !free.includes(time)) setTime(free[0]!);
    if (!free.length) setTime('');
  }, [free, time]);
  // What the door will actually charge for the visit: every line at the
  // price its own option carries. Never a "from" price.
  const price = lines.reduce((n, l) => n + l.price, 0);
  const durationMin = lines.reduce((n, l) => n + l.durationMin, 0);
  const dayLbl = days.find((d) => d.iso === date)?.lbl ?? date;
  const team = lines[0]?.svc.employees ?? [];
  const empName = team.find((e) => e.id === empId)?.name ?? 'Any available professional';
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
    toggle: (id: string) => {
      setCart((c) =>
        c.some((x) => x.serviceId === id)
          ? c.filter((x) => x.serviceId !== id)
          : [...c, { serviceId: id, variantId: null }],
      );
      setEmpId('any');
      setOpenVariantFor(id);
    },
    remove: (id: string) => setCart((c) => c.filter((x) => x.serviceId !== id)),
    setVariant: (serviceId: string, variantId: string | null) =>
      setCart((c) => c.map((x) => (x.serviceId === serviceId ? { ...x, variantId } : x))),
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
      <div className="stepper">
        <span className="step done" data-step="1"><span className="n">1</span>Treatment</span>
        <span className={`step ${p.time ? 'done' : 'on'}`} data-step="2"><span className="n">2</span>Date &amp; time</span>
        <span className={`step ${p.time ? 'on' : ''}`} data-step="3"><span className="n">3</span>Confirm</span>
      </div>
      {d.locations.length > 1 ? (
        <>
          <div className="pro-row" style={{ marginTop: '4px' }}>
            <span className="av">{IcPin}</span>
            <span className="who2">
              <small>Location</small>
              <b>{p.location?.name}</b>
            </span>
            <button className="chg" type="button" onClick={() => p.setLocOpen(!p.locOpen)}>
              Choose →
            </button>
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
      <div className="bk-h" style={desktop ? undefined : { marginTop: '4px' }}>1. Choose your treatment</div>
      <div className="bk-sub spark">
        {IcSpark}
        <span className="muted">Most booked treatments</span>
      </div>
      <div className="tr-grid">
        {head.map((s) => (
          <TrCard
            key={s.id}
            s={s}
            desktop={desktop}
            on={p.inCart(s.id)}
            chosen={chosenOf(p, s.id)}
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
                  chosen={chosenOf(p, s.id)}
                  onToggle={() => p.toggle(s.id)}
                />
              ))}
            </div>
          ) : null}
          <button className="btn btn-g viewall" onClick={() => p.setAllOpen(!p.allOpen)}>
            {p.allOpen ? 'Show fewer treatments' : `View all ${p.services.length} treatments`} {IcArr}
          </button>
        </>
      ) : null}
      {p.lines
        .filter((l) => l.svc.variants.length)
        .map((l) => (
          <div key={l.serviceId}>
            <div className="bk-sub" style={{ marginTop: '14px' }}>
              <span className="muted">Options for {l.svc.name}</span>
            </div>
            <div className="pro-grid">
              <button
                className={`pro-card${l.variantId === null ? ' on' : ''}`}
                onClick={() => p.setVariant(l.serviceId, null)}
              >
                <span className="pav any">{IcClock}</span>
                <span>
                  <b>Standard</b>
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
      <div className="pro-row">
        <span className="av">{IcPerson}</span>
        <span className="who2">
          <small>Professional</small>
          <b data-sum="pro">{p.empName}</b>
        </span>
        <button className="chg" type="button" onClick={() => p.setProOpen(!p.proOpen)}>
          Choose →
        </button>
      </div>
      {p.proOpen ? (
        <div className="pro-grid">
          <button className={`pro-card${p.empId === 'any' ? ' on' : ''}`} onClick={() => p.setEmpId('any')}>
            <span className="pav any">{IcPerson}</span>
            <span>
              <b>Any professional</b>
              <span className="sm muted">First available · fastest option</span>
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
            <span className="tiny-tag" style={{ marginLeft: '9px' }}>{d.products.length} products</span>
            <span className="chv">{IcChevD}</span>
          </div>
          {p.prodOpen ? (
            <div>
              <div className="bk-sub">
                <span className="muted">Available at the salon — ask for them at your visit.</span>
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
                      <span>Product</span>
                      <b>{fmtMKD(pr.price)}</b>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      <div className="bk-h" style={{ marginTop: '20px' }}>2. Choose date &amp; time</div>
      <div className="dayrow" ref={dayRef}>
        {p.dayOffset > 0 ? (
          <button className="daychip daychip--cal" onClick={p.prevDays} aria-label="Earlier days">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 6 8.5 12l6 6" /></svg>
          </button>
        ) : null}
        {p.days.map((day) => (
          <button key={day.iso} className={`daychip${p.date === day.iso ? ' on' : ''}`} onClick={() => p.setDate(day.iso)}>
            {day.lbl}
            <small>{day.small}</small>
          </button>
        ))}
        <button className="daychip daychip--cal" onClick={p.nextDays} aria-label="Later days">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 6l6 6-6 6" /></svg>
        </button>
      </div>
      <div className="timegrid">
        {p.free.map((t) => (
          <button key={t} className={`slot${p.time === t ? ' on' : ''}`} onClick={() => p.setTime(t)}>
            {t}
          </button>
        ))}
        {!p.free.length ? <div className="sm muted" style={{ gridColumn: '1/-1', padding: '8px 2px' }}>No open times this day — try another date.</div> : null}
      </div>
    </div>
  );
}

function goBook(p: Page, nav: (to: string) => void, setDraft: ReturnType<typeof useBooking>['setDraft']) {
  const d = p.detail;
  const first = p.lines[0];
  if (!d || !first || !p.time || !d.publishableKey || !p.location) return;
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
  const visitLbl = p.lines.length ? p.lines.map((l) => l.name).join(' + ') : 'Nothing selected yet';
  const book = () => goBook(p, nav, setDraft);
  const teamCard = (idPrefix: string) => (
    <div className="scard" id={`${idPrefix}-team`}>
      <h2>Team at {d.name}</h2>
      <div className="sm muted" style={{ margin: '-8px 0 12px' }}>Meet the team.</div>
      <div className="tsub">{d.name} team</div>
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
      <h2>Location</h2>
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
            <span className="sm muted">This salon hasn’t placed itself on the map yet.</span>
          ) : null}
        </span>
        <a
          className="readall"
          style={{ margin: '0' }}
          href={mapsUrl(pin.lat ?? null, pin.lng ?? null)}
          target="_blank"
          rel="noreferrer"
        >
          Get directions
        </a>
      </div>
    </div>
  );
  const aboutCard = (
    <div className="scard">
      <h2>About {d.name}</h2>
      <div className="about2">
        <div>
          <p style={{ margin: '0', fontSize: '14px' }}>{d.description || d.pitch}</p>
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
                <button style={{ border: '0', background: 'none', color: 'var(--muted)' }} onClick={() => nav('/')} aria-label="Clear">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                </button>
              </div>
            </div>
          </div>
          <div className="d-wrap d-salon">
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
                {d.bookable ? <span className="note">{IcBolt} Instant booking</span> : null}
                <span className="note">{IcVok} Verified salon</span>
              </div>
              {aboutCard}
              {d.team.length ? teamCard('d') : null}
              {locationCard('d')}
            </div>
            {d.bookable ? <BookCard p={p} desktop /> : null}
          </div>
          {d.bookable && p.lines.length ? (
            <div className={`dcart${p.cartMin ? ' min' : ''}`} id="dcart">
              <div className="dcart-h">
                Your booking
                <button className="dcart-min" aria-label="Minimize booking panel" onClick={() => p.setCartMin(!p.cartMin)}>
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
                          aria-label={`Remove ${l.svc.name}`}
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
                    <span>Total</span>
                    <b>{showPrice}</b>
                  </div>
                  <button className="btn btn-p" style={{ width: '100%' }} disabled={!p.time} onClick={book}>
                    Book now
                  </button>
                  {!p.time ? (
                    <div className="sm muted" style={{ textAlign: 'center', marginTop: '7px' }}>
                      Pick a time that fits the whole visit.
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
              <button className="dh-btn" onClick={() => nav(-1 as never)} aria-label="Back">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H6M11 6l-6 6 6 6" /></svg>
              </button>
              <span className="dh-title">{d.name}</span>
              <span style={{ display: 'flex' }}>
                <button className="dh-btn" aria-label="Save">
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
                {d.bookable ? <span className="note" style={{ fontSize: '12.5px' }}>{IcBolt} Instant booking</span> : null}
                <span className="note" style={{ fontSize: '12.5px' }}>{IcVok} Verified salon</span>
              </div>
            </div>
            {d.bookable ? <BookCard p={p} desktop={false} /> : null}
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
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="7" cy="18" r="2.6" /><circle cx="17" cy="18" r="2.6" /><path d="M8.8 16.2 17 4M15.2 16.2 7 4" /></svg>
                      <b data-sum="tr">{visitLbl}</b>
                      <span className="sep">|</span>
                      {IcCal}
                      <b data-sum="day">{p.dayLbl}</b>
                      <span className="sep">|</span>
                      {IcClock}
                      <b data-sum="time">{p.time || '—'}</b>
                    </span>
                  </span>
                  <span className="tot">
                    <small>Total</small>
                    <b data-sum="price">{showPrice}</b>
                  </span>
                </div>
                <button className="btn btn-p" disabled={!p.time} onClick={book}>
                  Book now {IcArr}
                </button>
                <span className="safe">{IcVok} Safe and simple booking</span>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}
