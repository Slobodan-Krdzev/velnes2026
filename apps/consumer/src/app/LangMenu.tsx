import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLang } from '../lib/i18n.js';

/**
 * The language pill — "EN ▾" — and its three choices.
 *
 * The prototype's footer carried a dead "MK · English" button and its
 * header no language control at all; every other Velnes app switches
 * from its shell header, and the consumer app now does too. Small on
 * purpose: a customer changes this once.
 */
export function LangMenu({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { lang, setLang, langs, label } = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);
  return (
    <div className={`langmenu${compact ? ' compact' : ''}`} ref={ref}>
      <button
        type="button"
        className="langbtn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('c.lang')}
        onClick={() => setOpen((o) => !o)}
      >
        {compact ? lang.toUpperCase() : label[lang]}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open ? (
        <div className="langlist" role="listbox" aria-label={t('c.lang')}>
          {langs.map((l) => (
            <button
              key={l}
              type="button"
              role="option"
              aria-selected={l === lang}
              className={`langopt${l === lang ? ' on' : ''}`}
              onClick={() => {
                setLang(l);
                setOpen(false);
              }}
            >
              {label[l]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
