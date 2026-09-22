import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../lib/i18n-core.js';

/**
 * The date-of-birth calendar — the prototype's own.
 *
 * `reference/client-prototype` has always carried a styled calendar for
 * this field: `.cal`, `.cal-hd`, `.cal-nav`, `.cal-dw`, `.cal-g`, built
 * by `calRender()`. The port never used it and dropped a bare
 * `<input type="date">` in instead, which hands the field to whatever
 * the browser feels like drawing — a different control on every
 * platform, none of them this product.
 *
 * So this is the prototype's markup and classes verbatim: month and
 * year selects between two arrows, a Monday-first weekday row, and a
 * grid of days with the chosen one in brand colour. Years run 2026 down
 * to 1930 and the calendar opens on 1995, exactly as it does there.
 *
 * The one departure is a Clear button. The field is optional, and the
 * prototype gave no way to un-pick a date once picked — a dead end the
 * moment somebody taps the wrong year.
 *
 * Talks ISO (`YYYY-MM-DD`) to the contract and shows the prototype's
 * "5 Mar 1990" to the person, so neither side has to know about the
 * other's format.
 */

const MONTHS = () => t('c.date.monthsLong').split(',');
const FIRST_YEAR = 1930;
/** Where the calendar opens when there is no date yet — the
 *  prototype's own default, and a reasonable guess for an adult. */
const DEFAULT_YEAR = 1995;

/** ISO → what the person reads. Empty for no date. */
export function dobLabel(iso: string): string {
  const p = parse(iso);
  return p ? `${p.d} ${MONTHS()[p.m]} ${p.y}` : '';
}

function parse(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export function DobPicker({
  value,
  onChange,
  id = 'dob',
}: {
  /** ISO date, or '' for none. */
  value: string;
  onChange: (isoDate: string) => void;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const picked = useMemo(() => parse(value), [value]);
  const [year, setYear] = useState(picked?.y ?? DEFAULT_YEAR);
  const [month, setMonth] = useState(picked?.m ?? 0);
  const box = useRef<HTMLDivElement>(null);

  // Opening on a date already chosen shows that month, not 1995.
  useEffect(() => {
    if (!open || !picked) return;
    setYear(picked.y);
    setMonth(picked.m);
  }, [open, picked]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('click', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const thisYear = new Date().getFullYear();
  const years: number[] = [];
  for (let y = thisYear; y >= FIRST_YEAR; y -= 1) years.push(y);

  // Monday-first, the way the prototype's weekday row is written.
  const startDow = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();

  const step = (by: number) => {
    let m = month + by;
    let y = year;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
    if (m > 11) {
      m = 0;
      y += 1;
    }
    setMonth(m);
    setYear(y);
  };

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <input
        id={id}
        className="acc-inp"
        readOnly
        placeholder={t('c.dob.choose')}
        aria-haspopup="dialog"
        aria-expanded={open}
        value={dobLabel(value)}
        onClick={() => setOpen(!open)}
        style={{ cursor: 'pointer' }}
      />
      {open ? (
        <div className="cal" role="dialog" aria-label={t('c.dob.choose')}>
          <div className="cal-hd">
            <button type="button" className="cal-nav" onClick={() => step(-1)} aria-label={t('c.dob.prevMonth')}>
              &#8249;
            </button>
            <select
              aria-label={t('c.dob.month')}
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {MONTHS().map((m, i) => (
                <option key={m} value={i}>
                  {m}
                </option>
              ))}
            </select>
            <select aria-label={t('c.dob.year')} value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <button type="button" className="cal-nav" onClick={() => step(1)} aria-label={t('c.dob.nextMonth')}>
              &#8250;
            </button>
          </div>
          <div className="cal-dw">
            <span>{t('c.dob.mo')}</span>
            <span>{t('c.dob.tu')}</span>
            <span>{t('c.dob.we')}</span>
            <span>{t('c.dob.th')}</span>
            <span>{t('c.dob.fr')}</span>
            <span>{t('c.dob.sa')}</span>
            <span>{t('c.dob.su')}</span>
          </div>
          <div className="cal-g">
            {Array.from({ length: startDow }, (_, i) => (
              <span key={`pad-${i}`} />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const d = i + 1;
              const on = picked?.d === d && picked.m === month && picked.y === year;
              return (
                <button
                  key={d}
                  type="button"
                  className={on ? 'on' : ''}
                  onClick={() => {
                    onChange(iso(year, month, d));
                    setOpen(false);
                  }}
                >
                  {d}
                </button>
              );
            })}
          </div>
          {value ? (
            <button
              type="button"
              className="cal-clear"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              {t('c.res.clear')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
