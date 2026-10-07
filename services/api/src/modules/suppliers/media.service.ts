import { SUPPLIER_MEDIA_MAX_BYTES, SUPPLIER_MEDIA_MAX_FILES } from '@velnes/contracts';
import { createHash } from 'node:crypto';
import type { Trx } from '../../db/index.js';
import { SupplierError } from './suppliers.service.js';

/**
 * Supplier media — printed catalogs as PDFs (Alex, 2026-10-07). The
 * supplier uploads and removes at any time; a connected salon lists and
 * opens them. The bytes live in supplier_media (sha256 beside them);
 * every door here runs under the caller's own context, so RLS decides
 * who sees which supplier's files.
 */

const toContract = (r: { id: string; supplierId: string; name: string; sizeBytes: number; sha256: string; uploadedByName: string; createdAt: Date }) => ({
  id: r.id,
  supplierId: r.supplierId,
  name: r.name,
  sizeBytes: r.sizeBytes,
  sha256: r.sha256,
  uploadedByName: r.uploadedByName,
  createdAt: r.createdAt.toISOString(),
});

export async function listMedia(trx: Trx, supplierId: string) {
  const rows = await trx
    .selectFrom('supplierMedia')
    .select(['id', 'supplierId', 'name', 'sizeBytes', 'sha256', 'uploadedByName', 'createdAt'])
    .where('supplierId', '=', supplierId)
    .orderBy('createdAt', 'desc')
    .execute();
  return rows.map(toContract);
}

/** The bytes of one file, or null when it is not there (or not visible). */
export async function readMedia(trx: Trx, supplierId: string, id: string) {
  const row = await trx
    .selectFrom('supplierMedia')
    .select(['name', 'mime', 'data'])
    .where('supplierId', '=', supplierId)
    .where('id', '=', id)
    .executeTakeFirst();
  return row ?? null;
}

/** Decode, check it is really a PDF and within the limits, store. */
export async function uploadMedia(
  trx: Trx,
  supplierId: string,
  by: { id: string; name: string },
  input: { name: string; data: string },
) {
  const data = Buffer.from(input.data.replace(/^data:[^,]*,/, ''), 'base64');
  if (data.length === 0) throw new SupplierError('INVALID', 'Empty file');
  if (data.length > SUPPLIER_MEDIA_MAX_BYTES) throw new SupplierError('INVALID', 'The file is larger than 15 MB');
  if (data.subarray(0, 5).toString('latin1') !== '%PDF-') throw new SupplierError('INVALID', 'Only PDF files are accepted');
  const count = await trx
    .selectFrom('supplierMedia')
    .select(({ fn }) => fn.countAll<string>().as('n'))
    .where('supplierId', '=', supplierId)
    .executeTakeFirstOrThrow();
  if (Number(count.n) >= SUPPLIER_MEDIA_MAX_FILES)
    throw new SupplierError('INVALID', `At most ${SUPPLIER_MEDIA_MAX_FILES} files — remove one first`);
  const name = /\.pdf$/i.test(input.name) ? input.name : `${input.name}.pdf`;
  const row = await trx
    .insertInto('supplierMedia')
    .values({
      supplierId,
      name,
      mime: 'application/pdf',
      sizeBytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
      data,
      uploadedBy: by.id,
      uploadedByName: by.name,
    })
    .returning(['id', 'supplierId', 'name', 'sizeBytes', 'sha256', 'uploadedByName', 'createdAt'])
    .executeTakeFirstOrThrow();
  return toContract(row);
}

export async function deleteMedia(trx: Trx, supplierId: string, id: string) {
  const gone = await trx
    .deleteFrom('supplierMedia')
    .where('supplierId', '=', supplierId)
    .where('id', '=', id)
    .returning('id')
    .executeTakeFirst();
  if (!gone) throw new SupplierError('NOT_FOUND', 'No such file');
}
