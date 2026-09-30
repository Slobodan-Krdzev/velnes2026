import { i18n } from '../i18n-core.js';
import type {
  DiscoveryCategory,
  DiscoverySalonCard,
  DiscoveryServiceCard,
} from '@velnes/contracts';

/** The only place API shapes meet the UI's view models (handover rule:
 *  components never import from here through a side door). */

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Whole-MKD amounts formatted the prototype's way: 1.200 MKD. */
export function fmtMKD(n: number): string {
  return `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} MKD`;
}

export interface CategoryVM {
  id: string;
  slug: string;
  name: string;
  /** CSS background-image value — HQ card image, else the decorative default. */
  img: string;
  /** HQ icon data URL; null renders the generic mark. */
  iconUrl: string | null;
}

export function categoryVM(c: DiscoveryCategory): CategoryVM {
  return {
    id: c.id,
    slug: slugify(c.name),
    name: c.name,
    img: c.cardImage ? `url("${c.cardImage}")` : 'var(--im)',
    iconUrl: c.icon,
  };
}

export interface SalonVM {
  /** The salon's own id — what a favourite refers to. */
  id: string;
  slug: string;
  name: string;
  city: string;
  address: string;
  pitch: string;
  /** Real HQ-taxonomy categories served by this salon. */
  serviceCategories: string[];
  /** CSS background-image value — first gallery photo, else decorative default. */
  photo: string;
  /** The salon's own map pin; null until it drops one. */
  lat: number | null;
  lng: number | null;
  /** Verified reviews: score and count, or null (none, or hidden by the salon). */
  rating: { avg: number; count: number } | null;
  /** Why it is recommended — only on the home page's recommended row. */
  reason?:
    | { kind: 'booked' }
    | { kind: 'favourite' }
    | { kind: 'category'; category: string }
    | { kind: 'nearby'; km: number }
    | { kind: 'new'; days: number }
    | null;
  bookable: boolean;
}

export function salonVM(s: DiscoverySalonCard & { reason?: SalonVM['reason'] }): SalonVM {
  return {
    rating: s.rating ?? null,
    ...(s.reason !== undefined ? { reason: s.reason } : {}),
    id: s.id,
    slug: s.slug,
    name: s.name,
    city: s.city ?? '',
    address: s.address ?? '',
    pitch: s.pitch,
    serviceCategories: s.serviceCategories,
    photo: s.photo ? `url("${s.photo}")` : 'var(--im)',
    lat: s.lat,
    lng: s.lng,
    bookable: s.bookable,
  };
}

export function minutesLbl(min: number): string {
  return i18n.t('c.min', { n: min });
}

/** A treatment as a result: the service itself, and the salon it is at.
 *  What the category cards now open onto — you pick the treatment, and
 *  the salon comes with it, rather than picking a salon and hunting for
 *  the treatment inside it. */
export interface ServiceVM {
  id: string;
  name: string;
  category: string;
  durationMin: number;
  /** Null when the salon publishes no prices — the door withholds the
   *  number rather than sending it to be hidden here. */
  price: number | null;
  priceFrom: number | null;
  /** "HH:MM" when the door was asked for *now* and this can start within
   *  the next half hour; null otherwise. Never computed here. */
  availableAt: string | null;
  /** The first free start on the day asked for, when a day (or a party)
   *  was asked: the salon's date and "HH:MM". Never computed here. */
  availableOn: { date: string; at: string } | null;
  salon: {
    slug: string;
    name: string;
    city: string;
    /** CSS background-image value, as the cards want it — the
     *  decorative default when the salon uploaded nothing. */
    photo: string;
    /** Whether that value is a real photograph. A card can fall back to
     *  the decorative tile happily; a map pin's little card cannot, and
     *  would show an empty box where a picture is meant to be. */
    hasPhoto: boolean;
    lat: number | null;
    lng: number | null;
    bookable: boolean;
    showPrices: boolean;
    rating: { avg: number; count: number } | null;
  };
  /** The place this result is at. A salon with two locations answers
   *  twice — the same treatment at each — and this is what tells the
   *  two rows apart: the key, the pin, and the link's `?location=`. */
  location: {
    id: string;
    name: string;
    city: string;
    address: string;
  };
}

/** A result's identity on the page: the treatment *at the place*. */
export function rowKey(s: ServiceVM): string {
  return `${s.id}@${s.location.id}`;
}

/**
 * Where a result is, in words: the salon, then its location when the
 * location adds something the salon's name does not already say, then
 * the distance (or the city when there is none). "Velnes Fizio Centar ·
 * Aerodrom · 2.1 km"; a one-location salon whose location is named
 * after its city just says "Salon · Skopje".
 */
export function placeLine(s: ServiceVM, away: string | null): string {
  const parts: string[] = [s.salon.name];
  const loc = s.location.name.trim();
  if (loc && !s.salon.name.toLowerCase().includes(loc.toLowerCase())) parts.push(loc);
  const last = away ?? s.location.city ?? s.salon.city;
  if (last && parts[parts.length - 1]!.toLowerCase() !== last.toLowerCase()) parts.push(last);
  return parts.join(' · ');
}

export function serviceVM(s: DiscoveryServiceCard): ServiceVM {
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    durationMin: s.durationMin,
    price: s.price,
    priceFrom: s.priceFrom,
    availableAt: s.availableAt ?? null,
    availableOn: s.availableOn ?? null,
    salon: {
      slug: s.salon.slug,
      name: s.salon.name,
      city: s.salon.city ?? '',
      photo: s.salon.photo ? `url("${s.salon.photo}")` : 'var(--im)',
      hasPhoto: Boolean(s.salon.photo),
      lat: s.salon.lat,
      lng: s.salon.lng,
      bookable: s.salon.bookable,
      showPrices: s.salon.showPrices,
      rating: s.salon.rating ?? null,
    },
    location: {
      id: s.location.id,
      name: s.location.name,
      city: s.location.city ?? s.salon.city ?? '',
      address: s.location.address ?? '',
    },
  };
}

/** What a result card prints where the price goes. A service with
 *  variants starts at the cheapest of them, so it says "from"; a salon
 *  that publishes no prices says so plainly rather than showing a gap. */
export function priceLbl(s: ServiceVM): string | null {
  if (!s.salon.showPrices) return null;
  if (s.priceFrom != null && s.price != null && s.priceFrom < s.price)
    return i18n.t('c.from', { p: fmtMKD(s.priceFrom) });
  if (s.price != null) return fmtMKD(s.price);
  return null;
}

/** A calendar day as a person reads it — "Sat 4 Oct" — in their own
 *  language. For the door's `availableOn`, which is a date, not a clock. */
export function dayLbl(iso: string, lang = i18n.language): string {
  try {
    return new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
  } catch {
    return iso;
  }
}
