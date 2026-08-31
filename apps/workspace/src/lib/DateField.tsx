import { I, Icon } from '@velnes/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOutsideClose } from './pop.js';

/** Every date on screen opens the same calendar the Calendar screen
 *  uses — the prototype's menu-cal grid — never the browser's own
 *  picker. Six rows of seven so the menu never jumps height. */

const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dOf = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
};
const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return localIso(new Date(y!, m! - 1, d! + n));
};
const mondayOf = (iso: string) => addDays(iso, -((dOf(iso).getDay() + 6) % 7));
const firstOfMonth = (iso: string) => `${iso.slice(0, 7)}-01`;
const addMonths = (iso: string, n: number) => {
  const d = dOf(firstOfMonth(iso));
  d.setMonth(d.getMonth() + n);
  return localIso(d);
};

export function DateField({
  value,
  onChange,
  min,
  max,
  label,
  clearable,
  width,
}: {
  value: string;
  onChange: (iso: string) => void;
  min?: string | undefined;
  max?: string | undefined;
  label: string;
  clearable?: boolean;
  width?: number | string;
}) {
  const { t, i18n } = useTranslation();
  const today = localIso(new Date());
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState(firstOfMonth(value || today));
  const ref = useOutsideClose(open, () => setOpen(false));

  const grid = mondayOf(first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(grid, i));
  const monthIx = dOf(first).getMonth();
  const outOfRange = (v: string) => (!!min && v < min) || (!!max && v > max);
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div className="pop" ref={ref} style={{ display: 'flex', width: width ?? '100%' }}>
      <button
        type="button"
        className={`input tnum calpick-btn${open ? ' open' : ''}`}
        style={{ width: '100%' }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        onClick={() => {
          if (!open) setFirst(firstOfMonth(value || today));
          setOpen(!open);
        }}
      >
        {value
          ? dOf(value).toLocaleDateString(i18n.language, {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })
          : '—'}
      </button>
      {open ? (
        <div className="menu menu-cal" role="dialog" aria-label={label}>
          <div className="calpick-head">
            <button
              type="button"
              className="btn btn-subtle btn-icon btn-sm"
              aria-label={t('cal.prevMonth')}
              onClick={() => setFirst(addMonths(first, -1))}
            >
              <Icon d={I.left} size={18} w={2.5} />
            </button>
            <span className="calpick-title">
              {dOf(first).toLocaleDateString(i18n.language, { month: 'long' })}{' '}
              {dOf(first).getFullYear()}
            </span>
            <button
              type="button"
              className="btn btn-subtle btn-icon btn-sm"
              aria-label={t('cal.nextMonth')}
              onClick={() => setFirst(addMonths(first, 1))}
            >
              <Icon d={I.right} size={18} w={2.5} />
            </button>
          </div>
          <div className="calpick-grid">
            {(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).map((k) => (
              <span key={k} className="calpick-dow">
                {t(`week.${k}`).slice(0, 1)}
              </span>
            ))}
            {days.map((v) => {
              const out = dOf(v).getMonth() !== monthIx;
              const dead = outOfRange(v);
              return (
                <button
                  key={v}
                  type="button"
                  className={`calpick-day${out ? ' out' : ''}${v === value ? ' on' : ''}${v === today ? ' today' : ''}${dead ? ' closed' : ''}`}
                  disabled={dead}
                  aria-current={v === today ? 'date' : 'false'}
                  title={v}
                  onClick={() => pick(v)}
                >
                  {Number(v.slice(8))}
                </button>
              );
            })}
          </div>
          <div className="calpick-foot">
            {clearable ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
              >
                {t('common.clear')}
              </button>
            ) : (
              <span className="muted">{value || '—'}</span>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={outOfRange(today)}
              onClick={() => pick(today)}
            >
              {t('common.today')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
