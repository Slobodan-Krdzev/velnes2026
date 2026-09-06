import { API_PREFIX, RegistrationImportResultSchema, type RegistrationImportResult } from '@velnes/contracts';
import { I, Icon, VelnesMark } from '@velnes/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { OB_PATTERN } from '../lib/obPattern.js';

type Stage = 'source' | 'reading' | 'ready';

/** The prototype's viewOnboarding source flow — a standalone
 *  AI-onboarding screen on /onboarding, its own `.obw`/`.obs` design.
 *  The owner pastes one link; the real import door reads the page's
 *  structured data; we show what it found, then hand a pre-filled draft
 *  to the registration wizard. Honest Phase 1: website only, no faked
 *  "building your marketplace" — the right pane stays a mood image. */
export function Onboarding() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('source');
  const [url, setUrl] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<RegistrationImportResult | null>(null);

  const hostOf = (u: string) => {
    try {
      return new URL(u.includes('://') ? u : `https://${u}`).hostname.replace(/^www\./, '');
    } catch {
      return u;
    }
  };
  const salonName = result?.salon.name || hostOf(url) || t('ob.yourSalon');

  const build = async () => {
    const clean = url.trim();
    if (!clean) return;
    setErr(null);
    setStage('reading');
    try {
      const res = await fetch(`${API_PREFIX}/registrations/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: clean.includes('://') ? clean : `https://${clean}` }),
      });
      if (!res.ok) {
        const e = (await res.json()) as { message?: string };
        setErr(e.message ?? t('ob.readErr'));
        setStage('source');
        return;
      }
      setResult(RegistrationImportResultSchema.parse(await res.json()));
      setStage('ready');
    } catch {
      setErr(t('ob.readErr'));
      setStage('source');
    }
  };

  const foundList = (loading: boolean) => {
    const r = result;
    const treatN = r?.serviceNames.length ?? 0;
    const rows = [
      { on: loading ? null : !!(r?.salon.name || r?.loc.city || r?.salon.phone), label: t('ob.rowDetails') },
      { on: loading ? null : treatN > 0, label: treatN ? t('ob.rowTreatmentsN', { n: treatN }) : t('ob.rowNoTreatments') },
      { on: loading ? null : (r?.hours.length ?? 0) > 0, label: (r?.hours.length ?? 0) > 0 ? t('ob.rowHours') : t('ob.rowNoHours') },
    ];
    return (
      <div className="ob-finds">
        {rows.map((row, i) => (
          <span key={i} className={`ob-find ${row.on === null ? '' : row.on ? 'on' : 'miss'}`}>
            {row.on === null ? (
              <i className="ring spin" />
            ) : row.on ? (
              <Icon d={I.check} size={15} w={2.8} />
            ) : (
              <Icon d={I.info} size={15} w={2.2} />
            )}
            {row.label}
          </span>
        ))}
      </div>
    );
  };

  const summary = (() => {
    const r = result;
    if (!r) return '';
    const bits = [
      r.serviceNames.length ? t('ob.rowTreatmentsN', { n: r.serviceNames.length }) : null,
      r.hours.length ? t('ob.rowHours').toLowerCase() : null,
      r.loc.city ? t('ob.address') : null,
    ].filter(Boolean);
    return bits.join(' · ') || t('ob.emptyStart');
  })();

  const missing = (() => {
    const r = result;
    if (!r) return [] as string[];
    const out: string[] = [];
    if (!r.hours.length) out.push(t('ob.rowHours'));
    if (!r.salon.phone) out.push(t('ob.phone'));
    return out;
  })();

  const goRegister = (imported?: RegistrationImportResult) =>
    navigate('/register', imported ? { state: { imported } } : undefined);

  const badge = (
    <span className="obs-badge">
      <Icon d={I.sparkle} size={15} w={1.9} /> {t('ob.badge')}
    </span>
  );

  return (
    <div className="obw" style={{ backgroundImage: `url("${OB_PATTERN}")` }}>
      <div className={`obs ob-st-${stage}`}>
        <div className="obs-left">
          <span className="obs-logo">
            <VelnesMark size={26} />
            <span className="w" style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.01em' }}>
              Velnes
            </span>
          </span>

          <div className="obs-mid">
            {stage === 'source' ? (
              <>
                {badge}
                <h1>
                  {t('ob.h1a')}
                  <br />
                  <em>{t('ob.h1b')}</em>
                </h1>
                <p className="lead">{t('ob.lead')}</p>
                <div className={`obq ${err ? 'bad' : ''}`}>
                  <input
                    className="obq-in"
                    placeholder="yoursalon.mk"
                    value={url}
                    autoComplete="url"
                    inputMode="url"
                    aria-label={t('ob.badge')}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void build()}
                  />
                  <button className="obq-go" aria-label={t('ob.buildAria')} onClick={() => void build()}>
                    <Icon d={I.sparkle} size={21} w={1.9} />
                  </button>
                </div>
                {err ? <p className="obs-err">{err}</p> : null}
                <p className="obs-alt">
                  {t('ob.noSite')} <button onClick={() => goRegister()}>{t('ob.fillYourself')}</button>
                </p>
                <p className="obs-alt">
                  {t('ob.prefer')} <button onClick={() => goRegister()}>{t('ob.classic')}</button>
                </p>
                <p className="obs-srcs">{t('ob.srcs')}</p>
              </>
            ) : null}

            {stage === 'reading' ? (
              <>
                {badge}
                <h1 className="sm">
                  {t('ob.settingUp')}
                  <br />
                  <em>{salonName}</em>
                </h1>
                <p className="lead">{t('ob.extracting')}</p>
                <span className="ob-urlok">
                  <Icon d={I.check} size={16} w={2.6} />
                  <span className="grow">{hostOf(url)}</span>
                  <Icon d={I.sparkle} size={15} w={1.9} />
                </span>
                {foundList(true)}
              </>
            ) : null}

            {stage === 'ready' ? (
              <>
                {badge}
                <h1 className="sm">
                  {t('ob.weRead')}
                  <br />
                  <em>{salonName}</em>
                </h1>
                <p className="lead">{t('ob.readBody', { salon: salonName })}</p>
                {foundList(false)}
                {summary ? <p className="ob-sum">{summary}</p> : null}
                {missing.length ? (
                  <p className="ob-miss">
                    <Icon d={I.info} size={14} /> {t('ob.missNote', { list: missing.join(t('ob.and')) })}
                  </p>
                ) : null}
                <button
                  className="btn btn-primary"
                  style={{ alignSelf: 'flex-start' }}
                  onClick={() => goRegister(result ?? undefined)}
                >
                  {t('ob.continue')} <Icon d={I.right} size={18} w={2.4} />
                </button>
              </>
            ) : null}
          </div>

          <div className="obs-foot">
            <span>Velnes · Skopje</span>
            <span style={{ flex: 1 }} />
            <button onClick={() => navigate('/login')}>{t('ob.leave')}</button>
          </div>
        </div>

        {/* The mood pane — a decorative preview, not the salon's own data. */}
        <div className="obs-right">
          <div className="obs-photos" aria-hidden="true">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className={`obs-photo f${n}`}
                style={{ backgroundImage: `url("/ob-faces/face${n}.webp")` }}
              />
            ))}
          </div>
          <div className="obs-veil" aria-hidden="true" />
          <div className="obs-cards" aria-hidden="true">
            <div className="obs-card c1">
              <span>
                <span>Physiotherapy session</span>
                <span className="s">45 min · 1.800 ден</span>
              </span>
            </div>
            <div className="obs-card c2">
              <span className="dot" />
              <span>
                <span>Booked online</span>
                <span className="s">Saturday 14:00 · Maria</span>
              </span>
            </div>
            <div className="obs-card c3">
              <span>
                <span>Rehab training</span>
                <span className="s">60 min · 1.500 ден</span>
              </span>
            </div>
            <div className="obs-card c4">
              <span className="dot" />
              <span>
                <span>Open today</span>
                <span className="s">09:00 – 19:00</span>
              </span>
            </div>
          </div>
          <span
            className="obs-ring"
            style={{ position: 'absolute', top: 18, right: 18, color: '#6f7357' }}
          >
            <span className="mk" style={{ display: 'inline-flex', color: '#6f7357' }}>
              <VelnesMark size={26} />
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
