import { SIGN_IN_LINK_DAYS, SignInLinkResponseSchema, type Employee } from '@velnes/contracts';
import { post } from '@velnes/client';
import { I, Icon } from '@velnes/ui';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PanelPortal } from '../../lib/Panel.js';

/** Where the employee app lives, for the how-to text before a link
 *  exists; once one is minted its own origin is the truth. */
const EMPLOYEE_APP = (import.meta.env.VITE_EMPLOYEE_URL ?? 'http://localhost:5174').replace(/\/+$/, '');

/**
 * Settings › Team › "Sign-in link" (Alex, 2026-09-23): the one place
 * that both hands a team member their personal link — copied, or
 * scanned as a QR — and explains how signing in works on the phone.
 * The link is minted on demand; the door revokes the previous one.
 */
export function SignInLinkPanel({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const { t } = useTranslation();
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mint = async () => {
    setWorking(true);
    setError(null);
    setCopied(false);
    try {
      const res = await post(SignInLinkResponseSchema, `/employees/${employee.id}/sign-in-link`, {});
      setLink({ url: res.url, expiresAt: res.expiresAt });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  };

  useEffect(() => {
    if (!link) {
      setQr(null);
      return;
    }
    QRCode.toDataURL(link.url, { margin: 1, width: 220, color: { dark: '#12241f', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [link]);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const appAt = link ? new URL(link.url).origin : EMPLOYEE_APP;
  const expires = link ? new Date(link.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';

  return (
    <PanelPortal>
      <div className="scrim on" onClick={onClose} />
      <aside className="panel open" role="dialog" aria-modal="true" aria-label={t('tset.linkTitle', { name: employee.name })}>
        <div className="panel-head plain">
          <div>
            <h2>{t('tset.linkTitle', { name: employee.name })}</h2>
            <p className="sub">{t('tset.linkSub')}</p>
          </div>
          <div className="panel-actions">
            <button className="iconbtn" aria-label={t('common.close')} onClick={onClose}>
              <Icon d={I.x} size={20} />
            </button>
          </div>
        </div>
        <div className="panel-body">
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>{t('tset.linkHowTitle', { name: employee.name })}</h3>
          <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6, fontSize: 13.5, lineHeight: 1.45 }}>
            <li>{t('tset.linkHow1')}</li>
            <li>{t('tset.linkHow2', { name: employee.name })}</li>
            <li>{t('tset.linkHow3')}</li>
            <li>
              {t('tset.linkHow4')} <code>{appAt}</code>
            </li>
          </ol>
          <div className="note" style={{ margin: '12px 0 18px' }}>
            {t('tset.linkNote', { days: SIGN_IN_LINK_DAYS })}
          </div>

          {link ? (
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              {qr ? <img src={qr} alt="" width={180} height={180} style={{ display: 'block', borderRadius: 10, border: '1px solid var(--line)' }} /> : null}
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <input className="input" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-primary btn-sm" onClick={() => void copy()}>
                    {copied ? t('tset.linkCopied') : t('tset.linkCopy')}
                  </button>
                  <button className="btn btn-ghost btn-sm" disabled={working} onClick={() => void mint()}>
                    {t('tset.linkAgain')}
                  </button>
                </div>
                <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  {t('tset.linkExpires', { date: expires })}
                </p>
              </div>
            </div>
          ) : (
            <button className="btn btn-primary" disabled={working} onClick={() => void mint()}>
              {working ? t('tset.linkCreating') : t('tset.linkCreate')}
            </button>
          )}
          {error ? (
            <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600, marginTop: 10 }}>
              {error}
            </p>
          ) : null}
        </div>
      </aside>
    </PanelPortal>
  );
}
