import { useRef, useState } from 'react';
import { AVATAR_MAX_CHARS } from '@velnes/contracts';
import { fileToResizedDataURL } from '@velnes/ui';
import { t } from '../lib/i18n-core.js';

/**
 * A profile photo (Alex, 2026-10-01): picked from the device, scaled
 * down here to a small square-ish JPEG data URL (the same helper the
 * workspace uses for its gallery), kept under the contract's cap, and
 * handed to the caller — the registration draft, or the profile door.
 * Never the file itself: the account stores a data URL, like the
 * salons' photos do.
 */
export function AvatarPicker({
  value,
  initials,
  onChange,
  size = 72,
  busy = false,
}: {
  value: string | null;
  initials: string;
  onChange: (dataUrl: string | null) => void;
  size?: number;
  busy?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState('');
  const pick = async (file: File | undefined) => {
    setErr('');
    if (!file) return;
    const url = await fileToResizedDataURL(file, 320, 0.85);
    if (!url) return setErr(t('c.acc.photoBad'));
    if (url.length > AVATAR_MAX_CHARS) return setErr(t('c.acc.photoTooBig'));
    onChange(url);
  };
  return (
    <div className="avpick" data-testid="avatar-picker">
      <span className="avdot avpick-dot" style={{ width: size, height: size, fontSize: Math.round(size / 3), ...(value ? { background: `url(${value}) center/cover` } : {}) }} aria-hidden="true">
        {value ? '' : initials}
      </span>
      <div className="avpick-actions">
        <button type="button" className="btn btn-g" disabled={busy} onClick={() => input.current?.click()}>
          {value ? t('c.acc.photoChange') : t('c.acc.photoAdd')}
        </button>
        {value ? (
          <button type="button" className="acc-link" disabled={busy} onClick={() => onChange(null)}>
            {t('c.acc.photoRemove')}
          </button>
        ) : null}
        <input
          ref={input}
          type="file"
          accept="image/*"
          aria-label={t('c.acc.photo')}
          style={{ display: 'none' }}
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {err ? <div className="acc-err">{err}</div> : null}
      </div>
    </div>
  );
}
