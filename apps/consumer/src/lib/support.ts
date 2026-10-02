/**
 * Where a customer or a business writes to Velnes.
 *
 * One address, read from `VITE_SUPPORT_EMAIL` at build time. The default
 * is the inbox the platform already routes salon and supplier support
 * tickets to (`services/api/src/modules/support`), so the public pages
 * name the channel that really answers — and one setting changes it.
 * There is no phone number, postal address or social profile for
 * Velnes anywhere in the platform, so none is shown.
 */
export function supportEmail(): string {
  const v = (import.meta.env?.VITE_SUPPORT_EMAIL as string | undefined)?.trim();
  return v || 'support@revelapps.com';
}

export function mailto(subject?: string): string {
  const q = subject ? `?subject=${encodeURIComponent(subject)}` : '';
  return `mailto:${supportEmail()}${q}`;
}
