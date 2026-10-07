import type { AccessClaims, BillingInvoice } from '@velnes/contracts';
import { evaluateIssueReadiness, formatInvoiceNumber, isKnownTimeZone } from '@velnes/contracts';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { Trx } from '../../db/index.js';
import { logAudit } from '../audit/audit.service.js';
import { nowAt } from '../scheduling/scheduling.service.js';
import { BillingError } from './billing.service.js';
import { actorName, buyerFromIdentity, issuerSnapshot, locationSnapshot, rowToContract, saleNow } from './drafts.service.js';
import { addEvent } from './events.js';
import { reaches, type Reach } from './scope.js';

/**
 * Issuing (phase 3, 2026-10-07) — docs/INVOICING.md "Phase 3".
 *
 * The one irreversible step: draft → issued, in ONE transaction (the
 * caller's `withTenant`), in this order and no other:
 *
 *   1. lock the draft row FOR UPDATE; a second issuer waits here
 *   2. already issued? same key → the same document (a retry);
 *      another key → 409 — a document is issued once
 *   3. refresh what is refreshed until issue: issuer (entity + profile
 *      + brand), place, and the buyer from its billing identity when
 *      it has one. The sale's money is NOT rebuilt: the draft is the
 *      transaction as it happened.
 *   4. the issue date — the location's calendar day, never the
 *      server's — and from it the legal year
 *   5. evaluate readiness (the same function the GET door reports):
 *      issuer complete and verified, buyer complete for its kind,
 *      clock known, dates sane, every money invariant from billing-math
 *      over the stored lines, the sale still what the origin says.
 *      Any problem → 422 with the list, and NOTHING below has run.
 *   6. freeze the branding: the profile's logo, content-addressed into
 *      billing_assets, referenced by hash from the issuer snapshot
 *   7. reserve the number: upsert-increment on the sequence row for
 *      (entity, series, year) — row-locked, inside this transaction,
 *      so a failure after it gives the number back with the rollback
 *   8. write status, number parts, dates, actor, key, snapshots
 *   9. the 'issued' event and the platform audit row
 *
 * The database holds the last word: the rendered number and the
 * (entity, series, year, seq) tuple are both unique among issued rows,
 * the row's shape is CHECKed, and from the commit on the row is frozen
 * by trigger to everything but the integration/cache columns.
 */

const MINOR = 100;

function logoAsset(dataUrl: string): { sha256: string; mime: string; bytes: number } {
  const m = /^data:([\w/+.-]+);base64,/.exec(dataUrl);
  return { sha256: createHash('sha256').update(dataUrl).digest('hex'), mime: m?.[1] ?? 'application/octet-stream', bytes: dataUrl.length };
}

/** Reserve the next sequence for (entity, series, year): one statement,
 *  one row lock, inside the issue transaction. Never MAX()+1. */
async function reserveSequence(trx: Trx, tenantId: string, legalEntityId: string, series: string, year: number): Promise<number> {
  const r = await sql<{ seq: number }>`
    INSERT INTO billing_sequences (tenant_id, legal_entity_id, series, year, last_seq)
    VALUES (${tenantId}, ${legalEntityId}, ${series}, ${year}, 1)
    ON CONFLICT (tenant_id, legal_entity_id, series, year)
    DO UPDATE SET last_seq = billing_sequences.last_seq + 1, updated_at = clock_timestamp()
    RETURNING last_seq AS seq`.execute(trx);
  const seq = Number(r.rows[0]?.seq);
  if (!Number.isInteger(seq) || seq < 1) throw new Error(`sequence reservation returned ${String(r.rows[0]?.seq)}`);
  return seq;
}

export async function issueInvoice(
  trx: Trx,
  claims: AccessClaims,
  reach: Reach,
  id: string,
  key: string,
  /** The moment of issue; tests pin it to cross a year boundary. */
  now = new Date(),
): Promise<{ invoice: BillingInvoice; replayed: boolean }> {
  // 1. The row, locked — the second concurrent issuer waits here and
  //    then finds it issued.
  const row = await trx.selectFrom('billingInvoices').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  if (!row || !reaches(reach, row.locationId)) throw new BillingError('NOT_FOUND', 'Unknown accounting invoice');

  // 2. Idempotency: the same key on an issued document is a retry.
  if (row.status === 'issued') {
    if (row.issueKey === key) return { invoice: await rowToContract(trx, id), replayed: true };
    throw new BillingError('CONFLICT', `This document was already issued as ${row.number}; an issued invoice is corrected by a credit note, never re-issued`);
  }
  if (row.status !== 'draft') throw new BillingError('INVALID', 'Only a draft can be issued');
  const elsewhere = await trx.selectFrom('billingInvoices').select('id').where('issueKey', '=', key).where('id', '<>', id).executeTakeFirst();
  if (elsewhere) throw new BillingError('CONFLICT', 'This issue key was already used for another document');
  if (row.kind !== 'invoice') throw new BillingError('INVALID', 'Only invoices are issued in this phase; credit notes come with their own');

  // 3. What is refreshed until issue: the issuer, the place, the buyer
  //    from its identity. The money stays the draft's.
  const issuer = await issuerSnapshot(trx, row.legalEntityId);
  const location = await locationSnapshot(trx, row.locationId);
  const buyer = row.billingCustomerId ? await buyerFromIdentity(trx, row.billingCustomerId) : ((row.buyer ?? null) as BillingInvoice['buyer']);
  const doc = await rowToContract(trx, id);

  // 4. The legal issue date is the location's day.
  if (!isKnownTimeZone(location.tz))
    throw new BillingError('ISSUE_BLOCKED', 'The location has no known time zone, so no issue date can be taken', [{ part: 'location', field: 'tz', reason: 'invalid' }]);
  const issueDate = nowAt(location.tz, now).date;
  const year = Number(issueDate.slice(0, 4));

  // 5. Everything that can be wrong, before a number is touched.
  const readiness = evaluateIssueReadiness({
    issuer: issuer.completeness,
    buyer,
    location,
    vatRegistered: row.vatRegistered,
    pricesIncludeVat: row.pricesIncludeVat,
    supplyDate: doc.supplyDate,
    issueDate,
    dueDate: doc.dueDate,
    lines: doc.lines,
    totals: doc.totals,
    vatBreakdown: doc.vatBreakdown,
    origin: doc.origin,
    sale: await saleNow(trx, row.originSaleId),
  });
  // The document's VAT state was fixed when it was drafted from the
  // sale; the issuer cannot have changed its mind underneath it.
  if (issuer.vatRegistered !== row.vatRegistered) readiness.problems.push({ part: 'issuer', field: 'vatRegistered', reason: 'changed' });
  if (issuer.currency !== row.currency) readiness.problems.push({ part: 'issuer', field: 'defaultCurrency', reason: 'changed' });
  if (readiness.problems.length)
    throw new BillingError(
      'ISSUE_BLOCKED',
      `This document cannot be issued yet: ${readiness.problems.map((p) => `${p.part}.${p.field} ${p.reason}`).join(', ')}`,
      readiness.problems,
    );

  // 6. The branding this document used, frozen by content.
  let logoSha256: string | null = null;
  let logoMime: string | null = null;
  if (issuer.logo) {
    const a = logoAsset(issuer.logo);
    await trx
      .insertInto('billingAssets')
      .values({ tenantId: claims.ten, sha256: a.sha256, kind: 'logo', mime: a.mime, bytes: a.bytes, data: issuer.logo })
      .onConflict((oc) => oc.columns(['tenantId', 'sha256']).doNothing())
      .execute();
    logoSha256 = a.sha256;
    logoMime = a.mime;
  }

  // 7. The number — last, under the sequence row's lock.
  const series = issuer.numbering.invoicePrefix;
  const seqYear = issuer.numbering.yearlyReset ? year : 0;
  const seq = await reserveSequence(trx, claims.ten, row.legalEntityId, series, seqYear);
  const number = formatInvoiceNumber({ prefix: series, year, seq, width: issuer.numbering.numberWidth });

  // 8. The issued row.
  const name = await actorName(trx, claims.sub);
  const issuedAt = (await sql<{ t: Date }>`SELECT clock_timestamp() AS t`.execute(trx)).rows[0]!.t;
  await trx
    .updateTable('billingInvoices')
    .set({
      status: 'issued',
      series,
      year,
      numberSeq: seq,
      number,
      issueDate: new Date(issueDate),
      issuedAt,
      issuedBy: claims.sub,
      issuedByName: name,
      issueKey: key,
      issuer: JSON.stringify({ ...issuer.snap, logoSha256, logoMime }),
      buyer: buyer ? JSON.stringify(buyer) : null,
      location: JSON.stringify(location),
      updatedBy: claims.sub,
      updatedByName: name,
      updatedAt: issuedAt,
    })
    .where('id', '=', id)
    .where('status', '=', 'draft')
    .execute();

  // 9. The timeline and the platform trail, same transaction.
  await addEvent(trx, claims.ten, id, 'issued', { id: claims.sub, name }, {
    number,
    series,
    year,
    numberSeq: seq,
    issueDate,
    supplyDate: doc.supplyDate,
    legalEntityId: row.legalEntityId,
    locationId: row.locationId,
    currency: row.currency,
    netMinor: doc.totals.netMinor,
    vatMinor: doc.totals.vatMinor,
    grossMinor: doc.totals.grossMinor,
    issueKey: key,
    logoSha256,
    warnings: readiness.warnings,
  });
  await logAudit(trx, claims.ten, {
    actorEmployeeId: claims.sub,
    actorName: name,
    action: 'Invoice issued',
    object: `Invoice · ${number}`,
    before: `draft · ${doc.origin?.saleNumber ?? id}`,
    after: `${doc.totals.grossMinor / MINOR} ${row.currency} · ${issueDate}`,
    locationName: location.name,
  });
  return { invoice: await rowToContract(trx, id), replayed: false };
}

/** The logo a document shows: the frozen asset of an issued one, the
 *  profile's current logo for a draft. Null when there is none. */
export async function logoOf(trx: Trx, reach: Reach, id: string): Promise<{ sha256: string | null; mime: string; dataUrl: string } | null> {
  const r = await trx.selectFrom('billingInvoices').select(['id', 'status', 'locationId', 'legalEntityId', 'issuer']).where('id', '=', id).executeTakeFirst();
  if (!r || !reaches(reach, r.locationId)) throw new BillingError('NOT_FOUND', 'Unknown accounting invoice');
  const sha = (r.issuer as { logoSha256?: string | null }).logoSha256 ?? null;
  if (r.status !== 'draft' || sha) {
    if (!sha) return null;
    const a = await trx.selectFrom('billingAssets').select(['sha256', 'mime', 'data']).where('sha256', '=', sha).executeTakeFirst();
    return a ? { sha256: a.sha256, mime: a.mime, dataUrl: a.data } : null;
  }
  const p = await trx.selectFrom('billingProfiles').select('logo').where('legalEntityId', '=', r.legalEntityId).executeTakeFirst();
  if (!p?.logo) return null;
  return { sha256: null, mime: logoAsset(p.logo).mime, dataUrl: p.logo };
}
