import { I, Icon } from '@velnes/ui';
import { useCallback, useState } from 'react';
import { useOutsideClose } from './pop.js';

/**
 * A small ⓘ beside a title. Click opens a short explainer card under
 * it; click anywhere else, or Escape, closes it. `body` lines are
 * paragraphs; the first is often enough.
 */
export function InfoTip({ title, body, label }: { title: string; body: string[]; label: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useOutsideClose(open, close);
  return (
    <span className="pop infotip" ref={ref}>
      <button
        type="button"
        className="infotip-btn"
        aria-label={label}
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon d={I.info} size={15} />
      </button>
      {open ? (
        <div className="menu infotip-card" role="dialog" aria-label={title}>
          <div className="infotip-title">{title}</div>
          {body.map((p, i) => (
            <p key={i} className="infotip-p">
              {p}
            </p>
          ))}
        </div>
      ) : null}
    </span>
  );
}
