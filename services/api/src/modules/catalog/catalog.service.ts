import type {
  LineQuoteResponse,
  LocationCatalogResponse,
  PriceForResponse,
  ResolvedServiceConfig,
  ServiceChoice,
} from '@velnes/contracts';
import type { Trx } from '../../db/index.js';

export class CatalogError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'BAD_MODIFIER',
    message: string,
  ) {
    super(message);
  }
}

const RESET_DEFAULT = 10;

interface MasterService {
  id: string;
  name: string;
  category: string | null;
  durationMin: number;
  price: number;
  vat: number;
  status: 'active' | 'draft';
  pos: boolean;
  online: boolean;
  prepMin: number | null;
  resetMin: number | null;
}

async function masterService(trx: Trx, serviceId: string): Promise<MasterService> {
  const s = await trx
    .selectFrom('services as s')
    .leftJoin('serviceCategories as c', 'c.id', 's.categoryId')
    .select([
      's.id',
      's.name',
      'c.name as category',
      's.durationMin',
      's.price',
      's.vat',
      's.status',
      's.pos',
      's.online',
      's.prepMin',
      's.resetMin',
    ])
    .where('s.id', '=', serviceId)
    .executeTakeFirst();
  if (!s) throw new CatalogError('NOT_FOUND', 'Unknown service');
  return s;
}

/** svcAt — the per-location resolution: the override row, or the
 *  master item's own values (active = not draft). */
export async function svcAt(
  trx: Trx,
  serviceId: string,
  locationId: string,
): Promise<ResolvedServiceConfig> {
  const s = await masterService(trx, serviceId);
  const c = await trx
    .selectFrom('locationCatalogServices')
    .selectAll()
    .where('serviceId', '=', serviceId)
    .where('locationId', '=', locationId)
    .executeTakeFirst();
  if (c)
    return {
      active: c.active,
      price: c.price,
      durationMin: c.durationMin,
      online: c.online,
      pos: c.pos,
    };
  return {
    active: s.status !== 'draft',
    price: s.price,
    durationMin: s.durationMin,
    online: s.online,
    pos: s.pos,
  };
}

/** svcVariants — a variant inherits price/duration from the master
 *  variant and can be overridden or switched off per location. */
export async function svcVariants(trx: Trx, serviceId: string, locationId: string | null) {
  const vs = await trx
    .selectFrom('serviceVariants')
    .selectAll()
    .where('serviceId', '=', serviceId)
    .orderBy('sort')
    .execute();
  if (!vs.length) return [];
  const ovs = locationId
    ? await trx
        .selectFrom('locationCatalogVariants')
        .selectAll()
        .where('locationId', '=', locationId)
        .where(
          'variantId',
          'in',
          vs.map((v) => v.id),
        )
        .execute()
    : [];
  const ov = new Map(ovs.map((o) => [o.variantId, o]));
  return vs.map((v) => {
    const o = ov.get(v.id);
    return {
      id: v.id,
      label: v.label,
      price: o?.price ?? v.price,
      durationMin: o?.durationMin ?? v.durationMin,
      std: v.std,
      active: o ? o.active : true,
    };
  });
}

/** svcChoice — chosen variant → std → first active; without variants,
 *  the service itself. One function so calendar, till and booking
 *  flow never drift apart. */
export async function svcChoice(
  trx: Trx,
  serviceId: string,
  locationId: string,
  variantId: string | null,
): Promise<ServiceChoice> {
  const cfg = await svcAt(trx, serviceId, locationId);
  const vs = (await svcVariants(trx, serviceId, locationId)).filter((v) => v.active);
  if (!vs.length)
    return { vid: null, label: null, price: cfg.price, durationMin: cfg.durationMin };
  const v = vs.find((x) => x.id === variantId) ?? vs.find((x) => x.std) ?? vs[0]!;
  return { vid: v.id, label: v.label, price: v.price, durationMin: v.durationMin };
}

async function modifierGroups(trx: Trx, serviceId: string) {
  const groups = await trx
    .selectFrom('serviceModifierGroups')
    .selectAll()
    .where('serviceId', '=', serviceId)
    .orderBy('sort')
    .execute();
  if (!groups.length) return [];
  const options = await trx
    .selectFrom('serviceModifierOptions')
    .selectAll()
    .where(
      'groupId',
      'in',
      groups.map((g) => g.id),
    )
    .orderBy('sort')
    .execute();
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    type: g.type,
    required: g.required,
    options: options
      .filter((o) => o.groupId === g.id)
      .map((o) => ({ id: o.id, name: o.name, price: o.price, durationMin: o.durationMin })),
  }));
}

/** modTotals + modMissing over a flat list of chosen option ids. */
export function modTotals(
  groups: Awaited<ReturnType<typeof modifierGroups>>,
  ids: string[],
) {
  const all = groups.flatMap((g) => g.options);
  const picked = ids.map((id) => all.find((o) => o.id === id));
  if (picked.some((p) => !p))
    throw new CatalogError('BAD_MODIFIER', 'Unknown modifier option for this service');
  const chosen = picked as NonNullable<(typeof picked)[number]>[];
  return {
    price: chosen.reduce((s, o) => s + o.price, 0),
    min: chosen.reduce((s, o) => s + o.durationMin, 0),
    names: chosen.map((o) => o.name),
  };
}

export function modMissing(
  groups: Awaited<ReturnType<typeof modifierGroups>>,
  ids: string[],
): string[] {
  return groups
    .filter((g) => g.required && !g.options.some((o) => ids.includes(o.id)))
    .map((g) => g.name);
}

/** svcTiming — prep/reset minutes: location override → master →
 *  defaults (prep 0, reset 10). All zero when timing is off. */
async function svcTiming(trx: Trx, serviceId: string, locationId: string) {
  const biz = await trx
    .selectFrom('businesses')
    .select('timingEnabled')
    .executeTakeFirst();
  if (!biz?.timingEnabled) return { prep: 0, reset: 0 };
  const s = await masterService(trx, serviceId);
  const c = await trx
    .selectFrom('locationCatalogServices')
    .select(['prepMin', 'resetMin'])
    .where('serviceId', '=', serviceId)
    .where('locationId', '=', locationId)
    .executeTakeFirst();
  return {
    prep: Math.max(0, c?.prepMin ?? s.prepMin ?? 0),
    reset: Math.max(0, c?.resetMin ?? s.resetMin ?? RESET_DEFAULT),
  };
}

/**
 * svcLine — one quoted line: variant choice + modifiers + prep/reset.
 * The duration basis is 'catalog' until the timing engine (Phase 3)
 * plugs effTreatment into this exact spot.
 */
export async function svcLine(
  trx: Trx,
  req: {
    serviceId: string;
    locationId: string;
    variantId?: string | null | undefined;
    modifierOptionIds: string[];
    employeeId?: string | null | undefined;
  },
): Promise<LineQuoteResponse> {
  const base = await svcChoice(trx, req.serviceId, req.locationId, req.variantId ?? null);
  const groups = await modifierGroups(trx, req.serviceId);
  const t = modTotals(groups, req.modifierOptionIds);
  const treatmentMin = Math.max(5, base.durationMin + t.min);
  const w = await svcTiming(trx, req.serviceId, req.locationId);
  return {
    vid: base.vid,
    label: base.label,
    price: Math.max(0, base.price + t.price),
    treatmentMin,
    prepMin: w.prep,
    resetMin: w.reset,
    operationalMin: w.prep + treatmentMin + w.reset,
    basis: 'catalog',
    modNames: t.names,
    missingRequired: modMissing(groups, req.modifierOptionIds),
  };
}

/** listPrice — the list price of a service (or one of its variants)
 *  at a location. */
async function listPrice(
  trx: Trx,
  serviceId: string,
  locationId: string,
  variantId: string | null,
): Promise<number> {
  if (variantId) {
    const v = (await svcVariants(trx, serviceId, locationId)).find((x) => x.id === variantId);
    if (v) return v.price;
  }
  return (await svcAt(trx, serviceId, locationId)).price;
}

/**
 * priceFor — THE pricing door. Phase 2 serves the list price;
 * last-minute, personal and member offers append options here in
 * their phases without changing the response shape.
 */
export async function priceFor(
  trx: Trx,
  req: { serviceId: string; locationId: string; variantId?: string | null | undefined },
): Promise<PriceForResponse> {
  const base = await listPrice(trx, req.serviceId, req.locationId, req.variantId ?? null);
  const options = [
    { kind: 'list' as const, price: base, label: 'Normal price', spends: false, ref: null },
  ];
  const noSpend = options.filter((o) => !o.spends);
  const best = noSpend.reduce((a, b) => (b.price < a.price ? b : a), noSpend[0]!);
  const choices = options.filter((o) => o.spends);
  return {
    base,
    options,
    best,
    effective: best.price,
    choices,
    hasChoice: choices.length > 0,
    discounted: best.price < base,
  };
}

/** The whole resolved catalog of one location, for catalog screens. */
export async function locationCatalog(
  trx: Trx,
  locationId: string,
): Promise<LocationCatalogResponse> {
  const services = await trx
    .selectFrom('services as s')
    .leftJoin('serviceCategories as c', 'c.id', 's.categoryId')
    .selectAll('s')
    .select('c.name as category')
    .orderBy('s.sort')
    .orderBy('s.name')
    .execute();
  const out = [];
  for (const s of services) {
    out.push({
      id: s.id,
      name: s.name,
      category: s.category,
      durationMin: s.durationMin,
      price: s.price,
      vat: s.vat,
      status: s.status,
      pos: s.pos,
      online: s.online,
      prepMin: s.prepMin,
      resetMin: s.resetMin,
      config: await svcAt(trx, s.id, locationId),
      variants: await svcVariants(trx, s.id, locationId),
      modifiers: await modifierGroups(trx, s.id),
    });
  }

  const products = await trx
    .selectFrom('products as p')
    .leftJoin('productCategories as c', 'c.id', 'p.categoryId')
    .leftJoin('locationCatalogProducts as lc', (join) =>
      join.onRef('lc.productId', '=', 'p.id').on('lc.locationId', '=', locationId),
    )
    .selectAll('p')
    .select(['c.name as category', 'lc.active as lcActive', 'lc.price as lcPrice',
      'lc.pos as lcPos', 'lc.stock as lcStock', 'lc.lowStock as lcLowStock'])
    .orderBy('p.name')
    .execute();

  return {
    services: out,
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      sku: p.sku,
      vat: p.vat,
      own: p.own,
      config: {
        active: p.lcActive ?? p.active,
        price: p.lcPrice ?? p.price,
        pos: p.lcPos ?? (p.own ? false : p.active),
        stock: p.lcStock ?? 0,
        lowStock: p.lcLowStock ?? 2,
      },
    })),
  };
}
