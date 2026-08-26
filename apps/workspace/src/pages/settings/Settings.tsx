import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AuditListResponseSchema,
  PERM_GROUPS,
  ReadinessResponseSchema,
  RoleListResponseSchema,
  scopeChoices,
  TransitionResponseSchema,
  type Location,
  type PermKey,
  type PermMap,
  type Role,
} from '@velnes/contracts';
import { empColorOf, EMP_COLORS, I, Icon } from '@velnes/ui';
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
          {tab === 'team' ? <TeamSection /> : null}
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

function TeamSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const employees = useEmployees();
  const locations = useLocations();
  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => get(RoleListResponseSchema, '/roles'),
  });

  const patch = async (id: string, body: Record<string, unknown>) => {
    await api(z.unknown(), `/employees/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    toast(t('catalog.saved'));
    void qc.invalidateQueries({ queryKey: ['employees'] });
  };
  const locName = (id: string) =>
    locations.data?.locations.find((l) => l.id === id)?.name ?? '';

  return (
    <div className="card">
      <div className="card-header">
        <h2>{t('settings.team')}</h2>
      </div>
      {(employees.data?.employees ?? []).map((e) => {
        const c = empColorOf(e.color);
        return (
          <div key={e.id} className="rowcard">
            <span className="mark" style={{ background: c[2], color: c[3] }}>
              {e.name[0]}
            </span>
            <span className="grow">
              <span className="t">
                {e.name}{' '}
                {e.status === 'invited' ? (
                  <span className="badge warning">{t('settings.invited')}</span>
                ) : null}
              </span>
              <span className="s">
                {e.roleTitle} · {e.email} · {e.locationIds.map(locName).join(', ')}
              </span>
            </span>
            <span className="badge">{e.access}</span>
            <select
              className="select"
              value={e.roleId ?? ''}
              aria-label={`${e.name} role`}
              onChange={(ev) => void patch(e.id, { roleId: ev.target.value || null })}
            >
              {(roles.data?.roles ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <span className="rowact">
              <button
                className={`toggle${e.bookable ? ' on' : ''}`}
                role="switch"
                aria-checked={e.bookable}
                aria-label={`${e.name} bookable`}
                onClick={() => void patch(e.id, { bookable: !e.bookable })}
              >
                <span className="knob" />
              </button>
            </span>
            <span className="swatches">
              {EMP_COLORS.slice(0, 5).map(([k, name, bg, ink]) => (
                <button
                  key={k}
                  className={`swatch${e.color === k ? ' on' : ''}`}
                  style={{
                    background: bg,
                    borderColor: e.color === k ? ink : 'transparent',
                    color: ink,
                  }}
                  title={name}
                  aria-label={`${e.name} ${name}`}
                  onClick={() => void patch(e.id, { color: k })}
                >
                  {e.color === k ? <Icon d={I.check} size={14} w={3.5} /> : null}
                </button>
              ))}
            </span>
          </div>
        );
      })}
    </div>
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
