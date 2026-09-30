import { useState } from 'react';
import type { z } from 'zod';
import type { DiscoverySalonDetailSchema } from '@velnes/contracts';
import { t } from '../../lib/i18n-core.js';
import { useSalonReviews } from '../../lib/api/queries.js';
import { Stars } from '../../components/Stars.js';

type Detail = z.infer<typeof DiscoverySalonDetailSchema>;
const PAGE = 5;

/**
 * The salon page's Reviews card (Alex, 2026-09-30): the score, how many
 * verified visits it rests on, the three parts, the spread, then the
 * reviews newest first, five at a time. With none: says so, quietly.
 * Every review here came from a completed appointment — the badge on
 * each is the platform's word, not the reviewer's.
 */
export function SalonReviews({ d, idPrefix }: { d: Detail; idPrefix: string }) {
  const [limit, setLimit] = useState(PAGE);
  const page = useSalonReviews(d.slug, limit);
  const s = d.reviews;
  return (
    <div className="scard" id={`${idPrefix}-reviews`}>
      <h2>{t('c.rv.reviews')}</h2>
      {!s ? (
        <div className="rv-empty">
          <b>{t('c.rv.noneYet')}</b>
          <div className="sm muted">{t('c.rv.noneYetSub')}</div>
        </div>
      ) : (
        <>
          <div className="rv-head">
            <div className="rv-score">
              <b>{s.avg.toFixed(1)}</b>
              <Stars value={s.avg} size={16} />
              <span className="sm muted">{s.count === 1 ? t('c.rv.countOne') : t('c.rv.count', { n: s.count })} · {t('c.rv.verified').toLowerCase()}</span>
            </div>
            <div className="rv-dist" aria-hidden="true">
              {[5, 4, 3, 2, 1].map((star) => {
                const n = s.distribution[star - 1] ?? 0;
                return (
                  <div className="rv-bar" key={star}>
                    <span>{star}</span>
                    <i>
                      <b style={{ width: `${s.count ? (n / s.count) * 100 : 0}%` }} />
                    </i>
                    <span className="muted">{n}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="rv-dims">
            {(['service', 'timing', 'cleanliness'] as const).map((k) => (
              <div key={k}>
                <span className="sm muted">{t(`c.rv.${k}`)}</span>
                <b>{s[k].toFixed(1)}</b>
              </div>
            ))}
          </div>
          <div className="rv-list">
            {(page.data?.reviews ?? []).map((r) => (
              <article className="rv-item" key={r.id}>
                <div className="rv-item-h">
                  <Stars value={r.overall} size={14} />
                  <b>{r.reviewer}</b>
                  <span className="sm muted">{r.visitMonth}</span>
                </div>
                {r.body ? <p>{r.body}</p> : null}
                <div className="sm muted rv-item-f">
                  <span className="vok">✓</span> {t('c.rv.verified')}
                  {r.serviceName ? ` · ${r.serviceName}` : ''}
                  {r.professionalName ? ` · ${r.professionalName}` : ''}
                </div>
              </article>
            ))}
          </div>
          {page.data && page.data.total > page.data.reviews.length ? (
            <button type="button" className="about-more" onClick={() => setLimit((n) => n + PAGE)}>
              {t('c.rv.showMore')}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
