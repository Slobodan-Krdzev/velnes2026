import type { AccessClaims, PermKey, PermMap } from '@velnes/contracts';
import { scopeOf } from '../auth/authz.service.js';

/**
 * Where a right reaches (phase 2, 2026-10-06). The role says the scope;
 * the employee's own locations say which ones. `business` sees every
 * location of the tenant; `location`/`locations` see the employee's;
 * `none` sees nothing. RLS already cut the tenant — this cuts inside it.
 */
export type Reach = { all: true } | { all: false; locationIds: string[] };

export function reachOf(perms: PermMap, key: PermKey, claims: AccessClaims): Reach | null {
  const s = scopeOf(perms, key);
  if (s === 'none') return null;
  if (s === 'business' || s === 'platform') return { all: true };
  return { all: false, locationIds: claims.locs };
}

export const reaches = (r: Reach, locationId: string) => r.all || r.locationIds.includes(locationId);
