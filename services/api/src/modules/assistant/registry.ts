import type { AssistantChangeSet, PermKey } from '@velnes/contracts';
import type { AccessClaims } from '@velnes/contracts';
import { sql } from 'kysely';
import type { Trx } from '../../db/index.js';
import { updateService } from '../catalog/catalog.crud.service.js';

/**
 * The AI Assistant Action Registry (V1 spike — workspace surface only).
 *
 * Each action is a thin, declarative wrapper over an EXISTING canonical
 * door. The Assistant never mutates directly: it resolves references to
 * IDs, validates, builds a structured preview + concurrency fingerprint,
 * and — only on explicit approval — calls the same service function the
 * normal UI calls, inside the caller's tenant transaction.
 *
 * Spike scope is deliberately two actions: one READ, one WRITE. New
 * capabilities register here without touching the Assistant machinery.
 */

export interface ResolveResult {
  args: Record<string, unknown>;
  missing: string[];
  errors: { field: string; code: string; message: string }[];
}
export type Fingerprint = Record<string, unknown>;
export interface Conflict {
  field: string;
  was: string;
  now: string;
  proposed: string;
}
export interface PreviewResult {
  changeSet: AssistantChangeSet;
  fingerprint: Fingerprint;
}
export interface ExecResult {
  message: string;
  change: AssistantChangeSet;
}

export interface ActionDef {
  id: string;
  app: 'workspace' | 'supplier';
  kind: 'read' | 'write';
  risk: 'low' | 'medium' | 'high';
  permission: PermKey;
  required: string[];
  title: string;
  description: string; // handed to the planner
  resolve(trx: Trx, claims: AccessClaims, raw: Record<string, unknown>): Promise<ResolveResult>;
  read?(trx: Trx, claims: AccessClaims, args: Record<string, unknown>): Promise<string>;
  preview?(trx: Trx, claims: AccessClaims, args: Record<string, unknown>): Promise<PreviewResult>;
  checkFingerprint?(
    trx: Trx,
    claims: AccessClaims,
    args: Record<string, unknown>,
    fp: Fingerprint,
  ): Promise<Conflict | null>;
  execute?(trx: Trx, claims: AccessClaims, args: Record<string, unknown>): Promise<ExecResult>;
}

const mkd = (n: number) => `${Number(n).toLocaleString('en-US')} MKD`;

/** Resolve a service by name under the caller's tenant (RLS). Returns a
 *  discriminated outcome so the caller can ask / disambiguate / proceed. */
type SvcRow = { id: string; name: string; price: number; category: string | null };
async function resolveService(
  trx: Trx,
  raw: string,
): Promise<{ ok: true; svc: SvcRow } | { ok: false; code: 'AMBIGUOUS' | 'NOT_FOUND'; options: string[] }> {
  const name = raw.trim();
  const base = trx
    .selectFrom('services as s')
    .leftJoin('serviceCategories as c', 'c.id', 's.categoryId')
    .select(['s.id', 's.name', 's.price', 'c.name as category']);
  const exact = await base.where(sql<boolean>`lower(s.name) = ${name.toLowerCase()}`).execute();
  const hits = exact.length
    ? exact
    : await base.where(sql<boolean>`lower(s.name) like ${'%' + name.toLowerCase() + '%'}`).execute();
  if (hits.length === 1) return { ok: true, svc: hits[0] as SvcRow };
  if (hits.length > 1) return { ok: false, code: 'AMBIGUOUS', options: hits.map((h) => h.name) };
  const all = await trx.selectFrom('services').select('name').orderBy('name').limit(12).execute();
  return { ok: false, code: 'NOT_FOUND', options: all.map((a) => a.name) };
}

/** Read the current base service into the fields a canonical PUT needs.
 *  Variants/modifiers/performers are omitted → updateService leaves them
 *  untouched, so a price change never disturbs the rest of the service. */
async function serviceBaseWrite(trx: Trx, serviceId: string, newPrice: number) {
  const s = await trx
    .selectFrom('services as s')
    .leftJoin('serviceCategories as c', 'c.id', 's.categoryId')
    .select([
      's.name',
      'c.name as category',
      's.durationMin',
      's.vat',
      's.status',
      's.pos',
      's.online',
      's.prepMin',
      's.resetMin',
    ])
    .where('s.id', '=', serviceId)
    .executeTakeFirstOrThrow();
  return {
    name: s.name,
    category: s.category,
    durationMin: s.durationMin,
    price: newPrice,
    vat: s.vat,
    status: s.status,
    pos: s.pos,
    online: s.online,
    prepMin: s.prepMin,
    resetMin: s.resetMin,
  };
}

// ── read_service_price ───────────────────────────────────────────────
const readServicePrice: ActionDef = {
  id: 'read_service_price',
  app: 'workspace',
  kind: 'read',
  risk: 'low',
  permission: 'catalog.view',
  required: ['serviceName'],
  title: 'Read a service price',
  description: 'Tell the user the current price of a named service.',
  async resolve(trx, _claims, raw) {
    const serviceName = typeof raw.serviceName === 'string' ? raw.serviceName.trim() : '';
    if (!serviceName) return { args: {}, missing: ['serviceName'], errors: [] };
    const r = await resolveService(trx, serviceName);
    if (!r.ok)
      return {
        args: { serviceName },
        missing: [],
        errors: [
          {
            field: 'serviceName',
            code: r.code,
            message:
              r.code === 'AMBIGUOUS'
                ? `Several services match "${serviceName}": ${r.options.join(', ')}. Which one?`
                : `I couldn't find "${serviceName}". Services: ${r.options.join(', ')}.`,
          },
        ],
      };
    return { args: { serviceId: r.svc.id, serviceName: r.svc.name, price: r.svc.price }, missing: [], errors: [] };
  },
  async read(_trx, _claims, args) {
    return `${String(args.serviceName)} is ${mkd(Number(args.price))}.`;
  },
};

// ── update_price ─────────────────────────────────────────────────────
const updatePrice: ActionDef = {
  id: 'update_price',
  app: 'workspace',
  kind: 'write',
  risk: 'medium',
  permission: 'catalog.edit',
  required: ['serviceName', 'price'],
  title: 'Update a service price',
  description: 'Change the price of a named service to a new amount in MKD.',
  async resolve(trx, _claims, raw) {
    const serviceName = typeof raw.serviceName === 'string' ? raw.serviceName.trim() : '';
    const rawPrice = raw.price;
    const price =
      typeof rawPrice === 'number'
        ? rawPrice
        : typeof rawPrice === 'string' && rawPrice.trim()
          ? Number(rawPrice.replace(/[^\d.]/g, ''))
          : undefined;
    const missing: string[] = [];
    if (!serviceName) missing.push('serviceName');
    if (price === undefined) missing.push('price');
    const errors: ResolveResult['errors'] = [];
    if (price !== undefined && (!Number.isFinite(price) || price < 0))
      errors.push({ field: 'price', code: 'BAD_PRICE', message: 'The price must be a positive number.' });
    const args: Record<string, unknown> = {};
    if (price !== undefined) args.price = Math.round(price);
    if (!serviceName) return { args, missing, errors };
    const r = await resolveService(trx, serviceName);
    if (!r.ok) {
      errors.push({
        field: 'serviceName',
        code: r.code,
        message:
          r.code === 'AMBIGUOUS'
            ? `Several services match "${serviceName}": ${r.options.join(', ')}. Which one?`
            : `I couldn't find "${serviceName}". Services: ${r.options.join(', ')}.`,
      });
      return { args: { ...args, serviceName }, missing, errors };
    }
    return {
      args: { ...args, serviceId: r.svc.id, serviceName: r.svc.name, currentPrice: r.svc.price },
      missing,
      errors,
    };
  },
  async preview(_trx, _claims, args) {
    const before = Number(args.currentPrice);
    const after = Number(args.price);
    return {
      changeSet: {
        ops: [
          {
            kind: 'update',
            entity: { type: 'service', id: String(args.serviceId), label: String(args.serviceName) },
            before: { price: before },
            after: { price: after },
          },
        ],
      },
      fingerprint: { serviceId: args.serviceId, price: before },
    };
  },
  async checkFingerprint(trx, _claims, args, fp) {
    const cur = await trx
      .selectFrom('services')
      .select('price')
      .where('id', '=', String(args.serviceId))
      .executeTakeFirst();
    const now = cur?.price;
    if (now === undefined || now === Number(fp.price)) return null;
    return { field: 'price', was: mkd(Number(fp.price)), now: mkd(Number(now)), proposed: mkd(Number(args.price)) };
  },
  async execute(trx, claims, args) {
    const write = await serviceBaseWrite(trx, String(args.serviceId), Number(args.price));
    await updateService(trx, claims, String(args.serviceId), write); // the canonical door
    return {
      message: `${String(args.serviceName)} is now ${mkd(Number(args.price))}.`,
      change: {
        ops: [
          {
            kind: 'update',
            entity: { type: 'service', id: String(args.serviceId), label: String(args.serviceName) },
            before: { price: Number(args.currentPrice) },
            after: { price: Number(args.price) },
          },
        ],
      },
    };
  },
};

const ALL: ActionDef[] = [readServicePrice, updatePrice];

export function registryFor(app: 'workspace' | 'supplier'): ActionDef[] {
  return ALL.filter((a) => a.app === app);
}
export function actionById(id: string): ActionDef | undefined {
  return ALL.find((a) => a.id === id);
}
