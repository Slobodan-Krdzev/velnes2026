import type { AmenityKey } from '@velnes/contracts';

/**
 * One icon per amenity — different shapes, one colour (Alex,
 * 2026-09-29). Path data on the 24-box the shared `Icon` draws with
 * `currentColor`, so every app paints them in its brand token; the
 * consumer app draws the same paths in its own stroke weight. No
 * emoji, no fills, no second colour.
 */
export const AMENITY_ICONS: Record<AmenityKey, string> = {
  wifi: '<path d="M2.5 9a15 15 0 0 1 19 0"/><path d="M5.5 12.5a10.5 10.5 0 0 1 13 0"/><path d="M8.6 16a6 6 0 0 1 6.8 0"/><circle cx="12" cy="19.2" r="1" fill="currentColor" stroke="none"/>',
  free_parking: '<rect x="4" y="3.5" width="16" height="17" rx="3"/><path d="M9.5 16.5v-9h3.4a2.6 2.6 0 0 1 0 5.2H9.5"/>',
  paid_parking_nearby: '<rect x="3" y="4" width="13" height="16" rx="2.5"/><path d="M7.5 15.5V8h2.9a2.2 2.2 0 0 1 0 4.4H7.5"/><path d="M19 8.5v7M17.3 10.3h2.4a1.2 1.2 0 0 1 0 2.4h-1.4a1.2 1.2 0 0 0 0 2.4h2.4"/>',
  wheelchair_accessible: '<circle cx="12" cy="4.5" r="1.6"/><path d="M10 8h4l1 5h4.5"/><path d="M13 13.5a5 5 0 1 1-6.3-4.8"/><path d="M10 8v5.5"/>',
  accessible_restroom: '<circle cx="8" cy="5" r="1.6"/><path d="M6.5 8.5h3l.8 4h3.2"/><path d="M8.8 12.5a3.6 3.6 0 1 1-4.5-3.4"/><path d="M17 4.5v15M14.5 8.5h5M15.2 19.5l1.8-5 1.8 5"/>',
  restroom: '<circle cx="7" cy="5" r="1.6"/><path d="M4.5 9.5h5v5H8v5.5H6v-5.5H4.5z"/><circle cx="17" cy="5" r="1.6"/><path d="M14 15l1.5-5.5h3L20 15h-1.8v5h-2.4v-5z"/>',
  air_conditioning: '<path d="M12 2.5v19M4 7l16 10M20 7 4 17"/><path d="M12 2.5 9.5 5M12 2.5 14.5 5M12 21.5 9.5 19M12 21.5l2.5-2.5M4 7l3.4-.6M4 7l.6 3.4M20 17l-3.4.6M20 17l-.6-3.4M20 7l-3.4-.6M20 7l-.6 3.4M4 17l3.4.6M4 17l.6-3.4"/>',
  waiting_area: '<path d="M5 11V7.5a2.5 2.5 0 0 1 2.5-2.5h9A2.5 2.5 0 0 1 19 7.5V11"/><path d="M3.5 11.5A1.5 1.5 0 0 1 5 13v3h14v-3a1.5 1.5 0 0 1 3 0v5.5H2V13a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M5 18.5v2M19 18.5v2"/>',
  private_treatment_rooms: '<path d="M5 21V4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5V21"/><path d="M3 21h18"/><circle cx="15" cy="12.5" r="1" fill="currentColor" stroke="none"/><path d="M8.5 7.5h3M8.5 10.5h2"/>',
  changing_room: '<path d="M12 4.5a1.7 1.7 0 1 1 1.7 1.7c-1 0-1.7.8-1.7 1.7v1"/><path d="M12 9 3.5 15.2a1.2 1.2 0 0 0 .7 2.2h15.6a1.2 1.2 0 0 0 .7-2.2z"/>',
  shower: '<path d="M4 21V6.5A3.5 3.5 0 0 1 7.5 3h.5a3.5 3.5 0 0 1 3.5 3.5V8"/><path d="M8 8h9a1 1 0 0 1 1 1v1H7V9a1 1 0 0 1 1-1z"/><path d="M10 13v1.5M12.5 13v2.5M15 13v1.5M10 17.5v1M12.5 18v1.5M15 17.5v1"/>',
  lockers: '<rect x="3.5" y="3" width="8" height="18" rx="1.5"/><rect x="12.5" y="3" width="8" height="18" rx="1.5"/><path d="M6 7.5h3M6 10h3M15 7.5h3M15 10h3"/><circle cx="9.5" cy="14.5" r=".8" fill="currentColor" stroke="none"/><circle cx="18.5" cy="14.5" r=".8" fill="currentColor" stroke="none"/>',
  sauna: '<path d="M4 20h16"/><path d="M6 20v-6a6 6 0 0 1 12 0v6"/><path d="M8.5 6.5c0-1.5 1-1.5 1-3M12 6.5c0-1.5 1-1.5 1-3M15.5 6.5c0-1.5 1-1.5 1-3"/><path d="M9 14h6"/>',
  steam_room: '<path d="M7 20c-1.5 0-2.5-1.2-2.5-2.5S5.5 15 7 15c.2-2 1.7-3.5 3.5-3.5 1.4 0 2.6.8 3.2 2 .3-.1.6-.1.8-.1 2 0 3.5 1.5 3.5 3.3S16.5 20 14.5 20z"/><path d="M8.5 8c0-1.5 1-1.5 1-3M12 8c0-1.5 1-1.5 1-3M15.5 8c0-1.5 1-1.5 1-3"/>',
  hot_tub: '<path d="M3 13h18v3a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5z"/><path d="M7 13V7.5a2.5 2.5 0 0 1 5 0"/><circle cx="14" cy="9" r="1"/><circle cx="17.5" cy="6.5" r="1"/><circle cx="16.5" cy="10.5" r=".8"/>',
  swimming_pool: '<path d="M3 15c2 0 2 1.5 4 1.5s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/><path d="M3 19c2 0 2 1.5 4 1.5s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/><path d="M8 13V5.5A2 2 0 0 1 12 5v.5M16 13V5.5A2 2 0 0 0 12 5"/><path d="M8 9h8"/>',
  relaxation_area: '<path d="M3 12h3a2 2 0 0 1 2 2v3H3z"/><path d="M8 17h13v-5.5A2.5 2.5 0 0 0 18.5 9H11"/><path d="M8 12V9a2 2 0 0 1 2-2h4"/><path d="M5 17v2.5M19 17v2.5"/>',
  couples_treatment_room: '<path d="M4 21V5a1.5 1.5 0 0 1 1.5-1.5h13A1.5 1.5 0 0 1 20 5v16"/><path d="M2.5 21h19"/><path d="M7.5 15.5a2 2 0 0 1 4 0v2h-4zM12.5 15.5a2 2 0 0 1 4 0v2h-4z"/><path d="M9.5 10.5a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4zM14.5 10.5a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z"/>',
  coffee_tea: '<path d="M4 9h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 6c0-1.2.8-1.2.8-2.4M11.5 6c0-1.2.8-1.2.8-2.4"/>',
  refreshments: '<path d="M8 3.5h8l-1 4H9z"/><path d="M9 7.5 8 20.5h8l-1-13"/><path d="M9.5 12h5"/>',
  child_friendly: '<circle cx="8" cy="6" r="2.5"/><path d="M4 21v-6.5A3.5 3.5 0 0 1 7.5 11h1A3.5 3.5 0 0 1 12 14.5V21"/><circle cx="17" cy="9.5" r="1.8"/><path d="M14 21v-4.5a2.5 2.5 0 0 1 2.5-2.5h1a2.5 2.5 0 0 1 2.5 2.5V21"/>',
  pet_friendly: '<circle cx="7" cy="8" r="1.8"/><circle cx="17" cy="8" r="1.8"/><circle cx="10" cy="4.8" r="1.6"/><circle cx="14" cy="4.8" r="1.6"/><path d="M12 10.5c-2.6 0-4.8 2.2-4.8 4.6 0 1.6 1 2.6 2.4 2.6.9 0 1.5-.4 2.4-.4s1.5.4 2.4.4c1.4 0 2.4-1 2.4-2.6 0-2.4-2.2-4.6-4.8-4.6z"/>',
  outdoor_area: '<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z"/><path d="M5 19c3-4 6-7 10-9"/>',
};
