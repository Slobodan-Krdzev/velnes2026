import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  GALLERY_IMG_MAX_CHARS,
  GALLERY_MAX_PHOTOS,
  type REG_DAYS,
  type RegistrationImportResult,
} from '@velnes/contracts';
import { env } from '../../env.js';
import { claudeExtract, htmlToText, type ExtractOutput } from './extract.provider.js';

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

// "Look deeper": many salons show only category tiles on the page and put
// the real services (with prices) in a linked price-list PDF or a
// /services sub-page. We read a few of those and add their text.
const DEEP_MAX_PDF_BYTES = 8_000_000;
const DEEP_TIMEOUT_MS = 20_000;
const PDF_TEXT_CAP = 14_000;
const SUBPAGE_TEXT_CAP = 5_000;
const DEEP_TEXT_BUDGET = 20_000; // total extra text across all deep sources
const COMBINED_TEXT_CAP = 30_000; // page text + deep text handed to the model
const PRICE_RE =
  /(cenovnik|cjenik|cenik|pricelist|price-list|prices|ceni|menu|meni|katalog|catalog|uslugi|usluge|services|услуги|ценовник|tretmani|treatments|prei?slist|preise|tarif)/i;
const JUNK_RE =
  /(product-category|\/cart|kosnic|kariera|career|contact|kontakt|about|za-nas|\/blog|\/news|vesti|privacy|terms|uslovi|\/login|\/account|\/en\/|\/feed|wp-json|wp-admin|facebook|instagram)/i;

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

// ── Photos: read the salon's own pictures off its page ───────────────
const IMG_MAX_BYTES = 460_000; // ≈ GALLERY_IMG_MAX_CHARS of base64
// Filenames that are chrome, not salon photos.
const NON_PHOTO = /(logo|icon|favicon|sprite|pixel|badge|avatar|placeholder|spinner|loading|blank|1x1|tracking|analytics)/i;

/** Gather candidate photo URLs from the page — the social hero first,
 *  then JSON-LD images, then inline <img> — resolved to absolute URLs,
 *  de-duped, with obvious non-photos (logos, icons, pixels, SVG) dropped. */
export function collectImages(html: string, finalUrl: string, biz?: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (raw: string | undefined) => {
    if (!raw) return;
    let abs: string;
    try {
      abs = new URL(raw.trim(), finalUrl).toString();
    } catch {
      return;
    }
    if (!/^https?:\/\//i.test(abs)) return;
    if (/\.svg(\?|$)/i.test(abs) || NON_PHOTO.test(abs)) return;
    if (!out.includes(abs)) out.push(abs);
  };

  push(metaTag(html, 'og:image'));
  push(metaTag(html, 'twitter:image'));
  const img = biz?.image;
  for (const i of Array.isArray(img) ? img : img ? [img] : [])
    push(typeof i === 'string' ? i : (i as { url?: string })?.url);
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 40) push(m[1]);
  return out.slice(0, 16);
}

/** Fetch one image under the same SSRF guards and return it as a data
 *  URL, or null on any miss (bad host, non-image, too large, error).
 *  Best-effort: photos never break an import, so this never throws. */
async function safeFetchImage(input: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  try {
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
          headers: { 'user-agent': 'VelnesOnboarding/1.0 (+salon import)', accept: 'image/*' },
        });
      } finally {
        clearTimeout(timer);
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location')!, url);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        continue;
      }
      if (!res.ok) return null;
      const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (!type.startsWith('image/') || type === 'image/svg+xml') return null;
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len && len > IMG_MAX_BYTES) return null;
      const buf = await res.arrayBuffer();
      if (buf.byteLength > IMG_MAX_BYTES) return null;
      const dataUrl = `data:${type};base64,${Buffer.from(buf).toString('base64')}`;
      return dataUrl.length <= GALLERY_IMG_MAX_CHARS ? dataUrl : null;
    }
  } catch {
    return null;
  }
  return null;
}

/** Import up to GALLERY_MAX_PHOTOS salon photos from the page, as data
 *  URLs. Candidates are tried in order (hero first) and oversized or
 *  unreachable ones are skipped; an empty result is a fine, honest one. */
export async function importPhotos(
  html: string,
  finalUrl: string,
  biz?: Record<string, unknown>,
): Promise<string[]> {
  const candidates = collectImages(html, finalUrl, biz);
  const photos: string[] = [];
  for (const c of candidates) {
    if (photos.length >= GALLERY_MAX_PHOTOS) break;
    const data = await safeFetchImage(c);
    if (data) photos.push(data);
  }
  return photos;
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

/** Decode the HTML entities that survive in <title>/OpenGraph text —
 *  &amp;, &#39;, numeric and hex refs — so a name reads as written. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

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

export function parseSalon(html: string, finalUrl: string): RegistrationImportResult {
  const found: string[] = [];
  const result: RegistrationImportResult = {
    source: finalUrl,
    found,
    salon: {},
    legal: {},
    loc: {},
    serviceNames: [],
    services: [],
    products: [],
    hours: [],
    gallery: [],
    provider: 'rules',
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
    result.salon.name = decodeEntities(name).slice(0, 80);
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
    if (street) result.loc.street = decodeEntities(street).slice(0, 120);
    if (city) result.loc.city = decodeEntities(city).slice(0, 80);
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
    if (typeof item === 'string') names.add(decodeEntities(item.trim()));
  };
  const offers = biz?.makesOffer;
  (Array.isArray(offers) ? offers : offers ? [offers] : []).forEach(grabOffer);
  const catalog = biz?.hasOfferCatalog as { itemListElement?: unknown[] } | undefined;
  if (catalog?.itemListElement) catalog.itemListElement.forEach(grabOffer);
  if (names.size) {
    result.serviceNames = [...names].slice(0, 20);
    found.push('services');
  }

  if (!found.length)
    throw new ImportError(
      'NOTHING_FOUND',
      'We could not read structured details from that page — fill the steps in yourself.',
    );
  return result;
}

/** Merge the deterministic baseline with the AI extraction into one
 *  result. Structured data (the parser) is authoritative for the fields
 *  it covers; the AI fills the gaps and supplies the full services and
 *  products — which JSON-LD almost never carries with prices/durations. */
function merge(
  source: string,
  base: RegistrationImportResult | null,
  ai: ExtractOutput | null,
): RegistrationImportResult {
  const salon = { ...(ai?.salon ?? {}), ...(base?.salon ?? {}) };
  const legal = { ...(ai?.legal ?? {}), ...(base?.legal ?? {}) };
  const loc = { ...(ai?.loc ?? {}), ...(base?.loc ?? {}) };
  const hours = base?.hours.length ? base.hours : (ai?.hours ?? []);
  const serviceNames = base?.serviceNames ?? [];
  const services = ai?.services ?? [];
  const products = ai?.products ?? [];

  const found: string[] = [];
  if (salon.name) found.push('name');
  if (salon.phone) found.push('phone');
  if (loc.street || loc.city) found.push('address');
  if (legal.name) found.push('legal name');
  if (hours.length) found.push('opening hours');
  if (services.length || serviceNames.length) found.push('services');
  if (products.length) found.push('products');

  return {
    source,
    found,
    salon,
    legal,
    loc,
    serviceNames,
    services,
    products,
    hours,
    gallery: [],
    provider: ai ? 'claude' : 'rules',
  };
}

export interface ImportOptions {
  serviceCategories?: string[];
  productCategories?: string[];
}

/** Fetch raw bytes under the SSRF guards, size-capped. Best-effort:
 *  returns null on any miss and never throws (deep reads never block). */
async function safeFetchBytes(
  input: string,
  maxBytes: number,
  accept: string,
): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicHost(url.hostname);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), DEEP_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'GET',
          redirect: 'manual',
          signal: ctrl.signal,
          headers: { 'user-agent': 'VelnesOnboarding/1.0 (+salon import)', accept },
        });
      } finally {
        clearTimeout(timer);
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location')!, url);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        continue;
      }
      if (!res.ok) return null;
      const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len && len > maxBytes) return null;
      const bytes = await res.arrayBuffer();
      if (bytes.byteLength > maxBytes) return null;
      return { bytes, type };
    }
  } catch {
    return null;
  }
  return null;
}

/** Read a price-list PDF into text (unpdf/pdf.js, lazily loaded). */
async function fetchPdfText(url: string): Promise<string> {
  const got = await safeFetchBytes(url, DEEP_MAX_PDF_BYTES, 'application/pdf');
  if (!got) return '';
  if (!got.type.includes('pdf') && !/\.pdf(\?|$)/i.test(url)) return '';
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(got.bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    const merged = Array.isArray(text) ? text.join('\n') : text;
    // Keep the line breaks — a price list pairs each service with its
    // price per line, so collapsing to one line loses that association.
    return merged
      .replace(/[^\S\n]+/g, ' ') // collapse spaces/tabs, keep newlines
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, PDF_TEXT_CAP);
  } catch {
    return '';
  }
}

/** Read a same-host sub-page (e.g. /services) into visible text. */
async function fetchSubpageText(url: string): Promise<string> {
  const got = await safeFetchBytes(url, MAX_BYTES, 'text/html');
  if (!got || !(got.type.includes('html') || got.type.includes('text'))) return '';
  const html = new TextDecoder('utf-8').decode(got.bytes.slice(0, MAX_BYTES));
  return htmlToText(html).slice(0, SUBPAGE_TEXT_CAP);
}

/** Same-host links worth reading deeper: price-list PDFs first (named
 *  ones prioritised), then a few service/price sub-pages. Junk (cart,
 *  blog, contact, product categories, social) is dropped. */
export function collectDeepLinks(html: string, finalUrl: string): { url: string; kind: 'pdf' | 'html' }[] {
  let host: string;
  try {
    host = new URL(finalUrl).host;
  } catch {
    return [];
  }
  const pdfs: string[] = [];
  const pages: string[] = [];
  const seen = new Set<string>([finalUrl.replace(/[?#].*$/, '')]);
  const re = /<a[^>]+href=["']([^"'#]+)["'][^>]*>([^<]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && pdfs.length + pages.length < 60) {
    let abs: URL;
    try {
      abs = new URL(m[1]!.trim(), finalUrl);
    } catch {
      continue;
    }
    if (abs.host !== host || (abs.protocol !== 'http:' && abs.protocol !== 'https:')) continue;
    const clean = abs.origin + abs.pathname;
    if (seen.has(clean)) continue;
    const hay = `${abs.pathname} ${m[2] ?? ''}`;
    if (/\.pdf(\?|$)/i.test(abs.pathname)) {
      seen.add(clean);
      if (PRICE_RE.test(hay)) pdfs.unshift(clean);
      else pdfs.push(clean);
    } else if (PRICE_RE.test(hay) && !JUNK_RE.test(hay)) {
      seen.add(clean);
      pages.push(clean);
    }
  }
  return [
    ...pdfs.slice(0, 2).map((url) => ({ url, kind: 'pdf' as const })),
    ...pages.slice(0, 3).map((url) => ({ url, kind: 'html' as const })),
  ];
}

/** Pull services out of the page's structured data — schema.org JSON-LD
 *  Service entries (name + category) and Next.js/embedded JSON (name +
 *  price + currency + duration) — into a compact list. Booking apps like
 *  Fresha render only the first category as text but carry the whole
 *  catalogue here; without it the model sees a single service. */
export function extractStructuredServices(html: string): string {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const cats = new Map<string, string>();
  const svc = new Map<string, { name: string; price?: number; currency?: string; durationMin?: number }>();
  const scripts: unknown[] = [];
  const re = /<script[^>]*type=["'](?:application\/ld\+json|application\/json)["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && scripts.length < 40) {
    try {
      scripts.push(JSON.parse(m[1]!.trim()));
    } catch {
      /* not JSON — skip */
    }
  }
  const walk = (o: unknown, depth: number) => {
    if (!o || typeof o !== 'object' || depth > 40) return;
    if (Array.isArray(o)) {
      for (const x of o) walk(x, depth + 1);
      return;
    }
    const rec = o as Record<string, unknown>;
    const name = typeof rec.name === 'string' ? norm(rec.name) : '';
    const t = rec['@type'];
    if (name && (t === 'Service' || (Array.isArray(t) && t.includes('Service'))) && typeof rec.category === 'string') {
      cats.set(name.toLowerCase(), norm(rec.category));
    }
    if (name && !svc.has(name.toLowerCase())) {
      // Price may be a plain number or an object {value, currency}, under
      // any of the common field names booking apps use.
      const p = rec.price ?? rec.retailPrice ?? rec.nonDiscountedPrice ?? rec.finalPrice ?? rec.priceMin;
      let price: number | undefined;
      let currency: string | undefined;
      if (p && typeof p === 'object') {
        const po = p as Record<string, unknown>;
        const v = po.value ?? po.amount;
        if (typeof v === 'number') price = v;
        if (typeof po.currency === 'string') currency = po.currency;
      } else if (typeof p === 'number') {
        price = p;
      }
      if (currency == null && typeof rec.currency === 'string') currency = rec.currency;
      if (price != null && Number.isFinite(price)) {
        const secs =
          typeof rec.minInSeconds === 'number'
            ? rec.minInSeconds
            : typeof rec.maxInSeconds === 'number'
              ? rec.maxInSeconds
              : undefined;
        svc.set(name.toLowerCase(), {
          name,
          price: Math.round(price),
          ...(currency ? { currency } : {}),
          ...(secs && secs > 0 ? { durationMin: Math.round(secs / 60) } : {}),
        });
      }
    }
    for (const k in rec) walk(rec[k], depth + 1);
  };
  for (const j of scripts) walk(j, 0);
  const lines: string[] = [];
  for (const s of svc.values()) {
    const c = cats.get(s.name.toLowerCase());
    lines.push(
      `${s.name} — ${s.price}${s.currency ? ` ${s.currency}` : ''}${s.durationMin ? ` — ${s.durationMin} min` : ''}${c ? ` [${c}]` : ''}`,
    );
    if (lines.length >= 90) break;
  }
  return lines.length ? `--- Services (structured data) ---\n${lines.join('\n')}\n\n` : '';
}

/** Homepage text plus structured-data services and the text of any
 *  price-list PDF / service sub-pages, so the model sees the whole
 *  catalogue — not just the category tiles or the first tab. */
async function deepPageText(html: string, finalUrl: string): Promise<string> {
  let combined = extractStructuredServices(html) + htmlToText(html);
  const parts: string[] = [];
  let used = 0;
  for (const d of collectDeepLinks(html, finalUrl)) {
    if (used > DEEP_TEXT_BUDGET) break;
    const txt = d.kind === 'pdf' ? await fetchPdfText(d.url) : await fetchSubpageText(d.url);
    if (!txt) continue;
    used += txt.length;
    parts.push(`\n\n--- ${d.kind === 'pdf' ? 'Price list' : 'Page'}: ${d.url} ---\n${txt}`);
  }
  if (parts.length) combined = `${combined}${parts.join('')}`.slice(0, COMBINED_TEXT_CAP);
  return combined;
}

export async function importSalon(
  url: string,
  opts: ImportOptions = {},
): Promise<RegistrationImportResult> {
  const { html, finalUrl } = await safeFetchHtml(url);

  // The deterministic baseline. "Nothing found" is tolerated here so the
  // AI extractor can still read a page that carries no structured data
  // (the common case) — only a genuinely different failure re-throws.
  let base: RegistrationImportResult | null = null;
  try {
    base = parseSalon(html, finalUrl);
  } catch (e) {
    if (!(e instanceof ImportError && e.code === 'NOTHING_FOUND')) throw e;
  }

  let ai: ExtractOutput | null = null;
  if (env.onboardingProvider === 'claude') {
    ai = await claudeExtract({
      url: finalUrl,
      pageText: await deepPageText(html, finalUrl),
      serviceCategories: opts.serviceCategories ?? [],
      productCategories: opts.productCategories ?? [],
      hints: {
        ...(base?.salon.name ? { name: base.salon.name } : {}),
        ...(base?.loc.city ? { city: base.loc.city } : {}),
        ...(base?.salon.phone ? { phone: base.salon.phone } : {}),
      },
    });
  }

  if (!base && !ai)
    throw new ImportError(
      'NOTHING_FOUND',
      'We could not read details from that page — fill the steps in yourself.',
    );

  const result = merge(finalUrl, base, ai);

  // The salon's own photos — best-effort, never blocking. The hero
  // (og:image) leads, then JSON-LD/inline images; each fetched under the
  // same SSRF guards and size-gated to the gallery's cap.
  const nodes = collectJsonLd(html);
  const biz = nodes.find((n) => typeOf(n).some((t) => BUSINESS_TYPES.has(t))) as
    | Record<string, unknown>
    | undefined;
  result.gallery = await importPhotos(html, finalUrl, biz);
  if (result.gallery.length) result.found.push('photos');

  return result;
}
