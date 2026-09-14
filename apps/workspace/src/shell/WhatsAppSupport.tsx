import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Revelapps HQ's WhatsApp support number, digits only for wa.me. Set
// VITE_SUPPORT_WHATSAPP (e.g. "+389 70 123 456") to switch the sidebar
// WhatsApp button + click-to-chat popup on; empty → nothing shows.
export const WA_SUPPORT = (import.meta.env.VITE_SUPPORT_WHATSAPP ?? '').replace(/\D/g, '');

/** The WhatsApp glyph — no I.* entry carries it. */
export function WhatsAppGlyph({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.86 9.86 0 0 0 12.04 2zm5.8 14.09c-.24.68-1.42 1.3-1.95 1.34-.5.05-1.13.24-3.68-.77-3.09-1.22-5.06-4.36-5.22-4.57-.15-.2-1.24-1.65-1.24-3.15 0-1.5.79-2.24 1.07-2.55.28-.31.61-.38.81-.38l.59.01c.19.01.44-.07.69.53.24.6.83 2.07.9 2.22.07.15.12.32.02.52-.1.2-.15.32-.3.5-.15.18-.31.4-.44.53-.15.15-.3.31-.13.6.17.29.76 1.25 1.63 2.03 1.12 1 2.06 1.31 2.35 1.46.29.15.46.12.63-.07.17-.2.73-.85.92-1.14.19-.29.39-.24.65-.15.26.1 1.67.79 1.96.93.29.15.48.22.55.34.07.12.07.68-.17 1.36z" />
    </svg>
  );
}

/** The click-to-chat popup, pinned bottom-right like the reference: the
 *  salon scans the QR with a phone (or opens it here) to reach HQ on
 *  WhatsApp. Honest — this hands off to WhatsApp, it is not an in-app
 *  thread. Rendered by the shell; opened from the sidebar's green icon. */
export function WhatsAppPopup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [qr, setQr] = useState<string | null>(null);
  const waUrl = `https://wa.me/${WA_SUPPORT}?text=${encodeURIComponent(t('support.waPrefill'))}`;
  useEffect(() => {
    if (!open || qr) return;
    QRCode.toDataURL(waUrl, { margin: 1, width: 240, color: { dark: '#12241f', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [open, qr, waUrl]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-label={t('support.waHeader')}
      style={{
        position: 'fixed', right: 20, bottom: 20, width: 'min(340px, calc(100vw - 40px))', zIndex: 60,
        border: '1px solid var(--line)', borderRadius: 16, overflow: 'hidden', background: 'var(--surface)',
        boxShadow: '0 24px 60px -18px rgba(0,0,0,.4), 0 4px 12px rgba(0,0,0,.12)',
        animation: 'waPop .18s cubic-bezier(.16,1,.3,1) both',
      }}
    >
      <style>{'@keyframes waPop{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}'}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: '#0b7a63', color: '#fff' }}>
        <span style={{ display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: 999, background: 'rgba(255,255,255,.18)' }}>
          <WhatsAppGlyph size={18} />
        </span>
        <span style={{ flex: 1 }}>
          <span style={{ display: 'block', fontWeight: 800 }}>{t('support.waHeader')}</span>
          <span style={{ fontSize: 12, opacity: 0.9 }}>{t('support.waSub')}</span>
        </span>
        <button type="button" onClick={onClose} aria-label={t('common.cancel')} style={{ background: 'transparent', border: 0, color: '#fff', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
      </div>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, background: 'var(--wash)' }}>
        <div style={{ background: '#fff', padding: 10, borderRadius: 12, border: '1px solid var(--line)' }}>
          {qr ? (
            <img src={qr} alt="WhatsApp QR" width={180} height={180} style={{ display: 'block' }} />
          ) : (
            <div className="muted" style={{ width: 180, height: 180, display: 'grid', placeItems: 'center' }}>…</div>
          )}
        </div>
        <p className="muted" style={{ fontWeight: 500, fontSize: 13, textAlign: 'center', margin: 0 }}>{t('support.waHow')}</p>
        <a className="btn" href={waUrl} target="_blank" rel="noopener noreferrer" style={{ background: '#25D366', color: '#fff', borderColor: '#25D366', fontWeight: 700, alignSelf: 'stretch', textAlign: 'center' }}>
          {t('support.waOpen')}
        </a>
        <p className="muted" style={{ fontSize: 11, textAlign: 'center', margin: 0 }}>{t('support.waFoot')}</p>
      </div>
    </div>
  );
}
