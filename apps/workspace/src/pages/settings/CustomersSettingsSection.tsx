import { useQueryClient } from '@tanstack/react-query';
import { BusinessSettingsSchema, type BusinessSettings } from '@velnes/contracts';
import { I, Icon } from '@velnes/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { patch } from '@velnes/client';
import { useToast } from '../../lib/toast.js';
import { Field, useBusinessSettings } from './bits.js';

/** Settings › Customers — the prototype's `customers` panel: the
 *  groups table with their standing discounts, and the two form
 *  switches. The form builder itself is a deferral — even the
 *  prototype only toasts. */
export function CustomersSettingsSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const settings = useBusinessSettings();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [discount, setDiscount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const cs = settings.data?.customers;

  const save = async (next: BusinessSettings['customers']) => {
    setError(null);
    try {
      await patch(BusinessSettingsSchema, '/business-settings', { customers: next });
      toast(t('cuset.saved'));
      void qc.invalidateQueries({ queryKey: ['businessSettings'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!cs) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="card">
        <div className="card-header">
          <h2>{t('cuset.groups')}</h2>
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            {t('cuset.newGroup')} <Icon d={I.plus} size={20} w={2.5} />
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>{t('cuset.group')}</th>
              <th>{t('cuset.discount')}</th>
              <th className="right" />
            </tr>
          </thead>
          <tbody>
            {cs.groups.map((g) => (
              <tr key={g.name}>
                <td className="bold">{g.name}</td>
                <td className="muted tnum">{g.discountPct}%</td>
                <td className="right">
                  {cs.groups.length > 1 ? (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        void save({ ...cs, groups: cs.groups.filter((x) => x.name !== g.name) })
                      }
                    >
                      {t('common.delete')}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {adding ? (
          <div className="grid2" style={{ padding: '0 20px 20px', alignItems: 'end' }}>
            <Field label={t('cuset.groupName')} req>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t('cuset.discount')}>
              <div className="hstack">
                <input
                  className="input"
                  type="number"
                  value={discount}
                  style={{ width: 120 }}
                  onChange={(e) => setDiscount(Number(e.target.value))}
                />
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!name.trim() || cs.groups.some((g) => g.name === name.trim())}
                  onClick={() => {
                    void save({
                      ...cs,
                      groups: [...cs.groups, { name: name.trim(), discountPct: discount }],
                    });
                    setAdding(false);
                    setName('');
                    setDiscount(0);
                  }}
                >
                  {t('cal.add')}
                </button>
              </div>
            </Field>
          </div>
        ) : null}
      </div>

      <div className="card">
        <div className="card-header">
          <h2>{t('cuset.forms')}</h2>
          <button className="btn btn-primary" disabled title={t('cuset.formBuilderLater')}>
            {t('cuset.newForm')} <Icon d={I.plus} size={20} w={2.5} />
          </button>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button
            className="checkrow"
            onClick={() => void save({ ...cs, forms: { ...cs.forms, consult: !cs.forms.consult } })}
          >
            <span className={`check${cs.forms.consult ? ' on' : ''}`}>
              <Icon d={I.check} size={14} w={3.5} />
            </span>
            <span style={{ fontWeight: 500 }}>{t('cuset.consultForm')}</span>
          </button>
          <button
            className="checkrow"
            onClick={() => void save({ ...cs, forms: { ...cs.forms, intake: !cs.forms.intake } })}
          >
            <span className={`check${cs.forms.intake ? ' on' : ''}`}>
              <Icon d={I.check} size={14} w={3.5} />
            </span>
            <span style={{ fontWeight: 500 }}>{t('cuset.intakeForm')}</span>
          </button>
          <p className="muted" style={{ fontWeight: 500, fontSize: 12 }}>
            {t('cuset.formBuilderLater')}
          </p>
        </div>
      </div>
      {error ? (
        <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
