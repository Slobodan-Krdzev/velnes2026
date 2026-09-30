import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { I, Icon } from '@velnes/ui';
import { quickLinks, search, type NavIndex } from './rank.js';
import type { NavEntry, NavTarget } from './types.js';
import './navsearch.css';

/**
 * The search surface: a small dialog under the top bar with one input
 * (a combobox over a listbox), the strongest results as the person
 * types, the quick links before they do. Arrow keys move, Enter goes,
 * Escape closes; focus comes back to whatever opened it. The same
 * component in every app — only the index and the way a target is
 * carried out differ.
 */
export function NavSearch<Ctx>({
  open,
  onClose,
  index,
  ctx,
  onGo,
  returnFocusTo,
}: {
  open: boolean;
  onClose: () => void;
  index: NavIndex<Ctx>;
  ctx: Ctx;
  /** Carry out a chosen destination — navigate, switch a tab, scroll. */
  onGo: (target: NavTarget, entry: NavEntry<Ctx>) => void;
  returnFocusTo?: React.RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const typed = q.trim().length > 0;
  const rows = useMemo<NavEntry<Ctx>[]>(
    () => (typed ? search(index, q, ctx).map((r) => r.entry) : quickLinks(index, ctx)),
    [index, q, ctx, typed],
  );

  // Fresh every time it opens; the field gets the focus.
  useEffect(() => {
    if (!open) return;
    setQ('');
    setActive(0);
    inputRef.current?.focus();
    // Once more after paint, for a browser that moved focus with the
    // click that opened us.
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);
  useEffect(() => setActive(0), [q]);

  const close = () => {
    onClose();
    const el = returnFocusTo?.current;
    if (el) requestAnimationFrame(() => el.focus());
  };
  const go = (entry: NavEntry<Ctx>) => {
    const target = typeof entry.go === 'function' ? entry.go(ctx) : entry.go;
    close();
    onGo(target, entry);
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (rows.length ? (a + 1) % rows.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (rows.length ? (a - 1 + rows.length) % rows.length : 0));
    } else if (e.key === 'Enter') {
      const entry = rows[active];
      if (entry) {
        e.preventDefault();
        go(entry);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  if (!open) return null;
  const optionId = (i: number) => `${listId}-${i}`;
  return createPortal(
    <>
      <div className="navs-scrim" onMouseDown={close} />
      <div className="navs" role="dialog" aria-modal="true" aria-label={t('navs.title')}>
        <div className="navs-in">
          <Icon d={I.search} size={20} />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={rows.length ? optionId(active) : undefined}
            aria-label={t('navs.title')}
            placeholder={t('navs.placeholder')}
            autoComplete="off"
            spellCheck={false}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
          />
          <span className="navs-kbd" aria-hidden="true">esc</span>
          <button type="button" className="navs-close" aria-label={t('navs.close')} onClick={close}>
            <Icon d={I.x} size={18} />
          </button>
        </div>
        {rows.length ? (
          <>
            {!typed ? <div className="navs-h">{t('navs.quick')}</div> : null}
            <ul id={listId} className="navs-list" role="listbox" aria-label={t('navs.results')}>
              {rows.map((entry, i) => (
                <li
                  key={entry.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  className="navs-item"
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(entry)}
                >
                  <span className="navs-ic">
                    <Icon d={entry.icon} size={20} w={1.8} />
                  </span>
                  <span className="navs-tx">
                    <b>{t(entry.title)}</b>
                    <span>{[...entry.crumbs, entry.title].map((k) => t(k)).join(' › ')}</span>
                  </span>
                  <span className="navs-enter" aria-hidden="true">↵</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="navs-empty">
            <b>{t('navs.empty')}</b>
            <p>{t('navs.emptyHint')}</p>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}

/** ⌘K / Ctrl+K opens the search from anywhere in the app. */
export function useNavSearchHotkey(open: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        open();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
}
