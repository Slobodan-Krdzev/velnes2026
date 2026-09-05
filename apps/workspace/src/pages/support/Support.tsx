import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SUPPORT_CATEGORIES,
  SupportTicketListSchema,
  type SupportCategory,
  type SupportTicket,
} from '@velnes/contracts';
import { z } from 'zod';
import { api, get, post } from '@velnes/client';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { useToast } from '../../lib/toast.js';

const OkSchema = z.object({ ok: z.literal(true) });
const IdSchema = z.object({ id: z.string() });

const statusTone: Record<string, string> = {
  open: 'info',
  in_progress: 'warning',
  resolved: 'success',
  closed: '',
};

function fmt(at: string) {
  try {
    return new Date(at).toLocaleString();
  } catch {
    return at;
  }
}

/** The salon's support desk: open a thread to Revelapps HQ, read the
 *  conversation, reply. Every write also travels to HQ over mail. */
export function SupportPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const tickets = useQuery({
    queryKey: ['support'],
    queryFn: () => get(SupportTicketListSchema, '/support/tickets'),
  });
  const rows = tickets.data?.tickets ?? [];
  const [selId, setSelId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const sel = rows.find((r) => r.id === selId) ?? null;

  // A bell click lands here with the ticket it spoke of.
  const asked = (useLocation().state as { ticket?: string } | null)?.ticket ?? null;
  useEffect(() => {
    if (asked && rows.some((r) => r.id === asked)) {
      setSelId(asked);
      setComposing(false);
    }
  }, [asked, rows]);

  const refresh = () => void qc.invalidateQueries({ queryKey: ['support'] });

  return (
    <div className="support-grid" style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 20 }}>
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-header">
          <h2>{t('support.title')}</h2>
          <button className="btn btn-primary btn-sm" onClick={() => { setComposing(true); setSelId(null); }}>
            {t('support.new')}
          </button>
        </div>
        {rows.length === 0 ? (
          <div className="empty" style={{ padding: 24 }}>
            <p>{t('support.empty')}</p>
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  className={`ticketrow${selId === r.id ? ' on' : ''}`}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '12px 16px',
                    border: 'none', borderTop: '1px solid var(--line)', background: selId === r.id ? 'var(--wash)' : 'transparent', cursor: 'pointer',
                  }}
                  onClick={() => { setSelId(r.id); setComposing(false); }}
                >
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span className="bold">{r.subject}</span>
                    <span className={`badge ${statusTone[r.status] ?? ''}`}>{t(`support.status.${r.status}`)}</span>
                  </span>
                  <span className="muted" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
                    {t(`support.cat.${r.category}`)} · {fmt(r.updatedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card" style={{ minHeight: 320 }}>
        {composing ? (
          <NewTicket
            onCreated={(id) => { refresh(); setComposing(false); setSelId(id); toast(t('support.sent')); }}
            onCancel={() => setComposing(false)}
          />
        ) : sel ? (
          <Thread ticket={sel} onReplied={() => { refresh(); toast(t('support.replied')); }} />
        ) : (
          <div className="empty" style={{ padding: 40 }}>
            <h3>{t('support.pickTitle')}</h3>
            <p>{t('support.pickSub')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function NewTicket({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<SupportCategory>('other');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post(IdSchema, '/support/tickets', { subject, category, body });
      onCreated(r.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 20, display: 'grid', gap: 14 }}>
      <h2>{t('support.newTitle')}</h2>
      <label className="field">
        <span>{t('support.subject')}<span className="req">*</span></span>
        <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label className="field">
        <span>{t('support.category')}</span>
        <select className="select" style={{ width: '100%' }} value={category} onChange={(e) => setCategory(e.target.value as SupportCategory)}>
          {SUPPORT_CATEGORIES.map((c) => (
            <option key={c} value={c}>{t(`support.cat.${c}`)}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t('support.message')}<span className="req">*</span></span>
        <textarea className="input" style={{ height: 140 }} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <p className="muted" style={{ fontWeight: 500, fontSize: 12, margin: 0 }}>{t('support.honestNote')}</p>
      {error ? <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>{error}</p> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
        <button className="btn btn-primary" disabled={busy || subject.trim().length < 3 || !body.trim()} onClick={() => void submit()}>
          {t('support.send')}
        </button>
      </div>
    </div>
  );
}

function Thread({ ticket, onReplied }: { ticket: SupportTicket; onReplied: () => void }) {
  const { t } = useTranslation();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const reply = async () => {
    setBusy(true);
    try {
      await api(OkSchema, `/support/tickets/${ticket.id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      setBody('');
      onReplied();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card-header" style={{ padding: 0 }}>
        <h2>{ticket.subject}</h2>
        <span className={`badge ${statusTone[ticket.status] ?? ''}`}>{t(`support.status.${ticket.status}`)}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {ticket.messages.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.authorKind === 'hq' ? 'flex-start' : 'flex-end',
              maxWidth: '80%',
              background: m.authorKind === 'hq' ? 'var(--wash)' : 'var(--accent-wash, #eef2ff)',
              borderRadius: 12,
              padding: '10px 14px',
            }}
          >
            <span className="muted" style={{ display: 'block', fontSize: 12, fontWeight: 600 }}>
              {m.authorKind === 'hq' ? t('support.fromHq') : m.authorName} · {fmt(m.at)}
            </span>
            <span style={{ whiteSpace: 'pre-wrap' }}>{m.body}</span>
          </div>
        ))}
      </div>
      {ticket.status === 'closed' ? (
        <p className="muted" style={{ fontWeight: 500 }}>{t('support.closedNote')}</p>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            className="input"
            style={{ height: 64, flex: 1 }}
            placeholder={t('support.replyPlaceholder')}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <button className="btn btn-primary" disabled={busy || !body.trim()} onClick={() => void reply()}>
            {t('support.reply')}
          </button>
        </div>
      )}
    </div>
  );
}
