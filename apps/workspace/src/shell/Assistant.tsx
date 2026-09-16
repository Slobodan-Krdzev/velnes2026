import {
  AssistantExecuteResponseSchema,
  AssistantMessageResponseSchema,
  AssistantResumeResponseSchema,
  type AssistantDraft,
} from '@velnes/contracts';
import { api, get, post, useSession } from '@velnes/client';
import { Icon, I } from '@velnes/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import './assistant.css';

const OkSchema = z.object({ ok: z.boolean() });

type Turn = { role: 'user' | 'assistant'; text: string };

/** Human labels for the preview field keys the server sends. */
const FIELD_LABEL: Record<string, string> = {
  price: 'Price',
  name: 'Name',
  category: 'Category',
  durationMin: 'Duration',
  vat: 'VAT',
  online: 'Online',
  pos: 'Till',
  closed: 'Closed',
  reason: 'Reason',
  performers: 'Performed by',
  email: 'Email',
  phone: 'Phone',
  bookable: 'Takes appointments',
  title: 'Job title',
  days: 'Days',
  hours: 'Hours',
  adds: 'Adds',
};
const label = (k: string) => FIELD_LABEL[k] ?? k;

/** Field-aware formatting for a preview value — prices in MKD, durations
 *  in minutes, flags as on/off, everything else as text. */
function fmt(key: string, v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'number') {
    if (key === 'price') return `${v.toLocaleString('en-US')} MKD`;
    if (key === 'durationMin') return `${v} min`;
    if (key === 'vat') return `${v}%`;
    return String(v);
  }
  return String(v);
}

/** Render the structured preview a write draft carries — field by field,
 *  before → after for edits, just the new value for creates. Never
 *  computed here; it's the server's ChangeSet. */
function Preview({ draft }: { draft: AssistantDraft }) {
  const { t } = useTranslation();
  if (!draft.preview) return null;
  return (
    <div className="asst-preview">
      <div className="asst-preview-h">{t('assistant.reviewTitle')}</div>
      {draft.preview.ops.map((op, i) => {
        const after = (op.after ?? {}) as Record<string, unknown>;
        const before = (op.before ?? {}) as Record<string, unknown>;
        const keys = Object.keys({ ...before, ...after });
        return (
          <div key={i} className="asst-op">
            <span className="asst-op-label">
              {op.kind === 'create' ? '+ ' : op.kind === 'delete' ? '− ' : ''}
              {op.entity.label}
            </span>
            {keys.map((k) => (
              <span key={k} className="asst-op-delta">
                <span className="asst-op-field">{label(k)}</span>{' '}
                {k in before && op.kind !== 'create' ? (
                  <>
                    <s>{fmt(k, before[k])}</s> <span aria-hidden>→</span> <b>{fmt(k, after[k])}</b>
                  </>
                ) : (
                  <b>{fmt(k, after[k] ?? before[k])}</b>
                )}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function Assistant() {
  const { t } = useTranslation();
  const { me, can } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState<AssistantDraft | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  // The launcher shows only when HQ has enabled the Assistant for this
  // salon AND the user can use at least the catalog. The server enforces
  // the entitlement too — this is just the visible half.
  const visible = !!me?.assistantEnabled && can('catalog.view');

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [turns, draft, busy]);

  const greeting = () => t('assistant.greeting', { name: me?.name.split(' ')[0] ?? '' });

  // On each open, resume any unfinished draft (continuation, decision F.3).
  useEffect(() => {
    if (!open) {
      setLoaded(false); // re-fetch fresh next time it opens
      return;
    }
    if (loaded) return;
    setLoaded(true);
    void get(AssistantResumeResponseSchema, '/assistant/draft')
      .then((r) => {
        if (r.draft) {
          setDraft(r.draft);
          setTurns([
            {
              role: 'assistant',
              text: t('assistant.continueBody', {
                intent: r.draft.intent,
                filled: r.draft.filledCount,
                required: r.draft.requiredCount,
              }),
            },
          ]);
        } else {
          setTurns([{ role: 'assistant', text: greeting() }]);
        }
      })
      .catch(() => setTurns([{ role: 'assistant', text: greeting() }]));
  }, [open, loaded, me, t]);

  if (!visible) return null;

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    setInput('');
    setTurns((v) => [...v, { role: 'user', text: message }]);
    setBusy(true);
    try {
      const res = await post(AssistantMessageResponseSchema, '/assistant/message', {
        message,
        ...(draft ? { draftId: draft.id } : {}),
      });
      setDraft(res.draft);
      setTurns((v) => [...v, { role: 'assistant', text: res.reply }]);
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!draft || busy) return;
    setBusy(true);
    try {
      const res = await post(AssistantExecuteResponseSchema, '/assistant/execute', { draftId: draft.id });
      setTurns((v) => [...v, { role: 'assistant', text: res.message }]);
      if (res.status === 'COMPLETED') {
        setDraft(null);
        // The change landed out-of-band from any open screen — refresh the
        // catalog/categories/schedule views so it appears without a reload.
        void qc.invalidateQueries({ queryKey: ['catalog'] });
        void qc.invalidateQueries({ queryKey: ['categories'] });
        void qc.invalidateQueries({ queryKey: ['combos'] });
        void qc.invalidateQueries({ queryKey: ['schedule'] });
      } else if (res.conflict && draft.preview) {
        // Re-baselined server-side; reflect the fresh "before" and let the
        // user approve again.
        const ops = draft.preview.ops.map((op) => ({ ...op, before: { price: numOf(res.conflict!.now) } }));
        setDraft({ ...draft, preview: { ops } });
      }
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (draft) await api(OkSchema, `/assistant/draft/${draft.id}`, { method: 'DELETE' }).catch(() => {});
    setDraft(null);
    setTurns((v) => [...v, { role: 'assistant', text: t('assistant.greeting', { name: me?.name.split(' ')[0] ?? '' }) }]);
  }

  const reviewing = draft?.status === 'READY_FOR_REVIEW' && !!draft.preview;
  const nav = draft?.kind === 'navigate' ? draft.navigate : null;

  function goTo() {
    if (!nav) return;
    navigate(nav.screen, { state: { tab: nav.tab, entityId: nav.entityId } });
    setOpen(false);
    setDraft(null);
  }

  return (
    <>
      {!open ? (
        <button className="asst-fab" aria-label={t('assistant.open')} onClick={() => setOpen(true)}>
          <Icon d={I.sparkle} size={24} w={2} />
        </button>
      ) : null}

      {open ? (
        <div className="asst-panel" role="dialog" aria-label={t('assistant.title')}>
          <header className="asst-head">
            <div>
              <div className="asst-title">{t('assistant.title')}</div>
              <div className="asst-sub">{t('assistant.subtitle')}</div>
            </div>
            <button className="iconbtn" aria-label={t('assistant.close')} onClick={() => setOpen(false)}>
              <Icon d={I.x} size={22} w={2} />
            </button>
          </header>

          <div className="asst-body" ref={scroller}>
            {turns.map((m, i) => (
              <div key={i} className={`asst-msg asst-${m.role}`}>
                {m.text}
              </div>
            ))}
            {reviewing ? <Preview draft={draft!} /> : null}
            {nav ? (
              <button className="btn btn-primary asst-navbtn" onClick={goTo}>
                {t('assistant.openScreen')}
              </button>
            ) : null}
            {busy ? <div className="asst-msg asst-assistant asst-muted">{t('assistant.thinking')}</div> : null}
          </div>

          {reviewing ? (
            <div className="asst-actions">
              <button className="btn btn-secondary" onClick={() => void cancel()} disabled={busy}>
                {t('assistant.cancel')}
              </button>
              <button className="btn btn-primary" onClick={() => void approve()} disabled={busy}>
                {busy ? t('assistant.applying') : t('assistant.approve')}
              </button>
            </div>
          ) : (
            <form
              className="asst-input"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t('assistant.placeholder')}
                aria-label={t('assistant.title')}
                autoFocus
              />
              <button className="btn btn-primary" type="submit" disabled={busy || !input.trim()}>
                {t('assistant.send')}
              </button>
            </form>
          )}
        </div>
      ) : null}
    </>
  );
}

const numOf = (s: string) => Number(s.replace(/[^\d.]/g, '')) || 0;
