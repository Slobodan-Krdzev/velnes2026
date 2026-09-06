import { API_PREFIX, RegistrationImportResultSchema, type RegistrationImportResult } from '@velnes/contracts';
import { I, Icon, VelnesMark } from '@velnes/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

type Stage = 'source' | 'reading' | 'ready';

/** The prototype's viewOnboarding — a standalone AI-onboarding screen
 *  (its own `.ob` design), on the workspace's /onboarding route. The
 *  owner pastes one link; the real import door reads the page's
 *  structured data, we show what it found, then hand a pre-filled draft
 *  to the registration wizard. Honest Phase 1: website only, no faked
 *  "building your marketplace" — what you see is what was read. */
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

  // The three things Phase 1 reads. `null` while reading, then on/miss.
  const rows = (loading: boolean) => {
    const r = result;
    const details = loading ? null : !!(r?.salon.name || r?.loc.city || r?.salon.phone);
    const treatN = r?.serviceNames.length ?? 0;
    const treatments = loading ? null : treatN > 0;
    const hasHours = (r?.hours.length ?? 0) > 0;
    const hours = loading ? null : hasHours;
    return [
      { on: details, label: t('ob.rowDetails') },
      { on: treatments, label: treatN ? t('ob.rowTreatmentsN', { n: treatN }) : t('ob.rowNoTreatments') },
      { on: hours, label: hasHours ? t('ob.rowHours') : t('ob.rowNoHours') },
    ];
  };

  const foundList = (loading: boolean) => (
    <div className="ob-finds">
      {rows(loading).map((row, i) => {
        const state = row.on === null ? 'ring' : row.on ? 'on' : 'miss';
        return (
          <span key={i} className={`ob-find ${state === 'on' ? 'on' : state === 'miss' ? 'miss' : ''}`}>
            {state === 'ring' ? (
              <i className="ring spin" />
            ) : state === 'miss' ? (
              <Icon d={I.info} size={15} w={2.2} />
            ) : (
              <Icon d={I.check} size={15} w={2.8} />
            )}
            {row.label}
          </span>
        );
      })}
    </div>
  );

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

  return (
    <div className="ob">
      <div className="ob-top">
        <VelnesMark size={30} />
        <span className="brand">Velnes</span>
        {stage !== 'source' ? (
          <span className="ob-pill">{stage === 'reading' ? t('ob.reading') : t('ob.draftReady')}</span>
        ) : null}
        <span className="grow" />
        <button className="btn btn-subtle btn-sm" onClick={() => navigate('/login')}>
          {t('ob.leave')}
        </button>
      </div>

      <div className="ob-body">
        {stage === 'source' ? (
          <div className="ob-narrow">
            <span className="obs-badge">
              <Icon d={I.sparkle} size={15} w={1.9} /> {t('ob.badge')}
            </span>
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
              {t('ob.noSite')}{' '}
              <button onClick={() => goRegister()}>{t('ob.fillYourself')}</button>
            </p>
            <p className="obs-alt">
              {t('ob.prefer')} <button onClick={() => goRegister()}>{t('ob.classic')}</button>
            </p>
            <p className="obs-srcs">{t('ob.srcs')}</p>
          </div>
        ) : null}

        {stage === 'reading' ? (
          <div className="ob-narrow">
            <span className="obs-badge">
              <Icon d={I.sparkle} size={15} w={1.9} /> {t('ob.badge')}
            </span>
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
          </div>
        ) : null}

        {stage === 'ready' ? (
          <div className="ob-narrow">
            <span className="obs-badge">
              <Icon d={I.sparkle} size={15} w={1.9} /> {t('ob.badge')}
            </span>
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
            <button className="btn btn-primary" onClick={() => goRegister(result ?? undefined)}>
              {t('ob.continue')} <Icon d={I.right} size={18} w={2.4} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
