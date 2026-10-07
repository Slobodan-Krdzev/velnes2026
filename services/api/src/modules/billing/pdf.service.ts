import { createHash } from 'node:crypto';
import type { Trx } from '../../db/index.js';
import { withTenant } from '../../db/index.js';
import { logAudit } from '../audit/audit.service.js';
import { BillingError } from './billing.service.js';
import { rowToContract } from './drafts.service.js';
import { addEvent } from './events.js';
import type { PdfLogo } from './invoice-pdf.js';
import { rendererFor } from './renderers.js';
import { reaches, type Reach } from './scope.js';

/**
 * The canonical PDF of an issued document (phase 4, 2026-10-07).
 *
 * One door: read the frozen row and its lines through the contract,
 * resolve the frozen logo asset the issuer snapshot names (and nothing
 * current), render, hash. The first successful render establishes the
 * canonical hash in `pdf_sha256` — atomically, only while it is NULL —
 * and writes the document's `pdf` event. Every later render must
 * reproduce that hash: a difference is an integrity failure, audited
 * in its own transaction and refused; the stored hash is history and
 * is never overwritten.
 *
 * A draft has no PDF here: the Workspace preview is its only picture,
 * so nothing that looks like a legal document exists before a number.
 */

export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export async function invoicePdf(
  trx: Trx,
  tenantId: string,
  reach: Reach,
  id: string,
  actor: { id: string | null; name: string },
): Promise<{ buffer: Buffer; sha256: string; number: string; established: boolean }> {
  const row = await trx
    .selectFrom('billingInvoices')
    .select(['id', 'status', 'locationId', 'number', 'pdfSha256', 'pdfRenderer', 'issuer'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row || !reaches(reach, row.locationId)) throw new BillingError('NOT_FOUND', 'Unknown accounting invoice');
  if (row.status !== 'issued' || !row.number)
    throw new BillingError('INVALID', 'Only an issued document has a PDF; a draft is previewed in the Workspace until it is issued');

  const doc = await rowToContract(trx, id);
  // The branding the document froze — by hash, never the profile's current logo.
  let logo: PdfLogo | null = null;
  if (doc.issuer.logoSha256) {
    const a = await trx.selectFrom('billingAssets').select(['mime', 'data']).where('sha256', '=', doc.issuer.logoSha256).executeTakeFirst();
    if (!a) throw new BillingError('INTEGRITY', `The logo this document was issued with (${doc.issuer.logoSha256.slice(0, 12)}…) is missing from the asset store`);
    logo = { mime: a.mime, dataUrl: a.data };
  }
  // The renderer the document is bound to — never a newer one for an
  // old document, never an unregistered one.
  let renderer: ReturnType<typeof rendererFor>;
  try {
    renderer = rendererFor(row.pdfRenderer);
  } catch {
    throw new BillingError('INTEGRITY', `${row.number} was rendered by ${row.pdfRenderer}, which this build does not carry; the PDF was not served`);
  }
  const rendered = await renderer.render(doc, logo);
  const hash = sha256(rendered.buffer);

  if (!row.pdfSha256) {
    // First canonical render: claim the hash and the renderer only if nobody did meanwhile.
    const claimed = await trx
      .updateTable('billingInvoices')
      .set({ pdfSha256: hash, pdfRenderer: renderer.version, updatedAt: new Date() })
      .where('id', '=', id)
      .where('pdfSha256', 'is', null)
      .executeTakeFirst();
    if (Number(claimed.numUpdatedRows) === 1) {
      await addEvent(trx, tenantId, id, 'pdf', actor, { sha256: hash, bytes: rendered.buffer.length, lang: doc.lang, logo: rendered.logo, renderer: renderer.version });
      return { buffer: rendered.buffer, sha256: hash, number: row.number, established: true };
    }
    const again = await trx.selectFrom('billingInvoices').select('pdfSha256').where('id', '=', id).executeTakeFirstOrThrow();
    row.pdfSha256 = again.pdfSha256;
  }
  if (row.pdfSha256 !== hash) {
    // Not in this transaction: the refusal must not roll the record back.
    await withTenant(tenantId, async (own) => {
      await addEvent(own, tenantId, id, 'pdf', actor, { integrity: 'mismatch', expected: row.pdfSha256, rendered: hash, bytes: rendered.buffer.length, renderer: renderer.version });
      await logAudit(own, tenantId, {
        actorEmployeeId: actor.id,
        actorName: actor.name,
        action: 'Invoice PDF integrity failure',
        object: `Invoice · ${row.number}`,
        before: row.pdfSha256 ?? '—',
        after: hash,
        reason: 'A render of an issued document did not reproduce its canonical hash; the PDF was not served',
      });
    });
    throw new BillingError('INTEGRITY', `The PDF of ${row.number} no longer reproduces its canonical hash; it was not served. Velnes has recorded the failure`);
  }
  return { buffer: rendered.buffer, sha256: hash, number: row.number, established: false };
}

/** An ASCII-safe filename from the legal number: `invoice-2026-000041.pdf`. */
export const pdfFilename = (number: string) => `invoice-${number.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')}.pdf`;
