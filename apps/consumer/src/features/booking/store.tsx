import { createContext, useContext, useState, type ReactNode } from 'react';

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
  items: { serviceId: string; variantId: string | null; name: string; durationMin: number; price: number }[];
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

export function BookingProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<BookingDraft | null>(null);
  const patch = (p: Partial<BookingDraft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  return <Ctx.Provider value={{ draft, setDraft, patch }}>{children}</Ctx.Provider>;
}

export function useBooking() {
  return useContext(Ctx);
}
