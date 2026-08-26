import { useQueryClient } from '@tanstack/react-query';
import { BusinessProfileSchema, type BusinessProfile } from '@velnes/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { patch } from '@velnes/client';
import { useToast } from '../../lib/toast.js';
import { Field, useBusiness } from './bits.js';

/** Settings › Company — the prototype's `company` panel: the business
 *  card, the HQ-managed Legal & payments block (read-only), and the
 *  public gallery. Photos are stored as data URLs — the file is the
 *  storage. */
export function CompanySection() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const business = useBusiness();
  const [form, setForm] = useState<{
    name: string;
    address: string;
    city: string;
    phone: string;
    description: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const b = business.data;
  useEffect(() => {
    if (b && !form)
      setForm({
        name: b.name,
        address: b.address ?? '',
        city: b.city ?? '',
        phone: b.phone ?? '',
        description: b.description,
      });
  }, [b, form]);
  if (!b || !form) return null;

  const save = async () => {
    setError(null);
    try {
      await patch(BusinessProfileSchema, '/business', {
        name: form.name,
        address: form.address || null,
        city: form.city || null,
        phone: form.phone || null,
        description: form.description,
      });
      toast(t('cset.saved'));
      void qc.invalidateQueries({ queryKey: ['business'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const setF = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });
  const legalReady = b.legal?.status === 'verified' && b.legal?.accountStatus === 'active';

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="card">
        <div className="card-header">
          <h2>{t('cset.companyInfo')}</h2>
          <button className="btn btn-primary btn-sm" disabled={!form.name} onClick={() => void save()}>
            {t('cset.saveChanges')}
          </button>
        </div>
        <div className="grid2" style={{ padding: 20 }}>
          <Field label={t('cset.businessName')} req span>
            <input className="input" value={form.name} onChange={(e) => setF('name', e.target.value)} />
          </Field>
          <Field label={t('cset.street')}>
            <input className="input" value={form.address} onChange={(e) => setF('address', e.target.value)} />
          </Field>
          <Field label={t('cset.city')}>
            <input className="input" value={form.city} onChange={(e) => setF('city', e.target.value)} />
          </Field>
          <Field label={t('cset.taxNumber')} hint={t('cset.taxNumberHint')}>
            <input className="input" value={b.vat ?? '—'} disabled />
          </Field>
          <Field label={t('cset.phone')}>
            <input className="input" value={form.phone} onChange={(e) => setF('phone', e.target.value)} />
          </Field>
          <Field label={t('cset.publicDescription')} span>
            <textarea
              className="input"
              value={form.description}
              onChange={(e) => setF('description', e.target.value)}
            />
          </Field>
        </div>
        {error ? (
          <p role="alert" style={{ padding: '0 20px 16px', color: 'var(--danger)', fontWeight: 600 }}>
            {error}
          </p>
        ) : null}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <h2>{t('cset.legalPayments')}</h2>
          <span className={`badge ${legalReady ? 'success' : 'warning'}`}>
            {legalReady ? t('cset.ready') : t('cset.incomplete')}
          </span>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="kv">
            <span className="k">{t('cset.legalSeller')}</span>
            <span className="v">{b.legal?.name ?? '—'}</span>
          </div>
          <div className="kv">
            <span className="k">{t('cset.taxNumber')}</span>
            <span className="v tnum">{b.legal?.taxId ?? '—'}</span>
          </div>
          <div className="kv">
            <span className="k">{t('cset.merchantId')}</span>
            <span className="v tnum">{b.legal?.merchantId ?? '—'}</span>
          </div>
          <div className="kv">
            <span className="k">{t('cset.provider')}</span>
            <span className="v">{b.legal?.provider ?? '—'}</span>
          </div>
          <div className="note">{t('cset.legalNote')}</div>
        </div>
      </div>

      <GalleryCard b={b} />
    </div>
  );
}

function GalleryCard({ b }: { b: BusinessProfile }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const write = async (gallery: BusinessProfile['gallery']) => {
    setError(null);
    try {
      await patch(BusinessProfileSchema, '/business', { gallery });
      toast(t('cset.saved'));
      void qc.invalidateQueries({ queryKey: ['business'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const addFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = typeof reader.result === 'string' ? reader.result : null;
      if (!img) return;
      void write([
        ...b.gallery,
        { id: `g${Date.now()}`, name: file.name.replace(/\.[^.]+$/, ''), img, tone: null },
      ]);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="card-header">
        <h2>{t('cset.gallery')}</h2>
        <span className="badge">{t('cset.photoCount', { n: b.gallery.length })}</span>
      </div>
      <div className="grid2" style={{ padding: 20, gap: 10 }}>
        {b.gallery.map((g) => (
          <div
            key={g.id}
            style={{
              position: 'relative',
              borderRadius: 12,
              overflow: 'hidden',
              border: '1px solid var(--line)',
              aspectRatio: '4/3',
              background: g.img ? 'none' : (g.tone ?? 'var(--surface-muted)'),
            }}
          >
            {g.img ? (
              <img src={g.img} alt={g.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : null}
            <span
              style={{
                position: 'absolute',
                left: 8,
                bottom: 6,
                fontSize: 12,
                fontWeight: 700,
                color: '#fff',
                textShadow: '0 1px 3px rgba(0,0,0,.5)',
              }}
            >
              {g.name}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              aria-label={t('cset.removePhoto', { name: g.name })}
              style={{ position: 'absolute', top: 4, right: 4, color: '#fff' }}
              onClick={() => void write(b.gallery.filter((x) => x.id !== g.id))}
            >
              ✕
            </button>
          </div>
        ))}
        <label
          className="hstack"
          style={{
            border: '1px dashed var(--line)',
            borderRadius: 12,
            aspectRatio: '4/3',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            fontWeight: 600,
            color: 'var(--muted)',
          }}
        >
          + {t('cset.addPhoto')}
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) addFile(f);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {error ? (
        <p role="alert" style={{ padding: '0 20px 16px', color: 'var(--danger)', fontWeight: 600 }}>
          {error}
        </p>
      ) : null}
      <div className="note" style={{ margin: '0 20px 20px' }}>
        {t('cset.galleryNote')}
      </div>
    </div>
  );
}
