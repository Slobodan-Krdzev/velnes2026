import { useQueryClient } from '@tanstack/react-query';
import { BusinessSettingsSchema, type BusinessSettings } from '@velnes/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { patch } from '@velnes/client';
import { useToast } from '../../lib/toast.js';
import { Field, ToggleRow, useBusiness, useBusinessSettings } from './bits.js';

/** Settings › Online marketplace — the prototype's `marketplace`
 *  panel. The choices are stored now and honored when search/discovery
 *  starts (§5 pending); the section says so instead of pretending a
 *  marketplace exists. Photos come from the Company gallery. */

const CATEGORIES = ['Physiotherapy', 'Rehab', 'Sports injury', 'Manual therapy', 'Dry needling'];
const LEADS = ['2 hours', 'Same day', '1 day'];
const CANCELS = ['24 hours before', '12 hours before', '2 hours before'];

export function MarketplaceSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const settings = useBusinessSettings();
  const business = useBusiness();
  const [mp, setMp] = useState<BusinessSettings['marketplace'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data && !mp) setMp(settings.data.marketplace);
  }, [settings.data, mp]);
  if (!mp) return null;

  const save = async (next: BusinessSettings['marketplace']) => {
    setError(null);
    setMp(next);
    try {
      await patch(BusinessSettingsSchema, '/business-settings', { marketplace: next });
      toast(t('mset.saved'));
      void qc.invalidateQueries({ queryKey: ['businessSettings'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const set = (part: Partial<BusinessSettings['marketplace']>) => void save({ ...mp, ...part });

  const b = business.data;
  const photos = b?.gallery ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="note">{t('mset.pendingNote')}</div>
      <div className="card">
        <div className="card-header">
          <h2>{t('mset.yourListing')}</h2>
          <span className={`badge ${mp.listed ? 'accent' : ''}`}>
            {mp.listed ? t('mset.live') : t('mset.hidden')}
          </span>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ToggleRow
            label={t('mset.showOnMarketplace')}
            hint={t('mset.showOnMarketplaceHint')}
            on={mp.listed}
            onChange={(v) => set({ listed: v })}
          />
          <div className="grid2">
            <Field label={t('mset.listingName')} req>
              <input className="input" value={b?.name ?? ''} disabled />
            </Field>
            <Field label={t('mset.marketplaceAddress')} hint={t('mset.addressHint')}>
              <input className="input" value={b?.slug ? `velnes.mk/skopje/${b.slug}` : '—'} disabled />
            </Field>
            <Field label={t('mset.pitch')} span hint={t('mset.pitchHint')}>
              <input
                className="input"
                value={mp.pitch}
                maxLength={70}
                onChange={(e) => setMp({ ...mp, pitch: e.target.value })}
                onBlur={() => void save(mp)}
              />
            </Field>
            <Field label={t('cset.publicDescription')} span>
              <textarea
                className="input"
                style={{ height: 96 }}
                value={mp.description}
                onChange={(e) => setMp({ ...mp, description: e.target.value })}
                onBlur={() => void save(mp)}
              />
            </Field>
          </div>
          <div>
            <span className="stat-label">{t('mset.photos')}</span>
            <div className="mp-photos">
              {photos.slice(0, 4).map((g, i) => (
                <div
                  key={g.id}
                  className={`mp-photo${i === 0 ? ' cover' : ''}`}
                  style={
                    g.img
                      ? { backgroundImage: `url(${g.img})`, backgroundSize: 'cover' }
                      : g.tone
                        ? { background: g.tone }
                        : undefined
                  }
                >
                  {i === 0 ? t('mset.cover') : ''}
                </div>
              ))}
              {photos.length < 4
                ? Array.from({ length: 4 - photos.length }, (_, i) => (
                    <div key={`empty-${i}`} className="mp-photo">
                      +
                    </div>
                  ))
                : null}
            </div>
            <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>
              {t('mset.photosHint')}
            </span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>{t('mset.whatPeopleSee')}</h2>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="field">
            <span>{t('mset.categories')}</span>
            <div className="chips" style={{ marginTop: 6 }}>
              {CATEGORIES.map((c) => {
                const on = mp.categories.includes(c);
                return (
                  <button
                    key={c}
                    className={`chip${on ? ' on' : ''}`}
                    onClick={() =>
                      set({
                        categories: on
                          ? mp.categories.filter((x) => x !== c)
                          : [...mp.categories, c],
                      })
                    }
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>
          <ToggleRow
            label={t('mset.showPrices')}
            hint={t('mset.showPricesHint')}
            on={mp.showPrices}
            onChange={(v) => set({ showPrices: v })}
          />
          <ToggleRow
            label={t('mset.showTeam')}
            hint={t('mset.showTeamHint')}
            on={mp.showTeam}
            onChange={(v) => set({ showTeam: v })}
          />
          <ToggleRow
            label={t('mset.showReviews')}
            hint={t('mset.showReviewsHint')}
            on={mp.showReviews}
            onChange={(v) => set({ showReviews: v })}
          />
          <p className="muted" style={{ fontWeight: 500, fontSize: 12 }}>
            {t('mset.perServiceNote')}
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>{t('mset.bookingsFrom')}</h2>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ToggleRow
            label={t('mset.autoConfirm')}
            hint={t('mset.autoConfirmHint')}
            on={mp.autoConfirm}
            onChange={(v) => set({ autoConfirm: v })}
          />
          <ToggleRow
            label={t('mset.depositNew')}
            hint={t('mset.depositNewHint')}
            on={mp.depositNew}
            onChange={(v) => set({ depositNew: v })}
          />
          <div className="grid2">
            <Field label={t('mset.deposit')} hint={t('mset.depositHint')}>
              <input
                className="input"
                type="number"
                value={mp.depositPct}
                style={{ width: 160 }}
                onChange={(e) => setMp({ ...mp, depositPct: Number(e.target.value) })}
                onBlur={() => void save(mp)}
              />
            </Field>
            <Field label={t('mset.minLead')}>
              <select
                className="select"
                style={{ width: '100%' }}
                value={mp.minLead}
                onChange={(e) => set({ minLead: e.target.value })}
              >
                {LEADS.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </Field>
            <Field label={t('mset.cancelUntil')}>
              <select
                className="select"
                style={{ width: '100%' }}
                value={mp.cancelUntil}
                onChange={(e) => set({ cancelUntil: e.target.value })}
              >
                {CANCELS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label={t('mset.commission')} hint={t('mset.commissionHint')}>
              <input className="input" value={t('mset.commissionValue')} disabled />
            </Field>
          </div>
        </div>
      </div>
      {error ? (
        <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
