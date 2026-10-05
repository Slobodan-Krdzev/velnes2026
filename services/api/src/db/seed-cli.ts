import { DEMO_PASSWORD, seedDemo } from './seed-demo.js';
import { closeDb } from './index.js';
import { recomputeAllQuietSlots } from '../modules/loyalty/quiet-slots.service.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed a production database.');
  process.exit(1);
}

// Seeding needs an RLS-exempt connection (superuser or BYPASSRLS):
// it writes across tenants and platform-level rows.
const url =
  process.env.SEED_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes';

await seedDemo(url);
console.log(`Seeded the demo world into ${new URL(url).pathname.slice(1)}.`);
// Quiet slots (2026-10-05): judge the seeded history now, so the tags
// are on the calendar before the hourly pass gets to them.
try {
  const n = await recomputeAllQuietSlots();
  console.log(`Judged quiet slots for ${n} locations.`);
} catch (e) {
  console.warn('Quiet slots not judged:', (e as Error).message);
}
await closeDb();
console.log(`Demo login: maria@velnes.mk (and colleagues) · password: ${DEMO_PASSWORD}`);
