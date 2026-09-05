import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { REG_SERVICE_TEMPLATES, type REG_DAYS, type RegistrationImportResult } from '@velnes/contracts';

/**
 * Phase 1 of AI-onboarding: import a salon from its OWN website. The
 * owner pastes one link; the server fetches it under strict SSRF guards
 * and reads whatever structured data the page carries — JSON-LD,
 * OpenGraph, microdata — into a partial draft the wizard pre-fills.
 *
 * No scraping of Instagram/Fresha/Treatwell (login-walled, anti-bot,
 * ToS) and no model call: this is the deterministic, honest slice. The
 * result is always a draft the owner reviews — never auto-submitted.
 */

export class ImportError extends Error {
  constructor(
    public code: 'BAD_URL' | 'BLOCKED' | 'FETCH_FAILED' | 'NOTHING_FOUND',
    message: string,
  ) {
    super(message);
  }
}

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

/** Reject anything that could reach inside our own network (SSRF). */
function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
    const [a, b] = p as [number, number, number, number];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  // IPv6 — block loopback, link-local, unique-local, and mapped v4.
  const low = ip.toLowerCase();
  if (low === '::1' || low === '::') return true;
  if (low.startsWith('fe80') || low.startsWith('fc') || low.startsWith('fd')) return true;
  if (low.startsWith('::ffff:')) return isPrivateIp(low.slice(7));
  return false;
}

async function assertPublicHost(hostname: string) {
  // A literal IP is checked directly; a name is resolved and every
  // address it maps to must be public.
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new ImportError('BLOCKED', 'That address is not reachable');
    return;
  }
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal'))
    throw new ImportError('BLOCKED', 'That address is not reachable');
  let addrs: { address: string }[];
  try {
    addrs = await lookup(hostname, { all: true });
  } catch {
    throw new ImportError('FETCH_FAILED', 'Could not reach that address');
  }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address)))
    throw new ImportError('BLOCKED', 'That address is not reachable');
}

/** Fetch HTML behind SSRF guards, following redirects hop by hop and
 *  re-checking each host, with a timeout and a size cap. */
async function safeFetchHtml(input: string): Promise<{ html: string; finalUrl: string }> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ImportError('BAD_URL', 'That does not look like a web address');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new ImportError('BAD_URL', 'Only http and https links can be read');
  if (url.username || url.password) throw new ImportError('BAD_URL', 'Remove the credentials from the link');

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url.hostname);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'user-agent': 'VelnesOnboarding/1.0 (+salon import)', accept: 'text/html' },
      });
    } catch {
      throw new ImportError('FETCH_FAILED', 'Could not read that page');
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      if (hop === MAX_REDIRECTS) throw new ImportError('FETCH_FAILED', 'That page redirects too many times');
      url = new URL(res.headers.get('location')!, url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:')
        throw new ImportError('BLOCKED', 'That page redirects somewhere unreadable');
      continue;
    }
    if (!res.ok) throw new ImportError('FETCH_FAILED', 'That page could not be read');
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('html') && !type.includes('text'))
      throw new ImportError('NOTHING_FOUND', 'That link is not a web page');
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len && len > MAX_BYTES) throw new ImportError('FETCH_FAILED', 'That page is too large to read');
    const buf = await res.arrayBuffer();
    const html = new TextDecoder('utf-8').decode(buf.slice(0, MAX_BYTES));
    return { html, finalUrl: url.toString() };
  }
  throw new ImportError('FETCH_FAILED', 'That page could not be read');
}

// ── Structured-data extraction ──────────────────────────────────────

const BUSINESS_TYPES = new Set([
  'localbusiness', 'healthandbeautybusiness', 'daysspa', 'beautysalon', 'hairsalon',
  'medicalbusiness', 'physiotherapy', 'healthclub', 'nailsalon', 'spa', 'organization',
]);
const DAY_MAP: Record<string, (typeof REG_DAYS)[number]> = {
  monday: 'mon', tuesday: 'tue', wednesday: 'wed', thursday: 'thu',
  friday: 'fri', saturday: 'sat', sunday: 'sun',
};

function collectJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1]!.trim());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const it of items) {
        const node = it as { '@graph'?: unknown[] };
        if (Array.isArray(node['@graph'])) out.push(...node['@graph']);
        else out.push(it);
      }
    } catch {
      /* one malformed block never sinks the rest */
    }
  }
  return out;
}

const typeOf = (n: unknown): string[] => {
  const t = (n as { '@type'?: unknown })?.['@type'];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string').map((x) => x.toLowerCase());
};

function metaTag(html: string, key: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["']`,
    'i',
  );
  const m = re.exec(html) ?? new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${key}["']`,
    'i',
  ).exec(html);
  return m?.[1]?.trim();
}

function matchServiceKeys(names: string[]): string[] {
  const keys = new Set<string>();
  for (const raw of names) {
    const n = raw.toLowerCase();
    for (const tpl of REG_SERVICE_TEMPLATES) {
      const words = tpl.name.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 3);
      if (words.some((w) => n.includes(w))) keys.add(tpl.key);
    }
  }
  return [...keys];
}

export function parseSalon(html: string, finalUrl: string): RegistrationImportResult {
  const found: string[] = [];
  const result: RegistrationImportResult = {
    source: finalUrl,
    found,
    salon: {},
    legal: {},
    loc: {},
    serviceKeys: [],
    serviceNames: [],
    hours: [],
  };

  const nodes = collectJsonLd(html);
  const biz = nodes.find((n) => typeOf(n).some((t) => BUSINESS_TYPES.has(t))) as
    | Record<string, unknown>
    | undefined;

  // Name — JSON-LD, then OpenGraph, then <title>.
  const ogName = metaTag(html, 'og:site_name') ?? metaTag(html, 'og:title');
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  const name = (biz?.name as string) || ogName || title;
  if (name) {
    result.salon.name = name.slice(0, 80);
    found.push('name');
  }

  const phone = (biz?.telephone as string) ?? undefined;
  if (phone) {
    result.salon.phone = String(phone).slice(0, 40);
    found.push('phone');
  }

  // Address — schema.org PostalAddress.
  const addr = biz?.address as Record<string, unknown> | undefined;
  if (addr && typeof addr === 'object') {
    const street = addr.streetAddress as string | undefined;
    const city = addr.addressLocality as string | undefined;
    const zip = addr.postalCode as string | undefined;
    if (street) result.loc.street = street.slice(0, 120);
    if (city) result.loc.city = city.slice(0, 80);
    if (zip) result.loc.zip = String(zip).slice(0, 20);
    if (street || city) found.push('address');
  }

  // A legal/organization name, if the page names one distinctly.
  const legalName = (biz?.legalName as string) ?? undefined;
  if (legalName) {
    result.legal.name = legalName.slice(0, 120);
    found.push('legal name');
  }

  // Opening hours — openingHoursSpecification.
  const spec = biz?.openingHoursSpecification;
  const specs = Array.isArray(spec) ? spec : spec ? [spec] : [];
  for (const s of specs as Record<string, unknown>[]) {
    const days = Array.isArray(s.dayOfWeek) ? s.dayOfWeek : s.dayOfWeek ? [s.dayOfWeek] : [];
    for (const d of days as string[]) {
      const key = DAY_MAP[String(d).toLowerCase().replace(/.*\//, '')];
      if (!key) continue;
      const opens = (s.opens as string) ?? '';
      const closes = (s.closes as string) ?? '';
      result.hours = result.hours.filter((h) => h.day !== key);
      result.hours.push({
        day: key,
        open: opens.slice(0, 5) || '09:00',
        close: closes.slice(0, 5) || '17:00',
        closed: !opens && !closes,
      });
    }
  }
  if (result.hours.length) found.push('opening hours');

  // Services — makesOffer / hasOfferCatalog itemListElement.
  const names = new Set<string>();
  const grabOffer = (o: unknown) => {
    const item = (o as { itemOffered?: { name?: string }; name?: string })?.itemOffered?.name
      ?? (o as { name?: string })?.name;
    if (typeof item === 'string') names.add(item.trim());
  };
  const offers = biz?.makesOffer;
  (Array.isArray(offers) ? offers : offers ? [offers] : []).forEach(grabOffer);
  const catalog = biz?.hasOfferCatalog as { itemListElement?: unknown[] } | undefined;
  if (catalog?.itemListElement) catalog.itemListElement.forEach(grabOffer);
  if (names.size) {
    result.serviceNames = [...names].slice(0, 20);
    result.serviceKeys = matchServiceKeys(result.serviceNames);
    found.push('services');
  }

  if (!found.length)
    throw new ImportError(
      'NOTHING_FOUND',
      'We could not read structured details from that page — fill the steps in yourself.',
    );
  return result;
}

export async function importSalon(url: string): Promise<RegistrationImportResult> {
  const { html, finalUrl } = await safeFetchHtml(url);
  return parseSalon(html, finalUrl);
}
