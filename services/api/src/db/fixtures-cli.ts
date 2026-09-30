/**
 * Fixture salons from the command line — see fixtures.ts.
 *
 *   fixtures add    --batch demo-2026-09 [--count 12]
 *   fixtures remove --batch demo-2026-09
 *   fixtures list
 *   fixtures amenities --batch demo-2026-09   (give an older batch its amenities)
 *   fixtures reviews   --batch demo-2026-09   (verified reviews on completed fixture visits)
 *   fixtures changes   --batch demo-2026-09   (every reschedule / cancellation / refund state, one consumer)
 *   fixtures loyalty   --batch demo-2026-09   (Velnes Loyalty ledgers in every shape)
 *
 * Needs the API connection (API_DATABASE_URL — the doors run under it)
 * and the owner connection (DATABASE_URL — tagging and removal cross
 * tenants, which RLS forbids the API role). On the VPS:
 *   node --env-file=/srv/velnes/api/.env /srv/velnes/api/fixtures.js add --batch demo --count 12
 */
import { addFixtureBatch, addFixtureChanges, addFixtureLoyalty, addFixtureReviews, backfillFixtureAmenities, FIXTURE_PASSWORD, listFixtureBatches, removeFixtureBatch } from './fixtures.js';

const [cmd, ...rest] = process.argv.slice(2);
const arg = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const adminUrl = process.env.DATABASE_URL ?? '';
if (!adminUrl) {
  console.error('DATABASE_URL (the owning role) must be set — removal and tagging cross tenants.');
  process.exit(1);
}

try {
  if (cmd === 'add') {
    const batch = arg('batch');
    if (!batch) throw new Error('--batch <name> is required');
    const count = Number(arg('count') ?? 12);
    const made = await addFixtureBatch({ batch, count, adminUrl, log: (l) => console.log(l) });
    console.log('');
    console.log(`Added ${made.length} fixture salons in batch "${batch}". Every account's password: ${FIXTURE_PASSWORD}`);
    console.log('');
    for (const s of made) console.log(`${s.name.padEnd(28)} ${s.city.padEnd(10)} /s/${s.slug.padEnd(30)} ${s.ownerEmail}`);
    console.log('');
    console.log(`Remove them again with: fixtures remove --batch ${batch}`);
  } else if (cmd === 'remove') {
    const batch = arg('batch');
    if (!batch) throw new Error('--batch <name> is required');
    const r = await removeFixtureBatch(batch, adminUrl);
    console.log(r.removed ? `Removed ${r.removed} salons of batch "${batch}" (${r.tables} tables swept).` : `No batch "${batch}".`);
  } else if (cmd === 'amenities') {
    const batch = arg('batch');
    if (!batch) throw new Error('--batch <name> is required');
    const r = await backfillFixtureAmenities(batch, adminUrl);
    console.log(r.salons ? `Gave ${r.salons} salons of batch "${batch}" their amenities (${r.rows} rows).` : `No batch "${batch}".`);
  } else if (cmd === 'reviews') {
    const batch = arg('batch');
    if (!batch) throw new Error('--batch <name> is required');
    const r = await addFixtureReviews(batch, adminUrl);
    console.log(r.salons ? `Gave ${r.salons} salons of batch "${batch}" ${r.reviews} verified reviews.` : `No batch "${batch}" (or it already has reviews).`);
  } else if (cmd === 'changes') {
    const batch = arg('batch');
    if (!batch) throw new Error('--batch <name> is required');
    const r = await addFixtureChanges(batch, adminUrl);
    console.log(r.salons ? `Gave the first salon of batch "${batch}" ${r.appointments} visits in every change state — sign in as changes.client@fixture.velnes.test / ${FIXTURE_PASSWORD}.` : `No batch "${batch}" (or it already has them).`);
  } else if (cmd === 'loyalty') {
    const batch = arg('batch');
    if (!batch) throw new Error('--batch <name> is required');
    const r = await addFixtureLoyalty(batch, adminUrl);
    console.log(r.rows ? `Wrote ${r.rows} Velnes Loyalty rows for ${r.consumers} consumers of batch "${batch}" (changes/welcome/active/quiet .client@fixture.velnes.test / ${FIXTURE_PASSWORD}).` : `No batch "${batch}" (or it already has them).`);
  } else if (cmd === 'list') {
    const rows = await listFixtureBatches(adminUrl);
    if (!rows.length) console.log('No fixture batches.');
    for (const r of rows) console.log(`${r.batch.padEnd(24)} ${String(r.salons).padStart(3)} salons   since ${new Date(r.since).toISOString().slice(0, 10)}`);
  } else {
    console.log('usage: fixtures add --batch <name> [--count N] | remove --batch <name> | amenities --batch <name> | reviews --batch <name> | changes --batch <name> | loyalty --batch <name> | list');
    process.exit(2);
  }
  const { closeDb } = await import('./index.js');
  await closeDb();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
