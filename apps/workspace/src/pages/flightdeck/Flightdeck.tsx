import { useQuery, useQueryClient } from '@tanstack/react-query';
import { InvoiceListResponseSchema, TimingSuggestionsResponseSchema } from '@velnes/contracts';
import { I, Icon } from '@velnes/ui';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { get, post } from '../../api/client.js';
import { useAppointments, useLocations } from '../../api/queries.js';
import { money } from '../../lib/money.js';
import { useToast } from '../../lib/toast.js';
import { useSession } from '../../session.js';
import { useScope } from '../../shell/Shell.js';
import { localIso } from '../calendar/Calendar.js';

/** Flightdeck: today's numbers from real data, plus the timing
 *  suggestions stack ("Velnes suggests 50 min") as the action queue.
 *  Premium/member cards arrive with Phase 9. */
export function FlightdeckPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { me, can } = useSession();
  const { scope } = useScope();
  const locations = useLocations();

  const myLocs = useMemo(() => {
    const all = locations.data?.locations ?? [];
    return me?.locationIds.length ? all.filter((l) => me.locationIds.includes(l.id)) : all;
  }, [locations.data, me]);
  const loc = scope !== 'all' ? scope : (myLocs[0]?.id ?? null);
  const today = localIso(new Date());
  const appts = useAppointments(loc, today, today);
  const invoices = useQuery({
    queryKey: ['invoices', 'today'],
    queryFn: () => get(InvoiceListResponseSchema, '/invoices?limit=100'),
  });
  const suggestions = useQuery({
    queryKey: ['timingSuggestions'],
    queryFn: () => get(TimingSuggestionsResponseSchema, '/timings/suggestions'),
    enabled: can('ranking.manage') || me?.access === 'owner',
  });

  const todays = (appts.data?.appointments ?? []).filter(
    (a) => a.kind === 'appointment' && a.status !== 'cancelled',
  );
  const revToday = (invoices.data?.invoices ?? [])
    .filter((i) => i.date === today && i.status === 'Paid')
    .reduce((s, i) => s + i.total, 0);

  const act = async (id: string, action: 'approve' | 'dismiss') => {
    await post(z.object({ ok: z.literal(true) }), `/timings/${id}/${action}`, {});
    toast(action === 'approve' ? t('fd.timingApproved') : t('fd.timingDismissed'));
    void qc.invalidateQueries({ queryKey: ['timingSuggestions'] });
  };

  return (
    <div className="stacked">
      <div className="grid4 fd-pulse">
        <div className="stat">
          <span className="stat-label">{t('fd.apptsToday')}</span>
          <span className="stat-value">{todays.length}</span>
          <span className="stat-hint">
            {todays.filter((a) => a.status === 'confirmed').length} {t('fd.confirmed')}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">{t('fd.revenueToday')}</span>
          <span className="stat-value">{money(revToday)}</span>
          <span className="stat-hint">
            {(invoices.data?.invoices ?? []).filter((i) => i.date === today).length}{' '}
            {t('fd.salesToday')}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">{t('fd.nextUp')}</span>
          <span className="stat-value tnum">
            {todays.find((a) => a.start >= new Date().toTimeString().slice(0, 5))?.start ?? '—'}
          </span>
          <span className="stat-hint">
            {todays.find((a) => a.start >= new Date().toTimeString().slice(0, 5))?.title ?? t('fd.dayDone')}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">{t('fd.suggestions')}</span>
          <span className="stat-value">{suggestions.data?.suggestions.length ?? 0}</span>
          <span className="stat-hint">{t('fd.timingStack')}</span>
        </div>
      </div>

      {suggestions.data?.suggestions.length ? (
        <div className="card">
          <div className="card-header">
            <h2>{t('fd.timingTitle')}</h2>
            <span className="muted" style={{ fontWeight: 500 }}>
              {t('fd.timingSub')}
            </span>
          </div>
          {suggestions.data.suggestions.map((s) => (
            <div key={s.id} className="rowcard">
              <span className="grow">
                <span className="t">
                  {s.employeeName} · {s.serviceName}
                </span>
                <span className="s">
                  {t('fd.timingLine', {
                    current: s.currentMin ?? '—',
                    suggested: s.recommendedMin ?? '—',
                    n: s.observedN,
                  })}
                </span>
              </span>
              <button className="btn btn-secondary btn-sm" onClick={() => void act(s.id, 'dismiss')}>
                {t('fd.dismiss')}
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => void act(s.id, 'approve')}>
                {t('fd.approve')}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="card">
        <div className="card-header">
          <h2>{t('fd.todaysAppointments')}</h2>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/calendar')}>
            {t('nav.calendar')} <Icon d={I.right} size={14} w={2.5} />
          </button>
        </div>
        {todays.length === 0 ? (
          <div className="empty">
            <h3>{t('fd.quietDay')}</h3>
            <p>{t('fd.quietDaySub')}</p>
          </div>
        ) : (
          <table>
            <tbody>
              {todays
                .sort((a, b) => a.start.localeCompare(b.start))
                .map((a) => (
                  <tr key={a.id}>
                    <td className="bold tnum" style={{ width: 90 }}>
                      {a.start}
                    </td>
                    <td>
                      <span className="bold">{a.title}</span>
                      <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                        {a.serviceName}
                      </span>
                    </td>
                    <td className="right muted tnum">{money(a.price)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
