import {
  REG_SERVICE_TEMPLATES,
  RegistrationCreateResponseSchema,
  RegistrationStatusResponseSchema,
  RegistrationStatusSchema,
  type RegistrationDraft,
} from '@velnes/contracts';
import { API_PREFIX } from '@velnes/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

/** The prototype's viewRegisterSalon: eight steps, one draft, the
 *  whole thing retained so "changes required" reopens the same
 *  wizard. Anonymous — no session anywhere near this. */

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_LABEL: Record<(typeof DAYS)[number], string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};
const money = (n: number) =>
  new Intl.NumberFormat('mk-MK', { style: 'currency', currency: 'MKD', maximumFractionDigits: 0 }).format(n);

type Day = { open: string; close: string; closed: boolean; split: boolean; open2: string; close2: string };
type Draft = {
  acct: { name: string; email: string; pass: string };
  salon: { name: string; type: string; phone: string; langs: string };
  legal: { name: string; taxId: string; vat: string; currency: string };
  loc: { street: string; no: string; city: string; zip: string; px: number; py: number; pinned: boolean; lat: number | null; lng: number | null };
  picks: Record<string, boolean>;
  gallery: { name: string; img: string | null }[];
  team: { name: string; email: string }[];
  hours: Record<(typeof DAYS)[number], Day>;
};
const newDraft = (): Draft => ({
  acct: { name: '', email: '', pass: '' },
  salon: { name: '', type: 'Physiotherapy', phone: '', langs: 'MK, EN' },
  legal: { name: '', taxId: '', vat: '', currency: 'MKD' },
  loc: { street: '', no: '', city: '', zip: '', px: 50, py: 50, pinned: false, lat: null, lng: null },
  picks: {},
  gallery: [],
  team: [{ name: '', email: '' }],
  hours: Object.fromEntries(
    DAYS.map((k) => [k, { open: '09:00', close: '19:00', closed: k === 'sun', split: false, open2: '15:00', close2: '19:00' }]),
  ) as Draft['hours'],
});

const STORE = 'velnes.reg';
type Stored = { id: string; token: string };
const stored = (): Stored | null => {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? 'null') as Stored | null;
  } catch {
    return null;
  }
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function Register() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [r, setR] = useState<Draft>(newDraft());
  const [step, setStep] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [phase, setPhase] = useState<'wizard' | 'done' | 'changes' | 'approved' | 'declined'>('wizard');
  const [ref, setRef] = useState<string | null>(null);
  const [hqReason, setHqReason] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);

  // A returning applicant: their token shows where the machine stands.
  useEffect(() => {
    const s = stored();
    if (!s) return;
    fetch(`${API_PREFIX}/registrations/${s.id}?token=${s.token}`)
      .then(async (res) => (res.ok ? RegistrationStatusResponseSchema.parse(await res.json()) : null))
      .then((row) => {
        if (!row) return localStorage.removeItem(STORE);
        setRef(row.id);
        if (row.status === 'changes_required') {
          setHqReason(row.hqReason);
          const d = row.draft;
          setR((prev) => ({
            ...prev,
            acct: { name: d.acct.name, email: d.acct.email, pass: '' },
            salon: d.salon,
            legal: d.legal,
            loc: {
              street: d.loc.street, no: d.loc.no, city: d.loc.city, zip: d.loc.zip,
              px: 50, py: 50, pinned: d.loc.lat != null, lat: d.loc.lat, lng: d.loc.lng,
            },
            picks: Object.fromEntries(d.services.map((k) => [k, true])),
            team: d.team.length ? d.team : [{ name: '', email: '' }],
            hours: d.hours as Draft['hours'],
          }));
          setPhase('changes');
        } else if (row.status === 'active') setPhase('approved');
        else if (row.status === 'declined') setPhase('declined');
        else setPhase('done');
      })
      .catch(() => undefined);
  }, []);

  const valid = (s: number): string | null => {
    if (s === 1) {
      if (!r.acct.name.trim()) return t('reg.vName');
      if (!EMAIL.test(r.acct.email)) return t('reg.vEmail');
      if (r.acct.pass.length < 6) return t('reg.vPass');
    }
    if (s === 2 && !r.salon.name.trim()) return t('reg.vSalon');
    if (s === 3) {
      if (!r.legal.name.trim()) return t('reg.vLegal');
      if (!r.legal.taxId.trim()) return t('reg.vTax');
    }
    if (s === 4) {
      if (!r.loc.street.trim() || !r.loc.city.trim()) return t('reg.vStreet');
      if (!r.loc.pinned) return t('reg.vPin');
    }
    if (s === 5 && !Object.values(r.picks).some(Boolean)) return t('reg.vServices');
    if (s === 7) {
      const bad = r.team.find((x) => x.email.trim() && !EMAIL.test(x.email.trim()));
      if (bad) return t('reg.vTeam', { email: bad.email });
    }
    if (s === 8) for (let i = 1; i <= 7; i++) { const m = valid(i); if (m) return m; }
    return null;
  };

  const toApi = (): RegistrationDraft => ({
    acct: r.acct,
    salon: r.salon,
    legal: r.legal,
    loc: { street: r.loc.street, no: r.loc.no, city: r.loc.city, zip: r.loc.zip, lat: r.loc.lat, lng: r.loc.lng },
    services: Object.keys(r.picks).filter((k) => r.picks[k]),
    gallery: r.gallery.map((g) => g.name),
    team: r.team.filter((x) => x.email.trim()).map((x) => ({ name: x.name, email: x.email })),
    hours: r.hours,
  });

  const submit = async () => {
    const bad = valid(8);
    if (bad) return setErr(bad);
    setErr(null);
    const s = stored();
    const url = fixing && s
      ? `${API_PREFIX}/registrations/${s.id}/resubmit?token=${s.token}`
      : `${API_PREFIX}/registrations`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toApi()),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      setErr(
        data.error === 'EMAIL_TAKEN' ? t('reg.emailTaken') : String(data.message ?? 'failed'),
      );
      return;
    }
    if (!fixing) {
      const out = RegistrationCreateResponseSchema.parse(data);
      localStorage.setItem(STORE, JSON.stringify({ id: out.id, token: out.resubmitToken }));
      setRef(out.id);
    } else {
      z.object({ id: z.uuid(), status: RegistrationStatusSchema }).parse(data);
    }
    setPhase('done');
  };

  const pin = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    // A zero-size rect (jsdom, hidden container) pins the centre.
    const rawX = rect.width ? ((e.clientX - rect.left) / rect.width) * 100 : 50;
    const rawY = rect.height ? ((e.clientY - rect.top) / rect.height) * 100 : 50;
    const px = Math.max(4, Math.min(96, rawX));
    const py = Math.max(6, Math.min(94, rawY));
    setR((d) => ({
      ...d,
      loc: {
        ...d.loc, px, py, pinned: true,
        lat: Math.round((42.05 - py * 0.0012) * 1e5) / 1e5,
        lng: Math.round((21.35 + px * 0.0015) * 1e5) / 1e5,
      },
    }));
  };

  if (phase === 'approved' || phase === 'declined')
    return (
      <Centered>
        <h1 style={{ margin: '0 0 8px' }}>{t(phase === 'approved' ? 'reg.approvedTitle' : 'reg.declinedTitle')}</h1>
        <p className="muted" style={{ fontWeight: 500 }}>
          {t(phase === 'approved' ? 'reg.approvedBody' : 'reg.declinedBody')}
        </p>
        <button
          className="btn btn-primary"
          onClick={() => {
            localStorage.removeItem(STORE);
            navigate('/login');
          }}
        >
          {t('reg.backToSignIn')}
        </button>
      </Centered>
    );

  if (phase === 'changes' && !fixing)
    return (
      <Centered wide>
        <h1 style={{ margin: '0 0 8px' }}>{t('reg.changesTitle')}</h1>
        <div className="note warn" style={{ textAlign: 'left', margin: '12px 0' }}>
          <b>{t('reg.reason')}</b> {hqReason ?? '—'}
        </div>
        <p className="muted" style={{ fontWeight: 500 }}>{t('reg.changesBody')}</p>
        <p className="muted" style={{ fontWeight: 500, fontSize: 13 }}>{t('reg.passAgain')}</p>
        <button className="btn btn-primary" onClick={() => { setFixing(true); setStep(1); setPhase('wizard'); }}>
          {t('reg.editResubmit')}
        </button>
      </Centered>
    );

  if (phase === 'done')
    return (
      <Centered>
        <h1 style={{ margin: '0 0 8px' }}>{t('reg.almostThere')}</h1>
        <p className="muted" style={{ fontWeight: 500 }}>
          {t('reg.doneBody', { ref: (ref ?? '').slice(0, 8) })}
        </p>
        <div style={{ textAlign: 'left', margin: '14px 0' }} className="stacked">
          <div className="kv">
            <span className="k">{t('reg.doneMail')}</span>
            <span className="v">{t('reg.doneMailV')}</span>
          </div>
          <div className="kv">
            <span className="k">{t('reg.doneHq')}</span>
            <span className="v">{t('reg.doneHqV')}</span>
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/login')}>
          {t('reg.backToSignIn')}
        </button>
      </Centered>
    );

  const steps = [
    t('reg.stepAccount'), t('reg.stepSalon'), t('reg.stepLegal'), t('reg.stepLocation'),
    t('reg.stepServices'), t('reg.stepGallery'), t('reg.stepTeamHours'), t('reg.stepReview'),
  ];
  const F = (
    label: string,
    value: string,
    set: (v: string) => void,
    opts: { type?: string; ph?: string } = {},
  ) => (
    <label className="field">
      <span>{label}</span>
      <input
        className="input"
        type={opts.type}
        value={value}
        placeholder={opts.ph}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );
  const groups = [...new Set(REG_SERVICE_TEMPLATES.map((s) => s.category))]
    .map((cat) => ({
      cat,
      items: REG_SERVICE_TEMPLATES.filter(
        (s) =>
          s.category === cat &&
          (!q || (s.name + s.category).toLowerCase().replace(/\s+/g, '').includes(q.toLowerCase().replace(/\s+/g, ''))),
      ),
    }))
    .filter((g) => g.items.length);
  const picked = Object.keys(r.picks).filter((k) => r.picks[k]).length;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface-muted)', padding: '24px 12px', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: 'min(680px,96vw)' }}>
        <div className="hstack" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h1 style={{ margin: 0 }}>{t('reg.title')}</h1>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/login')}>
            {t('reg.haveAccount')}
          </button>
        </div>
        <div className="chips" style={{ marginBottom: 14 }}>
          {steps.map((s, i) => (
            <button
              key={s}
              className={`chip ${step === i + 1 ? 'on' : ''}`}
              disabled={i + 1 > step}
              onClick={() => setStep(i + 1)}
            >
              {i + 1} · {s}
            </button>
          ))}
        </div>
        <div className="card" style={{ padding: 22 }}>
          {step === 1 ? (
            <>
              <div className="grid2">
                {F(t('reg.yourName'), r.acct.name, (v) => setR((d) => ({ ...d, acct: { ...d.acct, name: v } })))}
                {F(t('reg.email'), r.acct.email, (v) => setR((d) => ({ ...d, acct: { ...d.acct, email: v } })), { ph: 'you@salon.mk' })}
                {F(t('reg.password'), r.acct.pass, (v) => setR((d) => ({ ...d, acct: { ...d.acct, pass: v } })), { type: 'password' })}
              </div>
              <div className="note">{t('reg.emailNote')}</div>
            </>
          ) : null}

          {step === 2 ? (
            <div className="grid2">
              {F(t('reg.salonName'), r.salon.name, (v) => setR((d) => ({ ...d, salon: { ...d.salon, name: v } })))}
              {F(t('reg.phone'), r.salon.phone, (v) => setR((d) => ({ ...d, salon: { ...d.salon, phone: v } })))}
              <div className="field">
                <label>{t('reg.type')}</label>
                <select
                  className="select"
                  value={r.salon.type}
                  onChange={(e) => setR((d) => ({ ...d, salon: { ...d.salon, type: e.target.value } }))}
                >
                  {['Physiotherapy', 'Beauty salon', 'Wellness & spa', 'Barbershop', 'Nails'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </div>
              {F(t('reg.languages'), r.salon.langs, (v) => setR((d) => ({ ...d, salon: { ...d.salon, langs: v } })))}
            </div>
          ) : null}

          {step === 3 ? (
            <>
              <div className="grid2">
                {F(t('reg.legalName'), r.legal.name, (v) => setR((d) => ({ ...d, legal: { ...d.legal, name: v } })), { ph: '… DOOEL Skopje' })}
                {F(t('reg.taxNumber'), r.legal.taxId, (v) => setR((d) => ({ ...d, legal: { ...d.legal, taxId: v } })), { ph: 'MK403…' })}
                {F(t('reg.vatReg'), r.legal.vat, (v) => setR((d) => ({ ...d, legal: { ...d.legal, vat: v } })))}
                {F(t('reg.currency'), r.legal.currency, (v) => setR((d) => ({ ...d, legal: { ...d.legal, currency: v } })))}
              </div>
              <div className="note">{t('reg.legalNote')}</div>
            </>
          ) : null}

          {step === 4 ? (
            <>
              <div className="grid2">
                {F(t('reg.street'), r.loc.street, (v) => setR((d) => ({ ...d, loc: { ...d.loc, street: v } })))}
                {F(t('reg.number'), r.loc.no, (v) => setR((d) => ({ ...d, loc: { ...d.loc, no: v } })))}
                {F(t('reg.city'), r.loc.city, (v) => setR((d) => ({ ...d, loc: { ...d.loc, city: v } })))}
                {F(t('reg.zip'), r.loc.zip, (v) => setR((d) => ({ ...d, loc: { ...d.loc, zip: v } })))}
              </div>
              <div className="field" style={{ marginTop: 8 }}>
                <label>{t('reg.pinLabel')}</label>
                <div
                  onClick={pin}
                  data-testid="regmap"
                  style={{
                    position: 'relative', height: 220, border: '1px solid var(--line)', borderRadius: 12,
                    cursor: 'crosshair', overflow: 'hidden',
                    background:
                      'repeating-linear-gradient(0deg,var(--surface-muted) 0 34px,var(--line) 34px 35px),repeating-linear-gradient(90deg,var(--surface-muted) 0 46px,var(--line) 46px 47px)',
                  }}
                >
                  <span className="muted" style={{ position: 'absolute', left: 10, top: 8, fontSize: 12, fontWeight: 600 }}>
                    {t('reg.demoMap')}
                  </span>
                  <span
                    style={{
                      position: 'absolute', left: `${r.loc.px}%`, top: `${r.loc.py}%`,
                      transform: 'translate(-50%,-100%)', fontSize: 22, opacity: r.loc.pinned ? 1 : 0.35,
                    }}
                  >
                    📍
                  </span>
                </div>
                <span className="muted tnum" style={{ fontSize: 12, fontWeight: 600 }}>
                  {r.loc.pinned ? `${r.loc.lat}, ${r.loc.lng}` : t('reg.pinHint')}
                </span>
              </div>
              <div className="note">{t('reg.pinNote')}</div>
            </>
          ) : null}

          {step === 5 ? (
            <>
              <div className="field">
                <label>{t('common.search')}</label>
                <input className="input" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              {groups.map((g) => (
                <div key={g.cat} style={{ marginBottom: 10 }}>
                  <div className="stat-label" style={{ marginBottom: 6 }}>{g.cat}</div>
                  {g.items.map((s) => (
                    <label key={s.key} className="hstack" style={{ gap: 10, cursor: 'pointer', marginBottom: 4 }}>
                      <input
                        type="checkbox"
                        checked={!!r.picks[s.key]}
                        onChange={() => setR((d) => ({ ...d, picks: { ...d.picks, [s.key]: !d.picks[s.key] } }))}
                      />
                      <span style={{ fontWeight: 600 }}>{s.name}</span>
                      <span className="muted tnum" style={{ marginLeft: 'auto' }}>{money(s.price)}</span>
                    </label>
                  ))}
                </div>
              ))}
              <div className="note">{t('reg.pickServices')}</div>
            </>
          ) : null}

          {step === 6 ? (
            <>
              <div className="grid2" style={{ gap: 10 }}>
                {r.gallery.map((g, i) => (
                  <div
                    key={i}
                    style={{
                      position: 'relative', borderRadius: 12, overflow: 'hidden',
                      border: '1px solid var(--line)', aspectRatio: '4/3',
                      background: g.img ? 'none' : '#6f7357',
                    }}
                  >
                    {g.img ? (
                      <img src={g.img} alt={g.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : null}
                    <span style={{ position: 'absolute', left: 8, bottom: 6, fontSize: 12, fontWeight: 700, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,.5)' }}>
                      {g.name}
                    </span>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ position: 'absolute', top: 4, right: 4, color: '#fff' }}
                      onClick={() => setR((d) => ({ ...d, gallery: d.gallery.filter((_, j) => j !== i) }))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <label
                  className="hstack"
                  style={{
                    border: '1px dashed var(--line)', borderRadius: 12, aspectRatio: '4/3',
                    alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                    fontWeight: 600, color: 'var(--ink-muted)',
                  }}
                >
                  {t('reg.addPhoto')}
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      const reader = new FileReader();
                      reader.onload = () =>
                        setR((d) => ({
                          ...d,
                          gallery: [...d.gallery, { name: f.name.replace(/\.[^.]+$/, ''), img: String(reader.result) }],
                        }));
                      reader.readAsDataURL(f);
                    }}
                  />
                </label>
              </div>
              <div className="note">{t('reg.galleryNote')}</div>
            </>
          ) : null}

          {step === 7 ? (
            <div className="stacked">
              <div>
                <div className="stat-label" style={{ marginBottom: 6 }}>{t('reg.inviteTeam')}</div>
                {r.team.map((m, i) => (
                  <div key={i} className="hstack" style={{ gap: 8, marginBottom: 6 }}>
                    <input
                      className="input"
                      placeholder={t('reg.name')}
                      value={m.name}
                      onChange={(e) => setR((d) => ({ ...d, team: d.team.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) }))}
                    />
                    <input
                      className="input"
                      placeholder="email@…"
                      value={m.email}
                      onChange={(e) => setR((d) => ({ ...d, team: d.team.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)) }))}
                    />
                    {r.team.length > 1 ? (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setR((d) => ({ ...d, team: d.team.filter((_, j) => j !== i) }))}
                      >
                        {t('reg.remove')}
                      </button>
                    ) : null}
                  </div>
                ))}
                <button
                  className="btn btn-subtle btn-sm"
                  onClick={() => setR((d) => ({ ...d, team: [...d.team, { name: '', email: '' }] }))}
                >
                  {t('reg.addAnother')}
                </button>
                <div className="note" style={{ marginTop: 8 }}>{t('reg.inviteNote')}</div>
              </div>
              <div>
                <div className="stat-label" style={{ margin: '10px 0 6px' }}>{t('reg.openingHours')}</div>
                {DAYS.map((k) => {
                  const d = r.hours[k];
                  const setDay = (patch: Partial<Day>) =>
                    setR((prev) => ({ ...prev, hours: { ...prev.hours, [k]: { ...prev.hours[k], ...patch } } }));
                  return (
                    <div key={k} className="hstack" style={{ gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span style={{ width: 90, fontWeight: 600 }}>{DAY_LABEL[k]}</span>
                      <label className="hstack" style={{ gap: 6 }}>
                        <input type="checkbox" checked={d.closed} onChange={() => setDay({ closed: !d.closed })} />
                        <span className="muted" style={{ fontWeight: 500 }}>{t('reg.closed')}</span>
                      </label>
                      {d.closed ? null : (
                        <>
                          <input className="input" style={{ width: 86 }} value={d.open} onChange={(e) => setDay({ open: e.target.value })} />
                          <span className="muted">–</span>
                          <input className="input" style={{ width: 86 }} value={d.close} onChange={(e) => setDay({ close: e.target.value })} />
                          {d.split ? (
                            <>
                              <span className="muted" style={{ fontWeight: 500 }}>{t('reg.and')}</span>
                              <input className="input" style={{ width: 86 }} value={d.open2} onChange={(e) => setDay({ open2: e.target.value })} />
                              <span className="muted">–</span>
                              <input className="input" style={{ width: 86 }} value={d.close2} onChange={(e) => setDay({ close2: e.target.value })} />
                              <button className="btn btn-ghost btn-sm" onClick={() => setDay({ split: false })}>{t('reg.noSplit')}</button>
                            </>
                          ) : (
                            <button className="btn btn-ghost btn-sm" onClick={() => setDay({ split: true })}>{t('reg.split')}</button>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
                <div className="note">{t('reg.splitNote')}</div>
              </div>
            </div>
          ) : null}

          {step === 8 ? (
            <div className="stacked">
              {(
                [
                  [1, t('reg.stepAccount'), `${r.acct.name} · ${r.acct.email}`],
                  [2, t('reg.stepSalon'), `${r.salon.name} · ${r.salon.type}`],
                  [3, t('reg.stepLegal'), `${r.legal.name} · ${r.legal.taxId}`],
                  [4, t('reg.stepLocation'), `${r.loc.street} ${r.loc.no}, ${r.loc.city}${r.loc.pinned ? ` · pin ${r.loc.lat}, ${r.loc.lng}` : ''}`],
                  [5, t('reg.stepServices'), t('reg.selectedN', { n: picked })],
                  [6, t('reg.stepGallery'), t('reg.photosN', { n: r.gallery.length })],
                  [7, t('reg.stepTeamHours'), t('reg.invitedN', { n: r.team.filter((x) => x.email.trim()).length })],
                ] as [number, string, string][]
              ).map(([nStep, title, v]) => (
                <div className="kv" key={nStep}>
                  <span className="k">{title}</span>
                  <span className="v">
                    {v}{' '}
                    <button className="btn btn-ghost btn-sm" onClick={() => setStep(nStep)}>
                      {t('reg.edit')}
                    </button>
                  </span>
                </div>
              ))}
              <div className="note">{t('reg.reviewNote')}</div>
            </div>
          ) : null}

          {err ? (
            <div className="note" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', marginTop: 12 }}>
              {err}
            </div>
          ) : null}
          <div className="hstack" style={{ justifyContent: 'space-between', marginTop: 18 }}>
            <button className="btn btn-subtle" disabled={step === 1} onClick={() => setStep((s) => s - 1)}>
              {t('reg.back')}
            </button>
            {step < 8 ? (
              <button
                className="btn btn-primary"
                onClick={() => {
                  const bad = valid(step);
                  if (bad) return setErr(bad);
                  setErr(null);
                  setStep((s) => s + 1);
                }}
              >
                {t('reg.next')}
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => void submit()}>
                {fixing ? t('reg.resubmit') : t('reg.submit')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Centered({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-muted)' }}>
      <div className="card" style={{ width: `min(${wide ? 560 : 520}px,94vw)`, padding: 28, textAlign: 'center' }}>
        {children}
      </div>
    </div>
  );
}
