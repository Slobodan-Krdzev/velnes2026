/** The source dictionary. Every other language must cover exactly
 *  these keys — the compiler enforces it. */
export const en = {
  // Brand & shell
  'app.workspace': 'Velnes Workspace',
  'nav.flightdeck': 'Flightdeck',
  'nav.calendar': 'Calendar',
  'nav.till': 'Cash register',
  'nav.catalog': 'Catalog',
  'nav.customers': 'Customers',
  'nav.reports': 'Reports',
  'nav.settings': 'Settings',
  'shell.allLocations': 'All locations',
  'shell.signOut': 'Sign out',
  'shell.language': 'Language',
  'shell.loading': 'Loading…',

  // Login
  'login.title': 'Sign in to Velnes',
  'login.subtitle': 'The workspace for your salon',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.submit': 'Sign in',
  'login.working': 'Signing in…',
  'login.invalid': 'That email and password do not match',
  'login.notActive': 'This account has not accepted its invite yet',
  'login.error': 'Something went wrong — try again',

  // Common
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.search': 'Search',
  'common.today': 'Today',
  'common.retry': 'Try again',
  'common.notFound': 'Not found',
  'common.forbidden': 'Your role does not allow this',

  // Languages (each in its own tongue, for the switcher)
  'lang.en': 'English',
  'lang.mk': 'Македонски',
  'lang.sq': 'Shqip',
} as const;

export type TranslationKey = keyof typeof en;
