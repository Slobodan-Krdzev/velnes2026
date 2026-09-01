import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AuditListResponseSchema,
  PERM_GROUPS,
  ReadinessResponseSchema,
  RoleListResponseSchema,
  scopeChoices,
  TransitionResponseSchema,
  type Employee,
  type Location,
  type PermKey,
  type PermMap,
  type Role,
} from '@velnes/contracts';
import { I, Icon } from '@velnes/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api, get, post } from '@velnes/client';
import { useEmployees, useLocations } from '../../api/queries.js';
import { BookingSection } from './BookingSection.js';
import { CompanySection } from './CompanySection.js';
import { CustomersSettingsSection } from './CustomersSettingsSection.js';
import { EmployeesSection } from './EmployeesSection.js';
import { GeneralSection } from './GeneralSection.js';
import { HoursSection } from './HoursSection.js';
import { MarketplaceSection } from './MarketplaceSection.js';
import { NewLocationWizard } from './NewLocation.js';
import { RankingSection } from './RankingSection.js';
import { SalesSection } from './SalesSection.js';
import { PanelPortal } from '../../lib/Panel.js';
import { useToast } from '../../lib/toast.js';
import { refusalText } from '@velnes/client';
import { useSession } from '@velnes/client';

const OkSchema = z.object({ ok: z.literal(true) });
const IdSchema = z.object({ id: z.string() });

type SectionId =
  | 'general'
  | 'company'
  | 'locations'
  | 'team'
  | 'roles'
  | 'employees'
  | 'ranking'
  | 'calendar'
  | 'booking'
  | 'marketplace'
  | 'customers'
  | 'sales'
  | 'audit';

/** The prototype's SEC_PERM — every section hangs off one right. */
const SEC_PERM: Record<SectionId, PermKey> = {
  general: 'locations.manage',
  company: 'locations.manage',
  locations: 'locations.manage',
  team: 'users.manage',
  roles: 'roles.manage',
  employees: 'users.manage',
  ranking: 'ranking.manage',
  calendar: 'locations.manage',
  booking: 'widget.manage',
  marketplace: 'widget.manage',
  customers: 'customers.view_business',
  sales: 'payments.manage',
  audit: 'roles.manage',
};

export function SettingsPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const raw: ([`#${string}`, string] | [SectionId, string])[] = [
    ['#Business', ''],
    ['general', t('settings.general')],
    ['company', t('settings.company')],
    ['locations', t('settings.locations')],
    ['#People', ''],
    ['team', t('settings.team')],
    ['roles', t('settings.roles')],
    ['employees', t('settings.employees')],
    ['ranking', t('settings.ranking')],
    ['#Selling', ''],
    ['calendar', t('settings.openingHours')],
    ['booking', t('settings.booking')],
    ['marketplace', t('settings.marketplace')],
    ['customers', t('settings.customersSection')],
    ['sales', t('settings.sales')],
    ['#Governance', ''],
    ['audit', t('settings.audit')],
  ];
  const allowed = raw.filter(
    ([id]) => id.startsWith('#') || can(SEC_PERM[id as SectionId]),
  );
  // A group header only stays when something is left under it.
  const visible = allowed.filter(([id], i) => {
    if (!id.startsWith('#')) return true;
    const next = allowed[i + 1];
    return !!next && !next[0].startsWith('#');
  });
  const first = visible.find(([id]) => !id.startsWith('#'))?.[0] as SectionId | undefined;
  const [tab, setTab] = useState<SectionId>(first ?? 'general');

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-context">
          <span className="k">{t('nav.settings')}</span>
          <span className="v">
            {visible.find(([id]) => id === tab)?.[1] ?? ''}
          </span>
        </div>
        <div className="toolbar-actions" />
      </div>
      <div className="settings-layout">
        <nav className="snav">
          {visible.map(([id, label]) =>
            id.startsWith('#') ? (
              <span key={id} className="snav-label">
                {id.slice(1)}
              </span>
            ) : (
              <button
                key={id}
                className={tab === id ? 'active' : ''}
                onClick={() => setTab(id as SectionId)}
              >
                {label}
              </button>
            ),
          )}
        </nav>
        <div className="settings-pane">
          {tab === 'general' ? (
            <GeneralSection openEmployees={() => setTab('employees')} />
          ) : null}
          {tab === 'company' ? <CompanySection /> : null}
          {tab === 'locations' ? <LocationsSection /> : null}
          {tab === 'team' ? <TeamSection openAudit={() => setTab('audit')} /> : null}
          {tab === 'roles' ? <RolesSection /> : null}
          {tab === 'employees' ? <EmployeesSection /> : null}
          {tab === 'ranking' ? <RankingSection /> : null}
          {tab === 'calendar' ? <HoursSection /> : null}
          {tab === 'booking' ? <BookingSection /> : null}
          {tab === 'marketplace' ? <MarketplaceSection /> : null}
          {tab === 'customers' ? <CustomersSettingsSection /> : null}
          {tab === 'sales' ? <SalesSection /> : null}
          {tab === 'audit' ? <AuditSection /> : null}
        </div>
      </div>
    </>
  );
}

function LocationsSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const { me } = useSession();
  const locations = useLocations();
  const employees = useEmployees();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const isOwner = me?.access === 'owner';

  const transition = async (id: string, to: string) => {
    setError(null);
    try {
      await post(TransitionResponseSchema, `/locations/${id}/transitions`, { to });
      toast(t('settings.lifecycleDone', { to }));
      void qc.invalidateQueries({ queryKey: ['locations'] });
      void qc.invalidateQueries({ queryKey: ['readiness'] });
    } catch (e) {
      setError(refusalText(t, e));
    }
  };

  const all = locations.data?.locations ?? [];
  if (adding) return <NewLocationWizard done={() => setAdding(false)} />;
  return (
    <div className="stacked">
      {error ? (
        <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>
          {error}
        </p>
      ) : null}
      <div className="card">
        <div className="card-header">
          <h2>{t('settings.locations')}</h2>
        </div>
        <div className="grid4" style={{ padding: 20, gap: 16 }}>
          <div className="stat">
            <span className="stat-label">{t('settings.locations')}</span>
            <span className="stat-value">{all.length}</span>
            <span className="stat-hint">
              {all.filter((l) => l.lifecycle === 'ACTIVE').length} {t('shell.open').toLowerCase()}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">{t('settings.users')}</span>
            <span className="stat-value">{employees.data?.employees.length ?? '—'}</span>
            <span className="stat-hint">
              {employees.data?.employees.filter((e) => e.status === 'invited').length ?? 0}{' '}
              {t('settings.invitesOut')}
            </span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>{t('settings.locations')}</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
            {t('nloc.addLocation')} <Icon d={I.plus} size={18} w={2.5} />
          </button>
        </div>
        {all.map((l) => (
          <LocationRow key={l.id} l={l} isOwner={isOwner} transition={transition} />
        ))}
      </div>
    </div>
  );
}

function LocationRow({
  l,
  isOwner,
  transition,
}: {
  l: Location;
  isOwner: boolean;
  transition: (id: string, to: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const lc = l.lifecycle;
  const readiness = useQuery({
    queryKey: ['readiness', l.id],
    queryFn: () => get(ReadinessResponseSchema, `/locations/${l.id}/readiness`),
    enabled: lc === 'APPROVED',
  });
  const lcBadge =
    lc === 'ACTIVE' ? (
      <span className="badge success">Active</span>
    ) : (
      <span className="badge warning">{lc.replace('_', ' ')}</span>
    );
  let lcBlock = null;
  if (lc === 'DRAFT')
    lcBlock = (
      <div className="note" style={{ margin: '8px 0 0' }}>
        {t('settings.draftNote')}{' '}
        <button
          className="btn btn-primary btn-sm"
          style={{ marginLeft: 8 }}
          onClick={() => void transition(l.id, 'SUBMITTED')}
        >
          {t('settings.submitVerification')}
        </button>
      </div>
    );
  if (lc === 'SUBMITTED' || lc === 'UNDER_REVIEW' || lc === 'RESUBMITTED')
    lcBlock = (
      <div className="note" style={{ margin: '8px 0 0' }}>
        {t('settings.withHq')}
      </div>
    );
  if (lc === 'CHANGES_REQUIRED')
    lcBlock = (
      <div className="note warn" style={{ margin: '8px 0 0' }}>
        <b>{t('settings.hqChanges')}</b>{' '}
        <button
          className="btn btn-primary btn-sm"
          style={{ marginLeft: 8 }}
          onClick={() => void transition(l.id, 'RESUBMITTED')}
        >
          {t('settings.resubmit')}
        </button>
      </div>
    );
  if (lc === 'APPROVED') {
    const r = readiness.data;
    lcBlock = (
      <div className="note" style={{ margin: '8px 0 0' }}>
        <b>{t('settings.verifiedByHq')}</b> {t('settings.activationChecklist')}:
        {(r?.items ?? []).map((i) => (
          <span key={i.k} style={{ display: 'block' }}>
            {i.ok ? '✓' : '✗'} {i.label}
          </span>
        ))}
        <span style={{ display: 'block', color: 'var(--ink-muted)' }}>
          {t('settings.cosmeticsNote')}
        </span>
        {isOwner ? (
          <button
            className="btn btn-primary btn-sm"
            style={{ marginTop: 6 }}
            disabled={!r?.ok}
            onClick={() => void transition(l.id, 'ACTIVE')}
          >
            {t('settings.activate')}
          </button>
        ) : (
          <span style={{ display: 'block', marginTop: 6 }}>{t('settings.ownerOnly')}</span>
        )}
      </div>
    );
  }
  if (lc === 'ACTIVE')
    lcBlock = (
      <div style={{ marginTop: 8 }}>
        <button
          className="btn btn-subtle btn-sm"
          onClick={() => void transition(l.id, 'SUSPENDED')}
        >
          {t('settings.suspend')}
        </button>
      </div>
    );
  if (lc === 'SUSPENDED')
    lcBlock = (
      <div style={{ marginTop: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={() => void transition(l.id, 'ACTIVE')}>
          {t('settings.reactivate')}
        </button>
      </div>
    );

  return (
    <div className="rowcard" style={{ flexWrap: 'wrap' }}>
      <span className={`mark${lc === 'ACTIVE' ? ' on' : ''}`}>{l.name[0]}</span>
      <span className="grow">
        <span className="t">{l.name}</span>
        <span className="s">
          {l.address}, {l.city} · {l.tz} · {l.rooms} rooms
        </span>
      </span>
      {lcBadge}
      <span className={`badge${l.online ? ' accent' : ''}`}>
        {l.online ? t('settings.bookableOnline') : t('settings.notOnline')}
      </span>
      <span style={{ flexBasis: '100%' }}>{lcBlock}</span>
    </div>
  );
}

const inits = (n: string) =>
  n
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

/** The prototype's setTeam(): the Users table, the invite lade and
 *  the per-user locations panel — every act through the real doors. */
function TeamSection({ openAudit }: { openAudit: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const { me } = useSession();
  const employees = useEmployees();
  const locations = useLocations();
  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => get(RoleListResponseSchema, '/roles'),
  });
  const audit = useQuery({
    queryKey: ['audit'],
    queryFn: () => get(AuditListResponseSchema, '/audit?limit=100'),
  });
  const [inviting, setInviting] = useState(false);
  const [locsFor, setLocsFor] = useState<string | null>(null);

  const patchEmp = async (id: string, body: Record<string, unknown>) => {
    try {
      await api(z.unknown(), `/employees/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      toast(t('catalog.saved'));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
    void qc.invalidateQueries({ queryKey: ['employees'] });
  };
  const allLocs = locations.data?.locations ?? [];
  const locName = (id: string) => allLocs.find((l) => l.id === id)?.name ?? '';
  const accessChanges = (audit.data?.entries ?? [])
    .filter((a) => /Role|User|access/i.test(a.action + a.object))
    .slice(0, 5);

  return (
    <div className="stacked">
      <div className="card">
        <div className="card-header">
          <h2>{t('tset.users')}</h2>
          <button className="btn btn-primary btn-add" onClick={() => setInviting(true)}>
            {t('cal.add')} <Icon d={I.plus} size={20} w={2.5} />
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>{t('tset.user')}</th>
              <th>{t('tset.role')}</th>
              <th>{t('tset.locations')}</th>
              <th>{t('tset.twofa')}</th>
              <th>{t('eset.status')}</th>
              <th>{t('tset.lastActive')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(employees.data?.employees ?? []).map((e) => (
              <tr key={e.id} className={e.status === 'invited' ? 'dim' : ''}>
                <td>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className="avatar" style={{ width: 36, height: 36 }}>
                      {inits(e.name)}
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                      <span className="bold">{e.name}</span>
                      <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>
                        {e.email || t('eset.noEmail')}
                      </span>
                    </span>
                  </span>
                </td>
                <td>
                  <select
                    className="cell sel"
                    value={e.roleId ?? ''}
                    aria-label={t('tset.roleFor', { name: e.name })}
                    onChange={(ev) => void patchEmp(e.id, { roleId: ev.target.value || null })}
                  >
                    {(roles.data?.roles ?? []).map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                        {r.std ? '' : ` ${t('tset.custom')}`}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ padding: 0 }}
                    onClick={() => setLocsFor(e.id)}
                  >
                    {e.locationIds.length === allLocs.length
                      ? t('shell.allLocations')
                      : e.locationIds.map(locName).join(', ') || t('tset.none')}{' '}
                    <Icon d={I.right} size={14} />
                  </button>
                </td>
                <td>
                  {e.twofaEnabled ? (
                    <span className="badge success">{t('hset.on')}</span>
                  ) : (
                    <span className="badge warning">{t('hset.off')}</span>
                  )}
                </td>
                <td>
                  {e.status === 'invited' ? (
                    <span className="badge warning">{t('tset.inviteSent')}</span>
                  ) : (
                    <span className="badge success">{t('eset.active')}</span>
                  )}
                </td>
                <td className="muted tnum">
                  {e.lastActive
                    ? e.lastActive.slice(0, 16).replace('T', ' ')
                    : t('tset.never')}
                </td>
                <td className="right">
                  <span className="rowact">
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={e.id === me?.id && e.status === 'invited'}
                      onClick={() => setLocsFor(e.id)}
                    >
                      {t('common.edit')}
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="note" style={{ margin: '16px 20px' }}>
          {t('tset.lastOwnerNote')}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>{t('tset.recentChanges')}</h2>
          <button className="btn btn-subtle btn-sm" onClick={openAudit}>
            {t('tset.openFullLog')}
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>{t('settings.when')}</th>
              <th>{t('settings.who')}</th>
              <th>{t('tset.change')}</th>
              <th>{t('tset.from')}</th>
              <th>{t('tset.to')}</th>
            </tr>
          </thead>
          <tbody>
            {accessChanges.map((a) => (
              <tr key={a.id}>
                <td className="muted tnum">{a.ts.slice(0, 16).replace('T', ' ')}</td>
                <td className="bold">{a.actorName}</td>
                <td>
                  {a.action} · {a.object}
                </td>
                <td className="muted">{a.before}</td>
                <td className="bold">{a.after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {inviting ? (
        <InviteUserPanel
          roles={roles.data?.roles ?? []}
          locations={allLocs}
          onClose={() => setInviting(false)}
          onSaved={() => {
            setInviting(false);
            toast(t('tset.inviteToast'));
            void qc.invalidateQueries({ queryKey: ['employees'] });
            void qc.invalidateQueries({ queryKey: ['audit'] });
          }}
        />
      ) : null}
      {locsFor ? (
        <UserLocsPanel
          employee={employees.data?.employees.find((e) => e.id === locsFor) ?? null}
          roleName={
            roles.data?.roles.find(
              (r) => r.id === employees.data?.employees.find((e) => e.id === locsFor)?.roleId,
            )?.name ?? '—'
          }
          locations={allLocs}
          onClose={() => setLocsFor(null)}
          onSave={(ids) => {
            void patchEmp(locsFor, { locationIds: ids });
            setLocsFor(null);
          }}
        />
      ) : null}
    </div>
  );
}

function InviteUserPanel({
  roles,
  locations,
  onClose,
  onSaved,
}: {
  roles: Role[];
  locations: Location[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState(roles[0]?.id ?? '');
  const [locIds, setLocIds] = useState<string[]>([]);
  const [twofa, setTwofa] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    try {
      await post(z.unknown(), '/employees', {
        name: name.trim(),
        email: email.trim(),
        roleId,
        locationIds: locIds,
        twofa,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <PanelPortal>
      <div className="scrim on" onClick={onClose} />
      <aside className="panel open" role="dialog" aria-modal="true">
        <div className="panel-head plain">
          <div>
            <h2>{t('tset.inviteUser')}</h2>
            <p className="sub">{t('tset.inviteSub')}</p>
          </div>
          <div className="panel-actions">
            <button
              className="btn btn-primary btn-sm"
              disabled={!name.trim() || !email.trim() || !locIds.length}
              onClick={() => void save()}
            >
              {t('tset.sendInvite')}
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
                {t('tset.fullName')}
                <span className="req">*</span>
              </span>
              <input
                className="input"
                placeholder="Sara Ilieva"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="field">
              <span>
                {t('cust.email')}
                <span className="req">*</span>
              </span>
              <input
                className="input"
                type="email"
                placeholder="sara@velnes.mk"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <span className="hint">{t('tset.emailHint')}</span>
            </label>
            <label className="field span2">
              <span>
                {t('tset.role')}
                <span className="req">*</span>
              </span>
              <select
                className="select"
                style={{ width: '100%' }}
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="field">
            <span>
              {t('tset.locations')}
              <span className="req">*</span>
            </span>
            <span className="hint">{t('tset.locationsHint')}</span>
            {locations.map((l) => {
              const on = locIds.includes(l.id);
              return (
                <button
                  key={l.id}
                  className="checkrow"
                  onClick={() =>
                    setLocIds(on ? locIds.filter((x) => x !== l.id) : [...locIds, l.id])
                  }
                >
                  <span className={`check${on ? ' on' : ''}`}>
                    <Icon d={I.check} size={14} w={3.5} />
                  </span>
                  <span style={{ fontWeight: 500 }}>
                    {l.name} <span className="muted">· {l.city}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="togglerow">
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span className="l">{t('tset.require2fa')}</span>
              <span className="h">{t('tset.require2faHint')}</span>
            </span>
            <button
              className={`toggle${twofa ? ' on' : ''}`}
              role="switch"
              aria-checked={twofa}
              aria-label={t('tset.require2fa')}
              onClick={() => setTwofa(!twofa)}
            >
              <span className="knob" />
            </button>
          </div>
          <div className="note">{t('tset.inviteNote')}</div>
          {error ? (
            <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>
              {error}
            </p>
          ) : null}
        </div>
      </aside>
    </PanelPortal>
  );
}

function UserLocsPanel({
  employee,
  roleName,
  locations,
  onClose,
  onSave,
}: {
  employee: Employee | null;
  roleName: string;
  locations: Location[];
  onClose: () => void;
  onSave: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const [ids, setIds] = useState<string[]>(employee?.locationIds ?? []);
  if (!employee) return null;

  return (
    <PanelPortal>
      <div className="scrim on" onClick={onClose} />
      <aside className="panel open" role="dialog" aria-modal="true">
        <div className="panel-head plain">
          <div>
            <h2>{t('tset.locsFor', { name: employee.name.split(' ')[0] })}</h2>
            <p className="sub">{t('tset.whereApplies')}</p>
          </div>
          <div className="panel-actions">
            <button
              className="btn btn-primary btn-sm"
              disabled={!ids.length}
              onClick={() => onSave(ids)}
            >
              {t('tset.done')}
            </button>
            <button className="iconbtn" aria-label={t('common.close')} onClick={onClose}>
              <Icon d={I.x} size={20} />
            </button>
          </div>
        </div>
        <div className="panel-body">
          <p className="muted" style={{ fontWeight: 500 }}>
            {t('tset.roleDecidesWhat', { name: employee.name, role: roleName })}
          </p>
          <div className="field">
            {locations.map((l) => {
              const on = ids.includes(l.id);
              return (
                <button
                  key={l.id}
                  className="checkrow"
                  onClick={() => setIds(on ? ids.filter((x) => x !== l.id) : [...ids, l.id])}
                >
                  <span className={`check${on ? ' on' : ''}`}>
                    <Icon d={I.check} size={14} w={3.5} />
                  </span>
                  <span style={{ fontWeight: 500 }}>
                    {l.name} <span className="muted">· {l.city}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </aside>
    </PanelPortal>
  );
}

function RolesSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => get(RoleListResponseSchema, '/roles'),
  });
  const [open, setOpen] = useState<Role | 'new' | null>(null);

  return (
    <div className="stacked">
      <div className="card">
        <div className="card-header">
          <h2>{t('settings.roles')}</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setOpen('new')}>
            {t('cal.add')} <Icon d={I.plus} size={16} w={2.5} />
          </button>
        </div>
        {(roles.data?.roles ?? []).map((r) => (
          <div key={r.id} className="rowcard">
            <span className="grow">
              <span className="t">
                {r.name} {r.std ? <span className="badge accent">{t('settings.standard')}</span> : null}
                {r.locked ? <span className="badge">{t('settings.locked')}</span> : null}
              </span>
              <span className="s">{r.description}</span>
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(r)}>
              {r.locked ? t('settings.view') : t('common.edit')}
            </button>
          </div>
        ))}
      </div>
      {open ? (
        <RoleEditor
          role={open === 'new' ? null : open}
          onDone={() => {
            setOpen(null);
            toast(t('catalog.saved'));
            void qc.invalidateQueries({ queryKey: ['roles'] });
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}

function RoleEditor({
  role,
  onDone,
  onClose,
}: {
  role: Role | null;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [perms, setPerms] = useState<PermMap>(role?.perms ?? {});
  const [error, setError] = useState<string | null>(null);
  const readOnly = role?.locked ?? false;

  const save = async () => {
    setError(null);
    try {
      const body = { name, description, perms };
      if (role) await api(OkSchema, `/roles/${role.id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await post(IdSchema, '/roles', body);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>{role ? role.name : t('settings.newRole')}</h2>
        <button className="iconbtn" aria-label={t('common.close')} onClick={onClose}>
          <Icon d={I.x} size={20} />
        </button>
      </div>
      <div style={{ padding: 20, display: 'grid', gap: 16 }}>
        <div className="grid2">
          <label className="field">
            <span>{t('catalog.name')}</span>
            <input
              className="input"
              value={name}
              disabled={readOnly}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field">
            <span>{t('settings.description')}</span>
            <input
              className="input"
              value={description}
              disabled={readOnly}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </div>
        <div className="matrix">
          {PERM_GROUPS.map((g) => (
            <div key={g.group} style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
              <div className="section-label">{g.group}</div>
              {g.perms.map(([key, label]) => (
                <div
                  key={key}
                  style={{ display: 'flex', alignItems: 'center', gap: 12 }}
                >
                  <span style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600 }}>{label}</span>
                    <span className="permkey">{key}</span>
                  </span>
                  <select
                    className="select"
                    value={perms[key as PermKey] ?? 'none'}
                    disabled={readOnly}
                    aria-label={key}
                    onChange={(e) =>
                      setPerms((p) => ({ ...p, [key]: e.target.value as PermMap[PermKey] }))
                    }
                  >
                    {scopeChoices(key as PermKey).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          ))}
        </div>
        {error ? (
          <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>
            {error}
          </p>
        ) : null}
        {!readOnly ? (
          <button
            className="btn btn-primary"
            style={{ justifySelf: 'end' }}
            disabled={!name}
            onClick={() => void save()}
          >
            {t('common.save')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function AuditSection() {
  const { t } = useTranslation();
  const audit = useQuery({
    queryKey: ['audit'],
    queryFn: () => get(AuditListResponseSchema, '/audit?limit=100'),
  });
  return (
    <div className="card">
      <div className="card-header">
        <h2>{t('settings.audit')}</h2>
      </div>
      <table>
        <thead>
          <tr>
            <th>{t('settings.when')}</th>
            <th>{t('settings.who')}</th>
            <th>{t('settings.action')}</th>
            <th>{t('settings.object')}</th>
            <th className="sec">{t('settings.beforeAfter')}</th>
          </tr>
        </thead>
        <tbody>
          {(audit.data?.entries ?? []).map((e) => (
            <tr key={e.id}>
              <td className="muted tnum">{e.ts.slice(0, 16).replace('T', ' ')}</td>
              <td className="bold">{e.actorName}</td>
              <td>{e.action}</td>
              <td className="muted">{e.object}</td>
              <td className="muted sec tnum">
                {e.before} → {e.after}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
