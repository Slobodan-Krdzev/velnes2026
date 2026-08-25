import {
  AvailabilityResponseSchema,
  HoldResponseSchema,
  PublicBookResponseSchema,
  PublicServicesResponseSchema,
  PublicWidgetSchema,
  type PublicWidget,
} from '@velnes/contracts';
import type { Lang } from '@velnes/i18n';
import { I, Icon, VelnesMark } from '@velnes/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';

/** The prototype's viewBook, markup-exact: Location → Service → Time →
 *  Details → Payment → Done, with the hold countdown and the widget's
 *  accent. Priced and refused by the doors, never here. */

const P = '/api/v1/public';
const HOLD_SECONDS = 600;
const uuid = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `idem-${String(Math.random()).slice(2)}${Date.now().toString(36)}`;
const money = (n: number) =>
  new Intl.NumberFormat('mk-MK', {
    style: 'currency',
    currency: 'MKD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
};
const addDays = (iso: string, n: number) => {
  const d = parse(iso);
  d.setDate(d.getDate() + n);
  return localIso(d);
};
const wdIdx = (iso: string) => (parse(iso).getDay() + 6) % 7; // 0 = Monday

async function pub<S extends z.ZodType>(schema: S, path: string): Promise<z.infer<S>> {
  const res = await fetch(`${P}${path}`);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw Object.assign(new Error(String(data.message ?? 'failed')), data);
  return schema.parse(data) as z.infer<S>;
}
async function pubPost<S extends z.ZodType>(
  schema: S,
  path: string,
  body: unknown,
): Promise<z.infer<S>> {
  const res = await fetch(`${P}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw Object.assign(new Error(String(data.message ?? 'failed')), data);
  return schema.parse(data) as z.infer<S>;
}

type Service = z.infer<typeof PublicServicesResponseSchema>['services'][number];
type Slot = z.infer<typeof AvailabilityResponseSchema>['slots'][number];
type Done = z.infer<typeof PublicBookResponseSchema>;
type Refusal = { code?: string; params?: Record<string, string | number>; message?: string };

export function BookingFlow({
  slug,
  pk,
  source,
}: {
  slug: string | null;
  pk: string | null;
  source: 'link' | 'widget';
}) {
  const { t, i18n } = useTranslation();
  const [widget, setWidget] = useState<PublicWidget | null>(null);
  const [fatal, setFatal] = useState(false);
  const [step, setStep] = useState(1);
  const [loc, setLoc] = useState<string | null>(null);
  const [services, setServices] = useState<Service[] | null>(null);
  const [svc, setSvc] = useState<Service | null>(null);
  const [vid, setVid] = useState<string | null>(null);
  const [mods, setMods] = useState<string[]>([]);
  const [emp, setEmp] = useState<string>('any');
  const [date, setDate] = useState(localIso(new Date()));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [time, setTime] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [hold, setHold] = useState(0);
  const [released, setReleased] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const idem = useRef(uuid());
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // The widget (by key, or by slug for the hosted page). Its language
  // drives the whole page; its payload carries the publishable key the
  // data endpoints want.
  useEffect(() => {
    const path = pk ? `/widget?key=${encodeURIComponent(pk)}` : `/booking-page/${slug}`;
    pub(PublicWidgetSchema, path)
      .then((w) => {
        setWidget(w);
        void i18n.changeLanguage(w.lang as Lang);
        if (w.locations.length === 1) {
          setLoc(w.locations[0]!.id);
          setStep(2);
        }
      })
      .catch(() => setFatal(true));
  }, [pk, slug, i18n]);

  const key = pk ?? widget?.publishableKey ?? '';

  useEffect(() => {
    if (!loc || !key) return;
    setServices(null);
    pub(PublicServicesResponseSchema, `/services?key=${encodeURIComponent(key)}&locationId=${loc}`)
      .then((r) => setServices(r.services))
      .catch(() => setServices([]));
  }, [loc, key]);

  useEffect(() => {
    if (!loc || !svc || !key) return;
    setTime(null);
    pub(
      AvailabilityResponseSchema,
      `/availability?key=${encodeURIComponent(key)}&locationId=${loc}&serviceId=${svc.id}&date=${date}&employeeId=${emp}${vid ? `&variantId=${vid}` : ''}&holdKey=${idem.current}`,
    )
      .then((r) => setSlots(r.slots))
      .catch(() => setSlots([]));
  }, [loc, svc, date, vid, emp, key]);

  // The hold countdown — when it dies, the time goes back on sale and
  // the visitor lands back on the Time step (prototype behaviour).
  const startHold = useCallback(() => {
    setHold(HOLD_SECONDS);
    if (holdTimer.current) clearInterval(holdTimer.current);
    holdTimer.current = setInterval(() => {
      setHold((h) => {
        if (h <= 1) {
          if (holdTimer.current) clearInterval(holdTimer.current);
          setTime(null);
          setStep(3);
          setReleased(true);
          return 0;
        }
        return h - 1;
      });
    }, 1000);
  }, []);
  useEffect(
    () => () => {
      if (holdTimer.current) clearInterval(holdTimer.current);
    },
    [],
  );

  const restart = () => {
    if (holdTimer.current) clearInterval(holdTimer.current);
    idem.current = uuid();
    setStep(widget && widget.locations.length === 1 ? 2 : 1);
    setSvc(null);
    setVid(null);
    setMods([]);
    setEmp('any');
    setTime(null);
    setHold(0);
    setConsent(false);
    setError(null);
    setDone(null);
    setReleased(false);
  };
  const exit = () => {
    // Inside the iframe the host page owns the closing; standalone, a
    // fresh start is the only sensible "close".
    if (window.parent !== window) window.parent.postMessage({ velnes: 'close' }, '*');
    else restart();
  };

  if (fatal)
    return (
      <div className="bookwrap">
        <div className="bookcard">
          <div className="bookbody">
            <div className="empty">
              <h3>{t('book.notFoundTitle')}</h3>
              <p>{t('book.notFoundBody')}</p>
            </div>
          </div>
        </div>
      </div>
    );
  if (!widget)
    return (
      <div className="bookwrap">
        <div className="bookcard">
          <div className="bookbody muted">{t('shell.loading')}</div>
        </div>
      </div>
    );

  const accent = widget.accent;
  const lng = i18n.language;
  const monthOf = (iso: string) => parse(iso).toLocaleDateString(lng, { month: 'short' });
  const weekDay = (iso: string) => parse(iso).toLocaleDateString(lng, { weekday: 'short' });
  const dateFull = (iso: string) =>
    parse(iso).toLocaleDateString(lng, { weekday: 'long', day: 'numeric', month: 'long' });

  const chosenVariant =
    svc?.variants.find((v) => v.id === vid) ?? svc?.variants.find((v) => v.std) ?? null;
  const modOptions = (svc?.modifiers ?? []).flatMap((g) => g.options);
  const chosenMods = modOptions.filter((o) => mods.includes(o.id));
  const price =
    (chosenVariant?.price ?? svc?.price ?? 0) + chosenMods.reduce((s, o) => s + o.price, 0);
  const duration =
    (chosenVariant?.durationMin ?? svc?.durationMin ?? 0) +
    chosenMods.reduce((s, o) => s + o.durationMin, 0);
  const missing = (svc?.modifiers ?? [])
    .filter((g) => g.required && !g.options.some((o) => mods.includes(o.id)))
    .map((g) => g.name);

  const refusalText = (e: Refusal) =>
    e.code && i18n.exists(`refusal.${e.code}`)
      ? t(`refusal.${e.code}`, e.params ?? {})
      : (e.message ?? t('book.errorBody'));

  const holdAndContinue = async () => {
    setError(null);
    setReleased(false);
    try {
      await pubPost(HoldResponseSchema, '/holds', {
        widgetKey: key,
        key: idem.current,
        locationId: loc,
        serviceId: svc!.id,
        date,
        time,
        employeeId: emp,
      });
      startHold();
      setStep(4);
    } catch (e) {
      setError(refusalText(e as Refusal));
    }
  };

  const confirm = async () => {
    setError(null);
    try {
      const r = await pubPost(PublicBookResponseSchema, '/book', {
        widgetKey: key,
        key: idem.current,
        locationId: loc,
        serviceId: svc!.id,
        date,
        time,
        employeeId: emp,
        variantId: chosenVariant?.id ?? null,
        modifierOptionIds: mods,
        name,
        phone,
        ...(email ? { email } : {}),
      });
      if (holdTimer.current) clearInterval(holdTimer.current);
      setHold(0);
      setDone(r);
      setStep(6);
    } catch (e) {
      setError(refusalText(e as Refusal));
    }
  };

  const stepNames = [
    t('book.stepLocation'),
    t('book.stepService'),
    t('book.stepTime'),
    t('book.stepDetails'),
    t('book.stepPayment'),
    t('book.stepDone'),
  ];
  const cats = [...new Set((services ?? []).map((s) => s.category ?? ''))];
  const cancelText =
    widget.cancelPolicy === 'none'
      ? t('book.noCancel')
      : t('book.cancelPolicy', {
          hours: widget.cancelPolicy === 'inherit' ? 24 : widget.cancelPolicy,
        });
  const openDays: string[] = [];
  for (let i = 0; openDays.length < 14 && i < 30; i++) {
    const d = addDays(localIso(new Date()), i);
    if (wdIdx(d) !== 6) openDays.push(d); // Sundays closed in the demo world
  }
  const sourceLabel = source === 'widget' ? t('book.sourceWidget') : t('book.sourceLink');
  const embedHost = (() => {
    try {
      return document.referrer ? new URL(document.referrer).hostname : '';
    } catch {
      return '';
    }
  })();

  return (
    <div className="bookwrap">
      <div className="bookcard">
        <div className="bookhead">
          <span style={{ color: accent }}>
            <VelnesMark size={28} />
          </span>
          <span className="grow">
            <span className="bold">{widget.businessName}</span>
            <span className="muted" style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>
              {source === 'widget'
                ? `${t('book.onSiteSource')}${embedHost ? ` · ${embedHost}` : ''}`
                : t('book.linkSource')}
            </span>
          </span>
          <button className="btn btn-subtle btn-sm" onClick={exit}>
            {t('book.close')}
          </button>
        </div>
        <div className="bsteps">
          {stepNames.map((s, i) => (
            <span
              key={s}
              className={`bstep ${i + 1 <= step ? 'on' : ''}`}
              style={i + 1 <= step ? { background: accent } : undefined}
              title={s}
            />
          ))}
        </div>
        <div className="bookbody">
          {step > 1 && step < 6 ? (
            <div className="hstack" style={{ justifyContent: 'space-between' }}>
              <span className="muted" style={{ fontWeight: 600 }}>
                {t('book.stepOf', { n: step, name: stepNames[step - 1] })}
              </span>
              {loc ? (
                <span className="badge accent">
                  {widget.locations.find((l) => l.id === loc)?.name}
                  {svc ? ` · ${svc.name}` : ''}
                  {svc ? ` · ${money(price)}` : ''}
                </span>
              ) : null}
            </div>
          ) : null}
          {hold > 0 && step > 3 && step < 6 ? (
            <div className={`hold ${hold < 120 ? 'late' : ''}`}>
              <Icon d={I.calendar} size={18} /> {t('book.held')}{' '}
              <span className="tnum">
                {Math.floor(hold / 60)}:{String(hold % 60).padStart(2, '0')}
              </span>{' '}
              {t('book.left')}
            </div>
          ) : null}

          {step === 1 ? (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 700 }}>{t('book.whereTitle')}</h2>
              {widget.locations.map((l) => (
                <button
                  key={l.id}
                  className={`bpick ${loc === l.id ? 'on' : ''}`}
                  onClick={() => {
                    setLoc(l.id);
                    setStep(2);
                  }}
                >
                  <span className="mark on">{l.name[0]}</span>
                  <span className="grow">
                    <span className="t">{l.name}</span>
                    <span className="s">
                      {l.address}, {l.city} · {t('book.opens')}
                    </span>
                  </span>
                  <Icon d={I.right} size={18} />
                </button>
              ))}
            </>
          ) : null}

          {step === 2 ? (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 700 }}>{t('book.whatTitle')}</h2>
              {services === null ? (
                <p className="muted">{t('shell.loading')}</p>
              ) : services.length ? (
                cats.map((cat) => (
                  <div key={cat}>
                    <div
                      className="section-label"
                      style={{ border: 0, background: 'none', padding: '8px 0' }}
                    >
                      {cat}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {services
                        .filter((s) => (s.category ?? '') === cat)
                        .map((s) => {
                          const groups = s.modifiers.length;
                          const prices = s.variants.map((v) => v.price);
                          const from = prices.length ? Math.min(...prices) : s.price;
                          const to = prices.length ? Math.max(...prices) : s.price;
                          return (
                            <button
                              key={s.id}
                              className={`bpick ${svc?.id === s.id ? 'on' : ''}`}
                              onClick={() => {
                                setSvc(s);
                                setVid(null);
                                setMods([]);
                                setEmp('any');
                                setStep(3);
                              }}
                            >
                              <span className="grow">
                                <span className="t">{s.name}</span>
                                <span className="s">
                                  {s.variants.length
                                    ? `${s.variants.length} ${t('book.lengths')}`
                                    : `${s.durationMin} ${t('book.minutes')}`}
                                  {groups
                                    ? ` · ${groups} ${groups > 1 ? t('book.optionGroups') : t('book.optionGroup')}`
                                    : ''}
                                </span>
                              </span>
                              <span className="p">
                                {s.variants.length && from !== to
                                  ? `${t('catalog.from')} ${money(from)}`
                                  : money(s.variants.length ? from : s.price)}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty">
                  <h3>{t('book.nothingHereTitle')}</h3>
                  <p>{t('book.nothingHereBody')}</p>
                </div>
              )}
              <button className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setStep(1)}>
                <Icon d={I.arrowleft} size={16} /> {t('book.changeLocation')}
              </button>
            </>
          ) : null}

          {step === 3 && svc ? (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 700 }}>{t('book.whoWhenTitle')}</h2>
              {released ? <div className="note danger">{t('book.released')}</div> : null}
              {svc.variants.length ? (
                <div className="field">
                  <span>{t('book.howLong')}</span>
                  <div className="chips">
                    {svc.variants.map((v) => (
                      <button
                        key={v.id}
                        className={`chip ${chosenVariant?.id === v.id ? 'on' : ''}`}
                        onClick={() => setVid(v.id)}
                      >
                        {v.label} · {money(v.price)}
                      </button>
                    ))}
                  </div>
                  <span className="hint">{t('book.longerHint')}</span>
                </div>
              ) : null}
              {svc.modifiers.map((g) => (
                <div className="field" key={g.id}>
                  <span>
                    {g.name}
                    {g.required ? <span className="req">*</span> : null}
                  </span>
                  <div className="chips">
                    {g.options.map((o) => {
                      const on = mods.includes(o.id);
                      return (
                        <button
                          key={o.id}
                          className={`chip ${on ? 'on' : ''}`}
                          onClick={() =>
                            setMods((m) =>
                              g.type === 'single'
                                ? on
                                  ? m.filter((x) => !g.options.some((oo) => oo.id === x))
                                  : [...m.filter((x) => !g.options.some((oo) => oo.id === x)), o.id]
                                : on
                                  ? m.filter((x) => x !== o.id)
                                  : [...m, o.id],
                            )
                          }
                        >
                          {o.name}
                          {o.price ? ` · ${o.price > 0 ? '+' : '−'}${money(Math.abs(o.price))}` : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {svc.variants.length || svc.modifiers.length ? (
                <div className="note">
                  {svc.name}
                  {chosenVariant ? ` · ${chosenVariant.label}` : ''}
                  {chosenMods.length ? ` · ${chosenMods.map((o) => o.name).join(', ')}` : ''} —{' '}
                  <strong>{money(price)}</strong>, {duration} {t('book.minutes')}.
                </div>
              ) : null}
              <div className="field">
                <span>{t('book.professional')}</span>
                <div className="chips">
                  <button
                    className={`chip ${emp === 'any' ? 'on' : ''}`}
                    onClick={() => setEmp('any')}
                  >
                    {t('book.anyPro')}
                  </button>
                  {svc.employees.map((e) => (
                    <button
                      key={e.id}
                      className={`chip ${emp === e.id ? 'on' : ''}`}
                      onClick={() => setEmp(e.id)}
                    >
                      {e.name.split(' ')[0]}
                    </button>
                  ))}
                </div>
                {svc.employees.length ? null : <span className="hint">{t('book.nobodyHere')}</span>}
              </div>
              <div className="field">
                <span>{t('book.day')}</span>
                <div className="bdays">
                  {openDays.map((d) => (
                    <button
                      key={d}
                      className={`bday ${date === d ? 'on' : ''}`}
                      onClick={() => setDate(d)}
                    >
                      <span className="dw">{d === localIso(new Date()) ? t('common.today') : weekDay(d)}</span>
                      <span className="tnum">
                        {Number(d.slice(8))} {monthOf(d)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span>{t('book.time')}</span>
                {slots.some((s) => s.free) ? (
                  <div className="bslots">
                    {slots.map((s) => (
                      <button
                        key={s.t}
                        className={`bslot ${time === s.t ? 'on' : ''}`}
                        disabled={!s.free}
                        onClick={() => setTime(s.t)}
                      >
                        {s.t}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="muted" style={{ fontWeight: 500 }}>
                    {t('book.nothingFree')}
                  </p>
                )}
                <span className="hint">{t('book.slotsHint')}</span>
              </div>
              {error ? (
                <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>
                  {error}
                </p>
              ) : null}
              <div className="hstack" style={{ justifyContent: 'space-between' }}>
                <button className="btn btn-ghost" onClick={() => setStep(2)}>
                  <Icon d={I.arrowleft} size={16} /> {t('book.changeService')}
                </button>
                <button
                  className="btn btn-primary"
                  style={{ background: accent }}
                  disabled={!time || missing.length > 0}
                  onClick={() => void holdAndContinue()}
                >
                  {missing.length
                    ? t('book.choose', { what: missing.join(', ') })
                    : t('book.continue')}
                </button>
              </div>
            </>
          ) : null}

          {step === 4 ? (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 700 }}>{t('book.detailsTitle')}</h2>
              <div className="grid2">
                <label className="field">
                  <span>
                    {t('book.name')}
                    <span className="req">*</span>
                  </span>
                  <input
                    className="input"
                    value={name}
                    placeholder="Marija Stojanovska"
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>
                    {t('book.phone')}
                    <span className="req">*</span>
                  </span>
                  <input
                    className="input"
                    value={phone}
                    placeholder="+389 70 000 000"
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </label>
                <label className="field span2">
                  <span>{t('book.email')}</span>
                  <input
                    className="input"
                    type="email"
                    value={email}
                    placeholder="you@example.com"
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <span className="hint">{t('book.emailHint')}</span>
                </label>
              </div>
              <button className="checkrow" onClick={() => setConsent((v) => !v)}>
                <span className={`check ${consent ? 'on' : ''}`}>
                  <Icon d={I.check} size={14} w={3.5} />
                </span>
                <span style={{ fontWeight: 500 }}>{cancelText}</span>
              </button>
              <div className="hstack" style={{ justifyContent: 'space-between' }}>
                <button className="btn btn-ghost" onClick={() => setStep(3)}>
                  <Icon d={I.arrowleft} size={16} /> {t('book.changeTime')}
                </button>
                <button
                  className="btn btn-primary"
                  style={{ background: accent }}
                  disabled={!name || !phone || !consent}
                  onClick={() => setStep(5)}
                >
                  {t('book.continue')}
                </button>
              </div>
            </>
          ) : null}

          {step === 5 && svc ? (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 700 }}>{t('book.confirmTitle')}</h2>
              <div className="card" style={{ padding: 0 }}>
                <div style={{ padding: '16px 18px' }}>
                  <div className="kv">
                    <span className="k">{t('drawer.service')}</span>
                    <span className="v">
                      {svc.name}
                      {chosenVariant ? ` · ${chosenVariant.label}` : ''} · {duration} min
                    </span>
                  </div>
                  {chosenMods.length ? (
                    <div className="kv">
                      <span className="k">{t('book.options')}</span>
                      <span className="v">{chosenMods.map((o) => o.name).join(', ')}</span>
                    </div>
                  ) : null}
                  <div className="kv">
                    <span className="k">{t('book.where')}</span>
                    <span className="v">{widget.locations.find((l) => l.id === loc)?.name}</span>
                  </div>
                  <div className="kv">
                    <span className="k">{t('book.when')}</span>
                    <span className="v">
                      {dateFull(date)} · {time}
                    </span>
                  </div>
                  <div className="kv">
                    <span className="k">{t('book.with')}</span>
                    <span className="v">
                      {emp === 'any'
                        ? t('book.firstAvailable')
                        : svc.employees.find((e) => e.id === emp)?.name}
                    </span>
                  </div>
                  <div className="kv">
                    <span className="k">{t('till.total')}</span>
                    <span className="v">{money(price)}</span>
                  </div>
                  <div className="kv">
                    <span className="k">{t('book.payInSalon')}</span>
                    <span className="v" style={{ fontSize: 18 }}>
                      {money(0)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="note">{t('book.noPrepay')}</div>
              {error ? (
                <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>
                  {error}
                </p>
              ) : null}
              <div className="hstack" style={{ justifyContent: 'space-between' }}>
                <button className="btn btn-ghost" onClick={() => setStep(4)}>
                  <Icon d={I.arrowleft} size={16} /> {t('book.back')}
                </button>
                <button
                  className="btn btn-primary"
                  style={{ background: accent }}
                  onClick={() => void confirm()}
                >
                  {t('book.bookIt')}
                </button>
              </div>
              <p className="muted" style={{ fontSize: 12, fontWeight: 500 }}>
                {t('book.releaseNote')}
              </p>
            </>
          ) : null}

          {step === 6 && done ? (
            <>
              <div
                style={{
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 0',
                }}
              >
                <span className="rb-check" style={{ background: `${accent}1f`, color: accent }}>
                  <Icon d={I.check} size={30} w={3} />
                </span>
                <h2 style={{ fontSize: 24, fontWeight: 700 }}>
                  {t('book.booked', { name: name.split(' ')[0] || t('book.thanks') })}
                </h2>
                <p className="muted" style={{ fontWeight: 500 }}>
                  {t('book.confirmationTo', { to: email || phone })}
                </p>
              </div>
              <div className="card" style={{ padding: '16px 18px' }}>
                <div className="kv">
                  <span className="k">{t('book.reference')}</span>
                  <span className="v tnum">{done.ref.toUpperCase().slice(-8)}</span>
                </div>
                <div className="kv">
                  <span className="k">{t('drawer.service')}</span>
                  <span className="v">{done.serviceName}</span>
                </div>
                <div className="kv">
                  <span className="k">{t('book.when')}</span>
                  <span className="v">
                    {dateFull(done.date)} · {done.time}–{done.end}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">{t('book.where')}</span>
                  <span className="v">{done.locationName}</span>
                </div>
                <div className="kv">
                  <span className="k">{t('book.with')}</span>
                  <span className="v">{done.employeeName}</span>
                </div>
                <div className="kv">
                  <span className="k">{t('till.total')}</span>
                  <span className="v">{money(done.price)}</span>
                </div>
              </div>
              <div className="note">
                {t('book.doneNote', { location: done.locationName, source: sourceLabel })}
              </div>
              <div className="hstack">
                <button className="btn btn-ghost" onClick={restart}>
                  {t('book.another')}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
      <p className="muted" style={{ textAlign: 'center', fontWeight: 500, marginTop: 16, fontSize: 13 }}>
        {t('book.footer')} <strong>{sourceLabel}</strong>
      </p>
    </div>
  );
}
