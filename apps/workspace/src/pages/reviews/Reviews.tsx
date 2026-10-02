import { useQuery } from '@tanstack/react-query';
import { WorkspaceReviewsPageSchema, WorkspaceReviewsSummarySchema } from '@velnes/contracts';
import { get } from '@velnes/client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useLocations } from '../../api/queries.js';
import './reviews.css';

/**
 * Reviews (Alex, 2026-09-30): Marketing › Reviews — what customers said
 * after completed appointments: the salon's score, its parts, each
 * professional's own score, and the list. Read-only: nothing here edits, hides or deletes
 * a review, and there is no door that could. A `?review=` in the URL
 * (the bell's notice) opens with that one highlighted.
 */
const STAR = (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" /></svg>
);
export function WsStars({ value, size = 14 }: { value: number; size?: number }) {
  const { t } = useTranslation();
  return (
    <span className="wstars" role="img" aria-label={t('c.rv.stars', { n: value })} style={{ ['--star' as string]: `${size}px` }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className="wstar" style={{ ['--fill' as string]: `${Math.max(0, Math.min(1, value - (i - 1))) * 100}%` }}>
          <span className="off">{STAR}</span>
          <span className="on">{STAR}</span>
        </span>
      ))}
    </span>
  );
}

export function useReviewSummary(enabled = true) {
  return useQuery({ queryKey: ['reviews-summary'], queryFn: () => get(WorkspaceReviewsSummarySchema, '/reviews/summary'), enabled, staleTime: 30_000 });
}

export function ReviewsPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const highlight = params.get('review');
  const [loc, setLoc] = useState('');
  const [emp, setEmp] = useState('');
  const [stars, setStars] = useState('');
  const [limit, setLimit] = useState(20);
  const summary = useReviewSummary();
  const locations = useLocations();
  const qs = new URLSearchParams();
  if (loc) qs.set('locationId', loc);
  if (emp) qs.set('employeeId', emp);
  if (stars) qs.set('stars', stars);
  qs.set('limit', String(limit));
  const list = useQuery({
    queryKey: ['reviews', loc, emp, stars, limit],
    queryFn: () => get(WorkspaceReviewsPageSchema, `/reviews?${qs.toString()}`),
    staleTime: 15_000,
  });
  const s = summary.data;
  const none = s && s.count === 0;
  const filtered = Boolean(loc || emp || stars);

  return (
    <div className="rvw">
      <div>
        <div className="card-header">
          <h2>{t('rvw.title')}</h2>
          <span className="muted" style={{ fontWeight: 500 }}>{t('rvw.readOnly')}</span>
        </div>
        {none ? (
          <div className="empty">
            <h3>{t('rvw.empty')}</h3>
            <p>{t('rvw.emptySub')}</p>
          </div>
        ) : s ? (
          <div className="rvw-summary">
            <div className="rvw-score">
              <div className="rvw-big">{s.avg.toFixed(1)}</div>
              <WsStars value={s.avg} size={18} />
              <div className="muted">{s.count === 1 ? t('rvw.verifiedOne') : t('rvw.verifiedCount', { n: s.count })}</div>
            </div>
            <div className="rvw-dims">
              {(['service', 'timing', 'cleanliness'] as const).map((k) => (
                <div key={k} className="rvw-dim">
                  <span className="muted">{t(`rvw.${k}`)}</span>
                  <b>{s[k].toFixed(1)}</b>
                  <WsStars value={s[k]} size={12} />
                </div>
              ))}
            </div>
            <div className="rvw-dist">
              {[5, 4, 3, 2, 1].map((star) => (
                <div className="rvw-bar" key={star}>
                  <span>{star} ★</span>
                  <i><b style={{ width: `${s.count ? ((s.distribution[star - 1] ?? 0) / s.count) * 100 : 0}%` }} /></i>
                  <span className="muted">{s.distribution[star - 1] ?? 0}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {s && s.count > 0 ? (
        <div className="grid2 rvw-cols">
          <div>
            <div className="card-header"><h2>{t('rvw.byProfessional')}</h2></div>
            <table className="tbl">
              <tbody>
                {s.employees.map((e) => (
                  <tr key={e.id}>
                    <td className="bold">{e.name}</td>
                    <td><WsStars value={e.avg} /></td>
                    <td className="tnum"><b>{e.avg.toFixed(1)}</b></td>
                    <td className="muted tnum">{e.count === 1 ? t('rvw.ratingOne') : t('rvw.ratings', { n: e.count })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="card-header"><h2>{t('rvw.byLocation')}</h2></div>
            <table className="tbl">
              <tbody>
                {s.locations.map((l) => (
                  <tr key={l.id}>
                    <td className="bold">{l.name}</td>
                    <td><WsStars value={l.avg} /></td>
                    <td className="tnum"><b>{l.avg.toFixed(1)}</b></td>
                    <td className="muted tnum">{l.count === 1 ? t('rvw.ratingOne') : t('rvw.ratings', { n: l.count })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {!none ? (
        <div>
          <div className="card-header">
            <h2>{t('rvw.list')}</h2>
            <div className="rvw-filters">
              <label>
                <span className="muted">{t('rvw.filterLocation')}</span>
                <select className="cell sel" value={loc} onChange={(e) => setLoc(e.target.value)}>
                  <option value="">{t('rvw.any')}</option>
                  {(locations.data?.locations ?? []).map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="muted">{t('rvw.filterEmployee')}</span>
                <select className="cell sel" value={emp} onChange={(e) => setEmp(e.target.value)}>
                  <option value="">{t('rvw.any')}</option>
                  {(s?.employees ?? []).map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="muted">{t('rvw.filterStars')}</span>
                <select className="cell sel" value={stars} onChange={(e) => setStars(e.target.value)}>
                  <option value="">{t('rvw.any')}</option>
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>{n} ★</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          {list.data && list.data.reviews.length === 0 ? (
            <div className="empty"><p>{filtered ? t('rvw.noMatch') : t('rvw.emptySub')}</p></div>
          ) : null}
          <div className="rvw-list">
            {(list.data?.reviews ?? []).map((r) => (
              <article key={r.id} className={`rvw-item${r.id === highlight ? ' hl' : ''}${r.ratingStatus === 'void' ? ' void' : ''}`} id={`review-${r.id}`}>
                <div className="rvw-item-h">
                  <WsStars value={r.overall} size={16} />
                  <b>{r.overall.toFixed(1)}</b>
                  <span className="muted">{r.customerName}</span>
                  {r.ratingStatus === 'void' ? <span className="badge warning">{t('rvw.void')}</span> : null}
                </div>
                <div className="rvw-item-d">
                  <span>{t('rvw.service')} <b>{r.service}</b></span>
                  <span>{t('rvw.timing')} <b>{r.timing}</b></span>
                  <span>{t('rvw.cleanliness')} <b>{r.cleanliness}</b></span>
                  <span>{t('rvw.professional')} <b>{r.professional}</b></span>
                </div>
                {r.body ? (
                  r.bodyStatus === 'hidden' ? <p className="muted"><em>{t('rvw.hiddenBody')}</em></p> : <p>“{r.body}”</p>
                ) : null}
                <div className="rvw-item-f muted">
                  {r.serviceName ?? '—'} · {r.employeeName ?? '—'} · {r.locationName} · {t('rvw.visit')} {r.appointmentDate} · {t('rvw.reviewed')} {r.at.slice(0, 10)}
                </div>
              </article>
            ))}
          </div>
          {list.data && list.data.total > list.data.reviews.length ? (
            <div style={{ padding: '0 20px 16px' }}>
              <button className="btn btn-secondary" onClick={() => setLimit((n) => n + 20)}>{t('rvw.more')}</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
