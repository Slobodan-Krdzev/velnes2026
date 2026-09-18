import type { DiscoveryCategory, DiscoverySalonCard } from '@velnes/contracts';

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
  slug: string;
  name: string;
  city: string;
  address: string;
  pitch: string;
  /** Real HQ-taxonomy categories served by this salon. */
  serviceCategories: string[];
  /** CSS background-image value — first gallery photo, else decorative default. */
  photo: string;
  bookable: boolean;
}

export function salonVM(s: DiscoverySalonCard): SalonVM {
  return {
    slug: s.slug,
    name: s.name,
    city: s.city ?? '',
    address: s.address ?? '',
    pitch: s.pitch,
    serviceCategories: s.serviceCategories,
    photo: s.photo ? `url("${s.photo}")` : 'var(--im)',
    bookable: s.bookable,
  };
}

export function minutesLbl(min: number): string {
  return `${min} min`;
}
