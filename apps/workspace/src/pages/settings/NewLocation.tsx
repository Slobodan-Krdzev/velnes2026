import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LegalEntityListSchema,
  LocationSchema,
  type CopyChecklist,
  type LocationCreate,
} from '@velnes/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, get, post } from '@velnes/client';
import { useLocations } from '../../api/queries.js';
import { useToast } from '../../lib/toast.js';

/** The prototype's viewNewLoc: five steps (four when starting from
 *  scratch). Create is one door; submit-to-HQ can ride in the same
 *  act. */

const useLegalEntities = () =>
  useQuery({
    queryKey: ['legalEntities'],
    queryFn: () => get(LegalEntityListSchema, '/legal-entities'),
  });

type Draft = {
  step: number;
  mode: 'scratch' | 'copy' | null;
  srcId: string | null;
  loc: {
    name: string;
    address: string;
    city: string;
    zip: string;
    phone: string;
    tz: string;
    rooms: string;
    invPrefix: string;
    country: string;
  };
  legalMode: 'existing' | 'new';
  legalId: string | null;
  legal: { name: string; taxId: string; vat: string; currency: string };
  copy: CopyChecklist;
};

export function NewLocationWizard({ done }: { done: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const locations = useLocations();
  const entities = useLegalEntities();
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState<Draft>({
    step: 1,
    mode: null,
    srcId: null,
    loc: {
      name: '', address: '', city: '', zip: '', phone: '',
      tz: 'Europe/Skopje', rooms: '2', invPrefix: '', country: 'North Macedonia',
    },
    legalMode: 'existing',
    legalId: null,
    legal: { name: '', taxId: '', vat: '', currency: 'MKD' },
    copy: { services: true, prices: true, timing: true, products: true, hours: true, policies: true, payments: true },
  });
  const live = (locations.data?.locations ?? []).filter((l) => l.lifecycle === 'ACTIVE');
  const mine = entities.data?.entities ?? [];
  const legalId = n.legalId ?? mine.find((e) => e.isDefault)?.id ?? mine[0]?.id ?? null;
  const srcId = n.srcId ?? live[0]?.id ?? null;

  const steps = n.mode === 'copy' ? [1, 2, 3, 4, 5] : [1, 2, 3, 5];
  const labels: Record<number, string> = {
    1: t('nloc.stepStart'),
    2: t('nloc.stepLocation'),
    3: t('nloc.stepLegal'),
    4: t('nloc.stepCopy'),
    5: t('nloc.stepReview'),
  };
  const idx = steps.indexOf(n.step);
  const setLoc = (k: keyof Draft['loc'], v: string) =>
    setN((d) => ({ ...d, loc: { ...d.loc, [k]: v } }));
  const setLegal = (k: keyof Draft['legal'], v: string) =>
    setN((d) => ({ ...d, legal: { ...d.legal, [k]: v } }));

  const create = async (submit: boolean) => {
    setError(null);
    const body: LocationCreate = {
      name: n.loc.name.trim(),
      city: n.loc.city.trim(),
      address: n.loc.address.trim(),
      zip: n.loc.zip,
      country: n.loc.country,
      tz: n.loc.tz,
      phone: n.loc.phone,
      rooms: Number(n.loc.rooms || 2),
      invPrefix: n.loc.invPrefix,
      mode: n.mode === 'copy' ? 'copy' : 'scratch',
      srcLocationId: n.mode === 'copy' ? srcId : null,
      copy: n.copy,
      legal:
        n.legalMode === 'existing' && legalId
          ? { mode: 'existing', legalEntityId: legalId }
          : {
              mode: 'new',
              name: n.legal.name.trim(),
              taxId: n.legal.taxId.trim(),
              vat: n.legal.vat,
              currency: n.legal.currency || 'MKD',
            },
      submit,
    };
    try {
      await post(LocationSchema, '/locations', body);
      toast(submit ? t('nloc.submitted') : t('nloc.created'));
      void qc.invalidateQueries({ queryKey: ['locations'] });
      done();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'failed');
    }
  };

  const fld = (label: string, key: keyof Draft['loc'], ph?: string) => (
    <label className="field">
      <span>{label}</span>
      <input
        className="input"
        value={n.loc[key]}
        placeholder={ph}
        onChange={(e) => setLoc(key, e.target.value)}
      />
    </label>
  );

  const foreign = n.loc.country && n.loc.country !== 'North Macedonia';
  const copyItems: [keyof CopyChecklist, string][] = [
    ['services', t('nloc.copyServices')],
    ['prices', t('nloc.copyPrices')],
    ['timing', t('nloc.copyTiming')],
    ['products', t('nloc.copyProducts')],
    ['hours', t('nloc.copyHours')],
    ['policies', t('nloc.copyPolicies')],
    ['payments', t('nloc.copyPayments')],
  ];

  return (
    <div className="stacked">
      <div className="card" style={{ padding: 24 }}>
        <div className="hstack" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
          <h1 style={{ margin: 0 }}>{t('nloc.title')}</h1>
          <button className="btn btn-ghost btn-sm" onClick={done}>
            {t('nloc.cancel')}
          </button>
        </div>
        <p className="muted" style={{ fontWeight: 500, margin: '0 0 16px' }}>
          {t('nloc.subtitle')}
        </p>
        <div className="hstack" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {steps.map((st, i) => (
            <span key={st} className={`badge ${st === n.step ? 'accent' : i < idx ? 'success' : ''}`}>
              {i + 1} · {labels[st]}
            </span>
          ))}
        </div>

        {n.step === 1 ? (
          <>
            <div className="grid2" style={{ gap: 16 }}>
              <button
                className="card"
                style={{
                  textAlign: 'left', padding: 20, cursor: 'pointer',
                  border: `2px solid ${n.mode === 'scratch' ? 'var(--ink)' : 'var(--line)'}`,
                }}
                onClick={() => setN((d) => ({ ...d, mode: 'scratch' }))}
              >
                <div className="bold" style={{ marginBottom: 6 }}>{t('nloc.scratch')}</div>
                <div className="muted" style={{ fontWeight: 500 }}>{t('nloc.scratchSub')}</div>
              </button>
              <button
                className="card"
                style={{
                  textAlign: 'left', padding: 20, cursor: 'pointer',
                  border: `2px solid ${n.mode === 'copy' ? 'var(--ink)' : 'var(--line)'}`,
                }}
                onClick={() => setN((d) => ({ ...d, mode: 'copy' }))}
              >
                <div className="bold" style={{ marginBottom: 6 }}>{t('nloc.copy')}</div>
                <div className="muted" style={{ fontWeight: 500 }}>{t('nloc.copySub')}</div>
              </button>
            </div>
            {n.mode === 'copy' ? (
              <div className="field" style={{ marginTop: 16, maxWidth: 360 }}>
                <label>{t('nloc.copyFrom')}</label>
                <select
                  className="select"
                  value={srcId ?? ''}
                  onChange={(e) => setN((d) => ({ ...d, srcId: e.target.value }))}
                >
                  {live.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} — {l.city}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </>
        ) : null}

        {n.step === 2 ? (
          <>
            <div className="grid2" style={{ gap: 16, maxWidth: 760 }}>
              {fld(t('nloc.locName'), 'name', 'e.g. Debar Maalo')}
              {fld(t('reg.phone'), 'phone', '+389 …')}
              {fld(t('nloc.address'), 'address')}
              {fld(t('reg.city'), 'city')}
              {fld(t('reg.zip'), 'zip')}
              <div className="field">
                <label>{t('nloc.country')}</label>
                <select
                  className="select"
                  value={n.loc.country}
                  onChange={(e) => setLoc('country', e.target.value)}
                >
                  {['North Macedonia', 'Netherlands', 'Greece', 'Serbia'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              {fld(t('nloc.tz'), 'tz')}
              {fld(t('nloc.rooms'), 'rooms')}
              {fld(t('nloc.invPrefix'), 'invPrefix', 'DEB-')}
            </div>
            {foreign ? (
              <div className="note warn" style={{ marginTop: 12, maxWidth: 760 }}>
                {t('nloc.foreignNote')}
              </div>
            ) : null}
          </>
        ) : null}

        {n.step === 3 ? (
          <div className="stacked" style={{ maxWidth: 640 }}>
            <button
              className="card"
              style={{
                textAlign: 'left', padding: 16, cursor: 'pointer',
                border: `2px solid ${n.legalMode === 'existing' ? 'var(--ink)' : 'var(--line)'}`,
              }}
              onClick={() => setN((d) => ({ ...d, legalMode: 'existing' }))}
            >
              <div className="bold">{t('nloc.legalExisting')}</div>
              {n.legalMode === 'existing' ? (
                <div style={{ marginTop: 10 }}>
                  {mine.map((le) => (
                    <label
                      key={le.id}
                      className="hstack"
                      style={{ gap: 10, cursor: 'pointer', marginBottom: 6 }}
                    >
                      <input
                        type="radio"
                        name="nlle"
                        checked={legalId === le.id}
                        onChange={() => setN((d) => ({ ...d, legalId: le.id }))}
                      />
                      <span style={{ fontWeight: 600 }}>{le.name}</span>
                      <span className={`badge ${le.status === 'verified' ? 'success' : 'warning'}`}>
                        {le.status}
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
            </button>
            <button
              className="card"
              style={{
                textAlign: 'left', padding: 16, cursor: 'pointer',
                border: `2px solid ${n.legalMode === 'new' ? 'var(--ink)' : 'var(--line)'}`,
              }}
              onClick={() => setN((d) => ({ ...d, legalMode: 'new' }))}
            >
              <div className="bold">{t('nloc.legalNew')}</div>
              <div className="muted" style={{ fontWeight: 500 }}>{t('nloc.legalNewSub')}</div>
              {n.legalMode === 'new' ? (
                <div className="grid2" style={{ gap: 12, marginTop: 12 }}>
                  <label className="field">
                    <span>{t('reg.legalName')}</span>
                    <input
                      className="input"
                      placeholder="… DOOEL Skopje"
                      value={n.legal.name}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setLegal('name', e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>{t('reg.taxNumber')}</span>
                    <input
                      className="input"
                      value={n.legal.taxId}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setLegal('taxId', e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>{t('reg.vatReg')}</span>
                    <input
                      className="input"
                      value={n.legal.vat}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setLegal('vat', e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>{t('reg.currency')}</span>
                    <input
                      className="input"
                      value={n.legal.currency}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setLegal('currency', e.target.value)}
                    />
                  </label>
                </div>
              ) : null}
            </button>
          </div>
        ) : null}

        {n.step === 4 ? (
          <div className="card" style={{ maxWidth: 640, padding: 20 }}>
            {copyItems.map(([k, l]) => (
              <label key={k} className="hstack" style={{ gap: 10, cursor: 'pointer', marginBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={n.copy[k]}
                  onChange={() => setN((d) => ({ ...d, copy: { ...d.copy, [k]: !d.copy[k] } }))}
                />
                <span style={{ fontWeight: 600 }}>{l}</span>
              </label>
            ))}
            <div className="note" style={{ marginTop: 12 }}>{t('nloc.neverCopied')}</div>
          </div>
        ) : null}

        {n.step === 5 ? (
          <div className="card" style={{ maxWidth: 640, padding: 20 }}>
            <div className="kv">
              <span className="k">{t('nloc.reviewLocation')}</span>
              <span className="v">
                {n.loc.name || '—'} · {n.loc.address || '—'}, {n.loc.city || '—'}
              </span>
            </div>
            <div className="kv">
              <span className="k">{t('nloc.reviewStart')}</span>
              <span className="v">
                {n.mode === 'copy'
                  ? t('nloc.copyOf', { name: live.find((l) => l.id === srcId)?.name ?? '—' })
                  : t('nloc.fromScratch')}
              </span>
            </div>
            <div className="kv">
              <span className="k">{t('hq.legalEntity')}</span>
              <span className="v">
                {n.legalMode === 'existing'
                  ? (mine.find((e) => e.id === legalId)?.name ?? '—')
                  : `${n.legal.name} ${t('nloc.newReviewed')}`}
              </span>
            </div>
            <div className="note" style={{ margin: '14px 0' }}>{t('nloc.reviewNote')}</div>
            {error ? (
              <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>{error}</p>
            ) : null}
            <div className="hstack" style={{ gap: 10 }}>
              <button className="btn btn-secondary" onClick={() => void create(false)}>
                {t('nloc.saveDraft')}
              </button>
              <button className="btn btn-primary" onClick={() => void create(true)}>
                {t('nloc.submitHq')}
              </button>
            </div>
          </div>
        ) : null}

        <div className="hstack" style={{ gap: 10, marginTop: 18 }}>
          {idx > 0 ? (
            <button
              className="btn btn-secondary"
              onClick={() => setN((d) => ({ ...d, step: steps[idx - 1]! }))}
            >
              {t('reg.back')}
            </button>
          ) : null}
          {n.step !== 5 ? (
            <button
              className="btn btn-primary"
              disabled={n.step === 1 && !n.mode}
              onClick={() => setN((d) => ({ ...d, step: steps[idx + 1]! }))}
            >
              {t('reg.next')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
