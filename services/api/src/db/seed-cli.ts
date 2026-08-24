import { DEMO_PASSWORD, seedDemo } from './seed-demo.js';

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
console.log(`Demo login: maria@velnes.mk (and colleagues) · password: ${DEMO_PASSWORD}`);
