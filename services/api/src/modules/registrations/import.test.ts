import { API_PREFIX } from '@velnes/contracts';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../../db/index.js';
import { buildServer } from '../../server.js';
import {
  collectDeepLinks,
  collectImages,
  extractStructuredServices,
  importPhotos,
  ImportError,
  importSalon,
  parseSalon,
} from './import.service.js';

const app = await buildServer();

const SAMPLE = `<!doctype html><html><head><title>Skopje Physio Center</title>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"HealthAndBeautyBusiness",
 "name":"Skopje Physio Center","telephone":"+389 2 123 456",
 "legalName":"Skopje Physio DOOEL",
 "address":{"@type":"PostalAddress","streetAddress":"Bul. Partizanski 12","addressLocality":"Skopje","postalCode":"1000"},
 "openingHoursSpecification":[
   {"@type":"OpeningHoursSpecification","dayOfWeek":["Monday","Tuesday"],"opens":"09:00","closes":"19:00"},
   {"@type":"OpeningHoursSpecification","dayOfWeek":"https://schema.org/Sunday","opens":"","closes":""}],
 "makesOffer":[
   {"@type":"Offer","itemOffered":{"@type":"Service","name":"Physiotherapy session"}},
   {"@type":"Offer","itemOffered":{"name":"Sports massage 45 min"}}]}
</script></head><body></body></html>`;

describe('website import — structured-data parser and SSRF guards', () => {
  it('reads name, phone, address, legal name, hours and services from JSON-LD', () => {
    const r = parseSalon(SAMPLE, 'https://skopjephysio.mk/');
    expect(r.salon.name).toBe('Skopje Physio Center');
    expect(r.salon.phone).toContain('389');
    expect(r.legal.name).toBe('Skopje Physio DOOEL');
    expect(r.loc.street).toBe('Bul. Partizanski 12');
    expect(r.loc.city).toBe('Skopje');
    expect(r.loc.zip).toBe('1000');
    // Monday/Tuesday open, Sunday closed.
    expect(r.hours.find((h) => h.day === 'mon')?.open).toBe('09:00');
    expect(r.hours.find((h) => h.day === 'sun')?.closed).toBe(true);
    // Both service names captured as hints (the salon writes its own).
    expect(r.serviceNames).toContain('Physiotherapy session');
    expect(r.serviceNames.some((n) => n.startsWith('Sports massage'))).toBe(true);
    expect(r.found).toContain('opening hours');
    // The deterministic parser tags itself and leaves the AI-only fields
    // empty — the honest default when no model ran.
    expect(r.provider).toBe('rules');
    expect(r.services).toEqual([]);
    expect(r.products).toEqual([]);
  });

  it('falls back to <title>/OpenGraph when there is no JSON-LD', () => {
    const r = parseSalon(
      `<html><head><meta property="og:site_name" content="Ohrid Wellness"><title>Ignore</title></head></html>`,
      'https://ohrid.mk/',
    );
    expect(r.salon.name).toBe('Ohrid Wellness');
    expect(r.found).toEqual(['name']);
  });

  it('decodes HTML entities in a name read from the title', () => {
    const r = parseSalon(`<html><head><title>Hand &amp; Stone &#8212; Spa</title></head></html>`, 'https://x.mk/');
    expect(r.salon.name).toBe('Hand & Stone — Spa');
  });

  it('throws NOTHING_FOUND on a bare page', () => {
    expect(() => parseSalon('<html><head></head><body>hi</body></html>', 'https://x.mk/')).toThrow(ImportError);
  });

  it('blocks SSRF targets before any fetch', async () => {
    await expect(importSalon('http://localhost:3001/secret')).rejects.toMatchObject({ code: 'BLOCKED' });
    await expect(importSalon('http://127.0.0.1/')).rejects.toMatchObject({ code: 'BLOCKED' });
    await expect(importSalon('http://169.254.169.254/latest/meta-data')).rejects.toMatchObject({ code: 'BLOCKED' });
    await expect(importSalon('ftp://example.com/')).rejects.toMatchObject({ code: 'BAD_URL' });
  });
});

describe('website import — deep links (price lists & service pages)', () => {
  it('picks the price-list PDF and service sub-pages, drops the junk', () => {
    const html = `<html><body>
      <a href="/cenovnik/cenovnik.pdf">Ценовник</a>
      <a href="/uslugi/">Услуги</a>
      <a href="/product-category/kiara-sky/">Kiara Sky</a>
      <a href="/kariera/">Кариера</a>
      <a href="/en/home/">EN</a>
      <a href="https://facebook.com/x">FB</a>
      <a href="/some-random-brochure.pdf">Brochure</a>
    </body></html>`;
    const deep = collectDeepLinks(html, 'https://afrodita-s.com.mk/');
    // The named price list leads; any other same-host PDF still qualifies.
    expect(deep[0]).toEqual({ url: 'https://afrodita-s.com.mk/cenovnik/cenovnik.pdf', kind: 'pdf' });
    expect(deep.some((d) => d.url.endsWith('/uslugi/') && d.kind === 'html')).toBe(true);
    // Junk is excluded: product categories, careers, /en/, socials.
    expect(deep.some((d) => /product-category|kariera|\/en\/|facebook/.test(d.url))).toBe(false);
  });
});

describe('website import — structured-data services (Fresha-style)', () => {
  it('reads services from JSON-LD + embedded JSON: name, price (object or number), category', () => {
    const ld = { '@graph': [
      { '@type': 'Service', name: 'Thai Oil', category: 'Asian massages' },
      { '@type': 'Service', name: 'Manikir', category: 'Nails' },
    ] };
    const data = { props: { data: { services: [
      { name: 'Thai Oil', retailPrice: { currency: 'BAM', value: 100 }, minInSeconds: 4500 },
      { name: 'Manikir', price: 800, currency: 'BAM' },
    ] } } };
    const html = `<html><head>
      <script type="application/ld+json">${JSON.stringify(ld)}</script>
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>
    </head><body></body></html>`;
    const out = extractStructuredServices(html);
    // retailPrice object with value, duration from minInSeconds, category from JSON-LD.
    expect(out).toContain('Thai Oil — 100 BAM — 75 min [Asian massages]');
    // plain-number price + top-level currency.
    expect(out).toContain('Manikir — 800 BAM [Nails]');
  });

  it('returns empty when the page carries no structured services', () => {
    expect(extractStructuredServices('<html><body><h1>Hi</h1></body></html>')).toBe('');
  });
});

describe('website import — photos', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('collects photo candidates: hero first, relatives resolved, chrome dropped', () => {
    const html = `<html><head>
      <meta property="og:image" content="/hero.jpg">
      </head><body>
      <img src="https://cdn.site.com/logo.png">
      <img src="photos/room1.jpg">
      <img src="/icons/star.svg">
      <img src="data:image/png;base64,AAAA">
    </body></html>`;
    const urls = collectImages(html, 'https://salon.mk/page/');
    expect(urls[0]).toBe('https://salon.mk/hero.jpg'); // the social hero leads
    expect(urls).toContain('https://salon.mk/page/photos/room1.jpg'); // relative resolved
    expect(urls.some((u) => /logo/.test(u))).toBe(false); // logo dropped
    expect(urls.some((u) => /\.svg/.test(u))).toBe(false); // svg dropped
    expect(urls.some((u) => u.startsWith('data:'))).toBe(false); // data URL dropped
  });

  // A literal public IP skips DNS; fetch is stubbed for the bytes.
  const HERO = '<meta property="og:image" content="http://93.184.216.34/hero.jpg">';
  const pngBytes = Buffer.from('89504e470d0a1a0a0000', 'hex');

  it('fetches a candidate and returns it as a data URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(pngBytes, { status: 200, headers: { 'content-type': 'image/png' } })),
    );
    const photos = await importPhotos(HERO, 'http://93.184.216.34/');
    expect(photos).toHaveLength(1);
    expect(photos[0]).toMatch(/^data:image\/png;base64,/);
  });

  it('skips an oversized image and a non-image response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(pngBytes, { status: 200, headers: { 'content-type': 'image/png', 'content-length': '99999999' } }),
      ),
    );
    expect(await importPhotos(HERO, 'http://93.184.216.34/')).toHaveLength(0);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html/>', { status: 200, headers: { 'content-type': 'text/html' } })),
    );
    expect(await importPhotos(HERO, 'http://93.184.216.34/')).toHaveLength(0);
  });
});

describe('import route', () => {
  beforeAll(() => app.ready());
  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('rejects a private-network URL with 422 BLOCKED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/registrations/import`,
      payload: { url: 'http://127.0.0.1/' },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: string }).error).toBe('BLOCKED');
  });
});
