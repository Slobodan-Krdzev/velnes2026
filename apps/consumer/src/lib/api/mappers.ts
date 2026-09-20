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
  bookable: boolean;
}

export function salonVM(s: DiscoverySalonCard): SalonVM {
  return {
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
  return `${min} min`;
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
  salon: {
    slug: string;
    name: string;
    city: string;
    /** CSS background-image value, as the cards want it. */
    photo: string;
    lat: number | null;
    lng: number | null;
    bookable: boolean;
    showPrices: boolean;
  };
}

export function serviceVM(s: DiscoveryServiceCard): ServiceVM {
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    durationMin: s.durationMin,
    price: s.price,
    priceFrom: s.priceFrom,
    salon: {
      slug: s.salon.slug,
      name: s.salon.name,
      city: s.salon.city ?? '',
      photo: s.salon.photo ? `url("${s.salon.photo}")` : 'var(--im)',
      lat: s.salon.lat,
      lng: s.salon.lng,
      bookable: s.salon.bookable,
      showPrices: s.salon.showPrices,
    },
  };
}

/** What a result card prints where the price goes. A service with
 *  variants starts at the cheapest of them, so it says "from"; a salon
 *  that publishes no prices says so plainly rather than showing a gap. */
export function priceLbl(s: ServiceVM): string | null {
  if (!s.salon.showPrices) return null;
  if (s.priceFrom != null && s.price != null && s.priceFrom < s.price)
    return `from ${fmtMKD(s.priceFrom)}`;
  if (s.price != null) return fmtMKD(s.price);
  return null;
}
