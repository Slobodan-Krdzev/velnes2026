/**
 * The salon's web shop, read as a catalogue (Alex, 2026-10-02): every
 * product the site lists — title, price, image, short description — not
 * the twenty the model could carry from the home page. studiotri.mk has
 * none of its 200+ products on the home page; they sit on brand pages,
 * each paginated.
 *
 * Deterministic HTML, not model work: a listing page is any same-host
 * page that yields product tiles — a link to a product with a name, a
 * price beside it, usually an image and a one-line description. The
 * shapes of OpenCart, WooCommerce, Shopify and schema.org Product data
 * are all tiles in that sense, so one tolerant scanner reads them.
 * Pagination is followed per listing. Everything is bounded: pages
 * fetched, products kept, bytes per page — and every fetch runs through
 * the import's SSRF guards (the fetcher is injected, which is also what
 * makes this testable on fixtures).
 */

export interface ShopProduct {
  name: string;
  /** As shown, in `currency` — the caller converts. */
  price: number;
  currency: string;
  img: string | null;
  description: string | null;
  url: string | null;
}

export const SHOP_LIMITS = {
  /** Candidate pages fetched from the home page's links. */
  candidates: 40,
  /** Listing pages followed in total, pagination included. */
  pages: 80,
  /** Pagination depth per listing. */
  pagesPerListing: 15,
  /** Products kept. */
  products: 1000,
  /** A page counts as a listing from this many priced tiles. */
  minTiles: 3,
  /** Pages fetched at once. */
  concurrency: 4,
  /** Wall-clock budget for the whole walk; what is in hand is returned. */
  budgetMs: 60_000,
};

const JUNK = /(\/account|\/cart|checkout|login|register|wishlist|affiliate|newsletter|voucher|\/order|\/return|sitemap|privacy|terms|uslovi|kontakt|contact|about|za-nas|\/blog|\/news|vesti|\/image\/|\.(pdf|jpe?g|png|gif|webp|svg|css|js)(\?|$)|wp-json|wp-admin|wp-login|\/feed|\/tag\/|\/author\/|\/search|route=(account|checkout|information|product\/search|product\/compare|product\/special|product\/manufacturer)|facebook|instagram|mailto:|tel:)/i;
const NON_PHOTO = /(logo|icon|favicon|sprite|pixel|badge|avatar|placeholder|spinner|loading|blank|1x1|flag|payment|visa|master|paypal|cart)/i;

const MONEY_RE =
  /(?:(€|\$|£)\s*(\d{1,3}(?:[.,\s]\d{3})+|\d+)(?:[.,](\d{1,2}))?)|(?:(\d{1,3}(?:[.,\s]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s*(ден\.?|денари|den\.?|mkd|€|eur|\$|usd|£|gbp|лв\.?|bgn|lek|all|rsd|дин\.?|km|bam|kn|hrk|ron|lei|chf))/i;

/** "1.090 ден." → 1090 MKD; "€12,50" → 12.5 EUR; "1,850.00 MKD" → 1850. */
export function parsePrice(text: string): { amount: number; currency: string } | null {
  const m = MONEY_RE.exec(text);
  if (!m) return null;
  const sym = (m[1] ?? m[6] ?? '').toLowerCase().replace(/\.$/, '');
  const whole = (m[2] ?? m[4] ?? '').replace(/[.,\s]/g, '');
  const frac = m[3] ?? m[5];
  if (!whole) return null;
  const amount = Number(whole) + (frac ? Number(frac) / 10 ** frac.length : 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const cur: Record<string, string> = {
    '€': 'EUR', eur: 'EUR', $: 'USD', usd: 'USD', '£': 'GBP', gbp: 'GBP',
    ден: 'MKD', денари: 'MKD', den: 'MKD', mkd: 'MKD', лв: 'BGN', bgn: 'BGN', lek: 'ALL', all: 'ALL',
    rsd: 'RSD', дин: 'RSD', km: 'BAM', bam: 'BAM', kn: 'HRK', hrk: 'HRK', ron: 'RON', lei: 'RON', chf: 'CHF',
  };
  return { amount, currency: cur[sym] ?? 'MKD' };
}

/** The price being charged: a marked current/sale price first (<ins>,
 *  price-new, special, sale), else the first price in the text. */
function currentPrice(zone: string): { amount: number; currency: string } | null {
  if (!zone) return null;
  const marked =
    /<ins[^>]*>([\s\S]*?)<\/ins>/i.exec(zone)?.[1] ??
    /class=["'][^"']*(?:price-new|special-price|special|sale-price|current-price|price--sale)[^"']*["'][^>]*>([\s\S]*?)<\//i.exec(zone)?.[1] ??
    null;
  if (marked) {
    const p = parsePrice(strip(marked));
    if (p) return p;
  }
  // Old prices are struck through: drop them before reading the rest.
  const cleaned = zone.replace(/<del[\s\S]*?<\/del>|<s>[\s\S]*?<\/s>|class=["'][^"']*(?:price-old|old-price|regular-price|compare)[^"']*["'][^>]*>[\s\S]*?<\//gi, ' ');
  return parsePrice(strip(cleaned));
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
const strip = (html: string) => decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' '));

function abs(href: string, base: string): string | null {
  try {
    const u = new URL(href.trim(), base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}
const sameHost = (a: string, b: string) => {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
};
const pathOf = (u: string) => {
  try {
    return new URL(u).pathname.replace(/\/+$/, '');
  } catch {
    return u;
  }
};

/**
 * Product tiles on one page. Every same-host link with text is a
 * candidate product; around each the scanner looks for a price (after
 * the link, nearby), an image (nearby, not a logo) and a description
 * (an element whose class says so). A link that repeats (image + name)
 * is one product. Tiles with no price are not products.
 */
export function parseProductTiles(html: string, pageUrl: string): ShopProduct[] {
  const out = new Map<string, ShopProduct>();
  const pagePath = pathOf(pageUrl);
  // JSON-LD Product data first — exact when present.
  for (const p of jsonLdProducts(html, pageUrl)) if (!out.has(p.url ?? p.name)) out.set(p.url ?? p.name, p);

  const re = /<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = abs(m[1]!, pageUrl);
    if (!href || !sameHost(href, pageUrl) || JUNK.test(href)) continue;
    if (/[?&](page|sort|order|limit|filter)=/i.test(href)) continue;
    const path = pathOf(href);
    if (!path || path === pagePath || path === '') continue;
    const inner = m[2]!;
    const alt = /alt=["']([^"']{3,160})["']/i.exec(inner)?.[1];
    // The title: a heading or a titled element inside the link, else the
    // link's own text with any price taken out, else the image's alt.
    const titled =
      /<h\d[^>]*>([\s\S]*?)<\/h\d>/i.exec(inner)?.[1] ??
      /class=["'][^"']*(?:title|name)[^"']*["'][^>]*>([\s\S]*?)<\//i.exec(inner)?.[1] ??
      null;
    const name = decode(strip(titled ?? inner).replace(MONEY_RE, '').replace(/\s{2,}/g, ' ')) || (alt ? decode(alt) : '');
    if (!name || name.length < 3 || name.length > 160) continue;
    if (/^(read more|more|details|view|buy|add to cart|во кошничка|види|повеќе|shiko|bli)$/i.test(name)) continue;
    const after = html.slice(m.index + m[0].length, m.index + m[0].length + 900);
    const before = html.slice(Math.max(0, m.index - 700), m.index);
    // The price belongs to this tile only if it comes before the next
    // link and before a menu or header closes — a navigation link must
    // not borrow the first tile's price.
    const stopAt = after.search(/<a\s[^>]*href=|<\/nav>|<\/header>/i);
    const priceZone = stopAt > 0 ? after.slice(0, stopAt) : stopAt === 0 ? '' : after;
    const price = currentPrice(inner) ?? currentPrice(priceZone) ?? currentPrice(strip(before.slice(-200)));
    if (!price) continue;
    const img =
      /<img[^>]+(?:data-src|data-lazy-src)=["']([^"']+)["']/i.exec(inner)?.[1] ??
      /<img[^>]+src=["']([^"']+)["']/i.exec(inner)?.[1] ??
      [...before.matchAll(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/gi)].map((x) => x[1]!).filter((u) => !NON_PHOTO.test(u) && !u.startsWith('data:')).pop() ??
      /<img[^>]+(?:data-src|src)=["']([^"']+)["']/i.exec(after.slice(0, 500))?.[1] ??
      null;
    const descM =
      /class=["'][^"']*(?:description|excerpt|summary|short)[^"']*["'][^>]*>([\s\S]{10,800}?)<\//i.exec(priceZone) ??
      /class=["'][^"']*(?:description|excerpt|summary|short)[^"']*["'][^>]*>([\s\S]{10,800}?)<\//i.exec(after);
    const description = descM ? strip(descM[1]!).slice(0, 600) || null : null;
    const existing = out.get(href);
    const tile: ShopProduct = {
      name: existing?.name && existing.name.length > name.length ? existing.name : name,
      price: price.amount,
      currency: price.currency,
      img: (img && !NON_PHOTO.test(img) && !img.startsWith('data:') ? abs(img, pageUrl) : null) ?? existing?.img ?? null,
      description: description ?? existing?.description ?? null,
      url: href,
    };
    out.set(href, tile);
  }
  return [...out.values()];
}

function jsonLdProducts(html: string, pageUrl: string): ShopProduct[] {
  const out: ShopProduct[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    const o = n as Record<string, unknown>;
    const type = ([] as unknown[]).concat(o['@type'] ?? []).map(String);
    if (type.includes('Product') && typeof o.name === 'string') {
      const offers = ([] as unknown[]).concat(o.offers ?? [])[0] as Record<string, unknown> | undefined;
      const priceRaw = offers?.price ?? offers?.lowPrice;
      const amount = typeof priceRaw === 'number' ? priceRaw : Number(String(priceRaw ?? '').replace(/[^\d.,]/g, '').replace(',', '.'));
      if (Number.isFinite(amount) && amount > 0) {
        const image = ([] as unknown[]).concat(o.image ?? [])[0];
        out.push({
          name: decode(o.name),
          price: amount,
          currency: typeof offers?.priceCurrency === 'string' ? offers.priceCurrency : 'MKD',
          img: typeof image === 'string' ? abs(image, pageUrl) : typeof image === 'object' && image && typeof (image as { url?: unknown }).url === 'string' ? abs((image as { url: string }).url, pageUrl) : null,
          description: typeof o.description === 'string' ? decode(o.description).slice(0, 600) : null,
          url: typeof o.url === 'string' ? abs(o.url, pageUrl) : null,
        });
      }
    }
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v);
  };
  while ((m = re.exec(html))) {
    try {
      walk(JSON.parse(m[1]!));
    } catch {
      /* not JSON */
    }
  }
  return out;
}

/** Same-host pages worth trying as listings, best first: navigation
 *  links with short paths and short names (brands, categories), never
 *  product-looking slugs (long, many hyphens) or junk. */
export function collectShopLinks(html: string, finalUrl: string): string[] {
  const seen = new Set<string>([pathOf(finalUrl) || '/']);
  const scored: { url: string; score: number }[] = [];
  const re = /<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = abs(m[1]!, finalUrl);
    if (!href || !sameHost(href, finalUrl) || JUNK.test(href)) continue;
    if (/[?&](page|sort|order|limit|filter|route)=/i.test(href)) continue;
    const path = pathOf(href);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const segs = path.split('/').filter(Boolean);
    const last = segs[segs.length - 1] ?? '';
    const text = strip(m[2]!);
    const hyphens = (last.match(/-/g) ?? []).length;
    // A product slug: long and hyphen-heavy. Not a listing.
    if (last.length > 48 || hyphens > 5) continue;
    let score = 0;
    if (segs.length === 1) score += 3;
    if (segs.length === 2) score += 1;
    if (text && text.length <= 32) score += 2;
    if (/(product|shop|store|prodavnica|proizvod|produkt|katalog|catalog|brand|marka|kategori|categor|collection|kolekcij)/i.test(path)) score += 3;
    scored.push({ url: href.replace(/[?#].*$/, ''), score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.url);
}

/** Pagination of a listing: the other pages of the same path. */
export function paginationLinks(html: string, pageUrl: string): string[] {
  const base = pathOf(pageUrl);
  const found = new Map<number, string>();
  const re = /href=["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = abs(m[1]!, pageUrl);
    if (!href || !sameHost(href, pageUrl)) continue;
    const u = new URL(href);
    const q = u.searchParams.get('page');
    const seg = /\/page\/(\d+)\/?$/.exec(u.pathname);
    const n = q ? Number(q) : seg ? Number(seg[1]) : NaN;
    if (!Number.isInteger(n) || n < 2) continue;
    const path = seg ? u.pathname.replace(/\/page\/\d+\/?$/, '') : u.pathname.replace(/\/+$/, '');
    if (path !== base) continue;
    if (!found.has(n)) found.set(n, href);
  }
  return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([, u]) => u);
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Walk the shop from the home page: candidates in order, each kept as a
 * listing when it yields tiles, its pagination followed; products
 * deduped by link, then by name. `fetchHtml` is the import's guarded
 * fetcher (null on any miss); everything stays inside SHOP_LIMITS.
 */
export async function crawlShop(
  homeHtml: string,
  homeUrl: string,
  fetchHtml: (url: string) => Promise<string | null>,
  limits: typeof SHOP_LIMITS = SHOP_LIMITS,
): Promise<{ products: ShopProduct[]; listings: number; pages: number }> {
  const byKey = new Map<string, ShopProduct>();
  const add = (p: ShopProduct) => {
    const key = p.url ?? norm(p.name);
    const nameKey = `n:${norm(p.name)}`;
    if (byKey.has(key) || byKey.has(nameKey)) return;
    byKey.set(key, p);
    byKey.set(nameKey, p);
  };
  const count = () => new Set(byKey.values()).size;
  for (const p of parseProductTiles(homeHtml, homeUrl)) add(p);
  let pages = 0;
  let listings = 0;
  const deadline = Date.now() + limits.budgetMs;
  const visited = new Set<string>([homeUrl.replace(/[?#].*$/, '')]);
  const full = () => pages >= limits.pages || count() >= limits.products || Date.now() > deadline;
  // A small pool: a few pages in flight, in candidate order.
  const pool = async <T>(items: T[], fn: (item: T) => Promise<void>) => {
    let i = 0;
    const worker = async () => {
      while (i < items.length && !full()) {
        const item = items[i++]!;
        await fn(item);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limits.concurrency, items.length) }, worker));
  };
  const readPage = async (url: string): Promise<string | null> => {
    const clean = url.replace(/#.*$/, '');
    if (visited.has(clean) || full()) return null;
    visited.add(clean);
    pages++;
    return fetchHtml(clean);
  };
  await pool(collectShopLinks(homeHtml, homeUrl).slice(0, limits.candidates), async (url) => {
    const html = await readPage(url);
    if (!html) return;
    const tiles = parseProductTiles(html, url);
    if (tiles.length < limits.minTiles) return;
    listings++;
    tiles.forEach(add);
    // Its other pages, in order, within this listing's depth.
    for (const next of paginationLinks(html, url).slice(0, limits.pagesPerListing)) {
      if (full()) break;
      const more = await readPage(next);
      if (more) parseProductTiles(more, next).forEach(add);
    }
  });
  const products = [...new Set(byKey.values())].slice(0, limits.products);
  return { products, listings, pages };
}

/**
 * A category for a product from its name, when the model is not asked
 * or did not answer: the HQ taxonomy's own names are matched by family.
 */
export function guessProductCategory(name: string, categories: string[]): string {
  const n = name.toLowerCase();
  const pick = (re: RegExp) => categories.find((c) => re.test(c));
  const fam: [RegExp, RegExp][] = [
    [/(shampoo|šampon|шампон|conditioner|balzam|балзам|regenerator|hair|kos[ae]|коса|mask[ae]?|маска|keratin|olaplex|k[ée]rastase|styling|lak\b|лак за коса|wax|vosok|brush|четка|comb|чешел|dryer|фен|press|straight|curl|serum za kosa|leave.?in|scalp|dandruff|перут)/i, /hair/i],
    [/(cream|крем|krem|face|лице|lice|skin|кожа|koža|cleanser|tonic|тоник|peel|пилинг|spf|sun|сонце|serum|серум|moistur|hydrat|хидрат|anti.?age|acne|акни)/i, /skin|face/i],
    [/(nail|нокт|nokt|polish|gel lak|cuticle|manic|pedic)/i, /nail/i],
    [/(body|тело|telo|lotion|лосион|scrub|butter|deodorant|дезодоранс|shower|туш|bath|soap|сапун)/i, /body|skin/i],
    [/(oil|масло|ulje|massage|масаж|aroma|candle|свеќ)/i, /recovery|massage|spa|aroma/i],
    [/(band|roller|ball|tape|brace|support|exercise|вежб)/i, /exercise|support|recovery/i],
  ];
  for (const [re, cat] of fam) {
    if (re.test(n)) {
      const c = pick(cat);
      if (c) return c;
    }
  }
  return categories.find((c) => /other|останат|tjetër|general/i.test(c)) ?? categories[0] ?? 'Other';
}
