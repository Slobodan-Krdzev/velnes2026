import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AuditListResponseSchema,
  CopySetupResponseSchema,
  CustomerListResponseSchema,
  LocationSchema,
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
  type WeekHours,
} from '@velnes/contracts';
import { I, Icon, PhoneInput } from '@velnes/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { api, get, patch, post } from '@velnes/client';
import { useEmployees, useLocationCatalog, useLocations } from '../../api/queries.js';
import { WeekHoursEditor } from './bits.js';
import { BookingSection } from './BookingSection.js';
import { CompanySection } from './CompanySection.js';
import { CustomersSettingsSection } from './CustomersSettingsSection.js';
import { EmployeePanel, EmployeesSection } from './EmployeesSection.js';
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
  // Exit-preview lands here asking for a section — the prototype's
  // state.settingsTab='team' — but only one the caller may see.
  const asked = (useLocation().state as { tab?: SectionId } | null)?.tab;
  const [tab, setTab] = useState<SectionId>(
    asked && visible.some(([id]) => id === asked) ? asked : (first ?? 'general'),
  );
  // The full log opened from Team & access carries a way back; the
  // same section reached through the nav does not need one.
  const [auditFromTeam, setAuditFromTeam] = useState(false);

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
                onClick={() => {
                  setAuditFromTeam(false);
                  setTab(id as SectionId);
                }}
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
          {tab === 'team' ? (
            <TeamSection
              openAudit={() => {
                setAuditFromTeam(true);
                setTab('audit');
              }}
            />
          ) : null}
          {tab === 'roles' ? <RolesSection /> : null}
          {tab === 'employees' ? <EmployeesSection /> : null}
          {tab === 'ranking' ? <RankingSection /> : null}
          {tab === 'calendar' ? <HoursSection /> : null}
          {tab === 'booking' ? <BookingSection /> : null}
          {tab === 'marketplace' ? <MarketplaceSection /> : null}
          {tab === 'customers' ? <CustomersSettingsSection /> : null}
          {tab === 'sales' ? <SalesSection /> : null}
          {tab === 'audit' ? (
            <AuditSection
              onBack={
                auditFromTeam
                  ? () => {
                      setAuditFromTeam(false);
                      setTab('team');
                    }
                  : undefined
              }
            />
          ) : null}
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
  // The two business-wide stats: one customer file, one master list.
  const customers = useQuery({
    queryKey: ['customersTotal'],
    queryFn: () => get(CustomerListResponseSchema, '/customers?limit=1'),
    retry: false,
  });
  const catalog = useLocationCatalog(locations.data?.locations[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [copyFrom, setCopyFrom] = useState<Location | null>(null);
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
          <div className="stat">
            <span className="stat-label">{t('lset.customers')}</span>
            <span className="stat-value">{customers.data?.total ?? '—'}</span>
            <span className="stat-hint">{t('lset.customersHint')}</span>
          </div>
          <div className="stat">
            <span className="stat-label">{t('lset.catalog')}</span>
            <span className="stat-value">
              {catalog.data ? t('lset.servicesN', { n: catalog.data.services.length }) : '—'}
            </span>
            <span className="stat-hint">
              {catalog.data ? t('lset.catalogHint', { n: catalog.data.products.length }) : ''}
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
          <LocationRow
            key={l.id}
            l={l}
            isOwner={isOwner}
            mine={!me?.locationIds.length || (me?.locationIds.includes(l.id) ?? true)}
            transition={transition}
            onEdit={() => setEditing(l)}
            onCopy={() => setCopyFrom(l)}
          />
        ))}
      </div>

      {/* The prototype's central/local card: decided once, so
          nothing gets duplicated. */}
      <div className="card">
        <div className="card-header">
          <h2>{t('lset.centralTitle')}</h2>
          <span className="muted" style={{ fontWeight: 500 }}>
            {t('lset.centralSub')}
          </span>
        </div>
        <div className="grid2" style={{ padding: 0 }}>
          <div style={{ borderRight: '1px solid var(--line)' }}>
            <div className="section-label">{t('lset.businessWide')}</div>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
              <div key={i} className="rowcard" style={{ padding: '11px 20px' }}>
                <Icon d={I.check} size={16} w={2.5} />
                <span className="grow">
                  <span className="s" style={{ color: 'var(--ink)', fontWeight: 600 }}>
                    {t(`lset.c${i}`)}
                  </span>
                </span>
              </div>
            ))}
          </div>
          <div>
            <div className="section-label">{t('lset.perLocation')}</div>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
              <div key={i} className="rowcard" style={{ padding: '11px 20px' }}>
                <Icon d={I.calendar} size={16} w={2} />
                <span className="grow">
                  <span className="s" style={{ color: 'var(--ink)', fontWeight: 600 }}>
                    {t(`lset.l${i}`)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {editing ? (
        <LocationEditPanel
          l={editing}
          employees={(employees.data?.employees ?? []).filter((e) =>
            e.locationIds.includes(editing.id),
          )}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast(t('lset.updated'));
            void qc.invalidateQueries({ queryKey: ['locations'] });
            void qc.invalidateQueries({ queryKey: ['audit'] });
          }}
          onLifecycle={(to) => {
            const id = editing.id;
            setEditing(null);
            void transition(id, to);
          }}
        />
      ) : null}
      {copyFrom ? (
        <CopySetupPanel
          from={copyFrom}
          others={all.filter((x) => x.id !== copyFrom.id)}
          onClose={() => setCopyFrom(null)}
          onDone={() => {
            setCopyFrom(null);
            toast(t('lset.copied'));
            void qc.invalidateQueries({ queryKey: ['locations'] });
            void qc.invalidateQueries({ queryKey: ['catalog'] });
            void qc.invalidateQueries({ queryKey: ['audit'] });
          }}
        />
      ) : null}
    </div>
  );
}

function LocationRow({
  l,
  isOwner,
  mine,
  transition,
  onEdit,
  onCopy,
}: {
  l: Location;
  isOwner: boolean;
  mine: boolean;
  transition: (id: string, to: string) => Promise<void>;
  onEdit: () => void;
  onCopy: () => void;
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
  return (
    <div className="rowcard" style={{ flexWrap: 'wrap' }}>
      <span className={`mark${lc === 'ACTIVE' ? ' on' : ''}`}>{l.name[0]}</span>
      <span className="grow">
        <span className="t">
          {l.name} {mine ? null : <span className="badge">{t('lset.notAssigned')}</span>}
        </span>
        <span className="s">
          {l.address}, {l.city} · {l.tz} · {l.rooms} rooms
        </span>
      </span>
      {lcBadge}
      <span className={`badge${l.online ? ' accent' : ''}`}>
        {l.online ? t('settings.bookableOnline') : t('settings.notOnline')}
      </span>
      <span className="acts">
        {lc === 'ACTIVE' ? (
          <button className="btn btn-subtle btn-sm" onClick={onCopy}>
            {t('lset.copySetup')}
          </button>
        ) : null}
        <button className="btn btn-secondary btn-sm" onClick={onEdit}>
          {t('nav.settings')}
        </button>
      </span>
      <span style={{ flexBasis: '100%' }}>{lcBlock}</span>
    </div>
  );
}

const LOC_STD_HOURS: WeekHours = {
  '0': [['09:00', '19:00']], '1': [['09:00', '19:00']], '2': [['09:00', '19:00']],
  '3': [['09:00', '19:00']], '4': [['09:00', '19:00']], '5': [['09:00', '15:00']],
  '6': null,
};

/** The prototype's locationEdit panel over the real PATCH door: the
 *  card, the online toggle, the week and who works here. Payments
 *  per location stay an honest deferral — there is no door yet. */
function LocationEditPanel({
  l,
  employees,
  onClose,
  onSaved,
  onLifecycle,
}: {
  l: Location;
  employees: Employee[];
  onClose: () => void;
  onSaved: () => void;
  onLifecycle: (to: 'SUSPENDED' | 'ACTIVE') => void;
}) {
  const { t, i18n } = useTranslation();
  const [name, setName] = useState(l.name);
  const [address, setAddress] = useState(l.address ?? '');
  const [city, setCity] = useState(l.city ?? '');
  const [phone, setPhone] = useState(l.phone ?? '');
  const [tz, setTz] = useState(l.tz);
  const [rooms, setRooms] = useState(String(l.rooms));
  const [invPrefix, setInvPrefix] = useState(l.invPrefix ?? '');
  const [cancel, setCancel] = useState(String(l.cancelHours));
  const [online, setOnline] = useState(l.online);
  const [hours, setHours] = useState<WeekHours>(l.hours ?? LOC_STD_HOURS);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    try {
      await patch(LocationSchema, `/locations/${l.id}`, {
        name: name.trim() || l.name,
        address: address.trim() || null,
        city: city.trim() || null,
        phone: phone.trim() || null,
        tz,
        rooms: Number(rooms) > 0 ? Math.round(Number(rooms)) : l.rooms,
        ...(invPrefix.trim() ? { invPrefix: invPrefix.trim() } : {}),
        cancelHours: Number.isFinite(Number(cancel)) ? Number(cancel) : l.cancelHours,
        online,
        hours,
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
            <h2>{l.name}</h2>
            <p className="sub">{t('lset.locationSettings')}</p>
          </div>
          <div className="panel-actions">
            <button
              className="btn btn-primary btn-sm"
              disabled={!name.trim()}
              onClick={() => void save()}
            >
              {t('cset.saveChanges')}
            </button>
            <button className="iconbtn" aria-label={t('common.close')} onClick={onClose}>
              <Icon d={I.x} size={20} />
            </button>
          </div>
        </div>
        <div className="panel-body">
          <div className="grid2">
            <label className="field span2">
              <span>
                {t('nloc.locName')}
                <span className="req">*</span>
              </span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span>
                {t('lset.street')}
                <span className="req">*</span>
              </span>
              <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
            </label>
            <label className="field">
              <span>
                {t('reg.city')}
                <span className="req">*</span>
              </span>
              <input className="input" value={city} onChange={(e) => setCity(e.target.value)} />
            </label>
            <div className="field">
              <span>{t('cset.phone')}</span>
              <PhoneInput
                value={phone}
                onChange={setPhone}
                lang={i18n.language}
                ariaLabel={t('cset.phone')}
                searchLabel={t('phone.search')}
                countryLabel={t('phone.country')}
              />
            </div>
            <label className="field">
              <span>{t('lset.tz')}</span>
              <select
                className="select"
                style={{ width: '100%' }}
                value={tz}
                onChange={(e) => setTz(e.target.value)}
              >
                {[...new Set(['Europe/Skopje', 'Europe/Amsterdam', l.tz])].map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
              <span className="hint">{t('lset.tzHint')}</span>
            </label>
            <label className="field">
              <span>{t('lset.rooms')}</span>
              <input
                className="input"
                type="number"
                value={rooms}
                onChange={(e) => setRooms(e.target.value)}
              />
            </label>
            <label className="field">
              <span>{t('lset.invoiceNumbering')}</span>
              <input
                className="input"
                placeholder="AER-2026-"
                value={invPrefix}
                onChange={(e) => setInvPrefix(e.target.value)}
              />
              <span className="hint">{t('lset.invoiceHint')}</span>
            </label>
            <label className="field">
              <span>{t('lset.cancelUntil')}</span>
              <input
                className="input"
                type="number"
                value={cancel}
                onChange={(e) => setCancel(e.target.value)}
              />
              <span className="hint">{t('lset.cancelHint')}</span>
            </label>
          </div>
          <div className="togglerow">
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span className="l">{t('settings.bookableOnline')}</span>
              <span className="h">{t('lset.onlineHint')}</span>
            </span>
            <button
              className={`toggle${online ? ' on' : ''}`}
              role="switch"
              aria-checked={online}
              aria-label={t('settings.bookableOnline')}
              onClick={() => setOnline(!online)}
            >
              <span className="knob" />
            </button>
          </div>
          <div className="field">
            <span>{t('settings.openingHours')}</span>
            <span className="hint">{t('lset.hoursHint')}</span>
            <div
              style={{
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-control)',
                overflow: 'hidden',
              }}
            >
              <WeekHoursEditor hours={hours} onChange={setHours} timeWidth={96} dense />
            </div>
          </div>
          <div className="field">
            <span>{t('lset.employeesHere')}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {employees.length ? (
                employees.map((e) => (
                  <div
                    key={e.id}
                    className="rowcard"
                    style={{
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--r-control)',
                      padding: '10px 14px',
                    }}
                  >
                    <span className="avatar" style={{ width: 32, height: 32 }}>
                      {inits(e.name)}
                    </span>
                    <span className="grow">
                      <span className="t">{e.name}</span>
                      <span className="s">{e.roleTitle}</span>
                    </span>
                  </div>
                ))
              ) : (
                <p className="muted" style={{ fontWeight: 500 }}>
                  {t('lset.nobodyHere')}
                </p>
              )}
            </div>
          </div>
          {l.lifecycle === 'ACTIVE' || l.lifecycle === 'SUSPENDED' ? (
            // The one act in this panel that takes the location off
            // the market — it wears the danger colour, not a toggle's.
            <div
              className="togglerow"
              style={
                l.lifecycle === 'ACTIVE'
                  ? { borderColor: 'var(--danger)', background: 'rgba(198,40,40,.05)' }
                  : undefined
              }
            >
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span
                  className="l"
                  style={l.lifecycle === 'ACTIVE' ? { color: 'var(--danger)' } : undefined}
                >
                  {l.lifecycle === 'ACTIVE' ? t('settings.suspend') : t('settings.reactivate')}
                </span>
                <span className="h">{t('lset.suspendHint')}</span>
              </span>
              <button
                className="btn btn-primary btn-sm"
                style={l.lifecycle === 'ACTIVE' ? { background: 'var(--danger)' } : undefined}
                onClick={() => onLifecycle(l.lifecycle === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE')}
              >
                {l.lifecycle === 'ACTIVE' ? t('settings.suspend') : t('settings.reactivate')}
              </button>
            </div>
          ) : null}
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

/** The prototype's copyConfig panel over the real copy-setup door.
 *  Stock, appointments and customers never travel. */
function CopySetupPanel({
  from,
  others,
  onClose,
  onDone,
}: {
  from: Location;
  others: Location[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [to, setTo] = useState(others[0]?.id ?? '');
  const [parts, setParts] = useState({
    services: true, products: true, hours: true,
    payments: true, policy: true, widget: true,
  });
  const [error, setError] = useState<string | null>(null);

  const PARTS: [keyof typeof parts, string][] = [
    ['services', t('lset.partServices')],
    ['products', t('lset.partProducts')],
    ['hours', t('lset.partHours')],
    ['payments', t('lset.partPayments')],
    ['policy', t('lset.partPolicy')],
    ['widget', t('lset.partWidget')],
  ];

  const save = async () => {
    setError(null);
    try {
      await post(CopySetupResponseSchema, `/locations/${from.id}/copy-setup`, {
        toLocationId: to,
        parts,
      });
      onDone();
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
            <h2>{t('lset.copyTitle', { name: from.name })}</h2>
            <p className="sub">{t('lset.copySub')}</p>
          </div>
          <div className="panel-actions">
            <button
              className="btn btn-primary btn-sm"
              disabled={!to || !Object.values(parts).some(Boolean)}
              onClick={() => void save()}
            >
              {t('lset.copySetup')}
            </button>
            <button className="iconbtn" aria-label={t('common.close')} onClick={onClose}>
              <Icon d={I.x} size={20} />
            </button>
          </div>
        </div>
        <div className="panel-body">
          <p className="muted" style={{ fontWeight: 500 }}>
            {t('lset.copyIntro', { name: from.name })}
          </p>
          <label className="field">
            <span>
              {t('lset.copyTo')}
              <span className="req">*</span>
            </span>
            <select
              className="select"
              style={{ width: '100%' }}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            >
              {others.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>{t('lset.copyWhat')}</span>
            {PARTS.map(([k, label]) => (
              <button
                key={k}
                className="checkrow"
                onClick={() => setParts({ ...parts, [k]: !parts[k] })}
              >
                <span className={`check${parts[k] ? ' on' : ''}`}>
                  <Icon d={I.check} size={14} w={3.5} />
                </span>
                <span style={{ fontWeight: 500 }}>{label}</span>
              </button>
            ))}
          </div>
          <div className="note warn">{t('lset.copyWarn')}</div>
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
  const { me, startPreview } = useSession();
  const navigate = useNavigate();
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
  const [editing, setEditing] = useState<Employee | null>(null);

  const patchEmp = async (id: string, body: Record<string, unknown>) => {
    try {
      await api(z.unknown(), `/employees/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      toast(t('catalog.saved'));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
    void qc.invalidateQueries({ queryKey: ['employees'] });
  };
  // The prototype's startPreview(): become that user for real; when
  // the borrowed role cannot see Settings, land on the flightdeck.
  const doPreview = async (id: string) => {
    try {
      const emp = await startPreview(id);
      toast(
        t('preview.toast', {
          name: emp.name.split(' ')[0],
          role: emp.roleName ?? t(`eset.access_${emp.access}`),
        }),
      );
      if ((emp.perms['users.manage'] ?? 'none') === 'none') navigate('/');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
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
                    {e.id === me?.id ? null : (
                      <button
                        className="btn btn-subtle btn-sm"
                        onClick={() => void doPreview(e.id)}
                      >
                        {t('tset.previewAccess')}
                      </button>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(e)}>
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
      {editing ? (
        <EmployeePanel
          employee={editing}
          taken={(employees.data?.employees ?? []).map((e) => e.color)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast(t('eset.employeeUpdated'));
            void qc.invalidateQueries({ queryKey: ['employees'] });
            void qc.invalidateQueries({ queryKey: ['audit'] });
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

/** Contracts carry the permission vocabulary; the words on screen
 *  come from the dictionaries. The key is technical and stays. */
const permGroupKey = (g: string) => `permgroup.${g.toLowerCase().replace(/[^a-z]+/g, '_')}`;

/** The prototype's setRoles(): the role cards with Duplicate/Edit/
 *  Remove, and the permission matrix — every cell writes through the
 *  one PUT door, and the server decides again on every request. */
function RolesSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => get(RoleListResponseSchema, '/roles'),
  });
  const employees = useEmployees();
  const [open, setOpen] = useState<Role | 'new' | null>(null);
  const [group, setGroup] = useState<string>(PERM_GROUPS[0]!.group);

  const all = roles.data?.roles ?? [];
  const countFor = (id: string) =>
    (employees.data?.employees ?? []).filter((e) => e.roleId === id).length;
  const scopeLabel = (s: string) => t(`scope.${s}`);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['roles'] });
    void qc.invalidateQueries({ queryKey: ['audit'] });
  };

  const clone = async (r: Role) => {
    try {
      await post(IdSchema, '/roles', {
        name: `${r.name} (copy)`,
        description: t('rset.copyDesc', { name: r.name }),
        perms: r.perms,
      });
      toast(t('rset.copiedToast'));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
    refresh();
  };
  const remove = async (r: Role) => {
    try {
      await api(OkSchema, `/roles/${r.id}`, { method: 'DELETE' });
      toast(t('rset.removedToast', { name: r.name }));
    } catch (e) {
      // The door refuses (standard role, people still on it): the
      // reason is the message.
      toast(e instanceof Error ? e.message : String(e));
    }
    refresh();
  };
  const setScope = async (r: Role, key: PermKey, v: string) => {
    try {
      await api(OkSchema, `/roles/${r.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: r.name,
          description: r.description,
          perms: { ...r.perms, [key]: v },
        }),
      });
      toast(t('catalog.saved'));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
    refresh();
  };

  const g = PERM_GROUPS.find((x) => x.group === group) ?? PERM_GROUPS[0]!;

  return (
    <div className="stacked">
      <div className="card">
        <div className="card-header">
          <h2>{t('settings.roles')}</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setOpen('new')}>
            {t('cal.add')} <Icon d={I.plus} size={16} w={2.5} />
          </button>
        </div>
        {all.map((r) => {
          const n = countFor(r.id);
          return (
            <div key={r.id} className="rowcard">
              <span className={`mark${r.std ? ' on' : ''}`}>
                <Icon d={r.std ? I.user : I.users} size={20} />
              </span>
              <span className="grow">
                <span className="t">
                  {r.name}{' '}
                  {r.std ? (
                    <span className="badge">{t('settings.standard')}</span>
                  ) : (
                    <span className="badge accent">{t('rset.custom')}</span>
                  )}
                  {r.locked ? <span className="badge warning">{t('settings.locked')}</span> : null}
                </span>
                <span className="s">{r.description}</span>
              </span>
              <span className="badge">
                {n === 1 ? t('rset.userOne') : t('rset.usersN', { n })}
              </span>
              <span className="acts">
                <button className="btn btn-subtle btn-sm" onClick={() => void clone(r)}>
                  {t('rset.duplicate')}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => setOpen(r)}>
                  {r.locked ? t('settings.view') : t('common.edit')}
                </button>
                {r.locked || r.std || n ? null : (
                  <button className="btn btn-subtle btn-sm" onClick={() => void remove(r)}>
                    {t('rset.remove')}
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {open ? (
        <RolePanel
          role={open === 'new' ? null : open}
          stdRoles={all.filter((r) => r.std)}
          onDone={() => {
            setOpen(null);
            refresh();
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}

      <div className="card">
        <div className="card-header">
          <h2>{t('rset.matrixTitle')}</h2>
          <span className="muted" style={{ fontWeight: 500 }}>
            {t('rset.matrixSub')}
          </span>
        </div>
        <div className="matrix-tabs">
          <div className="tabs">
            {PERM_GROUPS.map((pg) => (
              <button
                key={pg.group}
                className={`tab${group === pg.group ? ' active' : ''}`}
                onClick={() => setGroup(pg.group)}
              >
                {t(permGroupKey(pg.group))}
              </button>
            ))}
          </div>
        </div>
        <div className="matrix-wrap">
          {/* Full width: on a wide screen the columns share the room
              and the last role fits; when it truly cannot fit, the
              wrap's min-width + sideways scroll take over. */}
          <table className="matrix" style={{ width: '100%' }}>
            <thead>
              <tr>
                {/* Pinned to its CSS minimum: long labels wrap, and
                    the role columns get the rest of the card. */}
                <th className="perm" style={{ width: 280 }}>
                  {t('rset.permission')}
                </th>
                {all.map((r) => (
                  <th key={r.id}>
                    {r.name}
                    {r.std ? null : <span className="permkey">{t('rset.customKey')}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {g.perms.map(([key]) => (
                <tr key={key}>
                  <td className="perm">
                    <span className="bold">{t(`perm.${key}`)}</span>
                    <span className="permkey">{key}</span>
                  </td>
                  {all.map((r) => {
                    const val = r.perms[key as PermKey] ?? 'none';
                    return (
                      // The select fills its cell instead of insisting
                      // on its widest option: the columns share the
                      // card's width and the last role stays in view.
                      <td key={r.id} style={{ minWidth: 168 }}>
                        {r.locked ? (
                          <span className={`scopetag${val === 'none' ? '' : ' on'}`}>
                            {scopeLabel(val)}
                          </span>
                        ) : (
                          <select
                            className="scopesel"
                            style={{ width: '100%', minWidth: 0 }}
                            data-on={val === 'none' ? 0 : 1}
                            value={val}
                            aria-label={`${r.name} · ${key}`}
                            onChange={(e) => void setScope(r, key as PermKey, e.target.value)}
                          >
                            {scopeChoices(key as PermKey).map((o) => (
                              <option key={o} value={o}>
                                {scopeLabel(o)}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="note" style={{ margin: '16px 20px' }}>
          {t('rset.matrixNote')}
        </div>
      </div>
    </div>
  );
}

/** The prototype's roleEdit/roleNew panel: name, description and the
 *  base role in front; the scope rows only once the role exists, so a
 *  role is never saved without a scope. One PUT/POST door. */
function RolePanel({
  role,
  stdRoles,
  onDone,
  onClose,
}: {
  role: Role | null;
  stdRoles: Role[];
  onDone: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [perms, setPerms] = useState<PermMap>(role?.perms ?? {});
  const [baseId, setBaseId] = useState(stdRoles[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const locked = role?.locked ?? false;
  const scopeLabel = (s: string) => t(`scope.${s}`);

  const save = async () => {
    setError(null);
    try {
      if (role) {
        await api(OkSchema, `/roles/${role.id}`, {
          method: 'PUT',
          body: JSON.stringify({ name: name.trim(), description, perms }),
        });
        toast(t('rset.updatedToast'));
      } else {
        // A new role starts as a copy of the chosen standard role's
        // permissions — narrowed down afterwards, never built bare.
        const base = stdRoles.find((r) => r.id === baseId) ?? stdRoles[0];
        await post(IdSchema, '/roles', {
          name: name.trim(),
          description: description.trim() || t('rset.baseDesc', { name: base?.name ?? '' }),
          perms: { ...(base?.perms ?? {}) },
        });
        toast(t('rset.createdToast'));
      }
      onDone();
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
            <h2>{role ? role.name : t('rset.createTitle')}</h2>
            <p className="sub">
              {role ? (role.std ? t('rset.stdRole') : t('rset.customRole')) : t('rset.createSub')}
            </p>
          </div>
          <div className="panel-actions">
            {locked ? null : (
              <button
                className="btn btn-primary btn-sm"
                disabled={!name.trim()}
                onClick={() => void save()}
              >
                {role ? t('cset.saveChanges') : t('rset.createRole')}
              </button>
            )}
            <button className="iconbtn" aria-label={t('common.close')} onClick={onClose}>
              <Icon d={I.x} size={20} />
            </button>
          </div>
        </div>
        <div className="panel-body">
          <div className="grid2">
            <label className="field span2">
              <span>
                {t('rset.roleName')}
                <span className="req">*</span>
              </span>
              <input
                className="input"
                value={name}
                disabled={locked}
                placeholder={t('rset.roleNamePh')}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="field span2">
              <span>{t('settings.description')}</span>
              <input
                className="input"
                value={description}
                disabled={locked}
                placeholder={t('rset.descPh')}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label className="field">
              <span>{t('rset.startFrom')}</span>
              <select
                className="select"
                style={{ width: '100%' }}
                value={role ? '' : baseId}
                disabled={!!role}
                onChange={(e) => setBaseId(e.target.value)}
              >
                {role ? <option value="">{role.name}</option> : null}
                {role
                  ? null
                  : stdRoles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
              </select>
              <span className="hint">
                {role ? t('rset.startFromHintSaved') : t('rset.startFromHintNew')}
              </span>
            </label>
          </div>
          {locked ? <div className="note warn">{t('rset.lockedNote')}</div> : null}
          {role ? (
            PERM_GROUPS.map((g) => (
              <div key={g.group} className="field">
                <span>{t(permGroupKey(g.group))}</span>
                {g.perms.map(([key]) => {
                  const val = perms[key as PermKey] ?? 'none';
                  return (
                    <div key={key} className="togglerow" style={{ alignItems: 'center' }}>
                      <span style={{ display: 'flex', flexDirection: 'column' }}>
                        <span className="l">{t(`perm.${key}`)}</span>
                        <span className="h">{key}</span>
                      </span>
                      {locked ? (
                        <span className={`scopetag${val === 'none' ? '' : ' on'}`}>
                          {scopeLabel(val)}
                        </span>
                      ) : (
                        <select
                          className="scopesel"
                          data-on={val === 'none' ? 0 : 1}
                          value={val}
                          aria-label={key}
                          onChange={(e) =>
                            setPerms((p) => ({ ...p, [key]: e.target.value as PermMap[PermKey] }))
                          }
                        >
                          {scopeChoices(key as PermKey).map((s) => (
                            <option key={s} value={s}>
                              {scopeLabel(s)}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          ) : (
            <div className="note">{t('rset.newRoleNote')}</div>
          )}
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

function AuditSection({ onBack }: { onBack?: (() => void) | undefined }) {
  const { t } = useTranslation();
  const audit = useQuery({
    queryKey: ['audit'],
    queryFn: () => get(AuditListResponseSchema, '/audit?limit=100'),
  });
  return (
    <div className="card">
      <div className="card-header">
        <h2>{t('settings.audit')}</h2>
        {onBack ? (
          <button className="btn btn-subtle btn-sm" onClick={onBack}>
            <Icon d={I.arrowleft} size={16} w={2.5} /> {t('tset.backToTeam')}
          </button>
        ) : null}
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
