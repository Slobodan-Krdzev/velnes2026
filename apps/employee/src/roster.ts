/**
 * The device's remembered salon. The first person signs in with email
 * and password; that binds the device — the roster of the salon's staff
 * is cached here so every later shift opens straight to "tap your name",
 * and each person unlocks with their own password (login-by-id). The
 * binding survives sign-out; only "not this salon" clears it.
 */
export type RosterEntry = { id: string; name: string; role: string };
export type Roster = { tenantId: string; staff: RosterEntry[] };

const KEY = 'velnes.emp.roster';

export function getRoster(): Roster | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
}

export function setRoster(r: Roster | null) {
  try {
    if (r) localStorage.setItem(KEY, JSON.stringify(r));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode — the device just won't remember its salon */
  }
}

export const initials = (name: string) =>
  name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
