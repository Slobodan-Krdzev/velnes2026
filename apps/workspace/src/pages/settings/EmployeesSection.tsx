import { useQueryClient } from '@tanstack/react-query';
import { EmployeeSchema, type Employee, type WeekHours } from '@velnes/contracts';
import { EMP_COLORS, empColorOf, I, Icon } from '@velnes/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { patch } from '@velnes/client';
import { useEmployees, useLocationCatalog, useLocations } from '../../api/queries.js';
import { useOutsideClose } from '../../lib/pop.js';
import { PanelPortal } from '../../lib/Panel.js';
import { useToast } from '../../lib/toast.js';
import { availSummary, Field, ToggleRow, Toggle, WeekHoursEditor } from './bits.js';

/** Settings › Schedules & services — the prototype's `employees`
 *  panel: the team table (colour dot, job title, access, availability,
 *  bookable) plus the per-person edit panel with the weekly hours and
 *  the services checklist. */

const ACCESS_KEYS = ['owner', 'manager', 'desk', 'staff'] as const;

export function EmployeesSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const employees = useEmployees();
  const [dotOpen, setDotOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<Employee | null>(null);
  const dotRef = useOutsideClose<HTMLSpanElement>(dotOpen !== null, () => setDotOpen(null));

  const save = async (id: string, body: Record<string, unknown>) => {
    await patch(EmployeeSchema, `/employees/${id}`, body);
    toast(t('catalog.saved'));
    void qc.invalidateQueries({ queryKey: ['employees'] });
  };

  const all = employees.data?.employees ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="card">
        <div className="card-header">
          <h2>{t('eset.team')}</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>{t('eset.name')}</th>
              <th>{t('eset.jobTitle')}</th>
              <th>{t('eset.access')}</th>
              <th>{t('eset.available')}</th>
              <th className="right">{t('eset.bookable')}</th>
              <th>{t('eset.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {all.map((e) => {
              const c = empColorOf(e.color);
              return (
                <tr key={e.id} className={e.status === 'invited' ? 'dim' : ''}>
                  <td className="bold">
                    <span className="pop empdot-pop" ref={dotOpen === e.id ? dotRef : null}>
                      <button
                        className="empdot"
                        aria-haspopup="menu"
                        aria-expanded={dotOpen === e.id}
                        aria-label={t('eset.colourFor', { name: e.name })}
                        style={{ background: c[2], boxShadow: `0 0 0 1px ${c[3]} inset` }}
                        onClick={() => setDotOpen(dotOpen === e.id ? null : e.id)}
                      />
                      {dotOpen === e.id ? (
                        <div className="menu menu-dot" role="menu">
                          <div className="menu-label">{t('eset.calendarColour')}</div>
                          <div className="swatches">
                            {EMP_COLORS.map(([k, name, bg, ink]) => (
                              <button
                                key={k}
                                type="button"
                                className={`swatch${e.color === k ? ' on' : ''}`}
                                style={{
                                  background: bg,
                                  borderColor: e.color === k ? ink : 'transparent',
                                  color: ink,
                                }}
                                title={name}
                                aria-label={name}
                                aria-pressed={e.color === k}
                                onClick={() => {
                                  setDotOpen(null);
                                  void save(e.id, { color: k });
                                }}
                              >
                                {e.color === k ? <Icon d={I.check} size={14} w={3.5} /> : null}
                              </button>
                            ))}
                          </div>
                          <div className="menu-foot">{c[1]}</div>
                        </div>
                      ) : null}
                    </span>
                    <span style={{ marginLeft: 8 }}>{e.name}</span>
                    <div className="muted" style={{ fontWeight: 500, fontSize: 12 }}>
                      {e.email || t('eset.noEmail')}
                    </div>
                  </td>
                  <td>
                    <RoleTitleCell e={e} save={save} />
                  </td>
                  <td>
                    <select
                      className="cell sel"
                      value={e.access}
                      aria-label={t('eset.accessFor', { name: e.name })}
                      onChange={(ev) => void save(e.id, { access: ev.target.value })}
                    >
                      {ACCESS_KEYS.map((a) => (
                        <option key={a} value={a}>
                          {t(`eset.access_${a}`)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="muted tnum">{availSummary(e.hours, t)}</td>
                  <td className="right">
                    <span className="rowact">
                      <Toggle
                        on={e.bookable}
                        label={t('eset.bookableFor', { name: e.name })}
                        onChange={(next) => void save(e.id, { bookable: next })}
                      />
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${e.status === 'invited' ? '' : 'success'}`}>
                      {e.status === 'invited' ? t('settings.invited') : t('eset.active')}
                    </span>
                  </td>
                  <td className="right">
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(e)}>
                      {t('common.edit')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted" style={{ padding: '14px 20px', fontWeight: 500, fontSize: 12 }}>
          {t('eset.tableFoot')}
        </p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>{t('eset.accessLevels')}</h2>
        </div>
        <table>
          <tbody>
            {ACCESS_KEYS.map((a) => (
              <tr key={a}>
                <td className="bold" style={{ width: 150 }}>
                  {t(`eset.access_${a}`)}
                </td>
                <td className="muted" style={{ fontWeight: 500 }}>
                  {t(`eset.accessDesc_${a}`)}
                </td>
                <td className="right tnum muted">{all.filter((e) => e.access === a).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing ? (
        <EmployeePanel
          employee={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast(t('eset.employeeUpdated'));
            void qc.invalidateQueries({ queryKey: ['employees'] });
          }}
        />
      ) : null}
    </div>
  );
}

function RoleTitleCell({
  e,
  save,
}: {
  e: Employee;
  save: (id: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [v, setV] = useState(e.roleTitle);
  return (
    <input
      className="cell"
      value={v}
      aria-label={t('eset.jobTitleFor', { name: e.name })}
      onChange={(ev) => setV(ev.target.value)}
      onBlur={() => {
        if (v !== e.roleTitle) void save(e.id, { roleTitle: v });
      }}
    />
  );
}

const STD_WEEK: WeekHours = {
  '0': [['09:00', '19:00']], '1': [['09:00', '19:00']], '2': [['09:00', '19:00']],
  '3': [['09:00', '19:00']], '4': [['09:00', '19:00']], '5': [['09:00', '15:00']],
  '6': null,
};

function EmployeePanel({
  employee,
  onClose,
  onSaved,
}: {
  employee: Employee;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const locations = useLocations();
  const firstLoc = locations.data?.locations[0]?.id ?? null;
  const catalog = useLocationCatalog(firstLoc);
  const [roleTitle, setRoleTitle] = useState(employee.roleTitle);
  const [access, setAccess] = useState(employee.access);
  const [hours, setHours] = useState<WeekHours>(employee.hours ?? STD_WEEK);
  const [skills, setSkills] = useState<string[]>(employee.skillServiceIds);
  const [bookable, setBookable] = useState(employee.bookable);
  const [error, setError] = useState<string | null>(null);

  const services = catalog.data?.services ?? [];
  const cats = [...new Set(services.map((s) => s.category ?? ''))];

  const save = async () => {
    setError(null);
    try {
      await patch(EmployeeSchema, `/employees/${employee.id}`, {
        roleTitle,
        access,
        hours,
        skillServiceIds: skills,
        bookable,
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
            <h2>{employee.name}</h2>
            <div className="sub">{t('eset.employee')}</div>
          </div>
          <button className="iconbtn" aria-label={t('common.close')} onClick={onClose}>
            <Icon d={I.x} size={22} w={2.2} />
          </button>
        </div>
        <div className="panel-body">
          <div className="grid2">
            <Field label={t('eset.jobTitle')}>
              <input className="input" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} />
            </Field>
            <Field label={t('eset.access')} hint={t('eset.accessHint')}>
              <select
                className="select"
                style={{ width: '100%' }}
                value={access}
                onChange={(e) => setAccess(e.target.value as Employee['access'])}
              >
                {ACCESS_KEYS.map((a) => (
                  <option key={a} value={a}>
                    {t(`eset.access_${a}`)}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="field">
            <span>{t('eset.availableFor')}</span>
            <div className="card" style={{ marginTop: 6 }}>
              <WeekHoursEditor hours={hours} onChange={setHours} variant="checkbox" timeWidth={124} />
            </div>
            <span className="hint" style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-muted)' }}>
              {t('eset.availableHint')}
            </span>
          </div>

          <div className="field">
            <span>{t('eset.servicesProvides')}</span>
            {cats.map((cat) => (
              <div key={cat}>
                <div className="section-label">{cat}</div>
                {services
                  .filter((s) => (s.category ?? '') === cat)
                  .map((s) => (
                    <label key={s.id} className="checkrow" style={{ padding: '6px 2px' }}>
                      <input
                        type="checkbox"
                        checked={skills.includes(s.id)}
                        onChange={(e) =>
                          setSkills(
                            e.target.checked
                              ? [...skills, s.id]
                              : skills.filter((x) => x !== s.id),
                          )
                        }
                      />
                      <span style={{ fontWeight: 500 }}>{s.name}</span>
                    </label>
                  ))}
              </div>
            ))}
            <span className="hint" style={{ fontSize: 12, fontWeight: 500 }}>
              {t('eset.skillsHint')}
            </span>
          </div>

          <ToggleRow
            label={t('eset.bookable')}
            hint={t('eset.bookableHint')}
            on={bookable}
            onChange={setBookable}
          />

          {error ? (
            <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>
              {error}
            </p>
          ) : null}
        </div>
        <div className="panel-foot">
          <button className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => void save()}>
            {t('cset.saveChanges')}
          </button>
        </div>
      </aside>
    </PanelPortal>
  );
}
