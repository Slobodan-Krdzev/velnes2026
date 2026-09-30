import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { REVIEW_BODY_MAX, type ClientAppointmentSchema } from '@velnes/contracts';
import type { z } from 'zod';
import { t } from '../../lib/i18n-core.js';
import { ApiError } from '../../lib/api/client.js';
import { useSession } from '../../lib/api/session.js';
import { StarInput, Stars } from '../../components/Stars.js';

type Appt = z.infer<typeof ClientAppointmentSchema>;
type Dim = 'service' | 'timing' | 'cleanliness' | 'professional';
const DIMS: Dim[] = ['service', 'timing', 'cleanliness', 'professional'];

/**
 * "How was your visit?" — four whole-star questions and an optional
 * line or two, for one completed appointment (Alex, 2026-09-30). The
 * button waits for all four stars; the door checks everything again;
 * a double tap sends once because the button is busy and the server
 * keeps one review per visit anyway.
 */
export function ReviewForm({ a, onDone }: { a: Appt; onDone: () => void }) {
  const { api } = useSession();
  const qc = useQueryClient();
  const [stars, setStars] = useState<Record<Dim, number | null>>({ service: null, timing: null, cleanliness: null, professional: null });
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  /** Velnes Loyalty points the submission earned, from the door. */
  const [earned, setEarned] = useState(0);
  const complete = DIMS.every((d) => stars[d] != null);

  const submit = async () => {
    if (!complete || busy) return;
    setBusy(true);
    setErr('');
    try {
      const out = await api<{ loyaltyPoints?: number }>(`/me/appointments/${a.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ ...stars, body: body.trim() || undefined }),
      });
      setEarned(out.loyaltyPoints ?? 0);
      setDone(true);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['my-appointments'] }),
        qc.invalidateQueries({ queryKey: ['my-notifications'] }),
        qc.invalidateQueries({ queryKey: ['my-loyalty'] }),
      ]);
      onDone();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      setErr(code === 'ALREADY_REVIEWED' ? t('c.rv.already') : code === 'NOT_COMPLETED' ? t('c.rv.notCompleted') : t('c.rv.failed'));
      if (code === 'ALREADY_REVIEWED') await qc.invalidateQueries({ queryKey: ['my-appointments'] });
    }
    setBusy(false);
  };

  if (done)
    return (
      <div className="acc-card rv-done" role="status">
        <b>{t('c.rv.thanks')}</b>
        <div className="sm muted">{t('c.rv.thanksSub')}</div>
        {earned ? <div className="loy-earned">{t('c.loy.thanksPoints', { n: earned.toLocaleString() })}</div> : null}
      </div>
    );

  const hint = (d: Dim) =>
    d === 'professional'
      ? a.employeeName
        ? t('c.rv.professionalHint', { name: a.employeeName })
        : t('c.rv.professionalHintAnon')
      : t(`c.rv.${d}Hint`);

  return (
    <form
      className="acc-card rv-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3 className="serif">{t('c.rv.title')}</h3>
      <div className="sm muted rv-ctx">
        <b>{a.salonName}</b> · {a.serviceName} · {a.date} {a.time}
        {a.employeeName ? ` · ${a.employeeName}` : ''}
      </div>
      <p className="sm muted">{t('c.rv.sub')}</p>
      {DIMS.map((d) => (
        <div className="rv-q" key={d}>
          <div className="rv-qt">
            <b>{t(`c.rv.${d}`)}</b>
            <span className="sm muted">{hint(d)}</span>
          </div>
          <StarInput name={`rv-${d}`} value={stars[d]} onChange={(v) => setStars((s) => ({ ...s, [d]: v }))} label={t(`c.rv.${d}`)} />
        </div>
      ))}
      <label className="rv-body">
        <span>
          {t('c.rv.body')} <em className="muted">({t('c.rv.bodyOptional')})</em>
        </span>
        <textarea
          className="acc-inp"
          rows={4}
          maxLength={REVIEW_BODY_MAX}
          placeholder={t('c.rv.bodyPh')}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <span className="sm muted rv-count">
          {body.length}/{REVIEW_BODY_MAX}
        </span>
      </label>
      {err ? <div className="acc-err">{err}</div> : null}
      {!complete ? <div className="sm muted">{t('c.rv.needAll')}</div> : null}
      <button type="submit" className="btn btn-p" style={{ width: '100%' }} disabled={!complete || busy}>
        {busy ? t('c.rv.submitting') : t('c.rv.submit')}
      </button>
    </form>
  );
}

/** The review as it was given, under a past visit. */
export function ReviewGiven({ r }: { r: NonNullable<Appt['review']> }) {
  const rows: [Dim, number][] = [['service', r.service], ['timing', r.timing], ['cleanliness', r.cleanliness], ['professional', r.professional]];
  return (
    <div className="acc-card rv-given">
      <div className="acc-lbl">{t('c.rv.yours')}</div>
      {rows.map(([d, v]) => (
        <div className="acc-kv" key={d}>
          <span>{t(`c.rv.${d}`)}</span>
          <Stars value={v} size={14} />
        </div>
      ))}
      {r.body ? <p className="rv-text">“{r.body}”</p> : null}
      <div className="sm muted">
        <span className="vok">✓</span> {t('c.rv.verified')} · {r.at.slice(0, 10)}
      </div>
    </div>
  );
}
