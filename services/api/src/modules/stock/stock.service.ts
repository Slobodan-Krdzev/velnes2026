import { randomUUID } from 'node:crypto';
import type { StockMoveRequest, StockMoveResponse } from '@velnes/contracts';
import type { AccessClaims } from '@velnes/contracts';
import type { Trx } from '../../db/index.js';

export class StockError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'INSUFFICIENT' | 'BAD_MOVE',
    message: string,
  ) {
    super(message);
  }
}

/**
 * The one stock door. Writes the ledger entry and the materialized
 * per-location stock in the same transaction. Stock never goes
 * negative and is never copied — only moved.
 */
export async function stockMove(
  trx: Trx,
  claims: AccessClaims,
  req: StockMoveRequest,
): Promise<StockMoveResponse> {
  const product = await trx
    .selectFrom('products')
    .select(['id', 'tenantId', 'price'])
    .where('id', '=', req.productId)
    .executeTakeFirst();
  if (!product) throw new StockError('NOT_FOUND', 'Unknown product');
  const tenantId = product.tenantId;

  async function apply(locationId: string, qty: number, kind: 'adjustment' | 'transfer_in' | 'transfer_out' | 'own_use', ref: string | null, note?: string) {
    // Ensure the per-location row exists (like the prototype's setStock).
    await trx
      .insertInto('locationCatalogProducts')
      .values({ tenantId, locationId, productId: product!.id, price: product!.price })
      .onConflict((oc) => oc.columns(['locationId', 'productId']).doNothing())
      .execute();
    const updated = await trx
      .updateTable('locationCatalogProducts')
      .set((eb) => ({ stock: eb('stock', '+', qty) }))
      .where('locationId', '=', locationId)
      .where('productId', '=', product!.id)
      .where((eb) => eb(eb('stock', '+', qty), '>=', 0))
      .returning(['stock', 'lowStock'])
      .executeTakeFirst();
    if (!updated)
      throw new StockError('INSUFFICIENT', 'Not enough stock at the source location');
    await trx
      .insertInto('stockMovements')
      .values({
        tenantId,
        locationId,
        productId: product!.id,
        qty,
        kind,
        ref,
        note: note ?? null,
        actorEmployeeId: claims.sub,
      })
      .execute();
    return { locationId, stock: updated.stock, lowStock: updated.lowStock };
  }

  if (req.kind === 'adjustment') {
    if (req.qty === 0) throw new StockError('BAD_MOVE', 'Adjustment of zero');
    return { levels: [await apply(req.locationId, req.qty, 'adjustment', null, req.note)] };
  }
  if (req.kind === 'own_use') {
    return { levels: [await apply(req.locationId, -req.qty, 'own_use', null, req.note)] };
  }
  // transfer: both sides atomically, linked by one ref.
  if (req.fromLocationId === req.toLocationId)
    throw new StockError('BAD_MOVE', 'Transfer needs two different locations');
  const ref = randomUUID();
  const out = await apply(req.fromLocationId, -req.qty, 'transfer_out', ref, req.note);
  const inn = await apply(req.toLocationId, req.qty, 'transfer_in', ref, req.note);
  return { levels: [out, inn] };
}
