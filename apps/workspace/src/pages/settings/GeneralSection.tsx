import { useQuery } from '@tanstack/react-query';
import { AuditListResponseSchema } from '@velnes/contracts';
import { LANGS, type Lang } from '@velnes/i18n';
import { useTranslation } from 'react-i18next';
import { get, useSession } from '@velnes/client';
import { Field } from './bits.js';

/** Settings › General — the prototype's `general` panel. Language is
 *  the one real workspace choice; time zone lives on each location and
 *  currency is fixed for the MK release, so those render read-only
 *  rather than pretending to save. */
export function GeneralSection({ openEmployees }: { openEmployees: () => void }) {
  const { t, i18n } = useTranslation();
  const { setLang } = useSession();
  const audit = useQuery({
    queryKey: ['audit', 'mini'],
    queryFn: () => get(AuditListResponseSchema, '/audit?limit=5'),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="card">
        <div className="card-header">
          <h2>{t('gset.workspace')}</h2>
        </div>
        <div className="grid2" style={{ padding: 20 }}>
          <Field label={t('gset.language')}>
            <select
              className="select"
              style={{ width: '100%' }}
              value={i18n.language}
              onChange={(e) => void setLang(e.target.value as Lang)}
            >
              {LANGS.map((l) => (
                <option key={l} value={l}>
                  {t(`lang.${l}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('gset.timezone')} hint={t('gset.timezoneHint')}>
            <select className="select" style={{ width: '100%' }} disabled>
              <option>Europe/Skopje (CET)</option>
            </select>
          </Field>
          <Field label={t('gset.currency')} hint={t('gset.currencyHint')}>
            <select className="select" style={{ width: '100%' }} disabled>
              <option>{t('gset.denar')}</option>
            </select>
          </Field>
          <Field label={t('gset.weekStart')} hint={t('gset.weekStartHint')}>
            <select className="select" style={{ width: '100%' }} disabled>
              <option>{t('week.monday')}</option>
            </select>
          </Field>
        </div>
      </div>
      <div className="card">
        <div className="card-header">
          <h2>{t('gset.userAccounts')}</h2>
          <button className="btn btn-secondary btn-sm" onClick={openEmployees}>
            {t('gset.openEmployees')}
          </button>
        </div>
        <p className="muted" style={{ padding: '16px 20px', fontWeight: 500 }}>
          {t('gset.accountsPointer')}
        </p>
      </div>
      <div className="card">
        <div className="card-header">
          <h2>{t('gset.activityLog')}</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>{t('settings.when')}</th>
              <th>{t('settings.who')}</th>
              <th>{t('gset.what')}</th>
            </tr>
          </thead>
          <tbody>
            {(audit.data?.entries ?? []).map((e) => (
              <tr key={e.id}>
                <td className="muted tnum">{e.ts.slice(0, 16).replace('T', ' ')}</td>
                <td className="bold">{e.actorName}</td>
                <td>{e.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
