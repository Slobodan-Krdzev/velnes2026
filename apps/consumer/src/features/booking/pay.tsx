import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { i18n, t } from '../../lib/i18n-core.js';
import { fmtMKD } from '../../lib/api/mappers.js';
import { ApiError, pubPost } from '../../lib/api/client.js';
import { useSession } from '../../lib/api/session.js';
import { useBooking } from './store.js';
import type { BookedVisit } from './steps.js';

/**
 * The payment section — Alex, 2026-09-22.
 *
 * After Book now the visit is booked and the same screen switches to
 * this: the visit, the salon's own promo code or gift card, and three
 * ways to pay. Card and Apple Pay go through the payment doors (a mock
 * provider today, honestly labelled); pay at the venue charges nothing.
 * A guest pays with the token the booking handed back; a signed-in
 * client pays under their own session. The full price is charged —
 * deposits stay deferred.
 */

const i18nHas = (key: string) => i18n.exists(key);

export interface PayQuote {
  appointmentId: string;
  salonName: string;
  locationName: string;
  items: { id: string; serviceName: string; date: string; time: string; end: string; price: number }[];
  subtotal: number;
  promo: { code: string; label: string; amount: number } | null;
  gift: { code: string; amount: number; remaining: number } | null;
  total: number;
  status: 'payable' | 'requested' | 'paid' | 'cancelled';
  codeError: string | null;
}
export interface PayResult {
  status: 'paid' | 'venue';
  method: 'card' | 'apple_pay' | 'venue';
  amount: number;
  invoiceNumber: string | null;
  card: { brand: string; last4: string } | null;
}
export interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

type Method = 'card' | 'apple_pay' | 'venue';

/** What the pay screen needs from whoever opens it: the booked visit
 *  and, for a guest, the token; the salon slug names the salon key. */
export interface PayEntry {
  visit: BookedVisit;
  slug: string;
  token?: string | undefined;
  email?: string | undefined;
}

const AppleMark = (
  <svg width="16" height="19" viewBox="0 0 170 210" aria-hidden="true">
    <path
      fill="currentColor"
      d="M141.5 111.8c-.2-24.8 20.3-36.7 21.2-37.3-11.5-16.9-29.5-19.2-35.9-19.4-15.3-1.6-29.8 9-37.6 9-7.7 0-19.7-8.8-32.4-8.5-16.7.2-32 9.7-40.6 24.6-17.3 30-4.4 74.5 12.5 98.9 8.2 11.9 18 25.3 30.8 24.8 12.4-.5 17.1-8 32-8 15 0 19.2 8 32.4 7.8 13.4-.2 21.9-12.1 30.1-24.1 9.5-13.8 13.4-27.2 13.6-27.9-.3-.1-26.1-10-26.1-39.9zM116.8 39c6.8-8.2 11.4-19.7 10.1-31.1-9.8.4-21.6 6.5-28.6 14.7-6.3 7.3-11.8 18.9-10.3 30 10.9.9 22-5.5 28.8-13.6z"
    />
  </svg>
);

export function BookPay() {
  useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { draft, setDraft } = useBooking();
  const { signedIn, profile, api } = useSession();
  const entry = (history.state?.usr ?? null) as PayEntry | null;
  const [quote, setQuote] = useState<PayQuote | null>(null);
  const [promo, setPromo] = useState('');
  const [gift, setGift] = useState('');
  const [codeIn, setCodeIn] = useState('');
  const [codeErr, setCodeErr] = useState('');
  const [method, setMethod] = useState<Method>('card');
  const [card, setCard] = useState({ number: '', exp: '', cvc: '', holder: '' });
  const [saveCard, setSaveCard] = useState(false);
  const [saved, setSaved] = useState<SavedCard[]>([]);
  const [useSavedId, setUseSavedId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // One door for both kinds of visitor: the guest's carries the key and
  // the token, the client's goes through their session.
  const call = useMemo(
    () =>
      <T,>(path: '/pay/quote' | '/pay', body: Record<string, unknown>) =>
        signedIn
          ? api<T>(path, { method: 'POST', body: JSON.stringify(body) })
          : pubPost<T>(path, { ...body, key: `salon:${entry?.slug ?? ''}`, token: entry?.token ?? '' }),
    [signedIn, api, entry?.slug, entry?.token],
  );

  useEffect(() => {
    if (!entry) return;
    let live = true;
    call<PayQuote>('/pay/quote', {
      appointmentId: entry.visit.ref,
      ...(promo ? { promoCode: promo } : {}),
      ...(gift ? { giftCode: gift } : {}),
    })
      .then((q) => {
        if (!live) return;
        setQuote(q);
        setCodeErr(q.codeError ?? '');
      })
      .catch((e: unknown) => {
        if (live) setErr(e instanceof ApiError ? e.message : t('c.bk.wrong'));
      });
    return () => {
      live = false;
    };
  }, [entry, promo, gift, call]);

  // A signed-in client's saved cards, offered first when they choose Card.
  useEffect(() => {
    if (!signedIn) return;
    api<{ cards: SavedCard[] }>('/me/cards')
      .then((r) => {
        setSaved(r.cards);
        if (r.cards[0]) setUseSavedId(r.cards[0].id);
      })
      .catch(() => setSaved([]));
  }, [signedIn, api]);

  if (!entry) {
    nav('/');
    return null;
  }
  const email = entry.email ?? profile?.email ?? draft?.email ?? '';

  const applyCode = () => {
    const code = codeIn.trim();
    if (!code) return;
    setCodeErr('');
    // The door tells promo from gift; we try the free slot first.
    if (!promo) setPromo(code);
    else setGift(code);
    setCodeIn('');
  };
  // A code the door refused comes back out of its slot.
  useEffect(() => {
    if (!quote?.codeError) return;
    if (promo && !quote.promo) setPromo('');
    else if (gift && !quote.gift) setGift('');
  }, [quote, promo, gift]);

  const pay = async () => {
    if (!quote) return;
    setErr('');
    setBusy(true);
    try {
      const [mm, yy] = card.exp.split(/[/\s]+/);
      const body: Record<string, unknown> = {
        appointmentId: quote.appointmentId,
        method,
        ...(quote.promo ? { promoCode: quote.promo.code } : {}),
        ...(quote.gift ? { giftCode: quote.gift.code } : {}),
      };
      if (method === 'card' && quote.total > 0) {
        if (signedIn && useSavedId) body.savedCardId = useSavedId;
        else {
          body.card = {
            number: card.number,
            expMonth: Number(mm),
            expYear: 2000 + Number((yy ?? '').slice(-2)),
            cvc: card.cvc,
            holder: card.holder,
          };
          body.saveCard = signedIn && saveCard;
        }
      }
      if (method === 'apple_pay' && quote.total > 0) body.applePayToken = `mock_ap_${crypto.randomUUID()}`;
      if (quote.total === 0 && method !== 'venue') body.method = 'venue';
      const res = await call<PayResult>('/pay', body);
      if (signedIn) await qc.invalidateQueries({ queryKey: ['my-appointments'] });
      if (draft) setDraft({ ...draft, email });
      nav('/book/confirmed', { state: { ...entry.visit, payment: res, email }, replace: true });
    } catch (e) {
      setBusy(false);
      setErr(e instanceof ApiError ? (i18nHas(`refusal.${e.code}`) ? t(`refusal.${e.code}`, e.params) : e.message) : t('c.bk.wrong'));
    }
  };

  const total = quote?.total ?? entry.visit.price;
  const free = quote ? quote.total === 0 : false;
  const canPay =
    !!quote &&
    !busy &&
    (method === 'venue' ||
      free ||
      method === 'apple_pay' ||
      (signedIn && !!useSavedId) ||
      (card.number.replace(/\s/g, '').length >= 12 && /^\d{2}\s?\/\s?\d{2,4}$/.test(card.exp) && card.cvc.length >= 3 && card.holder.trim().length > 0));

  return (
    <section data-screen="pay">
      <div className="authwrap authwrap-split pay-wrap">
        <div className="auth-info">
          <h1>{t('c.pay.title')}</h1>
          <div className="sub">{t('c.pay.sub')}</div>
          <div className="minisum">
            <div className="r"><span className="k">{t('c.bk.salon')}</span><span className="v">{quote?.salonName ?? draft?.salonName ?? ''}</span></div>
            {(quote?.items ?? entry.visit.items).map((i) => (
              <div className="r" key={'id' in i ? i.id : i.ref}>
                <span className="k">{i.time}–{i.end}</span>
                <span className="v">{i.serviceName} · {fmtMKD(i.price)}</span>
              </div>
            ))}
            <div className="r"><span className="k">{t('c.bk.dateTime')}</span><span className="v">{entry.visit.date} · {entry.visit.time}</span></div>
            <div className="r"><span className="k">{t('c.pay.subtotal')}</span><span className="v">{fmtMKD(quote?.subtotal ?? entry.visit.price)}</span></div>
            {quote?.promo ? (
              <div className="r pay-disc">
                <span className="k">{t('c.pay.promoLine', { code: quote.promo.code, label: quote.promo.label })}</span>
                <span className="v">−{fmtMKD(quote.promo.amount)} <button type="button" className="pay-x" onClick={() => setPromo('')}>{t('c.pay.remove')}</button></span>
              </div>
            ) : null}
            {quote?.gift ? (
              <div className="r pay-disc">
                <span className="k">{t('c.pay.giftLine', { code: quote.gift.code })}<small> · {t('c.pay.giftLeft', { left: quote.gift.remaining - quote.gift.amount })}</small></span>
                <span className="v">−{fmtMKD(quote.gift.amount)} <button type="button" className="pay-x" onClick={() => setGift('')}>{t('c.pay.remove')}</button></span>
              </div>
            ) : null}
            <div className="r pay-total"><span className="k">{t('c.pay.total')}</span><span className="v">{fmtMKD(total)}</span></div>
          </div>
          <div className="fld">
            <label htmlFor="pay-code">{t('c.pay.codeLbl')}</label>
            <div className="pay-code">
              <input
                id="pay-code"
                className="tin"
                type="text"
                autoComplete="off"
                placeholder={t('c.pay.codePh')}
                value={codeIn}
                onChange={(e) => setCodeIn(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyCode();
                }}
              />
              <button type="button" className="btn btn-g" onClick={applyCode} disabled={!codeIn.trim() || (!!promo && !!gift)}>
                {t('c.pay.apply')}
              </button>
            </div>
            {codeErr ? <div className="acc-err" style={{ marginTop: 6 }}>{codeErr}</div> : null}
          </div>
        </div>

        <div className="auth-form">
          <div className="fld">
            <label>{t('c.pay.method')}</label>
          </div>
          {free ? (
            <div className="note pay-note">{t('c.pay.nothingToPay')}</div>
          ) : (
            <div className="pay-methods" role="radiogroup">
              <button type="button" role="radio" aria-checked={method === 'card'} className={`fwopt${method === 'card' ? ' on' : ''}`} onClick={() => setMethod('card')}>
                <span className="fw-ic">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></svg>
                </span>
                {t('c.pay.card')}
              </button>
              <button type="button" role="radio" aria-checked={method === 'apple_pay'} className={`apple-pay-btn${method === 'apple_pay' ? ' on' : ''}`} onClick={() => setMethod('apple_pay')} aria-label={t('c.pay.applePay')}>
                {AppleMark}
                <span>Pay</span>
              </button>
              <button type="button" role="radio" aria-checked={method === 'venue'} className={`fwopt${method === 'venue' ? ' on' : ''}`} onClick={() => setMethod('venue')}>
                <span className="fw-ic">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 10.5 12 4l9 6.5" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></svg>
                </span>
                {t('c.pay.venue')}
              </button>
            </div>
          )}

          {!free && method === 'card' ? (
            <div className="pay-card">
              {signedIn && saved.length > 0 && useSavedId ? (
                <div className="pay-saved">
                  <div className="fld">
                    <label>{t('c.pay.savedCard')}</label>
                  </div>
                  {saved.map((c) => (
                    <button
                      type="button"
                      key={c.id}
                      className={`fwopt${useSavedId === c.id ? ' on' : ''}`}
                      onClick={() => setUseSavedId(c.id)}
                    >
                      {t('c.pay.useSaved', { brand: c.brand, last4: c.last4 })}
                    </button>
                  ))}
                  <button type="button" className="acc-link" onClick={() => setUseSavedId(null)}>
                    {t('c.pay.newCard')}
                  </button>
                </div>
              ) : (
                <>
                  <div className="fld">
                    <label htmlFor="pay-num">{t('c.pay.cardNumber')}</label>
                    <input id="pay-num" className="tin" inputMode="numeric" autoComplete="cc-number" placeholder="4242 4242 4242 4242" value={card.number} onChange={(e) => setCard({ ...card, number: e.target.value })} />
                  </div>
                  <div className="fld2">
                    <div className="fld">
                      <label htmlFor="pay-exp">{t('c.pay.expiry')}</label>
                      <input id="pay-exp" className="tin" inputMode="numeric" autoComplete="cc-exp" placeholder="MM / YY" value={card.exp} onChange={(e) => setCard({ ...card, exp: e.target.value })} />
                    </div>
                    <div className="fld">
                      <label htmlFor="pay-cvc">{t('c.pay.cvc')}</label>
                      <input id="pay-cvc" className="tin" inputMode="numeric" autoComplete="cc-csc" placeholder="123" value={card.cvc} onChange={(e) => setCard({ ...card, cvc: e.target.value })} />
                    </div>
                  </div>
                  <div className="fld">
                    <label htmlFor="pay-holder">{t('c.pay.holder')}</label>
                    <input id="pay-holder" className="tin" autoComplete="cc-name" placeholder={t('c.pay.holderPh')} value={card.holder} onChange={(e) => setCard({ ...card, holder: e.target.value })} />
                  </div>
                  {signedIn ? (
                    <label className="pay-save">
                      <input type="checkbox" checked={saveCard} onChange={(e) => setSaveCard(e.target.checked)} /> {t('c.pay.saveCard')}
                    </label>
                  ) : null}
                  {saved.length > 0 && signedIn ? (
                    <button type="button" className="acc-link" onClick={() => setUseSavedId(saved[0]!.id)}>
                      {t('c.pay.useSaved', { brand: saved[0]!.brand, last4: saved[0]!.last4 })}
                    </button>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
          {!free && method === 'venue' ? <div className="note pay-note">{t('c.pay.venueSub')}</div> : null}

          {err ? <div className="acc-err" style={{ marginTop: 8 }}>{err}</div> : null}
          <button className={`btn ${method === 'apple_pay' && !free ? 'btn-dark' : 'btn-p'}`} style={{ width: '100%', marginTop: 18, minHeight: 50 }} disabled={!canPay} onClick={pay}>
            {busy
              ? t('c.pay.paying')
              : free
                ? t('c.pay.confirmFree')
                : method === 'venue'
                  ? t('c.pay.confirmVenue')
                  : method === 'apple_pay'
                    ? <>{AppleMark} <span>{t('c.pay.payNow', { amount: fmtMKD(total) })}</span></>
                    : t('c.pay.payNow', { amount: fmtMKD(total) })}
          </button>
          <div className="auth-note">{t('c.pay.secure')}</div>
          <div className="auth-note pay-mock">{t('c.pay.mockNote')}</div>
        </div>
      </div>
    </section>
  );
}
