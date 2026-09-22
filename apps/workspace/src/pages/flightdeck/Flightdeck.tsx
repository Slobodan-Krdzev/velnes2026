import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FlightdeckSchema, TimingSuggestionsResponseSchema } from '@velnes/contracts';
import { I, Icon } from '@velnes/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { get, post } from '@velnes/client';
import { money } from '../../lib/money.js';
import { useToast } from '../../lib/toast.js';
import { useSession } from '@velnes/client';
import { useScope } from '../../shell/Shell.js';

const OPP_ICON: Record<string, string> = { users: I.users, pulse: I.pulse, bottle: I.bottle };
const OB_ICON: Record<string, string> = {
  services: I.sparkle,
  products: I.bottle,
  team: I.users,
  hours: I.clock,
  suppliers: I.bottle,
};

/** The salon flightdeck — the prototype's viewFlightdeck, composed from
 *  live data by the one /flightdeck door. Above the fold: the pulse,
 *  the priority-of-today hero, the opportunities and the stock that
 *  needs a decision. Below: today at a glance, upsell per person, and
 *  the Kumo insight. Opportunities/Kumo come from the insights engine
 *  (rules today, Claude later) — the UI computes nothing. */
/**
 * The home route. The flightdeck is the location's figures, so it is
 * for whoever may read location reports; a basic Employee — calendar
 * and till only — lands on their calendar instead of a 403.
 */
export function HomePage() {
  const { me, can } = useSession();
  // The account owner always has the deck, whatever the perm map says.
  return me?.access === 'owner' || can('reports.view_location') || can('reports.view_business') ? (
    <FlightdeckPage />
  ) : (
    <Navigate to="/calendar" replace />
  );
}

export function FlightdeckPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { me, can } = useSession();
  const { scope } = useScope();
  const [why, setWhy] = useState(false);
  // First-login-only nudge (per device): the very first time this owner
  // reaches the flightdeck we also suggest adding a second location.
  const [firstLogin, setFirstLogin] = useState(false);
  useEffect(() => {
    if (!me) return;
    const k = `velnes.fdSeen.${me.id}`;
    try {
      if (!localStorage.getItem(k)) {
        setFirstLogin(true);
        localStorage.setItem(k, '1');
      }
    } catch {
      /* storage unavailable — skip the one-time nudge */
    }
  }, [me]);

  // A specific scope views that location; "All locations" lets the
  // server show the primary operating location.
  const loc = scope !== 'all' ? scope : null;

  const fd = useQuery({
    queryKey: ['flightdeck', loc ?? 'all'],
    queryFn: () => get(FlightdeckSchema, `/flightdeck${loc ? `?locationId=${loc}` : ''}`),
  });
  const suggestions = useQuery({
    queryKey: ['timingSuggestions'],
    queryFn: () => get(TimingSuggestionsResponseSchema, '/timings/suggestions'),
    enabled: can('ranking.manage') || me?.access === 'owner',
  });

  const act = async (id: string, action: 'approve' | 'dismiss') => {
    await post(z.object({ ok: z.literal(true) }), `/timings/${id}/${action}`, {});
    toast(action === 'approve' ? t('fd.timingApproved') : t('fd.timingDismissed'));
    void qc.invalidateQueries({ queryKey: ['timingSuggestions'] });
  };

  const greeting = () => {
    const h = new Date().getHours();
    const key = h < 12 ? 'fd.greetMorning' : h < 18 ? 'fd.greetAfternoon' : 'fd.greetEvening';
    return t(key, { name: fd.data?.greetingName || (me?.name ?? '').split(' ')[0] });
  };
  const delta = (base: string, pct: number | null) => {
    if (pct === null) return t(`${base}Flat`);
    return t(pct >= 0 ? `${base}Up` : `${base}Down`, { pct: Math.abs(pct) });
  };
  const stockLine = (stock: number) => {
    const w = Math.max(1, Math.ceil(stock / 4));
    return t('fd.stockLine', { n: stock, weeks: w });
  };

  if (!fd.data) return <div className="fd" />;
  const d = fd.data;
  const sugg = suggestions.data?.suggestions ?? [];
  const maxUp = Math.max(1, ...d.staff.map((s) => s.value));

  return (
    <div className="fd">
      <div className="fd-fold">
        <div className="fd-greet">
          <h2>{greeting()}</h2>
          <p className="muted" style={{ fontWeight: 500 }}>
            {t('fd.deserves')}
          </p>
        </div>
        <div className="fd-main">
          <div className="fd-left">
            {d.legalPending.taxId || d.legalPending.vat ? (
              <div
                className="note"
                style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}
              >
                <Icon d={I.info} size={18} w={2} />
                <span className="grow" style={{ fontWeight: 500 }}>
                  {d.legalPending.taxId && d.legalPending.vat
                    ? t('fd.legalBoth')
                    : d.legalPending.taxId
                      ? t('fd.legalTax')
                      : t('fd.legalVat')}
                </span>
                <button className="btn btn-secondary btn-sm" onClick={() => navigate('/settings')}>
                  {t('fd.legalOpen')}
                </button>
              </div>
            ) : null}
            {d.onboarding.show ? (
              <div className="card fd-card fd-onboard" style={{ marginBottom: 14 }}>
                <div className="hstack" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <h3 style={{ margin: 0 }}>{t('fd.obTitle')}</h3>
                  <span className="muted" style={{ fontWeight: 600 }}>
                    {t('fd.obProgress', { done: d.onboarding.doneCount, total: d.onboarding.totalCount })}
                  </span>
                </div>
                <p className="muted" style={{ fontWeight: 500, marginTop: 4 }}>
                  {t('fd.obSub')}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                  {d.onboarding.steps.map((s) => (
                    <div key={s.key} className="fd-emp">
                      <span
                        className="pthumb ph fd-shot"
                        style={s.done ? { background: '#e6ecdc', color: '#4f5a33' } : undefined}
                      >
                        {s.done ? '✓' : <Icon d={OB_ICON[s.key] ?? I.pulse} size={18} w={2} />}
                      </span>
                      <span className="fd-emp-body">
                        <span className="n">{t(`fd.ob_${s.key}_t`)}</span>
                        <span className="x">{t(`fd.ob_${s.key}_x`)}</span>
                      </span>
                      <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/${s.actionTarget}`)}>
                        {s.done ? t('fd.obReview') : t('fd.obSetUp')}
                      </button>
                    </div>
                  ))}
                </div>
                {firstLogin && d.onboarding.locationCount <= 1 ? (
                  <div className="note" style={{ marginTop: 12 }}>
                    {t('fd.obLocationNudge')}{' '}
                    <button className="btn btn-subtle btn-sm" onClick={() => navigate('/settings')}>
                      {t('fd.obAddLocation')}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="grid4 fd-pulse">
              <div className="stat">
                <span className="stat-label">{t('fd.capacityToday')}</span>
                <span className="stat-value">{d.pulse.capacityPct}%</span>
                <span className="stat-hint">
                  {t('fd.slotsBooked', { booked: d.pulse.bookedToday, total: d.pulse.totalSlots })}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">{t('fd.revenueToday')}</span>
                <span className="stat-value">{money(d.pulse.revenueToday)}</span>
                <span className="stat-hint">
                  {d.pulse.revenueTarget
                    ? t('fd.ofAverage', {
                        pct: Math.round((d.pulse.revenueToday / d.pulse.revenueTarget) * 100),
                        avg: money(d.pulse.revenueTarget),
                      })
                    : t('fd.noBaseline')}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">{t('fd.newCustomers')}</span>
                <span className="stat-value">{d.pulse.newCustomers}</span>
                <span className="stat-hint">{delta('fd.thisMonth', d.pulse.newCustomersDeltaPct)}</span>
              </div>
              <div className="stat">
                <span className="stat-label">{t('fd.avgSpend')}</span>
                <span className="stat-value">{money(d.pulse.avgSpend)}</span>
                <span className="stat-hint">{delta('fd.perVisit', d.pulse.avgSpendDeltaPct)}</span>
              </div>
            </div>

            {d.memberRecs.count > 0 ? (
              <div className="fd-hero" data-fdrec>
                <div className="fd-hero-main">
                  <span className="fd-kicker">{t('fd.premiumKicker')}</span>
                  <h2>
                    {d.memberRecs.count === 1
                      ? t('fd.recWaitingOne')
                      : t('fd.recWaitingMany', { n: d.memberRecs.count })}
                  </h2>
                  <p>
                    {d.memberRecs.count === 1
                      ? t('fd.recBodyOne', { value: money(d.memberRecs.value) })
                      : t('fd.recBodyMany', { n: d.memberRecs.count, value: money(d.memberRecs.value) })}
                  </p>
                  <div className="fd-hero-actions">
                    <button
                      className="btn btn-primary"
                      onClick={() => navigate('/marketing', { state: { tab: 'premium' } })}
                    >
                      {t('fd.openPremium')}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {d.hero.kind === 'capacity' ? (
              <div className="fd-hero">
                <div className="fd-hero-main">
                  <span className="fd-kicker">{t('fd.priorityToday')}</span>
                  <h2>{d.hero.when === 'tomorrow' ? t('fd.fillTomorrow') : t('fd.fillToday')}</h2>
                  <p>
                    {t('fd.heroBody', {
                      when: d.hero.when === 'tomorrow' ? t('fd.whenTomorrow') : t('fd.whenToday'),
                      n: d.hero.openSlots,
                      from: d.hero.fromTime,
                      to: d.hero.toTime,
                    })}{' '}
                    {t('fd.heroMembers', { members: d.hero.memberCount })}
                  </p>
                  <div className="fd-hero-meta">
                    <span>
                      <Icon d={I.pulse} size={18} w={2} /> {t('fd.potential', { value: money(d.hero.potential) })}
                    </span>
                    <span>
                      <Icon d={I.clock} size={18} w={2} /> {t('fd.timeNeeded')}
                    </span>
                  </div>
                  <div className="fd-hero-actions">
                    <button className="btn btn-primary" onClick={() => navigate('/marketing')}>
                      {t('fd.sendOffer')}
                    </button>
                    <button className="btn btn-subtle" onClick={() => setWhy((v) => !v)}>
                      {why ? t('fd.hideReasoning') : t('fd.viewReasoning')}
                    </button>
                  </div>
                  {why ? <div className="note fd-why">{t('fd.reasoning')}</div> : null}
                </div>
              </div>
            ) : (
              <div className="fd-hero fd-hero-quiet">
                <div className="fd-hero-main">
                  <span className="fd-kicker">{t('fd.priorityToday')}</span>
                  <h2>{t('fd.nothingOnFire')}</h2>
                  <p>{t('fd.quietBody')}</p>
                </div>
              </div>
            )}

            {d.opportunities.length ? (
              <div className="fd-opps">
                {d.opportunities.map((o) => (
                  <div key={o.key} className="fd-opp">
                    <span className="fd-opp-ic">
                      <Icon d={OPP_ICON[o.icon] ?? I.pulse} size={22} w={2} />
                    </span>
                    <span className="fd-opp-body">
                      <span className="t">{o.title}</span>
                      <span className="x">{o.detail}</span>
                    </span>
                    <span className="fd-opp-side">
                      {o.value > 0 ? <span className="v">+{money(o.value)}</span> : null}
                      <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/${o.actionTarget}`)}>
                        {o.actionLabel}
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="fd-side">
            <div className="card fd-card">
              <h3>{t('fd.stockDecision')}</h3>
              {d.inventory.length ? (
                d.inventory.map((p) => (
                  <div key={p.id} className="fd-emp">
                    <span className="pthumb ph fd-shot">{(p.name[0] ?? '?').toUpperCase()}</span>
                    <span className="fd-emp-body">
                      <span className="n">{p.name}</span>
                      <span className={`x ${p.soldOut ? 'danger' : ''}`}>
                        {p.soldOut ? t('fd.soldOut') : stockLine(p.stock)}
                      </span>
                    </span>
                    <button className="btn btn-secondary btn-sm" onClick={() => navigate('/suppliers')}>
                      {t('fd.reorder')}
                    </button>
                  </div>
                ))
              ) : (
                <p className="muted" style={{ fontWeight: 500 }}>
                  {t('fd.nothingLow')}
                </p>
              )}
              <button className="btn btn-subtle btn-sm" onClick={() => navigate('/suppliers')}>
                {t('fd.viewSuppliers')} <Icon d={I.right} size={16} w={2.4} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="fd-more">
        <span className="fd-more-k">{t('fd.goodToKnow')}</span>
        <div className="fd-more-grid">
          <div className="card fd-card">
            <h3>{t('fd.todayGlance')}</h3>
            {(
              [
                [t('fd.treatmentsBooked'), `${d.snapshot.bookedToday} of ${d.snapshot.totalSlots}`],
                [t('fd.onlineBookings'), `${d.snapshot.onlineToday} of ${d.snapshot.bookedToday}`],
                [t('fd.noShows'), `${d.snapshot.noShows} (${d.snapshot.noShowPct}%)`],
                [t('fd.revenue'), money(d.snapshot.revenue)],
                [t('fd.productSales'), money(d.snapshot.productSales)],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} className="fd-row">
                <span className="k">{k}</span>
                <span className="v tnum">{v}</span>
              </div>
            ))}
            <button className="btn btn-subtle btn-sm" onClick={() => navigate('/reports')}>
              {t('fd.fullReports')} <Icon d={I.right} size={16} w={2.4} />
            </button>
          </div>

          <div className="card fd-card">
            <h3>{t('fd.upsellPerPerson')}</h3>
            {d.staff.length ? (
              d.staff.map((s) => (
                <div key={s.employeeId} className="fd-emp">
                  <span className="pthumb ph fd-face">
                    {s.name
                      .split(' ')
                      .map((w) => w[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                  <span className="fd-emp-body">
                    <span className="n">{s.name}</span>
                    <span className="fd-bar">
                      <i style={{ width: `${Math.round((s.value / maxUp) * 100)}%` }} />
                    </span>
                  </span>
                  <span className="v tnum">{money(s.value)}</span>
                </div>
              ))
            ) : (
              <p className="muted" style={{ fontWeight: 500 }}>
                {t('fd.noUpsell')}
              </p>
            )}
            <button className="btn btn-subtle btn-sm" onClick={() => navigate('/reports')}>
              {t('fd.fullReports')} <Icon d={I.right} size={16} w={2.4} />
            </button>
          </div>
        </div>

        {sugg.length ? (
          <div className="card">
            <div className="card-header">
              <h2>{t('fd.timingTitle')}</h2>
              <span className="muted" style={{ fontWeight: 500 }}>
                {t('fd.timingSub')}
              </span>
            </div>
            {sugg.map((s) => (
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

        {d.kumo ? (
          <div className="fd-kumo">
            <span className="fd-kumo-ic">
              <Icon d={I.sparkle} size={22} w={1.9} />
            </span>
            <span className="grow">
              <span className="t">{t('fd.insightKumo')}</span>
              <span className="x">{d.kumo.text}</span>
            </span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => navigate(`/${d.kumo!.actionTarget}`)}
            >
              {t('fd.createCampaign')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
