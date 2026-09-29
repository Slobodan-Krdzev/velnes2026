import { API_PREFIX, DiscoverySalonDetailSchema, LocationListResponseSchema, LocationSchema } from '@velnes/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { resetAdmittedCache } from '../../public/discovery.routes.js';
import { buildServer } from '../../server.js';

/**
 * Amenities live on the location (Alex, 2026-09-29): a set of keys from
 * the contracts' vocabulary, replaced whole through the location PATCH,
 * read back with the location and shown on the salon page for the
 * location it shows. Against the seeded world; put back as found.
 */
const app = await buildServer();
let ownerToken = '';
const auth = () => ({ authorization: `Bearer ${ownerToken}` });

describe('location amenities', () => {
  beforeAll(async () => {
    await app.ready();
    const res = await app.inject({ method: 'POST', url: `${API_PREFIX}/auth/login`, payload: { email: 'maria@velnes.mk', password: 'velnes-demo' } });
    ownerToken = res.json().accessToken as string;
  });
  afterAll(async () => {
    await app.inject({ method: 'PATCH', url: `${API_PREFIX}/locations/${demo.locAerodrom}`, headers: auth(), payload: { amenities: [] } });
    await app.close();
    await closeDb();
  });

  it('a location nobody configured has none, and works as before', async () => {
    const res = await app.inject({ method: 'GET', url: `${API_PREFIX}/locations`, headers: auth() });
    expect(res.statusCode).toBe(200);
    const { locations } = LocationListResponseSchema.parse(res.json());
    const l = locations.find((x) => x.id === demo.locAerodrom)!;
    expect(l.amenities).toEqual([]);
  });

  it('assigns a set — deduplicated, in the vocabulary’s order — and reads it back', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `${API_PREFIX}/locations/${demo.locAerodrom}`,
      headers: auth(),
      payload: { amenities: ['sauna', 'wifi', 'sauna', 'free_parking'] },
    });
    expect(res.statusCode).toBe(200);
    expect(LocationSchema.parse(res.json()).amenities).toEqual(['wifi', 'free_parking', 'sauna']);
    const list = await app.inject({ method: 'GET', url: `${API_PREFIX}/locations`, headers: auth() });
    const l = LocationListResponseSchema.parse(list.json()).locations.find((x) => x.id === demo.locAerodrom)!;
    expect(l.amenities).toEqual(['wifi', 'free_parking', 'sauna']);
    // An edit that says nothing about amenities leaves them alone.
    const other = await app.inject({ method: 'PATCH', url: `${API_PREFIX}/locations/${demo.locAerodrom}`, headers: auth(), payload: { rooms: 2 } });
    expect(LocationSchema.parse(other.json()).amenities).toEqual(['wifi', 'free_parking', 'sauna']);
  });

  it('the salon page carries each location’s own amenities', async () => {
    resetAdmittedCache();
    const res = await app.inject({ method: 'GET', url: `${API_PREFIX}/public/discovery/salons/velnes-fizio` });
    expect(res.statusCode).toBe(200);
    const d = DiscoverySalonDetailSchema.parse(res.json());
    const l = d.locations.find((x) => x.id === demo.locAerodrom)!;
    expect(l.amenities).toEqual(['wifi', 'free_parking', 'sauna']);
    for (const o of d.locations.filter((x) => x.id !== demo.locAerodrom)) expect(o.amenities).toEqual([]);
  });

  it('refuses a key outside the vocabulary, and removes by sending the set without it', async () => {
    const bad = await app.inject({ method: 'PATCH', url: `${API_PREFIX}/locations/${demo.locAerodrom}`, headers: auth(), payload: { amenities: ['jacuzzi'] } });
    expect(bad.statusCode).toBe(400);
    const less = await app.inject({ method: 'PATCH', url: `${API_PREFIX}/locations/${demo.locAerodrom}`, headers: auth(), payload: { amenities: ['wifi'] } });
    expect(LocationSchema.parse(less.json()).amenities).toEqual(['wifi']);
    const none = await app.inject({ method: 'PATCH', url: `${API_PREFIX}/locations/${demo.locAerodrom}`, headers: auth(), payload: { amenities: [] } });
    expect(LocationSchema.parse(none.json()).amenities).toEqual([]);
  });
});
