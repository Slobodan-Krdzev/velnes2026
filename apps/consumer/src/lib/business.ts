/**
 * Where "Velnes for Business" goes: the workspace app's onboarding —
 * the AI import that starts a salon's registration.
 *
 * Found the way every Velnes app finds a sibling (`@velnes/ui`'s
 * `siblingAppUrl`, mirrored here so the consumer app pulls in no UI
 * package for one string): in production each app is a subdomain of
 * one domain, so `marketplace.example.com` names
 * `workspace.example.com` by swapping the first label; an explicit
 * `VITE_WORKSPACE_APP_URL` wins when given; a dev server on
 * `localhost` falls back to the workspace's Vite port.
 */
export function businessOnboardingUrl(): string {
  const explicit = (import.meta.env?.VITE_WORKSPACE_APP_URL as string | undefined)?.replace(/\/+$/, '');
  if (explicit) return `${explicit}/onboarding`;
  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    const labels = hostname.split('.');
    if (labels.length >= 3) return `${protocol}//workspace.${labels.slice(1).join('.')}/onboarding`;
  }
  return 'http://localhost:5173/onboarding';
}

/** The workspace itself — where a listed business signs in. The same
 *  resolution as the onboarding door, without the path. */
export function workspaceUrl(): string {
  return businessOnboardingUrl().replace(/\/onboarding$/, '');
}
