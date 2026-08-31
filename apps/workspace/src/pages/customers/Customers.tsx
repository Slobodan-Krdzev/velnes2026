import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActivityListSchema,
  CustomerApptsSchema,
  CustomerInsightsSchema,
  CustomerInvoicesSchema,
  CustomerListResponseSchema,
  CustomerLoyaltySchema,
  CustomerProfileSchema,
  PersonalOfferCreateSchema,
  PersonalOfferListSchema,
  PersonalOfferSchema,
  type CustomerInsights,
  type CustomerProfile,
} from '@velnes/contracts';
import { I, Icon } from '@velnes/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { ApiError, get, patch, post, useSession } from '@velnes/client';
import { useLocations } from '../../api/queries.js';
import { money } from '../../lib/money.js';
import { useOutsideClose } from '../../lib/pop.js';
import { useToast } from '../../lib/toast.js';

/** viewCustomers + viewProfile, markup-faithful. Trends/Suggestions
 *  render their honest empty states until the CI rule sets land; the
 *  AI analysis panel waits for a real model. */

const inits = (n: string) =>
  n
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
const dateShort = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
};

const useCustomers = (query: string) =>
  useQuery({
    queryKey: ['customers', query],
    queryFn: () =>
      get(CustomerListResponseSchema, `/customers?limit=100${query ? `&query=${encodeURIComponent(query)}` : ''}`),
  });
const useProfile = (id: string) =>
  useQuery({ queryKey: ['customer', id], queryFn: () => get(CustomerProfileSchema, `/customers/${id}`) });
const useInsights = (id: string) =>
  useQuery({ queryKey: ['insights', id], queryFn: () => get(CustomerInsightsSchema, `/customers/${id}/insights`) });

const GROUPS = ['New', 'Regulars', 'VIP'];

export function CustomersPage() {
  const { id } = useParams();
  if (id) return <Profile id={id} />;
  return <CustomerList />;
}

function retentionBadge(t: (k: string) => string, ci?: CustomerInsights) {
  if (!ci) return null;
  if (ci.retention === 'returning')
    return <span className="badge success">{t('cust.returning')}</span>;
  if (ci.retention === 'at_risk') return <span className="badge warm">{t('cust.atRisk')}</span>;
  return null;
}

type CustomerSort = 'default' | 'visitsDesc' | 'visitsAsc' | 'spendDesc' | 'spendAsc';

function CustomerList() {
  const { t } = useTranslation();
  const { can } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');
  const [sort, setSort] = useState<CustomerSort>('default');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const filtersRef = useOutsideClose(filtersOpen, () => setFiltersOpen(false));
  const sortRef = useOutsideClose(sortOpen, () => setSortOpen(false));
  const [adding, setAdding] = useState(false);
  const list = useCustomers(q);
  const full = can('customers.view_business');

  const save = async (id: string, body: Record<string, unknown>) => {
    await patch(CustomerProfileSchema, `/customers/${id}`, body);
    void qc.invalidateQueries({ queryKey: ['customers'] });
  };

  const qTel = q.trim().replace(/\s+/g, '').toLowerCase();
  const rows = (list.data?.customers ?? []).filter((c) => {
    const s = q.trim().toLowerCase();
    const hit =
      !s ||
      c.name.toLowerCase().includes(s) ||
      (c.email ?? '').toLowerCase().includes(s) ||
      (qTel && (c.phone ?? '').replace(/\s+/g, '').toLowerCase().includes(qTel));
    return hit && (group === 'all' || c.group === group);
  });
  if (sort !== 'default')
    rows.sort(
      sort === 'visitsDesc'
        ? (a, b) => b.visits - a.visits
        : sort === 'visitsAsc'
          ? (a, b) => a.visits - b.visits
          : sort === 'spendDesc'
            ? (a, b) => b.spend - a.spend
            : (a, b) => a.spend - b.spend,
    );

  const sortOpts: [CustomerSort, string][] = [
    ['default', t('cust.sortDefault')],
    ['visitsDesc', t('cust.sortVisitsDesc')],
    ['visitsAsc', t('cust.sortVisitsAsc')],
    ...(full
      ? ([
          ['spendDesc', t('cust.sortSpendDesc')],
          ['spendAsc', t('cust.sortSpendAsc')],
        ] as [CustomerSort, string][])
      : []),
  ];
  const curSortLbl = sortOpts.find(([v]) => v === sort)?.[1] ?? '';

  return (
    <>
      <div className="toolbar toolbar-row">
        <div className="filters">
          <div className="search">
            <Icon d={I.search} size={20} />
            <input
              className="input"
              placeholder={t('cust.searchPh')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="pop" ref={filtersRef}>
            <button
              className={`btn btn-secondary btn-pill${group !== 'all' ? ' on' : ''}${filtersOpen ? ' open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((v) => !v)}
            >
              {t('cal.filters')}
              {group !== 'all' ? <span className="fbadge">1</span> : null}
              <span className={`caret${filtersOpen ? ' up' : ''}`}>
                <Icon d={I.down} size={18} w={2.2} />
              </span>
            </button>
            {filtersOpen ? (
              <div className="menu menu-left" role="menu">
                {[['all', t('cust.allGroups')] as [string, string]]
                  .concat(GROUPS.map((g) => [g, g] as [string, string]))
                  .map(([v, label]) => (
                    <button
                      key={v}
                      className={`menu-row${group === v ? ' on' : ''}`}
                      role="menuitemradio"
                      aria-checked={group === v}
                      onClick={() => {
                        setGroup(v);
                        setFiltersOpen(false);
                      }}
                    >
                      <span className="menu-tick">
                        {group === v ? <Icon d={I.check} size={18} w={3} /> : null}
                      </span>
                      <span className="grow" style={{ textAlign: 'left' }}>
                        {label}
                      </span>
                    </button>
                  ))}
              </div>
            ) : null}
          </div>
          <div className="pop" ref={sortRef}>
            <button
              className={`btn btn-secondary btn-pill${sort !== 'default' ? ' on' : ''}${sortOpen ? ' open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={sortOpen}
              onClick={() => setSortOpen((v) => !v)}
            >
              {t('cust.sort')}
              {sort !== 'default' ? `: ${curSortLbl}` : ''}
              <span className={`caret${sortOpen ? ' up' : ''}`}>
                <Icon d={I.down} size={18} w={2.2} />
              </span>
            </button>
            {sortOpen ? (
              <div className="menu menu-left" role="menu">
                {sortOpts.map(([v, label]) => (
                  <button
                    key={v}
                    className={`menu-row${sort === v ? ' on' : ''}`}
                    role="menuitemradio"
                    aria-checked={sort === v}
                    onClick={() => {
                      setSort(v);
                      setSortOpen(false);
                    }}
                  >
                    <span className="menu-tick">
                      {sort === v ? <Icon d={I.check} size={18} w={3} /> : null}
                    </span>
                    <span className="grow" style={{ textAlign: 'left' }}>
                      {label}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="toolbar-actions">
          <button className="btn btn-primary btn-add" onClick={() => setAdding(true)}>
            {t('cal.add')} <Icon d={I.plus} size={20} w={2.5} />
          </button>
        </div>
      </div>
      {adding ? (
        <NewCustomerPanel
          onClose={() => setAdding(false)}
          onSaved={(id) => {
            setAdding(false);
            void qc.invalidateQueries({ queryKey: ['customers'] });
            navigate(`/customers/${id}`);
          }}
        />
      ) : null}
      <div className="card">
        {rows.length === 0 ? (
          <div className="empty">
            <h3>{t('cust.noMatch')}</h3>
            <p>{t('cust.noMatchSub')}</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('cust.customer')}</th>
                <th className="sec">{t('cust.group')}</th>
                <th>{t('cust.phone')}</th>
                <th className="right">{t('cust.visits')}</th>
                {full ? (
                  <>
                    <th className="right">{t('cust.spend')}</th>
                    <th className="right sec">{t('cust.points')}</th>
                  </>
                ) : null}
                <th className="right">{t('cust.canBook')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={c.blacklisted ? 'dim' : ''}>
                  <td>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span className="avatar" style={{ width: 36, height: 36 }}>
                        {inits(c.name)}
                      </span>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span className="bold">{c.name}</span>
                        <span className="muted" style={{ fontSize: 12 }}>
                          {c.email ?? '—'}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="sec">
                    <select
                      className="select"
                      value={c.group}
                      onChange={(e) => void save(c.id, { group: e.target.value })}
                    >
                      {GROUPS.map((g) => (
                        <option key={g}>{g}</option>
                      ))}
                    </select>
                    {c.blacklisted ? (
                      <div style={{ marginTop: 4 }}>
                        <span className="badge danger">
                          {t('cust.blacklistedBadge', { n: c.noShows })}
                        </span>
                      </div>
                    ) : null}
                  </td>
                  <td className="tnum">{c.phone ?? '—'}</td>
                  <td className="right tnum">{c.visits}</td>
                  {full ? (
                    <>
                      <td className="right bold tnum">{money(c.spend)}</td>
                      <td className="right muted tnum sec">{c.points}</td>
                    </>
                  ) : null}
                  <td className="right">
                    <span className="rowact">
                      <button
                        className={`toggle ${c.blacklisted ? '' : 'on'}`}
                        role="switch"
                        aria-checked={!c.blacklisted}
                        aria-label={`${t('cust.canBook')} ${c.name}`}
                        onClick={() => void save(c.id, { blacklisted: !c.blacklisted })}
                      >
                        <span className="knob" />
                      </button>
                    </span>
                  </td>
                  <td className="right">
                    <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/customers/${c.id}`)}>
                      {t('cust.view')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/** The prototype's New-customer lade: who they are and how to reach
 *  them, saved through the real POST door. */
function NewCustomerPanel({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [group, setGroup] = useState('New');
  const [birthday, setBirthday] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.add('panel-open');
    return () => document.body.classList.remove('panel-open');
  }, []);

  const save = async () => {
    setError(null);
    try {
      const c = await post(CustomerProfileSchema, '/customers', {
        name: `${first.trim()} ${last.trim()}`.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        group,
        birthday: birthday || null,
      });
      toast(t('cust.saved'));
      onSaved(c.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div className="scrim on" onClick={onClose} />
      <aside className="panel open" role="dialog" aria-modal="true">
        <div className="panel-head plain">
          <div>
            <h2>{t('cust.newCustomer')}</h2>
            <p className="sub">{t('cust.newCustomerSub')}</p>
          </div>
          <div className="panel-actions">
            <button
              className="btn btn-primary btn-sm"
              disabled={!first.trim() || !phone.trim()}
              onClick={() => void save()}
            >
              {t('cust.saveCustomer')}
            </button>
            <button className="iconbtn" aria-label={t('common.close')} onClick={onClose}>
              <Icon d={I.x} size={20} />
            </button>
          </div>
        </div>
        <div className="panel-body">
          <div className="grid2">
            <label className="field">
              <span>
                {t('cust.firstName')}
                <span className="req">*</span>
              </span>
              <input className="input" value={first} onChange={(e) => setFirst(e.target.value)} />
            </label>
            <label className="field">
              <span>
                {t('cust.lastName')}
                <span className="req">*</span>
              </span>
              <input className="input" value={last} onChange={(e) => setLast(e.target.value)} />
            </label>
            <label className="field span2">
              <span>{t('cust.email')}</span>
              <input
                className="input"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="field">
              <span>
                {t('cust.phone')}
                <span className="req">*</span>
              </span>
              <input
                className="input"
                type="tel"
                placeholder="+389 7x xxx xxx"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            <label className="field">
              <span>{t('cust.group')}</span>
              <select
                className="select"
                style={{ width: '100%' }}
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              >
                {GROUPS.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('cust.dob')}</span>
              <input
                className="input"
                type="date"
                value={birthday}
                onChange={(e) => setBirthday(e.target.value)}
              />
            </label>
          </div>
          {error ? (
            <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>
              {error}
            </p>
          ) : null}
        </div>
      </aside>
    </>
  );
}

const TABS = [
  ['appointments', 'cust.tabAppointments'],
  ['sales', 'cust.tabSales'],
  ['loyalty', 'cust.tabLoyalty'],
  ['premium', 'cust.tabPremium'],
  ['prepaid', 'cust.tabPrepaid'],
  ['activity', 'cust.tabActivity'],
] as const;

function Profile({ id }: { id: string }) {
  const { t } = useTranslation();
  const { can } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const profile = useProfile(id);
  const insights = useInsights(id);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('appointments');
  const [menu, setMenu] = useState(false);
  const menuRef = useOutsideClose(menu, () => setMenu(false));
  const [offerOpen, setOfferOpen] = useState(false);
  const full = can('customers.view_business');
  const c = profile.data;
  const st = insights.data;

  if (profile.isError)
    return (
      <div className="empty">
        <h3>{t('cust.gone')}</h3>
        <p>{t('cust.goneSub')}</p>
        <button className="btn btn-secondary" onClick={() => navigate('/customers')}>
          {t('cust.backToCustomers')}
        </button>
      </div>
    );
  if (!c) return null;

  return (
    <>
      <div className="toolbar">
        <button className="backlink" style={{ margin: 0 }} onClick={() => navigate('/customers')}>
          <Icon d={I.arrowleft} size={16} /> {t('cust.allCustomers')}
        </button>
        <div className="toolbar-actions">
          {can('marketing.personal_offers') ? (
            <div className="pop" ref={menuRef}>
              <button
                className={`btn btn-primary btn-add ${menu ? 'open' : ''}`}
                aria-haspopup="menu"
                aria-expanded={menu}
                onClick={() => setMenu((v) => !v)}
              >
                {t('cust.actions')} <Icon d={menu ? I.left : I.down} size={20} w={2.5} />
              </button>
              {menu ? (
                <div className="menu menu-wide" role="menu">
                  <button className="menu-row" role="menuitem" onClick={() => navigate('/calendar')}>
                    <Icon d={I.calendar} size={20} />
                    <span className="grow" style={{ textAlign: 'left' }}>
                      <span>{t('cust.bookAppointment')}</span>
                      <span className="menu-sub">{t('cust.bookSub')}</span>
                    </span>
                  </button>
                  <button
                    className="menu-row"
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      setOfferOpen(true);
                    }}
                  >
                    <Icon d={I.pulse} size={20} />
                    <span className="grow" style={{ textAlign: 'left' }}>
                      <span>{t('cust.createOffer')}</span>
                      <span className="menu-sub">
                        {t('cust.offerSub', { name: c.name.split(' ')[0] })}
                      </span>
                    </span>
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <button className="btn btn-primary" onClick={() => navigate('/calendar')}>
              {t('cust.bookAppointment')}
            </button>
          )}
        </div>
      </div>
      <div className="profile-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            className="card"
            style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}
          >
            <span className="avatar" style={{ width: 80, height: 80, fontSize: 20 }}>
              {inits(c.name)}
            </span>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{c.name}</div>
              <div className="muted" style={{ fontWeight: 500 }}>
                {t('cust.since', { date: c.since ? dateShort(c.since) : '—' })}
              </div>
            </div>
            <span className="badge warm">{c.group}</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              {c.isPremium ? <span className="badge accent">{t('cust.premiumBadge')}</span> : null}
              {c.blacklisted ? (
                <span className="badge danger">{t('cust.bookingBlocked')}</span>
              ) : (
                <span className="badge success">{t('cust.canBookBadge')}</span>
              )}
              {retentionBadge(t, st)}
            </div>
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left', marginTop: 8 }}>
              <a className="contact" href={`mailto:${c.email ?? ''}`}>
                <Icon d={I.mail} size={16} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.email ?? '—'}</span>
              </a>
              <a className="contact" href={`tel:${c.phone ?? ''}`}>
                <Icon d={I.phone} size={16} />
                <span className="tnum">{c.phone ?? '—'}</span>
              </a>
            </div>
          </div>
          {c.note ? (
            <div className="card" style={{ padding: 20 }}>
              <div className="stat-label" style={{ marginBottom: 6 }}>
                {t('cust.note')}
              </div>
              <div style={{ fontWeight: 500 }}>{c.note}</div>
            </div>
          ) : null}
          {st?.firstVisit ? <VisitCard title={t('cust.firstVisit')} v={st.firstVisit} /> : null}
          {st?.lastVisit ? <VisitCard title={t('cust.lastVisit')} v={st.lastVisit} /> : null}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {st ? <KpiBlock c={c} st={st} full={full} /> : null}
          {!full ? <div className="note">{t('cust.privacyNote')}</div> : null}
          {full && st ? <InsightsCharts st={st} /> : null}
          <OffersCard id={id} />
          <div className="card">
            <div style={{ padding: '16px 20px 0' }}>
              <div className="tabs">
                {(full ? TABS : TABS.slice(0, 1)).map(([k, label]) => (
                  <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
                    {t(label)}
                  </button>
                ))}
              </div>
            </div>
            {tab === 'appointments' ? <ApptsTab id={id} /> : null}
            {tab === 'sales' ? <SalesTab id={id} /> : null}
            {tab === 'loyalty' ? <LoyaltyTab id={id} /> : null}
            {tab === 'premium' ? <PremiumTab c={c} /> : null}
            {tab === 'prepaid' ? (
              c.prepaid ? (
                <div style={{ padding: 20 }}>
                  <div className="muted">{t('cust.availableBalance')}</div>
                  <div className="tnum" style={{ fontSize: 24, fontWeight: 700 }}>
                    {money(c.prepaid)}
                  </div>
                </div>
              ) : (
                <Empty title={t('cust.noPrepaid')} sub={t('cust.noPrepaidSub')} />
              )
            ) : null}
            {tab === 'activity' ? <ActivityTab id={id} /> : null}
          </div>
        </div>
      </div>
      {offerOpen ? (
        <OfferPanel
          c={c}
          close={() => setOfferOpen(false)}
          done={() => {
            setOfferOpen(false);
            toast(t('cust.offerCreatedToast'));
            void qc.invalidateQueries({ queryKey: ['offers', id] });
            void qc.invalidateQueries({ queryKey: ['activity', id] });
          }}
        />
      ) : null}
    </>
  );
}

function Empty({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{sub}</p>
    </div>
  );
}

function VisitCard({ title, v }: { title: string; v: NonNullable<CustomerInsights['firstVisit']> }) {
  return (
    <div className="card" style={{ padding: '16px 20px' }}>
      <div className="stat-label" style={{ marginBottom: 6 }}>
        {title} · {dateShort(v.date)}
      </div>
      {v.rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, fontWeight: 500, padding: '2px 0' }}>
          <span>
            {r.service} · {r.employeeName}
          </span>
          <span className="tnum">{money(r.amount)}</span>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </div>
  );
}

function KpiBlock({ c, st, full }: { c: CustomerProfile; st: CustomerInsights; full: boolean }) {
  const { t } = useTranslation();
  if (!full)
    return (
      <div className="grid4">
        <Stat label={t('cust.visits')} value={st.totals.visits} />
        <Stat label={t('cust.lastVisit')} value={st.totals.lastDate ? dateShort(st.totals.lastDate) : '—'} />
      </div>
    );
  return (
    <>
      <div className="grid4">
        <Stat label={t('cust.visits')} value={st.totals.visits} />
        <Stat label={t('cust.lifetimeSpend')} value={money(st.totals.spend)} />
        <Stat label={t('cust.avgPerVisit')} value={money(st.totals.avgSpend)} />
        <Stat label={t('cust.lastVisit')} value={st.totals.lastDate ? dateShort(st.totals.lastDate) : '—'} />
      </div>
      <div className="grid4">
        <Stat
          label={t('cust.favoriteService')}
          value={st.favoriteService?.name ?? '—'}
          hint={st.favoriteService ? t('cust.bookingsN', { n: st.favoriteService.count }) : ''}
        />
        <Stat
          label={t('cust.favoriteProduct')}
          value={st.favoriteProduct?.name ?? '—'}
          hint={st.favoriteProduct ? t('cust.boughtN', { n: st.favoriteProduct.qty }) : ''}
        />
        <Stat label={t('cust.loyaltyPoints')} value={c.points} />
        <Stat label={t('cust.prepaid')} value={money(c.prepaid)} />
      </div>
    </>
  );
}

function Bar({ label, val, max, extra }: { label: string; val: number; max: number; extra: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
      <span style={{ flex: '0 0 180px', minWidth: 0, fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <span style={{ flex: 1, background: 'var(--surface-muted)', borderRadius: 6, height: 14, overflow: 'hidden' }}>
        <span
          style={{
            display: 'block',
            height: '100%',
            width: `${max ? Math.max(3, Math.round((val / max) * 100)) : 0}%`,
            background: 'var(--accent)',
          }}
        />
      </span>
      <span className="tnum" style={{ flex: '0 0 auto', fontWeight: 600, fontSize: 13 }}>
        {extra}
      </span>
    </div>
  );
}

function Section({ title, pill, children }: { title: string; pill: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="card">
      <button
        style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 12, padding: '16px 20px', background: 'none', border: 0, cursor: 'pointer', textAlign: 'left', font: 'inherit' }}
        onClick={() => setOpen((v) => !v)}
      >
        <span style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>{title}</span>
        <span className="badge">{pill}</span>
        <span className={`caret ${open ? 'up' : ''}`}>
          <Icon d={I.down} size={18} w={2.2} />
        </span>
      </button>
      {open ? <div style={{ padding: '0 20px 16px' }}>{children}</div> : null}
    </div>
  );
}

function InsightsCharts({ st }: { st: CustomerInsights }) {
  const { t } = useTranslation();
  const maxS = st.services[0]?.count ?? 0;
  const maxT = st.times.reduce((m, x) => Math.max(m, x.count), 0);
  const spendRows = st.services.slice().sort((a, b) => b.spend - a.spend);
  const maxSp = spendRows[0]?.spend ?? 0;
  const maxP = st.products.reduce((m, p) => Math.max(m, p.spend), 0);
  return (
    <>
      <div className="card" style={{ padding: '16px 20px' }}>
        <div className="stat-label" style={{ marginBottom: 8 }}>
          {t('cust.trends')}
        </div>
        <p className="muted" style={{ fontWeight: 500, margin: 0 }}>
          {t('cust.noTrends')}
        </p>
      </div>
      <div className="card" style={{ padding: '16px 20px' }}>
        <div className="stat-label" style={{ marginBottom: 8 }}>
          {t('cust.suggestions')}
        </div>
        <p className="muted" style={{ fontWeight: 500, margin: 0 }}>
          {t('cust.noSuggestions')}
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span className="stat-label" style={{ flex: 1 }}>
          {t('cust.analytics')}
        </span>
      </div>
      <Section title={t('cust.mostBooked')} pill={st.services.length ? t('cust.nServices', { n: st.services.length }) : t('cust.noData')}>
        {st.services.length ? (
          st.services.map((s) => (
            <Bar key={s.name} label={s.name} val={s.count} max={maxS} extra={`${s.count}× · ${s.pct}%`} />
          ))
        ) : (
          <p className="muted" style={{ fontWeight: 500 }}>{t('cust.noCompleted')}</p>
        )}
      </Section>
      <Section title={t('cust.preferredTimes')} pill={st.times.length ? t('cust.byStartHour') : t('cust.noData')}>
        {st.times.length ? (
          st.times.map((x) => (
            <Bar key={x.hour} label={`${String(x.hour).padStart(2, '0')}:00`} val={x.count} max={maxT} extra={`${x.count}×`} />
          ))
        ) : (
          <p className="muted" style={{ fontWeight: 500 }}>{t('cust.noCompleted')}</p>
        )}
      </Section>
      <Section
        title={t('cust.spendByService')}
        pill={spendRows.length ? t('cust.top', { name: spendRows[0]!.name }) : t('cust.noData')}
      >
        {spendRows.length ? (
          <>
            {spendRows.map((s) => (
              <Bar key={s.name} label={s.name} val={s.spend} max={maxSp} extra={money(s.spend)} />
            ))}
            {st.products.length ? (
              <>
                <div className="stat-label" style={{ margin: '10px 0 4px' }}>
                  {t('cust.productsAtTill')}
                </div>
                {st.products.map((p) => (
                  <Bar key={p.name} label={p.name} val={p.spend} max={maxP} extra={money(p.spend)} />
                ))}
              </>
            ) : null}
          </>
        ) : (
          <p className="muted" style={{ fontWeight: 500 }}>{t('cust.noCompleted')}</p>
        )}
      </Section>
    </>
  );
}

function OffersCard({ id }: { id: string }) {
  const { t } = useTranslation();
  const { can } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const offers = useQuery({
    queryKey: ['offers', id],
    queryFn: () => get(PersonalOfferListSchema, `/customers/${id}/offers`),
  });
  const decide = async (oid: string, action: 'cancel' | 'redeem') => {
    try {
      await post(z.object({ ok: z.literal(true) }), `/personal-offers/${oid}/${action}`, {});
      toast(t(action === 'cancel' ? 'cust.offerCancelledToast' : 'cust.offerRedeemedToast'));
      void qc.invalidateQueries({ queryKey: ['offers', id] });
      void qc.invalidateQueries({ queryKey: ['activity', id] });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'failed');
    }
  };
  const rows = offers.data?.offers ?? [];
  if (!rows.length) return null;
  const tone = { live: 'success', redeemed: 'accent', cancelled: '', expired: 'warning' } as const;
  return (
    <div className="card">
      <div className="card-header">
        <h2>{t('cust.offers')}</h2>
      </div>
      {rows.map((o) => (
        <div className="rowcard" key={o.id}>
          <span className="grow">
            <span className="t">{o.serviceName}</span>
            <span className="s">
              <s className="tnum">{money(o.normalPrice)}</s>{' '}
              <strong className="tnum">{money(o.specialPrice)}</strong> · {t('cust.validUntil')}{' '}
              {dateShort(o.validUntil)}
              {o.intent ? ` · ${o.intent}` : ''}
            </span>
          </span>
          <span className={`badge ${tone[o.status]}`}>{o.status}</span>
          {o.status === 'live' && can('marketing.personal_offers') ? (
            <span className="acts">
              <button className="btn btn-ghost btn-sm" onClick={() => void decide(o.id, 'redeem')}>
                {t('cust.redeemOffer')}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--danger)' }}
                onClick={() => void decide(o.id, 'cancel')}
              >
                {t('cust.cancelOffer')}
              </button>
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ApptsTab({ id }: { id: string }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['custAppts', id],
    queryFn: () => get(CustomerApptsSchema, `/customers/${id}/appointments`),
  });
  const d = q.data;
  if (!d) return null;
  if (!d.upcoming.length && !d.history.length)
    return <Empty title={t('cust.noAppointments')} sub={t('cust.noAppointmentsSub')} />;
  return (
    <table>
      <thead>
        <tr>
          <th>{t('cust.service')}</th>
          <th>{t('cust.time')}</th>
          <th>{t('cust.status')}</th>
          <th className="right">{t('cust.price')}</th>
        </tr>
      </thead>
      <tbody>
        {d.upcoming.map((a) => (
          <tr key={a.id}>
            <td className="bold">
              {a.serviceName}
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                {a.locationName}
              </span>
            </td>
            <td className="muted tnum">
              {dateShort(a.date)} · {a.start} – {a.end}
            </td>
            <td>
              <span className="badge accent">{t('cust.upcoming')}</span>
            </td>
            <td className="right bold tnum">{money(a.price)}</td>
          </tr>
        ))}
        {d.history.map((a) => (
          <tr key={a.id} className={a.status === 'cancelled' || a.status === 'no_show' ? 'dim' : ''}>
            <td className="bold">
              {a.serviceName}
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                {a.locationName} · {a.employeeName ?? '—'}
              </span>
            </td>
            <td className="muted tnum">
              {dateShort(a.date)} · {a.start} – {a.end}
            </td>
            <td>
              <span className={`badge ${a.status === 'cancelled' || a.status === 'no_show' ? 'danger' : 'success'}`}>
                {a.status.replace('_', ' ')}
              </span>
            </td>
            <td className="right bold tnum">{money(a.price)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SalesTab({ id }: { id: string }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['custInvoices', id],
    queryFn: () => get(CustomerInvoicesSchema, `/customers/${id}/invoices`),
  });
  const rows = q.data?.invoices ?? [];
  if (q.data && !rows.length)
    return <Empty title={t('cust.nothingBought')} sub={t('cust.nothingBoughtSub')} />;
  return (
    <table>
      <thead>
        <tr>
          <th>{t('cust.invoice')}</th>
          <th>{t('cust.date')}</th>
          <th>{t('cust.method')}</th>
          <th className="right">{t('cust.total')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((i) => (
          <tr key={i.id}>
            <td className="bold tnum">{i.number}</td>
            <td className="muted tnum">{dateShort(i.date)}</td>
            <td className="muted">{i.method}</td>
            <td className="right bold tnum">{money(i.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LoyaltyTab({ id }: { id: string }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['custLoyalty', id],
    queryFn: () => get(CustomerLoyaltySchema, `/customers/${id}/loyalty`),
  });
  const d = q.data;
  if (!d) return null;
  return (
    <>
      <div style={{ padding: '20px 20px 0', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div>
          <span className="stat-label">{t('cust.balance')}</span>
          <div className="tnum" style={{ fontSize: 24, fontWeight: 700 }}>
            {t('cust.pointsN', { n: d.balance })}
          </div>
        </div>
        <div>
          <span className="stat-label">{t('cust.worth')}</span>
          <div className="tnum" style={{ fontSize: 24, fontWeight: 700 }}>
            {money(d.worth)}
          </div>
        </div>
        <div>
          <span className="stat-label">{t('cust.nextReward')}</span>
          <div className="tnum" style={{ fontSize: 24, fontWeight: 700 }}>
            {d.nextRewardAt} {t('cust.pts')}
          </div>
        </div>
      </div>
      {d.rows.length ? (
        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>{t('cust.reason')}</th>
              <th>{t('cust.reference')}</th>
              <th>{t('cust.date')}</th>
              <th className="right">{t('cust.change')}</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((l) => (
              <tr key={l.id}>
                <td className="bold">{l.reason}</td>
                <td className="muted tnum">{l.ref}</td>
                <td className="muted tnum">{dateShort(l.when)}</td>
                <td className={`right bold tnum ${l.points < 0 ? 'down' : 'up'}`}>
                  {l.points > 0 ? '+' : ''}
                  {l.points}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty title={t('cust.noPoints')} sub={t('cust.noPointsSub')} />
      )}
    </>
  );
}

function PremiumTab({ c }: { c: CustomerProfile }) {
  const { t } = useTranslation();
  if (!c.premium) return <Empty title={t('cust.notPremium')} sub={t('cust.notPremiumSub')} />;
  const tone = c.premium.status === 'active' ? 'success' : c.premium.status === 'expired' ? '' : 'danger';
  return (
    <div style={{ padding: '4px 0' }}>
      <div className="grid4" style={{ marginBottom: 14, padding: '0 20px' }}>
        <Stat label={t('cust.status')} value={<span className={`badge ${tone}`}>{c.premium.status}</span>} />
        <Stat label={t('cust.memberSince')} value={dateShort(c.premium.since)} />
        <Stat
          label={c.premium.status === 'active' ? t('cust.renews') : t('cust.ended')}
          value={dateShort(c.premium.renews)}
        />
        <Stat
          label={t('cust.loyaltyBonus')}
          value={c.premium.status === 'active' ? '×1.5' : '—'}
          hint={t('cust.onEveryPurchase')}
        />
      </div>
      <div className="note" style={{ margin: '0 20px 20px' }}>
        {t('cust.premiumNote')}
      </div>
    </div>
  );
}

function ActivityTab({ id }: { id: string }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['activity', id],
    queryFn: () => get(ActivityListSchema, `/customers/${id}/activity`),
  });
  const rows = q.data?.entries ?? [];
  if (q.data && !rows.length)
    return <Empty title={t('cust.noActivity')} sub={t('cust.noActivitySub')} />;
  const lbl: Record<string, string> = {
    offer_created: t('cust.offerCreated'),
    offer_cancelled: t('cust.offerCancelled'),
    offer_redeemed: t('cust.offerRedeemed'),
  };
  return (
    <table>
      <thead>
        <tr>
          <th>{t('cust.when')}</th>
          <th>{t('cust.what')}</th>
          <th>{t('cust.reference')}</th>
          <th className="right">{t('cust.amount')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a.id}>
            <td className="muted tnum">{a.ts.slice(0, 16).replace('T', ' ')}</td>
            <td className="bold">
              {lbl[a.type] ?? a.type}
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                {String(a.meta.intent ?? '')}
              </span>
            </td>
            <td className="muted tnum">{a.refId || '—'}</td>
            <td className="right bold tnum">{a.meta.amount ? money(Number(a.meta.amount)) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OfferPanel({
  c,
  close,
  done,
}: {
  c: CustomerProfile;
  close: () => void;
  done: () => void;
}) {
  const { t } = useTranslation();
  const locations = useLocations();
  const live = (locations.data?.locations ?? []).filter((l) => l.lifecycle === 'ACTIVE');
  const [locId, setLocId] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [until, setUntil] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [intent, setIntent] = useState('win_back');
  const [error, setError] = useState<string | null>(null);
  const loc = locId ?? live[0]?.id ?? null;
  const catalog = useQuery({
    queryKey: ['catalog', loc],
    queryFn: () =>
      get(
        z.object({ services: z.array(z.object({ id: z.uuid(), name: z.string(), config: z.object({ active: z.boolean(), price: z.number() }) }).loose()) }),
        `/locations/${loc}/catalog`,
      ),
    enabled: !!loc,
  });
  const services = (catalog.data?.services ?? []).filter((s) => s.config.active);
  const svc = serviceId ?? services[0]?.id ?? null;
  const normal = services.find((s) => s.id === svc)?.config.price;

  const create = async () => {
    setError(null);
    try {
      await post(PersonalOfferSchema, `/customers/${c.id}/offers`, {
        ...PersonalOfferCreateSchema.parse({
          serviceId: svc,
          locationId: loc,
          specialPrice: Number(price),
          validUntil: until,
          intent,
        }),
      });
      done();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'failed');
    }
  };

  return (
    <div className="panel-wrap open">
      <div className="scrim" onClick={close} />
      <aside className="panel">
        <div className="panel-head">
          <div>
            <h2>{t('cust.offerFor', { name: c.name.split(' ')[0] })}</h2>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={close}>
            ✕
          </button>
        </div>
        <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label className="field">
            <span>{t('hq.location')}</span>
            <select className="select" value={loc ?? ''} onChange={(e) => setLocId(e.target.value)}>
              {live.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('cust.service')}</span>
            <select className="select" value={svc ?? ''} onChange={(e) => setServiceId(e.target.value)}>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('cust.specialPrice')}</span>
            <input className="input" type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
            {normal != null ? <span className="hint">{t('cust.normally', { price: money(normal) })}</span> : null}
          </label>
          <label className="field">
            <span>{t('cust.validUntil')}</span>
            <input className="input" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('cust.intent')}</span>
            <select className="select" value={intent} onChange={(e) => setIntent(e.target.value)}>
              {['win_back', 'birthday', 'lapsed_service', 'high_value'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          {error ? (
            <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>
              {error}
            </p>
          ) : null}
        </div>
        <div className="panel-foot">
          <button className="btn btn-secondary" onClick={close}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" disabled={!svc || !loc || !price} onClick={() => void create()}>
            {t('cust.create')}
          </button>
        </div>
      </aside>
    </div>
  );
}
