/**
 * Where a sibling Velnes app lives, from this app's own hostname.
 *
 * In production every app sits on its own subdomain of one domain
 * (`workspace.example.com`, `employee.example.com`, `hq.example.com` …),
 * so the workspace can name the employee app by swapping the first
 * label — no build-time variable to keep in sync on the host. An
 * explicit URL (a `VITE_*` variable) still wins when given; a dev
 * server on `localhost` falls back to the sibling's Vite port.
 */
export function siblingAppUrl(explicit: string | undefined, sibling: string, devPort: number): string {
  if (explicit) return explicit.replace(/\/+$/, '');
  if (typeof window === 'undefined') return `http://localhost:${devPort}`;
  const { protocol, hostname } = window.location;
  const labels = hostname.split('.');
  if (labels.length >= 3) return `${protocol}//${sibling}.${labels.slice(1).join('.')}`;
  return `http://localhost:${devPort}`;
}
