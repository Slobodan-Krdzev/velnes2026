import type {
  HqMeResponseSchema} from '@velnes/contracts';
import {
  HqApproveResponseSchema,
  HqAuditListSchema,
  HqBusinessListSchema,
  HqLocationQueueSchema,
  HqLocationReviewSchema,
  RegistrationStatusSchema,
  HqRegistrationListSchema,
} from '@velnes/contracts';
import type { Lang } from '@velnes/i18n';
import { VelnesMark } from '@velnes/ui';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { HqApiError, hqGet, hqPost } from './api.js';

/** The prototype's viewHQ: the customers pane is the intake table —
 *  new locations, new registrations, then every business on the
 *  platform. Suppliers and HQ team wait for their phases, honestly. */

type HqUser = z.infer<typeof HqMeResponseSchema>;
type Tab = 'customers' | 'suppliers' | 'team' | 'audit';
const DecisionResp = z.object({ id: z.uuid(), lifecycle: z.string() });
const RegDecisionResp = z.object({ id: z.uuid(), status: RegistrationStatusSchema });

export function Hq({
  user,
  setLang,
  signOut,
}: {
  user: HqUser;
  setLang: (l: Lang) => void;
  signOut: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>('customers');
  const [toast, setToast] = useState<string | null>(null);
  const say = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const tabs: [Tab, string][] = [
    ['customers', t('hq.tabCustomers')],
    ['suppliers', t('hq.tabSuppliers')],
    ['team', t('hq.tabTeam')],
    ['audit', t('hq.tabAudit')],
  ];

  return (
    <div className="app" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="topbar" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '0 20px' }}>
        <span style={{ color: 'var(--accent-deep)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <VelnesMark size={26} />
          <strong>Revelapps HQ</strong>
        </span>
        <div className="cat-tabs" style={{ marginLeft: 12 }}>
          {tabs.map(([k, l]) => (
            <button key={k} className={`ttab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>
              {l}
            </button>
          ))}
        </div>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <select
            className="select"
            aria-label="Language"
            value={i18n.language}
            onChange={(e) => setLang(e.target.value as Lang)}
          >
            <option value="en">EN</option>
            <option value="mk">МК</option>
            <option value="sq">SQ</option>
          </select>
          <span className="badge">
            {t('hq.signedInAs')} {user.name} · {user.role}
          </span>
          <button className="btn btn-subtle btn-sm" onClick={signOut}>
            {t('hq.signOut')}
          </button>
        </span>
      </header>
      <main style={{ flex: 1, padding: 24, maxWidth: 1280, width: '100%', margin: '0 auto' }}>
        {tab === 'customers' ? <Customers say={say} /> : null}
        {tab === 'suppliers' ? (
          <div className="empty">
            <h3>{t('hq.comingSoon')}</h3>
            <p>{t('hq.suppliersSoon')}</p>
          </div>
        ) : null}
        {tab === 'team' ? (
          <div className="empty">
            <h3>{t('hq.comingSoon')}</h3>
            <p>{t('hq.teamSoon')}</p>
          </div>
        ) : null}
        {tab === 'audit' ? <PlatformLog /> : null}
      </main>
      {toast ? <div className="toast show">{toast}</div> : null}
    </div>
  );
}

function Customers({ say }: { say: (m: string) => void }) {
  const { t } = useTranslation();
  const [openLoc, setOpenLoc] = useState<string | null>(null);
  const [regs, setRegs] = useState<z.infer<typeof HqRegistrationListSchema> | null>(null);
  const [queue, setQueue] = useState<z.infer<typeof HqLocationQueueSchema> | null>(null);
  const [biz, setBiz] = useState<z.infer<typeof HqBusinessListSchema> | null>(null);
  const [regReq, setRegReq] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const reload = useCallback(() => {
    void hqGet(HqRegistrationListSchema, '/hq/registrations').then(setRegs);
    void hqGet(HqLocationQueueSchema, '/hq/locations').then(setQueue);
    void hqGet(HqBusinessListSchema, '/hq/businesses').then(setBiz);
  }, []);
  useEffect(reload, [reload]);

  if (openLoc)
    return (
      <LocReview
        id={openLoc}
        back={() => {
          setOpenLoc(null);
          reload();
        }}
        say={say}
      />
    );

  const pend = (regs?.registrations ?? []).filter(
    (r) => r.status === 'pending_review' || r.status === 'resubmitted',
  );
  const nlq = queue?.locations ?? [];

  const decide = async (id: string, what: 'approve' | 'decline' | 'request_changes') => {
    try {
      if (what === 'approve') {
        const r = await hqPost(HqApproveResponseSchema, `/hq/registrations/${id}/approve`);
        say(t('hq.activated', { name: r.ownerEmail }));
      } else if (what === 'decline') {
        await hqPost(RegDecisionResp, `/hq/registrations/${id}/decline`);
        say(t('hq.declined'));
      } else {
        if (!reason.trim()) {
          say(t('hq.reasonNeeded'));
          return;
        }
        await hqPost(RegDecisionResp, `/hq/registrations/${id}/request-changes`, { reason });
        say(t('hq.sentBack'));
        setRegReq(null);
        setReason('');
      }
      reload();
    } catch (e) {
      say(e instanceof HqApiError ? e.message : 'failed');
    }
  };

  return (
    <div className="stacked">
      {nlq.length ? (
        <div className="card">
          <div className="card-header">
            <h2>{t('hq.newLocations')}</h2>
            <span className="badge warning">{t('hq.awaiting', { n: nlq.length })}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>{t('hq.location')}</th>
                <th>{t('hq.business')}</th>
                <th>{t('hq.city')}</th>
                <th>{t('hq.legalEntity')}</th>
                <th>{t('hq.state')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {nlq.map((l) => (
                <tr key={l.id}>
                  <td className="bold">{l.name}</td>
                  <td className="muted">{l.businessName}</td>
                  <td className="muted">{l.city ?? '—'}</td>
                  <td className="muted">
                    {l.legalName ?? '—'}{' '}
                    {l.legalStatus === 'pending' ? (
                      <span className="badge warning">{t('hq.newCompound')}</span>
                    ) : null}
                  </td>
                  <td>
                    <span className="badge warning">{l.lifecycle}</span>
                  </td>
                  <td className="right">
                    <button className="btn btn-secondary btn-sm" onClick={() => setOpenLoc(l.id)}>
                      {t('hq.review')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {pend.length ? (
        <div className="card">
          <div className="card-header">
            <h2>{t('hq.newRegistrations')}</h2>
            <span className="badge warning">{t('hq.awaiting', { n: pend.length })}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>{t('hq.salon')}</th>
                <th>{t('hq.owner')}</th>
                <th>{t('hq.city')}</th>
                <th>{t('hq.legalEntity')}</th>
                <th>{t('hq.emailCheck')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pend.map((rw) => (
                <>
                  <tr key={rw.id}>
                    <td className="bold">
                      {rw.salonName}
                      <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                        {rw.salonType}
                      </span>
                    </td>
                    <td className="muted">
                      {rw.ownerName}
                      <span style={{ display: 'block', fontSize: 12 }}>{rw.ownerEmail}</span>
                    </td>
                    <td className="muted">{rw.city}</td>
                    <td className="muted">
                      {rw.legalName}
                      <span className="tnum" style={{ display: 'block', fontSize: 12 }}>
                        {rw.taxId}
                      </span>
                    </td>
                    <td>
                      {rw.emailVerifiedAt ? (
                        <span className="badge success">{t('hq.verified')}</span>
                      ) : (
                        <span className="badge">{t('hq.awaitingSmtp')}</span>
                      )}
                    </td>
                    <td className="right">
                      <span className="rowact">
                        <button className="btn btn-ghost btn-sm" onClick={() => void decide(rw.id, 'approve')}>
                          {t('hq.verifyActivate')}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setRegReq(regReq === rw.id ? null : rw.id)}
                        >
                          {t('hq.requestChanges')}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--danger)' }}
                          onClick={() => void decide(rw.id, 'decline')}
                        >
                          {t('hq.decline')}
                        </button>
                      </span>
                    </td>
                  </tr>
                  {regReq === rw.id ? (
                    <tr key={`${rw.id}-reason`}>
                      <td colSpan={6}>
                        <div className="hstack" style={{ gap: 10 }}>
                          <input
                            className="input"
                            placeholder={t('hq.reasonPh')}
                            style={{ flex: 1 }}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                          />
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => void decide(rw.id, 'request_changes')}
                          >
                            {t('hq.sendBack')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!nlq.length && !pend.length && regs && queue ? (
        <div className="note">{t('hq.noQueue')}</div>
      ) : null}

      <div className="card">
        <div className="card-header">
          <h2>{t('hq.businesses')}</h2>
          <span className="muted" style={{ fontWeight: 500 }}>
            {t('hq.accounts', { n: biz?.businesses.length ?? 0 })}
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th>{t('hq.business')}</th>
              <th>{t('hq.owner')}</th>
              <th>{t('hq.locationsCol')}</th>
              <th>{t('hq.teamCol')}</th>
              <th>{t('hq.bookingLinkCol')}</th>
            </tr>
          </thead>
          <tbody>
            {(biz?.businesses ?? []).map((b) => (
              <tr key={b.id}>
                <td className="bold">{b.name}</td>
                <td>
                  {b.ownerName ?? '—'}
                  <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                    {b.ownerEmail ?? ''}
                  </span>
                </td>
                <td className="tnum">
                  {b.locations}{' '}
                  {b.liveLocations ? (
                    <span className="badge success">{b.liveLocations} {t('hq.live')}</span>
                  ) : null}
                </td>
                <td className="tnum">{b.employees}</td>
                <td className="muted">{b.slug ? `velnes.mk/book/${b.slug}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LocReview({ id, back, say }: { id: string; back: () => void; say: (m: string) => void }) {
  const { t } = useTranslation();
  const [l, setL] = useState<z.infer<typeof HqLocationReviewSchema> | null>(null);
  const [reason, setReason] = useState('');
  useEffect(() => {
    void hqGet(HqLocationReviewSchema, `/hq/locations/${id}`).then(setL).catch(() => setL(null));
  }, [id]);
  if (!l) return <p className="muted">{t('hq.notFound')}</p>;

  const decide = async (action: 'approve' | 'request_changes') => {
    try {
      await hqPost(DecisionResp, `/hq/locations/${id}/decision`, {
        action,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      say(action === 'approve' ? t('hq.approvedToast') : t('hq.sentBack'));
      back();
    } catch (e) {
      say(e instanceof HqApiError ? e.message : 'failed');
    }
  };

  return (
    <div className="stacked">
      <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={back}>
        ← {t('hq.allNewLocations')}
      </button>
      <div className="card" style={{ padding: 20 }}>
        <div className="hstack" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>{l.name}</h2>
          <span className="badge warning">{l.lifecycle}</span>
        </div>
        <div className="kv">
          <span className="k">{t('hq.business')}</span>
          <span className="v">
            {l.businessName} <span className="badge success">{t('hq.verified').toLowerCase()}</span>
          </span>
        </div>
        <div className="kv">
          <span className="k">{t('hq.address')}</span>
          <span className="v">
            {l.address ?? '—'}, {l.city ?? '—'}
          </span>
        </div>
        <div className="kv">
          <span className="k">{t('hq.contact')}</span>
          <span className="v">
            {l.phone ?? '—'} · {l.tz}
          </span>
        </div>
        <div className="kv">
          <span className="k">{t('hq.invoicePrefix')}</span>
          <span className="v tnum">{l.invPrefix}</span>
        </div>
        <div className="kv">
          <span className="k">{t('hq.legalEntity')}</span>
          <span className="v">
            {l.legal ? (
              <>
                {l.legal.name} · {l.legal.taxId}{' '}
                <span className={`badge ${l.legal.status === 'verified' ? 'success' : 'warning'}`}>
                  {l.legal.status}
                </span>
              </>
            ) : (
              <span className="badge danger">{t('hq.noneAttached')}</span>
            )}
          </span>
        </div>
        {l.paymentAccount ? (
          <div className="kv">
            <span className="k">{t('hq.paymentAccount')}</span>
            <span className="v">
              {l.paymentAccount.provider}{' '}
              <span className={`badge ${l.paymentAccount.status === 'active' ? 'success' : 'warning'}`}>
                {l.paymentAccount.status}
              </span>
            </span>
          </div>
        ) : null}
        {l.compound ? (
          <div className="note warn" style={{ marginTop: 10 }}>
            {t('hq.compoundNote')}
          </div>
        ) : null}
        {l.log.length ? (
          <div className="note" style={{ marginTop: 10 }}>
            {l.log.map((e, i) => (
              <span key={i} style={{ display: 'block' }}>
                {e.from} → {e.to}
                {e.reason ? ` — ${e.reason}` : ''}
              </span>
            ))}
          </div>
        ) : null}
        <div className="field" style={{ marginTop: 14 }}>
          <label>{t('hq.reasonLabel')}</label>
          <input
            className="input"
            placeholder={t('hq.reasonPh2')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="hstack" style={{ gap: 10, marginTop: 12 }}>
          <button className="btn btn-primary" onClick={() => void decide('approve')}>
            {l.compound ? t('hq.approveCompound') : t('hq.approve')}
          </button>
          <button className="btn btn-secondary" onClick={() => void decide('request_changes')}>
            {t('hq.requestChanges')}
          </button>
        </div>
        <div className="note" style={{ marginTop: 10 }}>
          {t('hq.approveNote')}
        </div>
      </div>
    </div>
  );
}

function PlatformLog() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<z.infer<typeof HqAuditListSchema> | null>(null);
  useEffect(() => {
    void hqGet(HqAuditListSchema, '/hq/audit?limit=80').then(setRows);
  }, []);
  return (
    <div className="card">
      <div className="card-header">
        <h2>{t('hq.tabAudit')}</h2>
      </div>
      <table>
        <thead>
          <tr>
            <th>{t('hq.when')}</th>
            <th>{t('hq.tenant')}</th>
            <th>{t('hq.who')}</th>
            <th>{t('hq.action')}</th>
            <th>{t('hq.what')}</th>
            <th>{t('hq.change')}</th>
          </tr>
        </thead>
        <tbody>
          {(rows?.entries ?? []).map((e) => (
            <tr key={e.id}>
              <td className="muted tnum" style={{ whiteSpace: 'nowrap' }}>
                {e.ts.slice(0, 16).replace('T', ' ')}
              </td>
              <td className="muted">{e.tenantName}</td>
              <td>{e.actorName}</td>
              <td className="bold">{e.action}</td>
              <td className="muted">{e.object}</td>
              <td className="muted">
                {e.before !== '—' || e.after !== '—' ? `${e.before} → ${e.after}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
