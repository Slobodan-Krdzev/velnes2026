import { useQueryClient } from '@tanstack/react-query';
import { BusinessSettingsSchema, LocationSchema, type BusinessSettings } from '@velnes/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { patch } from '@velnes/client';
import { useLocations } from '../../api/queries.js';
import { useToast } from '../../lib/toast.js';
import { Field, ToggleRow, useBusinessSettings } from './bits.js';

/** Settings › Sales — the prototype's `sales` panel. The invoice
 *  prefix is real per-location data (the counter that numbers every
 *  invoice); VAT and the register toggles live in the settings
 *  document. */
export function SalesSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const settings = useBusinessSettings();
  const locations = useLocations();
  const [error, setError] = useState<string | null>(null);

  const s = settings.data?.sales;

  const save = async (next: BusinessSettings['sales']) => {
    setError(null);
    try {
      await patch(BusinessSettingsSchema, '/business-settings', { sales: next });
      toast(t('sset.saved'));
      void qc.invalidateQueries({ queryKey: ['businessSettings'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!s) return null;

  return (
    <div className="card">
      <div className="card-header">
        <h2>{t('sset.sales')}</h2>
      </div>
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {(locations.data?.locations ?? []).map((l) => (
          <InvPrefixField key={l.id} id={l.id} name={l.name} invPrefix={l.invPrefix ?? ''} />
        ))}
        <Field label={t('sset.defaultVat')}>
          <input
            className="input"
            type="number"
            defaultValue={s.defaultVat}
            style={{ width: 160 }}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (v !== s.defaultVat) void save({ ...s, defaultVat: v });
            }}
          />
        </Field>
        <ToggleRow
          label={t('sset.autoReceipt')}
          on={s.autoReceipt}
          onChange={(v) => void save({ ...s, autoReceipt: v })}
        />
        <ToggleRow
          label={t('sset.allowDiscounts')}
          on={s.allowDiscounts}
          onChange={(v) => void save({ ...s, allowDiscounts: v })}
        />
        <ToggleRow
          label={t('sset.roundCash')}
          on={s.roundCash}
          onChange={(v) => void save({ ...s, roundCash: v })}
        />
        {error ? (
          <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function InvPrefixField({ id, name, invPrefix }: { id: string; name: string; invPrefix: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [v, setV] = useState(invPrefix);
  return (
    <Field label={t('sset.invoicePrefix', { name })} hint={t('sset.invoicePrefixHint')}>
      <input
        className="input"
        value={v}
        style={{ width: 224 }}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          if (v && v !== invPrefix) {
            void (async () => {
              await patch(LocationSchema, `/locations/${id}`, { invPrefix: v });
              toast(t('sset.saved'));
              void qc.invalidateQueries({ queryKey: ['locations'] });
            })();
          }
        }}
      />
    </Field>
  );
}
