import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BillingProfileListSchema, BillingProfileSchema, type BillingProfile, type BillingProfileWrite } from '@velnes/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { get, put } from '@velnes/client';
import { fileToAvatarDataUrl } from '../../lib/image.js';
import { useToast } from '../../lib/toast.js';
import { Field, ToggleRow } from './bits.js';

/**
 * Settings › Invoicing (Phase 1, 2026-10-06) — docs/INVOICING.md.
 * One form per legal entity: identity read from the entity (HQ-managed),
 * everything an invoice must carry set here. The completeness banner is
 * the server's own verdict — the same evaluator the issue door will use.
 */
export const useBillingProfiles = () =>
  useQuery({ queryKey: ['billingProfiles'], queryFn: () => get(BillingProfileListSchema, '/billing/profiles') });

export function InvoicingSection() {
  const { t } = useTranslation();
  const q = useBillingProfiles();
  if (!q.data) return null;
  if (!q.data.profiles.length)
    return (
      <div className="card">
        <div className="card-header">
          <h2>{t('iset.title')}</h2>
        </div>
        <p className="muted" style={{ padding: 20 }}>{t('iset.noEntity')}</p>
      </div>
    );
  return (
    <>
      {q.data.profiles.map((p) => (
        <ProfileForm key={p.legalEntityId} profile={p} />
      ))}
    </>
  );
}

const toWrite = (p: BillingProfile): BillingProfileWrite => ({
  tradingName: p.tradingName,
  address: p.address,
  city: p.city,
  zip: p.zip,
  country: p.country,
  vatRegistered: p.vatRegistered,
  vatRegNo: p.vatRegNo,
  embs: p.embs,
  bankName: p.bankName,
  bankAccount: p.bankAccount,
  defaultCurrency: p.defaultCurrency,
  invoicePrefix: p.invoicePrefix,
  creditPrefix: p.creditPrefix,
  yearlyReset: p.yearlyReset,
  numberWidth: p.numberWidth,
  defaultVatRateBp: p.defaultVatRateBp,
  pricesIncludeVat: p.pricesIncludeVat,
  footerText: p.footerText,
  paymentInstructions: p.paymentInstructions,
  signatoryName: p.signatoryName,
  contactEmail: p.contactEmail,
  phone: p.phone,
  website: p.website,
  logo: p.logo,
  issueMode: p.issueMode,
});

function ProfileForm({ profile }: { profile: BillingProfile }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<BillingProfileWrite>(() => toWrite(profile));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm(toWrite(profile)), [profile]);
  const set = <K extends keyof BillingProfileWrite>(k: K, v: BillingProfileWrite[K]) => setForm((f) => ({ ...f, [k]: v }));

  const c = profile.completeness;
  const year = new Date().getFullYear();
  const sample = (prefix: string) => `${prefix}${year}-${'1'.padStart(form.numberWidth, '0')}`;
  const fieldName = (f: string) => t(`iset.f.${f}`, { defaultValue: f });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await put(BillingProfileSchema, `/billing/profiles/${profile.legalEntityId}`, form);
      toast(t('iset.saved'));
      void qc.invalidateQueries({ queryKey: ['billingProfiles'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onLogo = async (file: File | undefined) => {
    if (!file) return;
    set('logo', await fileToAvatarDataUrl(file, 320));
  };

  return (
    <div className="card" data-testid="invoicing-profile">
      <div className="card-header">
        <div>
          <h2>{t('iset.title')}</h2>
          <span className="muted">{t('iset.sub')}</span>
        </div>
        <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
          {t('iset.save')}
        </button>
      </div>

      <div
        className={`note ${c.complete ? '' : 'warn'}`}
        style={{ margin: '0 20px 16px' }}
        role="status"
        data-testid="invoicing-status"
      >
        {c.complete ? (
          <b>{t('iset.statusComplete')}</b>
        ) : (
          <>
            <b>{t('iset.statusIncomplete')}</b>
            <span style={{ display: 'block' }}>
              {c.missing.length ? t('iset.statusMissing', { n: c.missing.length }) : null}
              {c.missing.length && c.invalid.length ? ' · ' : ''}
              {c.invalid.length ? t('iset.statusInvalid', { n: c.invalid.length }) : null}
            </span>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {c.missing.map((f) => (
                <li key={`m-${f}`}>
                  {fieldName(f)} — {t('iset.r.missing')}
                </li>
              ))}
              {c.invalid.map((i) => (
                <li key={`i-${i.field}-${i.reason}`}>
                  {fieldName(i.field)} — {t(`iset.r.${i.reason}`)}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <Group title={t('iset.gIdentity')} hint={t('iset.gIdentityHint')}>
        <Field label={t('iset.legalName')} req span>
          <input className="input" value={profile.legalName} disabled />
        </Field>
        <Field label={t('iset.edb')} req>
          <input className="input" value={profile.edb || '—'} disabled />
        </Field>
        <Field label={t('iset.embs')}>
          <input className="input" value={form.embs ?? ''} onChange={(e) => set('embs', e.target.value)} placeholder="7012345" />
        </Field>
        <Field label={t('iset.tradingName')} hint={t('iset.tradingNameHint')} span>
          <input className="input" value={form.tradingName ?? ''} placeholder={profile.businessName} onChange={(e) => set('tradingName', e.target.value || null)} />
        </Field>
      </Group>

      <Group title={t('iset.gAddress')}>
        <Field label={t('iset.address')} req span>
          <input className="input" value={form.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label={t('iset.city')} req>
          <input className="input" value={form.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label={t('iset.zip')} req>
          <input className="input" value={form.zip} onChange={(e) => set('zip', e.target.value)} />
        </Field>
        <Field label={t('iset.country')} req>
          <input className="input" value={form.country} onChange={(e) => set('country', e.target.value)} />
        </Field>
        {profile.locations.length ? (
          <p className="muted span2" style={{ margin: 0, fontSize: 13 }}>
            {t('iset.locations', { names: profile.locations.map((l) => l.name).join(', ') })}
          </p>
        ) : null}
      </Group>

      <Group title={t('iset.gVat')}>
        <div className="span2">
          <ToggleRow
            label={t('iset.vatRegistered')}
            hint={t('iset.vatRegisteredHint')}
            on={form.vatRegistered}
            onChange={(v) => {
              set('vatRegistered', v);
              set('defaultVatRateBp', v ? (form.defaultVatRateBp || 1800) : 0);
            }}
          />
        </div>
        {form.vatRegistered ? (
          <>
            <Field label={t('iset.vatRegNo')} req hint={t('iset.vatRegNoHint')}>
              <input
                className="input"
                value={form.vatRegNo ?? ''}
                disabled={!!profile.vatRegNo && profile.entityStatus === 'verified'}
                onChange={(e) => set('vatRegNo', e.target.value)}
                placeholder="MK4030000000000"
              />
            </Field>
            <Field label={t('iset.defaultVat')}>
              <input
                className="input"
                type="number"
                min={0}
                max={100}
                value={form.defaultVatRateBp / 100}
                onChange={(e) => set('defaultVatRateBp', Math.round(Number(e.target.value) * 100))}
              />
            </Field>
            <div className="span2">
              <ToggleRow label={t('iset.pricesIncludeVat')} on={form.pricesIncludeVat} onChange={(v) => set('pricesIncludeVat', v)} />
            </div>
          </>
        ) : null}
      </Group>

      <Group title={t('iset.gBank')}>
        <Field label={t('iset.bankName')}>
          <input className="input" value={form.bankName} onChange={(e) => set('bankName', e.target.value)} />
        </Field>
        <Field label={t('iset.bankAccount')}>
          <input className="input" value={form.bankAccount} onChange={(e) => set('bankAccount', e.target.value)} />
        </Field>
      </Group>

      <Group title={t('iset.gDefaults')}>
        <Field label={t('iset.currency')}>
          <input className="input" value={form.defaultCurrency} maxLength={3} style={{ width: 120 }} onChange={(e) => set('defaultCurrency', e.target.value.toUpperCase())} />
        </Field>
        <Field label={t('iset.issueMode')}>
          <select className="input" value={form.issueMode} onChange={(e) => set('issueMode', e.target.value as 'draft' | 'auto')}>
            <option value="draft">{t('iset.issueDraft')}</option>
            <option value="auto">{t('iset.issueAuto')}</option>
          </select>
        </Field>
        <Field label={t('iset.footer')} span>
          <textarea className="input" value={form.footerText} onChange={(e) => set('footerText', e.target.value)} />
        </Field>
        <Field label={t('iset.paymentInstructions')} span>
          <textarea className="input" value={form.paymentInstructions} onChange={(e) => set('paymentInstructions', e.target.value)} />
        </Field>
      </Group>

      <Group title={t('iset.gNumbering')} hint={profile.numberingLocked ? t('iset.numberingLocked') : t('iset.numberingHint')}>
        <Field label={t('iset.invoicePrefix')}>
          <input className="input" value={form.invoicePrefix} disabled={profile.numberingLocked} onChange={(e) => set('invoicePrefix', e.target.value.toUpperCase())} placeholder="INV-" />
        </Field>
        <Field label={t('iset.creditPrefix')}>
          <input className="input" value={form.creditPrefix} disabled={profile.numberingLocked} onChange={(e) => set('creditPrefix', e.target.value.toUpperCase())} />
        </Field>
        <Field label={t('iset.numberWidth')}>
          <input className="input" type="number" min={4} max={8} value={form.numberWidth} disabled={profile.numberingLocked} style={{ width: 120 }} onChange={(e) => set('numberWidth', Number(e.target.value))} />
        </Field>
        <div>
          <ToggleRow label={t('iset.yearlyReset')} on={form.yearlyReset} disabled={profile.numberingLocked} onChange={(v) => set('yearlyReset', v)} />
        </div>
        <p className="muted span2 tnum" style={{ margin: 0, fontSize: 13 }} data-testid="numbering-preview">
          {t('iset.preview', { inv: sample(form.invoicePrefix), cn: sample(form.creditPrefix) })}
        </p>
      </Group>

      <Group title={t('iset.gSignatory')}>
        <Field label={t('iset.signatoryName')} req span>
          <input className="input" value={form.signatoryName} onChange={(e) => set('signatoryName', e.target.value)} />
        </Field>
      </Group>

      <Group title={t('iset.gContact')}>
        <Field label={t('iset.contactEmail')}>
          <input className="input" type="email" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} />
        </Field>
        <Field label={t('iset.phone')}>
          <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label={t('iset.website')}>
          <input className="input" value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="www.yoursalon.mk" />
        </Field>
        <div className="field">
          <span>{t('iset.logo')}</span>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {form.logo ? <img src={form.logo} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }} /> : null}
            <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
              {t('iset.logoChange')}
              <input type="file" accept="image/*" hidden onChange={(e) => void onLogo(e.target.files?.[0])} />
            </label>
            {form.logo ? (
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => set('logo', null)}>
                {t('iset.logoRemove')}
              </button>
            ) : null}
          </div>
        </div>
      </Group>

      {error ? (
        <p role="alert" style={{ padding: '0 20px 16px', color: 'var(--danger)', fontWeight: 600 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '0 20px 16px' }}>
      <h3 style={{ margin: '8px 0 4px', fontSize: 15 }}>{title}</h3>
      {hint ? <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>{hint}</p> : null}
      <div className="grid2">{children}</div>
    </div>
  );
}
