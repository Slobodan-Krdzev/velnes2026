import { useQuery } from '@tanstack/react-query';
import { appointmentPoints, type LoyaltyAccount, type LoyaltyEntry } from '@velnes/contracts';
import { t } from '../../lib/i18n-core.js';
import { i18n } from '../../lib/i18n-core.js';
import { useSession } from '../../lib/api/session.js';
import { dayLbl } from '../../lib/api/mappers.js';
import { SkelRows } from '../../components/Skeleton.js';

/**
 * Velnes Loyalty in My Velnes (Alex, 2026-09-30) — docs/LOYALTY.md.
 * The balance, the ledger as people read it, and how points are
 * earned — every number from the door, the rules from the door too,
 * so a rule change never leaves the words behind.
 */

export const IcFlower = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2.5c1.9 0 3.2 1.7 3.2 3.6 0 .5-.1 1-.3 1.4 1.1-.6 2.5-.4 3.5.5 1.4 1.3 1.5 3.3.3 4.6-.4.4-.8.7-1.3.9.5.2.9.5 1.3.9 1.2 1.3 1.1 3.3-.3 4.6-1 .9-2.4 1.1-3.5.5.2.4.3.9.3 1.4 0 1.9-1.3 3.6-3.2 3.6s-3.2-1.7-3.2-3.6c0-.5.1-1 .3-1.4-1.1.6-2.5.4-3.5-.5-1.4-1.3-1.5-3.3-.3-4.6.4-.4.8-.7 1.3-.9-.5-.2-.9-.5-1.3-.9-1.2-1.3-1.1-3.3.3-4.6 1-.9 2.4-1.1 3.5-.5-.2-.4-.3-.9-.3-1.4 0-1.9 1.3-3.6 3.2-3.6z" />
    <circle cx="12" cy="12" r="2.4" fill="#fff" />
  </svg>
);

export function useMyLoyalty() {
  const { api, signedIn } = useSession();
  return useQuery({
    queryKey: ['my-loyalty'],
    queryFn: () => api<LoyaltyAccount>('/me/loyalty'),
    enabled: signedIn,
    staleTime: 15_000,
  });
}

/**
 * What a visit being put together will earn — the same rule the
 * ledger uses (`servicePoints`, one place), shown as a preview in the
 * booking summary (Alex, 2026-09-30) — the services' points plus the
 * products taken home with the visit; a guest is told what signing in
 * would earn, since a guest has no wallet.
 */
export function LoyaltyEarn({ serviceCount, productUnits = 0, extras = 0, className = '' }: { serviceCount: number; productUnits?: number; extras?: number; className?: string }) {
  const { signedIn } = useSession();
  if (serviceCount < 1) return null;
  // Products booked with the visit (2026-10-01) count like products
  // sold with it, and every choice beyond Standard — a length, an
  // option — earns on top (2026-10-02): the same rule, from the same place.
  const n = fmtPoints(appointmentPoints(serviceCount, productUnits, extras).total);
  return (
    <div className={`loy-earn${className ? ` ${className}` : ''}`} data-testid="loyalty-earn">
      <span className="loy-earn-ic" aria-hidden="true">{IcFlower}</span>
      <span>{signedIn ? t('c.loy.earnWith', { n }) : t('c.loy.earnSignIn', { n })}</span>
    </div>
  );
}

/** "1,450" in the viewer's language — whole points, never decimals. */
export const fmtPoints = (n: number) => Math.round(n).toLocaleString(i18n.language);

function EntryRow({ e }: { e: LoyaltyEntry }) {
  const meta = e.meta as { serviceCount?: number; productUnits?: number; reason?: string };
  // The quiet-time bonus is a promotion row that says why (2026-10-05).
  const label = e.type === 'promotion_bonus' && meta.reason === 'quiet_slot' ? 'c.loy.quietBonus' : `c.loy.t.${e.type}`;
  const detail =
    e.type === 'appointment_completed' && meta.serviceCount != null
      ? t(meta.serviceCount === 1 ? 'c.loy.breakdownOne' : 'c.loy.breakdown', { services: meta.serviceCount, products: meta.productUnits ?? 0 })
      : null;
  return (
    <div className="acc-kv loy-row">
      <span>
        <b className="loy-what">{t(label)}</b>
        <span className="sm muted" style={{ display: 'block' }}>
          {[e.salonName, detail].filter(Boolean).join(' · ')}
          {e.salonName || detail ? ' · ' : ''}
          {dayLbl(e.at.slice(0, 10))}
        </span>
      </span>
      <b className={`loy-delta${e.points < 0 ? ' neg' : ''}`}>
        {e.points > 0 ? '+' : ''}
        {fmtPoints(e.points)}
      </b>
    </div>
  );
}

/** The overview card: the balance and the way in. */
export function LoyaltyCard({ balance, onOpen }: { balance: number; onOpen: () => void }) {
  return (
    <div className="acc-card loy-card" data-testid="loyalty-card">
      <div className="acc-kv" style={{ alignItems: 'center', gap: '12px' }}>
        <span className="loy-ic" aria-hidden="true">{IcFlower}</span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <b>{t('c.loy.title')}</b>
          <br />
          <span className="loy-balance">{t('c.loy.pointsN', { n: fmtPoints(balance) })}</span>
          <span className="sm muted" style={{ display: 'block' }}>{t('c.loy.cardSub')}</span>
        </span>
        <button className="btn btn-g" style={{ minHeight: '38px', padding: '6px 14px', fontSize: '13px', flex: '0 0 auto' }} onClick={onOpen}>
          {t('c.loy.view')}
        </button>
      </div>
    </div>
  );
}

/** The section: balance, recent activity, how to earn. */
export function LoyaltySection() {
  const q = useMyLoyalty();
  const d = q.data;
  const rules = d?.rules;
  return (
    <>
      <div className="acc-card loy-hero" data-testid="loyalty-balance">
        <span className="loy-ic big" aria-hidden="true">{IcFlower}</span>
        <div className="loy-big">{d ? fmtPoints(d.balance) : '—'}</div>
        <div className="sm muted">{t('c.loy.points')}</div>
        <div className="sm" style={{ marginTop: 6 }}>{t('c.loy.sub')}</div>
      </div>
      <div className="acc-card">
        <div className="acc-lbl">{t('c.loy.recent')}</div>
        {!d ? <SkelRows n={3} /> : null}
        {d && !d.entries.length ? <div className="sm muted">{t('c.loy.none')}</div> : null}
        {(d?.entries ?? []).map((e) => (
          <EntryRow key={e.id} e={e} />
        ))}
      </div>
      {rules ? (
        <div className="acc-card">
          <div className="acc-lbl">{t('c.loy.how')}</div>
          <div className="acc-kv">
            <span>{t('c.loy.howJoin')}</span>
            <b>+{fmtPoints(rules.registration)}</b>
          </div>
          <div className="acc-kv">
            <span>
              {t('c.loy.howAppt')}
              <span className="sm muted" style={{ display: 'block' }}>{t('c.loy.howApptSub', { first: fmtPoints(rules.firstService), more: fmtPoints(rules.additionalService) })}</span>
            </span>
            <b>+{fmtPoints(rules.firstService)}</b>
          </div>
          {rules.extraChoice ? (
            <div className="acc-kv">
              <span>
                {t('c.loy.howUpgrade')}
                <span className="sm muted" style={{ display: 'block' }}>{t('c.loy.howUpgradeSub')}</span>
              </span>
              <b>+{fmtPoints(rules.extraChoice)}</b>
            </div>
          ) : null}
          {rules.quietSlot ? (
            <div className="acc-kv">
              <span>
                {t('c.loy.howQuiet')}
                <span className="sm muted" style={{ display: 'block' }}>{t('c.loy.howQuietSub')}</span>
              </span>
              <b>+{fmtPoints(rules.quietSlot)}</b>
            </div>
          ) : null}
          <div className="acc-kv">
            <span>
              {t('c.loy.howProduct')}
              <span className="sm muted" style={{ display: 'block' }}>{t('c.loy.howProductSub', { n: fmtPoints(rules.productUnit) })}</span>
            </span>
            <b>+{fmtPoints(rules.productUnit)}</b>
          </div>
          <div className="acc-kv">
            <span>{t('c.loy.howReview')}</span>
            <b>+{fmtPoints(rules.review)}</b>
          </div>
        </div>
      ) : null}
    </>
  );
}
