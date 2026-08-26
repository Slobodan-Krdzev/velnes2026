import { useQueryClient } from '@tanstack/react-query';
import { BusinessSettingsSchema, RANK_KEYS } from '@velnes/contracts';
import { useTranslation } from 'react-i18next';
import { patch } from '@velnes/client';
import { useToast } from '../../lib/toast.js';
import { Checkrow, useBusinessSettings } from './bits.js';

/** Settings › Ranking settings — the prototype's setRanking(): the
 *  explainer, the criteria grid, and the "at least one stays on"
 *  rule (the contract refuses an empty list). */
export function RankingSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const settings = useBusinessSettings();

  const chosen = settings.data?.ranking.criteria ?? [];

  const toggle = async (key: (typeof RANK_KEYS)[number]) => {
    const next = chosen.includes(key) ? chosen.filter((k) => k !== key) : [...chosen, key];
    if (!next.length) return; // at least one stays on
    await patch(BusinessSettingsSchema, '/business-settings', { ranking: { criteria: next } });
    toast(t('rset.saved'));
    void qc.invalidateQueries({ queryKey: ['businessSettings'] });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="card">
        <div className="card-header">
          <h2>{t('rset.howItWorks')}</h2>
          <span className="badge accent">
            {t('rset.inUse', { n: chosen.length, total: RANK_KEYS.length })}
          </span>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p className="muted" style={{ fontWeight: 500 }}>
            {t('rset.explain1')}
          </p>
          <p className="muted" style={{ fontWeight: 500 }}>
            {t('rset.explain2')}
          </p>
          <div className="note">{t('rset.nextBoard')}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>{t('rset.whatCounts')}</h2>
          <span className="muted" style={{ fontWeight: 500 }}>
            {t('rset.tickAll')}
          </span>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="grid2" style={{ gap: 10 }}>
            {RANK_KEYS.map((k) => (
              <Checkrow
                key={k}
                on={chosen.includes(k)}
                label={t(`rset.${k}`)}
                hint={t(`rset.${k}_hint`)}
                onToggle={() => void toggle(k)}
              />
            ))}
          </div>
          <p className="muted" style={{ fontWeight: 500, fontSize: 12 }}>
            {t('rset.atLeastOne')}
          </p>
        </div>
      </div>
    </div>
  );
}
