import { API_PREFIX } from '@velnes/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { buildServer } from '../../server.js';
import { ImportError, importSalon, parseSalon } from './import.service.js';

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
  });

  it('falls back to <title>/OpenGraph when there is no JSON-LD', () => {
    const r = parseSalon(
      `<html><head><meta property="og:site_name" content="Ohrid Wellness"><title>Ignore</title></head></html>`,
      'https://ohrid.mk/',
    );
    expect(r.salon.name).toBe('Ohrid Wellness');
    expect(r.found).toEqual(['name']);
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
