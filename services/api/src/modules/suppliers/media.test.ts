import { API_PREFIX, SupplierMediaListSchema, SupplierMediaSchema } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';

/**
 * Supplier media (2026-10-07) — docs/SUPPLIERS.md. A supplier publishes
 * its printed catalogs as PDFs; a connected salon lists and opens them;
 * a salon that is not connected sees nothing; the supplier removes at
 * any time; only a real PDF is accepted.
 */
const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
let maria = '';
let vesna = '';
let bojan = '';
let goran = '';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

const call = (method: 'GET' | 'POST' | 'DELETE', url: string, token: string, payload?: unknown) =>
  app.inject({ method, url: `${API_PREFIX}${url}`, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
const login = async (url: string, email: string) =>
  (await app.inject({ method: 'POST', url: `${API_PREFIX}${url}`, payload: { email, password: 'velnes-demo' } })).json().accessToken as string;

describe('supplier media — printed catalogs as PDFs', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    await admin.query(`DELETE FROM supplier_media WHERE name LIKE '%(test)%'`);
    maria = await login('/auth/login', 'maria@velnes.mk');
    vesna = await login('/portal/auth/login', 'vesna@beautypro.mk'); // BeautyPro, no catalog right
    bojan = await login('/portal/auth/login', 'bojan@beautypro.mk'); // BeautyPro's owner, connected to Velnes Fizio
    // Every seeded portal user belongs to BeautyPro: give sup2 an owner of
    // its own so "another supplier is blind" is a real check.
    const hash = (await admin.query(`SELECT password_hash FROM supplier_users WHERE email='bojan@beautypro.mk'`)).rows[0].password_hash as string;
    await admin.query(
      `INSERT INTO supplier_users (supplier_id, name, email, role, status, password_hash) VALUES ($1,'Other Owner (test)','other.owner@media-test.velnes','sr_owner','active',$2)
       ON CONFLICT DO NOTHING`,
      [demo.sup2, hash],
    );
    goran = await login('/portal/auth/login', 'other.owner@media-test.velnes'); // another supplier's portal, full rights
  });
  afterAll(async () => {
    await admin.query(`DELETE FROM supplier_media WHERE name LIKE '%(test)%'`);
    await admin.query(`DELETE FROM supplier_users WHERE email='other.owner@media-test.velnes'`);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('the supplier publishes a PDF, the connected salon lists and opens it byte for byte, the supplier removes it', async () => {
    // A portal user without the catalog right cannot publish; the owner can.
    expect((await call('POST', '/portal/media', vesna, { name: 'Nope (test)', data: PDF.toString('base64') })).statusCode).toBe(403);
    const up = await call('POST', '/portal/media', bojan, { name: 'Autumn catalog (test)', data: PDF.toString('base64') });
    expect(up.statusCode, up.body).toBe(200);
    const file = SupplierMediaSchema.parse(up.json());
    expect(file).toMatchObject({ supplierId: demo.sup1, name: 'Autumn catalog (test).pdf', sizeBytes: PDF.length, uploadedByName: 'Bojan Cvetkov' });
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    // Every portal user lists and opens it; so does the connected salon.
    expect(SupplierMediaListSchema.parse((await call('GET', '/portal/media', vesna)).json()).files.some((f) => f.id === file.id)).toBe(true);
    const salon = await call('GET', `/suppliers/${demo.sup1}/media`, maria);
    expect(salon.statusCode, salon.body).toBe(200);
    expect(SupplierMediaListSchema.parse(salon.json()).files.some((f) => f.id === file.id)).toBe(true);
    // The bytes come back as a PDF, inline, unchanged.
    const bytes = await call('GET', `/suppliers/${demo.sup1}/media/${file.id}/file`, maria);
    expect(bytes.statusCode).toBe(200);
    expect(bytes.headers['content-type']).toBe('application/pdf');
    expect(String(bytes.headers['content-disposition'])).toMatch(/^inline/);
    expect(Buffer.from(bytes.rawPayload).equals(PDF)).toBe(true);
    expect(Buffer.from((await call('GET', `/portal/media/${file.id}/file`, vesna)).rawPayload).equals(PDF)).toBe(true);
    // Another supplier's portal neither sees nor can remove it.
    expect(SupplierMediaListSchema.parse((await call('GET', '/portal/media', goran)).json()).files.some((f) => f.id === file.id)).toBe(false);
    expect((await call('DELETE', `/portal/media/${file.id}`, goran)).statusCode).toBe(404);
    // Removed by its owner: gone for the salon too.
    expect((await call('DELETE', `/portal/media/${file.id}`, vesna)).statusCode).toBe(403);
    expect((await call('DELETE', `/portal/media/${file.id}`, bojan)).statusCode).toBe(200);
    expect(SupplierMediaListSchema.parse((await call('GET', `/suppliers/${demo.sup1}/media`, maria)).json()).files.some((f) => f.id === file.id)).toBe(false);
    expect((await call('GET', `/suppliers/${demo.sup1}/media/${file.id}/file`, maria)).statusCode).toBe(404);
  });

  it('a salon not connected to the supplier gets nothing; a non-PDF is refused; the catalog right is required', async () => {
    // sup4 is only pending for Velnes Fizio; sup3 has no connection at all.
    expect((await call('GET', `/suppliers/${demo.sup4}/media`, maria)).statusCode).toBe(404);
    expect((await call('GET', `/suppliers/${demo.sup3}/media`, maria)).statusCode).toBe(404);
    const notPdf = await call('POST', '/portal/media', bojan, { name: 'price list (test)', data: Buffer.from('hello, not a pdf at all').toString('base64') });
    expect(notPdf.statusCode).toBe(422);
    expect(notPdf.json().message).toMatch(/PDF/);
    // The other supplier publishes its own file: BeautyPro's portal never lists it,
    // and Velnes Fizio (connected to both) sees each under its own supplier only.
    const theirs = SupplierMediaSchema.parse((await call('POST', '/portal/media', goran, { name: 'Other (test)', data: PDF.toString('base64') })).json());
    expect(SupplierMediaListSchema.parse((await call('GET', '/portal/media', bojan)).json()).files.some((f) => f.id === theirs.id)).toBe(false);
    expect(SupplierMediaListSchema.parse((await call('GET', `/suppliers/${demo.sup2}/media`, maria)).json()).files.some((f) => f.id === theirs.id)).toBe(true);
    expect(SupplierMediaListSchema.parse((await call('GET', `/suppliers/${demo.sup1}/media`, maria)).json()).files.some((f) => f.id === theirs.id)).toBe(false);
    expect((await call('GET', `/suppliers/${demo.sup1}/media/${theirs.id}/file`, maria)).statusCode).toBe(404);
    expect((await call('DELETE', `/portal/media/${theirs.id}`, goran)).statusCode).toBe(200);
  });
});
