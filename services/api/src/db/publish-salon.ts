import { sql } from 'kysely';
import { closeDb, db, withTenant } from './index.js';
import { publishSalon } from '../modules/registrations/registrations.service.js';

/**
 * Publish a salon that was approved before 2026-09-22, when approval
 * started publishing: services online, the owner skilled in them, a
 * live booking widget, the location ACTIVE. Runs the very same
 * `publishSalon()` registration approval runs, under the tenant, so
 * the two can never disagree. Idempotent — safe to run twice.
 *
 *   pnpm --filter @velnes/api exec tsx --env-file-if-exists=../../.env \
 *     src/db/publish-salon.ts <business slug>
 */
const slug = process.argv[2];
if (!slug) {
  console.error('Usage: publish-salon.ts <business slug>');
  process.exit(1);
}

const biz = await db.transaction().execute(async (trx) => {
  await sql`select set_config('app.hq', '1', true)`.execute(trx);
  return trx.selectFrom('businesses').select(['id', 'name']).where('slug', '=', slug).executeTakeFirst();
});
if (!biz) {
  console.error(`No business with slug "${slug}".`);
  await closeDb();
  process.exit(1);
}

const result = await withTenant(biz.id, async (trx) => {
  const loc = await trx
    .selectFrom('locations')
    .select(['id', 'name', 'lifecycle'])
    .orderBy('createdAt')
    .executeTakeFirst();
  if (!loc) throw new Error(`${biz.name} has no location to publish.`);
  const r = await publishSalon(trx, {
    businessId: biz.id,
    locationId: loc.id,
    actorName: 'Revelapps (publish-salon)',
    reason: 'Published by repair: approved before approval published',
  });
  return { ...r, location: loc.name, was: loc.lifecycle };
});

console.log(
  result.activated
    ? `${biz.name} · ${result.location}: ${result.was} → ACTIVE, services online, owner skilled, widget live.`
    : `${biz.name} · ${result.location}: stays ${result.was} — not ready: ${result.notReady.join(', ')}`,
);
await closeDb();
