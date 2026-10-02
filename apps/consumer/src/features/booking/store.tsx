import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/** The in-flight booking draft — filled on the salon page, consumed by
 *  the guest identity steps, resolved by the real /public/book door. */
export interface BookingDraft {
  slug: string;
  salonName: string;
  photo: string;
  publishableKey: string;
  locationId: string;
  /** The location's own pin, so the confirmation can map it. */
  lat: number | null;
  lng: number | null;
  /** Every treatment in the visit, in the order they happen. */
  items: { serviceId: string; variantId: string | null; modifierOptionIds: string[]; name: string; durationMin: number; price: number }[];
  /** Products to take home with the visit (2026-10-01); `price` is the
   *  line total, `price` on the draft counts them in. */
  products: { productId: string; name: string; qty: number; price: number }[];
  serviceId: string;
  variantId: string | null;
  serviceName: string;
  durationMin: number;
  price: number;
  employeeId: string;
  employeeName: string;
  date: string;
  dayLbl: string;
  time: string;
  forWhom: 'self' | 'other';
  guestName: string;
  email: string;
  name: string;
  phone: string;
}

interface BookingCtx {
  draft: BookingDraft | null;
  setDraft: (d: BookingDraft | null) => void;
  patch: (p: Partial<BookingDraft>) => void;
}

const Ctx = createContext<BookingCtx>({ draft: null, setDraft: () => {}, patch: () => {} });

/**
 * The draft outlives a reload (Alex, 2026-10-01: /book/review came up
 * empty). It is kept for this tab only, under a key the confirmation
 * screen clears, so a finished booking never comes back as a draft and
 * a second tab never inherits one. Storage can be refused (private
 * windows) — then the draft is simply in memory, as before.
 */
export const DRAFT_KEY = 'velnes.booking.draft';

function readDraft(): BookingDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as BookingDraft;
    return d && typeof d === 'object' && Array.isArray(d.items) && d.slug ? { ...d, products: Array.isArray(d.products) ? d.products : [] } : null;
  } catch {
    return null;
  }
}

function writeDraft(d: BookingDraft | null) {
  try {
    if (d) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* in memory only */
  }
}

export function BookingProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<BookingDraft | null>(readDraft);
  const patch = (p: Partial<BookingDraft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  useEffect(() => writeDraft(draft), [draft]);
  return <Ctx.Provider value={{ draft, setDraft, patch }}>{children}</Ctx.Provider>;
}

export function useBooking() {
  return useContext(Ctx);
}
