import { z } from 'zod';

/**
 * Amenities — the facilities and conveniences a customer can expect at
 * a LOCATION (Alex, 2026-09-29). A fixed vocabulary with stable keys,
 * kept here rather than in a table the way the registration days and
 * the permission keys are: every door validates against it, the apps
 * translate and draw it, and search can filter on the keys later.
 * Selections live per location in `location_amenities`.
 *
 * Deliberately NOT amenities, because Velnes models them elsewhere:
 * payments (the location's `payments` document), gift cards (the till's
 * gift cards), a product shop (the salon's sellable products), hours,
 * languages, policies, services and staff.
 */
export const AMENITY_GROUPS = ['facilities', 'spa', 'experience'] as const;
export type AmenityGroup = (typeof AMENITY_GROUPS)[number];

/** In display order within each group: the common, high-value ones first. */
export const AMENITIES = [
  { key: 'wifi', group: 'facilities' },
  { key: 'free_parking', group: 'facilities' },
  { key: 'paid_parking_nearby', group: 'facilities' },
  { key: 'wheelchair_accessible', group: 'facilities' },
  { key: 'accessible_restroom', group: 'facilities' },
  { key: 'restroom', group: 'facilities' },
  { key: 'air_conditioning', group: 'facilities' },
  { key: 'waiting_area', group: 'facilities' },
  { key: 'private_treatment_rooms', group: 'facilities' },
  { key: 'changing_room', group: 'facilities' },
  { key: 'shower', group: 'facilities' },
  { key: 'lockers', group: 'facilities' },
  { key: 'sauna', group: 'spa' },
  { key: 'steam_room', group: 'spa' },
  { key: 'hot_tub', group: 'spa' },
  { key: 'swimming_pool', group: 'spa' },
  { key: 'relaxation_area', group: 'spa' },
  { key: 'couples_treatment_room', group: 'spa' },
  { key: 'coffee_tea', group: 'experience' },
  { key: 'refreshments', group: 'experience' },
  { key: 'child_friendly', group: 'experience' },
  { key: 'pet_friendly', group: 'experience' },
  { key: 'outdoor_area', group: 'experience' },
] as const satisfies readonly { key: string; group: AmenityGroup }[];

export const AMENITY_KEYS = AMENITIES.map((a) => a.key) as [AmenityKey, ...AmenityKey[]];
export type AmenityKey = (typeof AMENITIES)[number]['key'];
export const AmenityKeySchema = z.enum(AMENITY_KEYS);

/** A location's selection: a set, so the order is always the vocabulary's. */
export const AmenityListSchema = z.array(AmenityKeySchema).max(AMENITIES.length);

/** The vocabulary's own order, for any list of keys. */
export function sortAmenities<T extends string>(keys: readonly T[]): T[] {
  const rank = new Map<string, number>(AMENITY_KEYS.map((k, i) => [k, i]));
  return [...new Set(keys)].sort((a, b) => (rank.get(a) ?? 999) - (rank.get(b) ?? 999));
}

/** Keys grouped in display order — what both editors and the salon page draw. */
export function amenitiesByGroup(keys: readonly AmenityKey[]): { group: AmenityGroup; keys: AmenityKey[] }[] {
  const set = new Set(keys);
  return AMENITY_GROUPS.map((group) => ({
    group,
    keys: AMENITIES.filter((a) => a.group === group && set.has(a.key)).map((a) => a.key),
  })).filter((g) => g.keys.length > 0);
}
