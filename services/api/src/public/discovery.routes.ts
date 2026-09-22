import {
  consumerKey,
  SocialLinksSchema,
  BusinessSettingsSchema,
  DiscoveryCategoriesSchema,
  DiscoveryCategoryServicesSchema,
  DiscoverySalonDetailSchema,
  DiscoveryRankedServicesSchema,
  MostChosenSchema,
  SearchRequestSchema,
  SearchResultsSchema,
  type SearchFacets,
  SearchSuggestionsSchema,
  SearchSuggestRequestSchema,
  DiscoverySalonsSchema,
  DiscoveryRecommendedSchema,
  DiscoveryNewestSchema,
  NEWEST_SALON_DAYS,
  DiscoveryViewerSchema,
} from '@velnes/contracts';
import type { DiscoveryServiceCard } from '@velnes/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import { svcVariants } from '../modules/catalog/catalog.service.js';
import { ClientClaimsSchema } from '@velnes/contracts';
import { rank, type RankCandidate } from '../modules/search/rank.js';
import {
  activeSearchConfig,
  mostChosenCategoryIds,
  viewerHistory,
} from '../modules/search/search.service.js';
import { lookupMatches, MIN_QUERY, topMatches } from '../modules/search/lookup.js';
import {
  interpret,
  textRelevanceOf,
  type Interpretation,
  type SearchMatch,
} from '../modules/search/interpret.js';
import { applyFilters, priceTercilesOf } from '../modules/search/filters.js';
import { NOW_WINDOW_MIN, readNow } from '../modules/search/now-intent.js';
import { firstStartWithin } from '../modules/booking/booking.service.js';
import { db, withClient, withTenant } from '../db/index.js';

const ErrorSchema = z.object({ error: z.string(), message: z.string() });

/** The consumer app's key-free read surface. Everything served here is
 *  either the global HQ taxonomy or data a salon publishes through its
 *  marketplace listing switch — nothing tenant-private. */

/** A salon's gallery as the consumer app can use it. Entries may carry
 *  a colour tone and no photograph — the prototype's placeholders, and
 *  what the seed still holds — so they are dropped one by one rather
 *  than letting a single empty entry take the whole gallery with it. */
const GalleryEntrySchema = z
  .object({
    id: z.string(),
    name: z.string().default(''),
    img: z.string().nullable().default(null),
    tone: z.string().nullable().default(null),
    card: z.boolean().optional(),
  })
  .loose();
const GallerySchema = z.array(GalleryEntrySchema).catch([]);
/** Everything the salon put in its gallery, photograph or tile. A
 *  malformed entry is dropped on its own rather than taking the whole
 *  gallery with it. */
const galleryOf = (gallery: unknown) =>
  GallerySchema.parse(gallery)
    .filter((p) => p.img || p.tone)
    .map((p) => ({ id: p.id, name: p.name, img: p.img, tone: p.tone, card: p.card === true }));
/** The card image: the photograph the salon marked for its card, else
 *  the first real photograph, if there is one. */
const cardPhoto = (gallery: unknown) => {
  const photos = galleryOf(gallery).filter((p) => p.img);
  return (photos.find((p) => p.card) ?? photos[0])?.img ?? null;
};

/** The consumer app is first-party: answer velnes hosts and local dev,
 *  nothing else needs these doors cross-origin. */
function openCors(req: FastifyRequest, reply: FastifyReply) {
  const origin = req.headers.origin;
  if (!origin) return;
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return;
  }
  if (host === 'localhost' || host.endsWith('velnes.mk')) {
    reply.header('access-control-allow-origin', origin);
    reply.header('vary', 'origin');
  }
}

interface ListedBusiness {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  description: string;
  gallery: unknown;
  socials: { website: string | null; instagram: string | null; facebook: string | null; tiktok: string | null };
  marketplace: ReturnType<typeof BusinessSettingsSchema.parse>['marketplace'];
  /** When the business entered the platform — HQ approval for a
   *  registered salon. */
  createdAt: Date;
}

/** All businesses that publish a marketplace listing, read under
 *  app.public (the same policy the slug lookup uses). */
async function listedBusinesses(): Promise<ListedBusiness[]> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.public', '1', true)`.execute(trx);
    const rows = await trx
      .selectFrom('businesses')
      .select(['id', 'slug', 'name', 'city', 'address', 'phone', 'description', 'gallery', 'settings', 'socials', 'createdAt'])
      .orderBy('name')
      .execute();
    const out: ListedBusiness[] = [];
    for (const b of rows) {
      if (!b.slug) continue;
      const parsed = BusinessSettingsSchema.safeParse(b.settings ?? {});
      if (!parsed.success || !parsed.data.marketplace.listed) continue;
      out.push({
        id: b.id,
        slug: b.slug,
        name: b.name,
        city: b.city,
        address: b.address,
        phone: b.phone,
        description: b.description,
        gallery: b.gallery,
        socials: socialLinks(b.socials),
        marketplace: parsed.data.marketplace,
        createdAt: new Date(b.createdAt),
      });
    }
    return out;
  });
}

/**
 * A salon's social links as the page shows them: whatever the owner
 * typed — "@slobos", "slobos", a full URL — becomes one link per
 * network, and nothing becomes null. The owner never has to know what
 * a canonical URL is.
 */
export function socialLinks(raw: unknown): ListedBusiness['socials'] {
  const s = SocialLinksSchema.safeParse(raw ?? {});
  const v = s.success ? s.data : SocialLinksSchema.parse({});
  const handle = (x: string) => x.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?[^/]+\//i, '').replace(/\/+$/, '');
  const url = (x: string, host: string) => {
    const t = x.trim();
    if (!t) return null;
    if (/^https?:\/\//i.test(t)) return t;
    if (/^(www\.)?[a-z0-9-]+\.[a-z]{2,}/i.test(t)) return `https://${t}`;
    return `https://${host}/${handle(t)}`;
  };
  const site = v.website.trim();
  return {
    website: !site ? null : /^https?:\/\//i.test(site) ? site : `https://${site}`,
    instagram: url(v.instagram, 'instagram.com'),
    facebook: url(v.facebook, 'facebook.com'),
    tiktok: v.tiktok.trim() ? (/^https?:\/\//i.test(v.tiktok) ? v.tiktok.trim() : `https://tiktok.com/@${handle(v.tiktok)}`) : null,
  };
}

/** Great-circle distance in kilometres — the same arithmetic the app's
 *  own "from you" label uses. */
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(la1) * Math.cos(la2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Where a salon sits on the map: the pin its owner dropped, preferring
 *  a live location's but falling back to any of them — a salon that is
 *  listed but not yet bookable still has a place in the world. */
async function firstPin(tenantId: string): Promise<{ lat: number | null; lng: number | null }> {
  const rows = await withTenant(tenantId, (trx) =>
    trx
      .selectFrom('locations')
      .select(['lat', 'lng', 'lifecycle'])
      .orderBy('name')
      .execute(),
  );
  const pinned = rows.filter((l) => l.lat != null && l.lng != null);
  const best = pinned.find((l) => l.lifecycle === 'ACTIVE') ?? pinned[0];
  return { lat: best?.lat ?? null, lng: best?.lng ?? null };
}

/** Is the salon open to the outside world — does it have an ACTIVE
 *  location? The one bookability question; the website widget is a
 *  separate product and plays no part (Alex, 2026-09-22). */
async function isOpen(tenantId: string): Promise<boolean> {
  const active = await withTenant(tenantId, (trx) =>
    trx.selectFrom('locations').select('id').where('lifecycle', '=', 'ACTIVE').executeTakeFirst(),
  );
  return !!active;
}

/**
 * The categories something is actually published in.
 *
 * A category card is a promise that there is something behind it, so
 * the shelf only carries categories a listed salon really offers an
 * active, online service in. The predicate is deliberately the same one
 * the services door filters on — if the two ever drifted apart, a card
 * would open onto an empty page, which is the one thing the shelf must
 * not do.
 */
async function categoryIdsOnOffer(admitted: ListedBusiness[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const b of admitted) {
    const rows = await withTenant(b.id, (trx) =>
      trx
        .selectFrom('services')
        .select('categoryId')
        .distinct()
        .where('status', '=', 'active')
        .where('online', '=', true)
        .execute(),
    );
    for (const r of rows) if (r.categoryId) out.add(r.categoryId);
  }
  return out;
}

/** What the filters can offer when there is no answer to describe. */
const NO_FACETS: SearchFacets = { categories: [], price: null };

/** Everything typed text becomes, on the way to being ranked. */
export interface TextCandidates {
  matches: SearchMatch[];
  read: Interpretation;
  services: DiscoveryServiceCard[];
  byCategory: RankCandidate[];
  facetCategories: { id: string; name: string; count: number }[];
  /** Salons the text reached that the strict rule would not open on
   *  their own. Offered rather than guessed between. */
  nearMisses: { id: string; slug: string; name: string; city: string | null }[];
}

/**
 * When each candidate can start, if within the next half hour.
 *
 * Asked only when the customer asked for *now*: it is one calendar
 * question per treatment per active location, through the same
 * `bookingCheck` the booking goes through, so a time this promises is
 * a time the salon can keep. Grouped by salon so each tenant context
 * is opened once. Remembered for a short while per treatment: a page
 * that refetches on every filter tap must not re-walk every calendar.
 */
const NOW_TTL_MS = 20_000;
const nowCache = new Map<string, { at: number; value: string | null }>();
async function availableNowOf(
  candidates: RankCandidate[],
  now: Date,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const byBiz = new Map<string, RankCandidate[]>();
  for (const c of candidates) {
    const list = byBiz.get(c.salon.businessId) ?? [];
    list.push(c);
    byBiz.set(c.salon.businessId, list);
  }
  for (const [bizId, list] of byBiz) {
    const todo = list.filter((c) => {
      const hit = nowCache.get(`${bizId}:${c.id}`);
      if (hit && now.getTime() - hit.at < NOW_TTL_MS) {
        out.set(c.id, hit.value);
        return false;
      }
      return true;
    });
    if (!todo.length) continue;
    await withTenant(bizId, async (trx) => {
      const locs = await trx
        .selectFrom('locations')
        .select('id')
        .where('lifecycle', '=', 'ACTIVE')
        .orderBy('name')
        .execute();
      for (const c of todo) {
        let at: string | null = null;
        for (const l of locs) {
          at = await firstStartWithin(trx, {
            locationId: l.id,
            serviceId: c.id,
            windowMin: NOW_WINDOW_MIN,
            now,
          });
          if (at) break;
        }
        out.set(c.id, at);
        nowCache.set(`${bizId}:${c.id}`, { at: now.getTime(), value: at });
      }
    });
  }
  return out;
}

/** Every category with something on offer, as candidates — what "now"
 *  on its own asks for: anything, as long as it can start soon. */
async function allCandidates(): Promise<{
  services: DiscoveryServiceCard[];
  byCategory: RankCandidate[];
  facetCategories: { id: string; name: string; count: number }[];
}> {
  const onOffer = await categoryIdsOnOffer(await admittedBusinesses());
  const seen = new Map<string, DiscoveryServiceCard>();
  const byCategory: RankCandidate[] = [];
  const facetCategories: { id: string; name: string; count: number }[] = [];
  for (const id of onOffer) {
    const got = await gatherCategory(id);
    if (!got) continue;
    const fresh = got.services.filter((svc) => !seen.has(svc.id));
    for (const svc of fresh) seen.set(svc.id, svc);
    if (!fresh.length) continue;
    byCategory.push(...candidatesOf(got.category.id, fresh, got.meta));
    facetCategories.push({ id: got.category.id, name: got.category.name, count: fresh.length });
  }
  return { services: [...seen.values()], byCategory, facetCategories };
}

/**
 * Typed text to candidates — the first half of a search.
 *
 * Exported, and exported for one reason: the HQ Search lab runs text
 * queries too (step 11), and a lab that built its candidates a second
 * way would be explaining a search nobody performs. The instruction for
 * this phase was one search system; this function is where the "one"
 * lives for the text entrance, exactly as `candidatesOf` is for the
 * category one.
 */
export async function textCandidates(q: string): Promise<TextCandidates> {
  const admitted = await admittedBusinesses();
  const matches = await lookupMatches(
    q,
    admitted.map((b) => b.id),
  );
  const read = interpret(matches);

  const bySlug = new Map(admitted.map((b) => [b.slug, b]));
  const nearMisses = topMatches(matches, 'salon', 5).map((m) => ({
    id: m.id,
    slug: m.salonSlug ?? '',
    name: m.display,
    city: bySlug.get(m.salonSlug ?? '')?.city ?? null,
  }));

  // Candidates come from the categories the text meant. A treatment
  // named outright has its own category included by `interpret`, so
  // gathering by category picks it up along with its siblings — which
  // is also the only honest way to fill a page for a query that named
  // exactly one thing.
  //
  // Gathered one category at a time, and kept that way: a candidate has
  // to carry its own category id, or affinity, diversity and the
  // category filter are all reasoning about a category the treatment is
  // not in. "fizio" is four categories at once.
  const seen = new Map<string, DiscoveryServiceCard>();
  const byCategory: RankCandidate[] = [];
  const facetCategories: { id: string; name: string; count: number }[] = [];
  for (const id of read.categoryIds) {
    const got = await gatherCategory(id);
    if (!got) continue;
    const fresh = got.services.filter((svc) => !seen.has(svc.id));
    for (const svc of fresh) seen.set(svc.id, svc);
    if (!fresh.length) continue;
    byCategory.push(...candidatesOf(got.category.id, fresh, got.meta));
    facetCategories.push({ id: got.category.id, name: got.category.name, count: fresh.length });
  }
  return { matches, read, services: [...seen.values()], byCategory, facetCategories, nearMisses };
}

/** The one thing a text query knows that a category card does not. */
export function withTextRelevance(
  candidates: RankCandidate[],
  matches: SearchMatch[],
): RankCandidate[] {
  return candidates.map((c) => ({ ...c, textRelevance: textRelevanceOf(c.id, matches) }));
}

/**
 * At or below this many results, the page is thin enough that the
 * customer went away with nothing — worth knowing about even though the
 * query technically worked.
 */
const LOW_RESULTS = 2;

/**
 * Record a search that found nothing, or nearly nothing — step 10 of
 * docs/SEARCH.md, decision 3.
 *
 * Three properties, all deliberate:
 *
 *  - It **cannot break a search.** Analytics that can take the product
 *    down with it is a worse trade than analytics nobody has. Every
 *    failure here is swallowed, and the customer's results go out.
 *  - It **writes through one SECURITY DEFINER function**, never through
 *    a table grant. This is a key-free public door; an INSERT policy
 *    here would hand a pen to the whole internet.
 *  - It **records nothing about who asked.** No client, no session, no
 *    IP, and a day rather than a moment. The normalization happens in
 *    SQL, so what lands is the same form the index matched against.
 */
async function noteMiss(raw: string, results: number, how: string): Promise<void> {
  if (results > LOW_RESULTS) return;
  try {
    await db.transaction().execute(async (trx) => {
      await sql`select set_config('app.public', '1', true)`.execute(trx);
      await sql`select log_search_miss(${raw}, ${results}, ${how})`.execute(trx);
    });
  } catch {
    // Deliberately silent. Knowing what people could not find is worth
    // having; it is not worth an error page.
  }
}

/** What the ranker needs that a result card does not carry. */
interface CandidateMeta {
  businessId: string;
  createdAt: string;
}

/**
 * Stage 1 admission for consumer service discovery — §5.
 *
 * Three hard rules, and they are hard: a salon that fails one is absent,
 * never merely ranked low.
 *
 *  - It publishes a marketplace listing.
 *  - It has at least one location on lifecycle ACTIVE. Only ACTIVE
 *    locations exist to the outside world, which is the rule the
 *    lifecycle was built to carry; a salon still being set up is not
 *    open, whatever else is true of it.
 *    That ACTIVE location is also what makes it bookable: the consumer
 *    app books through the public doors with the salon's own key
 *    (`salon:<slug>`), so nothing else — in particular no website
 *    widget, a separate product not every salon will have — is asked
 *    for. As an admission rule rather than a weight, because a weight
 *    can always be out-argued by another weight: at proximity 0.30
 *    against availability 0.20 a nearby salon that took no bookings
 *    used to outrank a bookable one further away, which is precisely
 *    the outcome this forbids.
 *
 * One predicate, used by the category shelf and by both service doors,
 * so a card can never open onto a page its own admission rules emptied.
 */
/**
 * The admitted set, remembered briefly.
 *
 * `admittedBusinesses()` asks each listed salon whether it has an ACTIVE
 * location — one query per tenant. That is nothing on a category page
 * and far too much on every keystroke, so the suggestion door reads
 * through this instead.
 *
 * Only the suggestion door. Everything that decides what a customer can
 * actually book keeps calling the uncached version, because a salon that
 * unlists itself should disappear from results immediately, not in
 * fifteen seconds — and the existing tests that toggle a salon and
 * re-query are asserting exactly that.
 *
 * The cost of the cache is that a suggestion can name a salon that
 * unlisted moments ago. Clicking it lands on a page that correctly shows
 * nothing, which is a smaller lie than a search box that stalls.
 */
const ADMITTED_TTL_MS = 15_000;
let admittedCache: { at: number; value: ListedBusiness[] } | null = null;

async function admittedBusinessesCached(): Promise<ListedBusiness[]> {
  if (admittedCache && Date.now() - admittedCache.at < ADMITTED_TTL_MS) return admittedCache.value;
  const value = await admittedBusinesses();
  admittedCache = { at: Date.now(), value };
  return value;
}

/**
 * "Most chosen", memoised — step 9 of docs/SEARCH.md.
 *
 * A far longer TTL than the admission cache, and for the opposite
 * reason: this is a ninety-day aggregate and it iterates every admitted
 * tenant to build, so computing it per request would be absurd, and it
 * cannot meaningfully change within ten minutes anyway.
 */
const MOST_CHOSEN_TTL_MS = 600_000;
let mostChosenCache: { at: number; value: string[] } | null = null;

async function mostChosenCached(): Promise<string[]> {
  if (mostChosenCache && Date.now() - mostChosenCache.at < MOST_CHOSEN_TTL_MS)
    return mostChosenCache.value;
  const admitted = await admittedBusinesses();
  const value = await mostChosenCategoryIds(
    admitted.map((b) => b.id),
    new Date(),
  );
  mostChosenCache = { at: Date.now(), value };
  return value;
}

/** Tests change the world and then expect to see it. */
export function resetAdmittedCache() {
  admittedCache = null;
  mostChosenCache = null;
}

async function admittedBusinesses(): Promise<ListedBusiness[]> {
  const listed = await listedBusinesses();
  const out: ListedBusiness[] = [];
  for (const b of listed) if (await isOpen(b.id)) out.push(b);
  return out;
}

/**
 * Everything published in one category, across every listed salon —
 * the candidates both doors work from.
 *
 * One gatherer, so the ranked and unranked forms can never disagree
 * about who is in the running. They differ only in the order they put
 * them in.
 */
export async function gatherCategory(categoryId: string): Promise<
  | {
      category: { id: string; name: string; cardImage: string | null; icon: string | null };
      services: DiscoveryServiceCard[];
      meta: Map<string, CandidateMeta>;
    }
  | null
> {
  const category = await db
    .selectFrom('serviceCategories')
    .select(['id', 'name', 'cardImage', 'icon'])
    .where('id', '=', categoryId)
    .executeTakeFirst();
  if (!category) return null;

  const listed = await admittedBusinesses();
  // An empty IN list is not valid SQL to build, and "nothing is admitted"
  // is an ordinary state — a category page with nothing on it, not an
  // error. The same guard liveWidgets already uses.
  const created = listed.length
    ? await db.transaction().execute(async (trx) => {
        await sql`select set_config('app.public', '1', true)`.execute(trx);
        return trx
          .selectFrom('businesses')
          .select(['id', 'createdAt'])
          .where(
            'id',
            'in',
            listed.map((b) => b.id),
          )
          .execute();
      })
    : [];
  const createdAt = new Map(created.map((b) => [b.id, b.createdAt]));

  const services: DiscoveryServiceCard[] = [];
  const meta = new Map<string, CandidateMeta>();
  for (const b of listed) {
    const photo = cardPhoto(b.gallery);
    const pin = await firstPin(b.id);
    const rows = await withTenant(b.id, async (trx) => {
      const found = await trx
        .selectFrom('services as s')
        .select(['s.id', 's.name', 's.durationMin', 's.price', 's.sort'])
        .where('s.categoryId', '=', category.id)
        .where('s.status', '=', 'active')
        // POS-only treatments are not on offer to the public.
        .where('s.online', '=', true)
        .orderBy('s.sort')
        .orderBy('s.name')
        .execute();
      // A variant's price can undercut the master's, and the card says
      // "from" when it does. No location here, so this is the salon-wide
      // price before any per-location override.
      return Promise.all(
        found.map(async (s) => {
          const vs = (await svcVariants(trx, s.id, null)).filter((v) => v.active);
          return { ...s, priceFrom: vs.length ? Math.min(...vs.map((v) => v.price)) : null };
        }),
      );
    });
    const show = b.marketplace.showPrices;
    for (const s of rows) {
      services.push({
        id: s.id,
        name: s.name,
        category: category.name,
        durationMin: s.durationMin,
        price: show ? s.price : null,
        priceFrom: show ? s.priceFrom : null,
        salon: {
          slug: b.slug,
          name: b.name,
          city: b.city,
          photo,
          lat: pin.lat,
          lng: pin.lng,
          // Admission already guaranteed this; kept on the card because
          // the app still says it, and a field that silently became
          // constant is a field someone will later misread.
          bookable: true,
          showPrices: show,
        },
        // Learned only when a request asks for *now*; see the doors.
        availableAt: null,
      });
      meta.set(s.id, {
        businessId: b.id,
        createdAt: (createdAt.get(b.id) ?? new Date()).toISOString(),
      });
    }
  }
  return { category, services, meta };
}

/**
 * Result cards as the ranker wants them.
 *
 * Exported because the HQ Search lab ranks the same candidates the real
 * door ranks — a dry run that scored a different shape would be telling
 * whoever is tuning the weights a comfortable lie.
 */
export function candidatesOf(
  categoryId: string,
  services: DiscoveryServiceCard[],
  meta: Map<string, CandidateMeta>,
): RankCandidate[] {
  return services.map((s) => {
    const m = meta.get(s.id)!;
    return {
      id: s.id,
      name: s.name,
      categoryId,
      durationMin: s.durationMin,
      price: s.price,
      priceFrom: s.priceFrom,
      salon: {
        slug: s.salon.slug,
        businessId: m.businessId,
        name: s.salon.name,
        lat: s.salon.lat,
        lng: s.salon.lng,
        bookable: s.salon.bookable,
        createdAt: m.createdAt,
      },
    };
  });
}

/**
 * The signed-in client, if there is one.
 *
 * Deliberately never throws and never answers 401: these are key-free
 * public doors, and being signed out is not an error. A token that has
 * expired or does not parse means the same thing as no token at all —
 * rank without a history.
 */
async function clientClaimsOf(req: FastifyRequest) {
  if (!req.headers.authorization) return null;
  try {
    return ClientClaimsSchema.parse(await req.jwtVerify());
  } catch {
    return null;
  }
}

export async function discoveryRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.addHook('onRequest', async (req, reply) => openCors(req, reply));

  // The Velnes taxonomy as browsable cards, plus the HQ-provided media
  // — but only the part of it that has anything behind it. A salon
  // registering still picks from the whole taxonomy; that is the
  // registration wizard's own door (/registrations/service-categories),
  // so a category nobody serves yet stays choosable there while staying
  // off the shelf here.
  r.route({
    method: 'GET',
    url: '/discovery/categories',
    schema: { response: { 200: DiscoveryCategoriesSchema } },
    handler: async () => {
      const onOffer = await categoryIdsOnOffer(await admittedBusinesses());
      const rows = await db
        .selectFrom('serviceCategories')
        .select(['id', 'name', 'cardImage', 'icon'])
        .orderBy('sort')
        .orderBy('name')
        .execute();
      return { categories: rows.filter((c) => onOffer.has(c.id)) };
    },
  });

  /**
   * "Most chosen" — step 9 of docs/SEARCH.md, and decision 2.
   *
   * What the platform actually books most, in order, from completed
   * visits over ninety days. Empty is a real answer and the common one
   * early on: below the volume floor the phrase is a claim about
   * nothing, and the page shows no label rather than a decorative one.
   *
   * Still filtered by what is on offer *now*: a category nobody
   * publishes in any more was popular once and is a dead end today.
   */
  r.route({
    method: 'GET',
    url: '/discovery/most-chosen',
    schema: { response: { 200: MostChosenSchema } },
    handler: async () => {
      const ranked = await mostChosenCached();
      if (!ranked.length) return { categories: [] };
      const onOffer = await categoryIdsOnOffer(await admittedBusinesses());
      const rows = await db
        .selectFrom('serviceCategories')
        .select(['id', 'name', 'cardImage', 'icon'])
        .where('id', 'in', ranked)
        .execute();
      const byId = new Map(rows.map((c) => [c.id, c]));
      return {
        categories: ranked
          .filter((id) => onOffer.has(id))
          .map((id) => byId.get(id))
          .filter((c): c is NonNullable<typeof c> => !!c),
      };
    },
  });

  /**
   * "Recommended for you" — Alex, 2026-09-23. No random order: a
   * signed-in viewer who allows personalisation is recommended from
   * their own completed bookings and favourites (the same
   * `viewerHistory` the search ranker reads), a guest — or a viewer who
   * switched personalisation off — gets the salons around their
   * position, and with no position at all the listed order as it is.
   * Every card says why it is there.
   */
  r.route({
    method: 'GET',
    url: '/discovery/recommended',
    schema: {
      querystring: z.object({
        lat: z.coerce.number().min(-90).max(90).optional(),
        lng: z.coerce.number().min(-180).max(180).optional(),
      }),
      response: { 200: DiscoveryRecommendedSchema },
    },
    handler: async (req) => {
      const now = new Date();
      const position = req.query.lat != null && req.query.lng != null ? { lat: req.query.lat, lng: req.query.lng } : null;
      const listed = await listedBusinesses();
      // Candidates: open salons, each with the categories it really serves.
      const cards = [];
      for (const b of listed) {
        if (!(await isOpen(b.id))) continue;
        const cats = await withTenant(b.id, (trx) =>
          trx
            .selectFrom('services as s')
            .innerJoin('serviceCategories as c', 'c.id', 's.categoryId')
            .select(['c.id', 'c.name'])
            .distinct()
            .where('s.status', '=', 'active')
            .where('s.online', '=', true)
            .execute(),
        );
        const pin = await firstPin(b.id);
        cards.push({
          card: {
            id: b.id,
            slug: b.slug,
            name: b.name,
            city: b.city,
            address: b.address,
            pitch: b.marketplace.pitch,
            categories: b.marketplace.categories,
            serviceCategories: cats.map((c) => c.name),
            photo: cardPhoto(b.gallery),
            lat: pin.lat,
            lng: pin.lng,
            bookable: true,
          },
          catIds: cats,
          km: position && pin.lat != null && pin.lng != null ? haversineKm(position, { lat: pin.lat, lng: pin.lng }) : null,
        });
      }

      // The viewer, when there is one and they allow it.
      let history: Awaited<ReturnType<typeof viewerHistory>> | null = null;
      const claims = await clientClaimsOf(req);
      if (claims) {
        const me = await withClient(claims.sub, (trx) =>
          trx.selectFrom('clientUsers').select('personalisedResults').where('id', '=', claims.sub).executeTakeFirst(),
        );
        if (me?.personalisedResults) history = await viewerHistory(claims.sub, now);
      }
      const hasHistory =
        !!history &&
        (Object.keys(history.businesses).length > 0 || Object.keys(history.categories).length > 0 || history.favouriteBusinessIds.length > 0 || history.favouriteServiceIds.length > 0);

      // Favourite treatments count for their category, resolved inside
      // their own salon's context — one pass per salon.
      const favCats = new Set<string>();
      if (history?.favouriteServiceIds.length) {
        for (const c of cards) {
          const hits = await withTenant(c.card.id, (trx) =>
            trx.selectFrom('services').select('categoryId').where('id', 'in', history!.favouriteServiceIds).execute(),
          );
          for (const h of hits) if (h.categoryId) favCats.add(h.categoryId);
        }
      }
      const fresh = (iso: string) => Math.exp(-Math.max(0, (now.getTime() - new Date(iso).getTime()) / 86_400_000) / 120);

      type Reason = { kind: 'booked' } | { kind: 'favourite' } | { kind: 'category'; category: string } | { kind: 'nearby'; km: number };
      const scored = cards.map((c) => {
        let score = 0;
        let reason: Reason | null = null;
        if (hasHistory && history) {
          if (history.favouriteBusinessIds.includes(c.card.id)) {
            score += 3;
            reason = { kind: 'favourite' };
          }
          const last = history.businesses[c.card.id];
          if (last) {
            score += 2 * fresh(last);
            reason ??= { kind: 'booked' };
          }
          let best: { name: string; w: number } | null = null;
          for (const cat of c.catIds) {
            const seen = history.categories[cat.id];
            const w = (seen ? 1.5 * fresh(seen) : 0) + (favCats.has(cat.id) ? 1 : 0);
            if (w > 0 && (!best || w > best.w)) best = { name: cat.name, w };
          }
          if (best) {
            score += best.w;
            reason ??= { kind: 'category', category: best.name };
          }
        }
        if (c.km != null) {
          score += Math.max(0, 1 - c.km / 15);
          reason ??= { kind: 'nearby', km: Math.round(c.km * 10) / 10 };
        }
        return { ...c, score, reason };
      });
      const how: 'history' | 'nearby' | 'default' = hasHistory ? 'history' : position ? 'nearby' : 'default';
      const ordered =
        how === 'default'
          ? scored
          : scored.slice().sort((a, b) => b.score - a.score || (a.km ?? Infinity) - (b.km ?? Infinity) || a.card.name.localeCompare(b.card.name));
      return { how, salons: ordered.slice(0, 8).map((c) => ({ ...c.card, reason: c.reason })) };
    },
  });

  /**
   * "Newest to Velnes" — Alex, 2026-09-23: the salons that joined the
   * platform within the last 30 days, newest first. Only open, listed
   * salons; the row is hidden when there are none.
   */
  r.route({
    method: 'GET',
    url: '/discovery/newest',
    schema: { response: { 200: DiscoveryNewestSchema } },
    handler: async () => {
      const since = Date.now() - NEWEST_SALON_DAYS * 86_400_000;
      const fresh = (await listedBusinesses())
        .filter((b) => b.createdAt.getTime() >= since)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const salons = [];
      for (const b of fresh) {
        if (!(await isOpen(b.id))) continue;
        const cats = await withTenant(b.id, (trx) =>
          trx
            .selectFrom('services as s')
            .innerJoin('serviceCategories as c', 'c.id', 's.categoryId')
            .select('c.name')
            .distinct()
            .where('s.status', '=', 'active')
            .where('s.online', '=', true)
            .execute(),
        );
        const pin = await firstPin(b.id);
        salons.push({
          id: b.id,
          slug: b.slug,
          name: b.name,
          city: b.city,
          address: b.address,
          pitch: b.marketplace.pitch,
          categories: b.marketplace.categories,
          serviceCategories: cats.map((c) => c.name),
          photo: cardPhoto(b.gallery),
          lat: pin.lat,
          lng: pin.lng,
          bookable: true,
          joinedAt: b.createdAt.toISOString(),
        });
        if (salons.length === 8) break;
      }
      return { days: NEWEST_SALON_DAYS, salons };
    },
  });

  r.route({
    method: 'GET',
    url: '/discovery/salons',
    schema: { response: { 200: DiscoverySalonsSchema } },
    handler: async () => {
      const listed = await listedBusinesses();
      const salons = [];
      for (const b of listed) {
        const photo = cardPhoto(b.gallery);
        const open = await isOpen(b.id);
        const cats = await withTenant(b.id, (trx) =>
          trx
            .selectFrom('services as s')
            .innerJoin('serviceCategories as c', 'c.id', 's.categoryId')
            .select('c.name')
            .distinct()
            .where('s.status', '=', 'active')
            .execute(),
        );
        const pin = await firstPin(b.id);
        salons.push({
          id: b.id,
          slug: b.slug,
          name: b.name,
          city: b.city,
          address: b.address,
          pitch: b.marketplace.pitch,
          categories: b.marketplace.categories,
          serviceCategories: cats.map((c) => c.name),
          photo,
          lat: pin.lat,
          lng: pin.lng,
          bookable: open,
        });
      }
      return { salons };
    },
  });

  /**
   * Everything offered in one category, across every listed salon —
   * the door behind a category card.
   *
   * What it will not do yet: rank. The order here is deterministic and
   * impersonal — bookable first, then cheapest, then by name — because
   * ordering results by where somebody is and what they have booked
   * before is the §5 search-architecture decision (exposure decay,
   * quality floor, consent modes, the HQ Search lab that tunes them).
   * Inventing a ranking here would put that rule behind a second door.
   */
  r.route({
    method: 'GET',
    url: '/discovery/categories/:id/services',
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 200: DiscoveryCategoryServicesSchema, 404: ErrorSchema },
    },
    handler: async (req, reply) => {
      const found = await gatherCategory(req.params.id);
      if (!found)
        return reply.code(404).send({ error: 'UNKNOWN_CATEGORY', message: 'No category here' });
      const { category, services } = found;

      // The unpersonalised order, and the whole of it: something you can
      // book leads; then the cheaper treatment; then alphabetical, so the
      // list is stable between requests. A salon that hides its prices
      // sorts after the ones that publish them rather than as free.
      const askingPrice = (s: DiscoveryServiceCard) =>
        s.priceFrom ?? s.price ?? Number.POSITIVE_INFINITY;
      const sorted = [...services].sort(
        (a, z) =>
          Number(z.salon.bookable) - Number(a.salon.bookable) ||
          askingPrice(a) - askingPrice(z) ||
          a.name.localeCompare(z.name) ||
          a.salon.name.localeCompare(z.salon.name),
      );

      return { category, services: sorted };
    },
  });

  /**
   * What the customer might mean, while they are still typing — step 4
   * of docs/SEARCH.md.
   *
   * One door for all three kinds, because there is one search bar. A
   * POST rather than a GET for the same reason the ranked door is one:
   * the query is a body, and viewer context will join it here later
   * without ever reaching a URL.
   *
   * Suggestions are not results. This answers "what might you mean";
   * the search door answers "given that, what can you book". They are
   * allowed to contain different kinds of thing, and do.
   */
  r.route({
    method: 'POST',
    url: '/discovery/suggest',
    schema: {
      body: SearchSuggestRequestSchema,
      response: { 200: SearchSuggestionsSchema },
    },
    handler: async (req) => {
      const q = req.body.q.trim();
      // Two characters match half the world; below that, say nothing
      // rather than everything.
      if (q.length < MIN_QUERY)
        return { salons: [], services: [], categories: [], q: req.body.q };

      const admitted = await admittedBusinessesCached();
      const bySlug = new Map(admitted.map((b) => [b.slug, b]));
      const matches = await lookupMatches(
        q,
        admitted.map((b) => b.id),
      );

      return {
        salons: topMatches(matches, 'salon', 5).map((m) => ({
          id: m.id,
          slug: m.salonSlug ?? '',
          name: m.display,
          city: bySlug.get(m.salonSlug ?? '')?.city ?? null,
        })),
        services: topMatches(matches, 'service', 6).map((m) => ({
          id: m.id,
          name: m.display,
          salonName: m.salonName ?? '',
          salonSlug: m.salonSlug ?? '',
          categoryId: m.categoryId ?? null,
        })),
        categories: topMatches(matches, 'category', 4).map((m) => ({
          id: m.id,
          name: m.display,
          salonCount: m.salonCount ?? 0,
        })),
        q: req.body.q,
      };
    },
  });

  /**
   * A submitted search — step 7 of docs/SEARCH.md.
   *
   * Text becomes an interpretation, the interpretation becomes
   * candidates, and from there it is the pipeline Phases A–C already
   * built: the same admission, the same ranker, the same diversity, the
   * same consent. A category card and a typed query are two entrances to
   * one room.
   *
   * The only thing this adds to the ordering is `textRelevance`, which
   * the category door cannot supply and therefore does not carry.
   */
  r.route({
    method: 'POST',
    url: '/discovery/search',
    schema: {
      body: SearchRequestSchema,
      response: { 200: SearchResultsSchema },
    },
    handler: async (req) => {
      // The "when" comes out of the text first: "massage now" is a
      // search for massage, with a flag. The flag in the body means the
      // same thing, so either sets it.
      const when = readNow(req.body.q);
      const wantNow = req.body.now || when.now;
      const q = when.now ? when.q : req.body.q.trim();
      const empty = {
        directSalon: null,
        services: [],
        salons: [],
        rankVersion: 0,
        personalised: false,
        how: 'none' as const,
        ambiguous: false,
        widened: null,
        facets: NO_FACETS,
        hiddenUnpriced: 0,
        nowRequested: wantNow,
        availableNow: 0,
        q: req.body.q,
      };
      // "now" alone is a whole question — anything, as long as it can
      // start soon — and gets every category on offer as its answer.
      const nowOnly = wantNow && q.length < MIN_QUERY;
      if (q.length < MIN_QUERY && !nowOnly) return empty;

      const { matches, read, services, byCategory, facetCategories, nearMisses } = nowOnly
        ? {
            matches: [],
            read: {
              directSalon: null,
              categoryIds: [],
              serviceIds: [],
              how: 'category' as const,
              ambiguous: false,
            },
            nearMisses: [],
            ...(await allCandidates()),
          }
        : await textCandidates(q);

      const cfg = await activeSearchConfig();
      // A salon named outright: the client navigates and never sees a
      // results page. Nothing is ranked, because there is nothing to
      // rank — this is not a search, it is an address.
      if (read.directSalon)
        return { ...empty, directSalon: read.directSalon, how: 'salon' as const, rankVersion: cfg.version };

      if (!services.length) {
        await noteMiss(q, 0, read.how);
        return {
          ...empty,
          salons: nearMisses,
          how: read.how,
          ambiguous: read.ambiguous,
          rankVersion: cfg.version,
        };
      }

      const now = new Date();
      const position =
        req.body.lat != null && req.body.lng != null
          ? { lat: req.body.lat, lng: req.body.lng }
          : null;

      let history = null;
      let personalised = false;
      const claims = await clientClaimsOf(req);
      if (claims) {
        const me = await withClient(claims.sub, (trx) =>
          trx
            .selectFrom('clientUsers')
            .select('personalisedResults')
            .where('id', '=', claims.sub)
            .executeTakeFirst(),
        );
        if (me?.personalisedResults) {
          history = await viewerHistory(claims.sub, now);
          personalised = true;
        }
      }

      const candidates = withTextRelevance(byCategory, matches);

      // Facets describe the answer before anybody narrowed it, so
      // choosing a band does not move the boundaries underneath the
      // person who chose it, and a category can always be unchosen.
      const terciles = priceTercilesOf(candidates);
      const facets = {
        // Nothing to narrow when the query only ever meant one thing.
        categories: facetCategories.length > 1 ? facetCategories : [],
        price: terciles,
      };

      const cut = applyFilters(
        candidates,
        {
          radiusKm: req.body.radiusKm,
          priceBand: req.body.priceBand,
          categoryId: req.body.categoryId,
        },
        position,
        terciles,
        true,
      );
      let widened: 'category' | 'radius' | null = cut.widened;
      // The text named particular treatments and we are showing more
      // than those: their category came too, which is a broadening and
      // is labelled as one.
      if (
        !widened &&
        !req.body.categoryId &&
        read.serviceIds.length &&
        cut.admitted.length > read.serviceIds.length
      )
        widened = 'category';

      // Asked for now: every admitted candidate learns when it could
      // start, and that becomes its availability — and the order.
      const soon = wantNow ? await availableNowOf(cut.admitted, now) : null;
      const admitted = soon
        ? cut.admitted.map((c) => ({ ...c, availableAt: soon.get(c.id) ?? null }))
        : cut.admitted;
      const ranked = rank(admitted, { position, history }, cfg.payload, { now });
      // A page with almost nothing on it is a miss the customer feels,
      // even though the query technically worked. Only recorded when
      // they did not narrow it themselves: an empty answer to "under
      // 700 MKD within 2 km" is a filter doing its job, not a gap in
      // what the platform sells. "now" on its own names no gap either.
      const narrowed = Boolean(req.body.priceBand || req.body.categoryId || req.body.radiusKm);
      if (!narrowed && !nowOnly) await noteMiss(q, ranked.length, read.how);
      const byId = new Map(services.map((s) => [s.id, s]));
      return {
        directSalon: null,
        services: ranked.map((x) => ({
          ...byId.get(x.candidate.id)!,
          availableAt: x.candidate.availableAt ?? null,
        })),
        salons: nearMisses,
        rankVersion: cfg.version,
        personalised,
        how: read.how,
        ambiguous: read.ambiguous,
        widened,
        facets,
        hiddenUnpriced: cut.hiddenUnpriced,
        nowRequested: wantNow,
        availableNow: soon ? [...soon.values()].filter(Boolean).length : 0,
        q: req.body.q,
      };
    },
  });

  /**
   * The ranked form of the same results — §5, Phase B.
   *
   * A POST and not a GET because the viewer's position travels in the
   * body: a precise location in a query string ends up in access logs,
   * proxy logs and referrers. The coordinates arrive already rounded to
   * ~110m, are used to order one response, and are not stored.
   *
   * Authentication is optional on purpose. A signed-out visitor is an
   * ordinary caller and gets a perfectly good page — proximity, value
   * and availability, with the personal component simply absent rather
   * than substituted for.
   */
  r.route({
    method: 'POST',
    url: '/discovery/categories/:id/services',
    schema: {
      params: z.object({ id: z.uuid() }),
      body: DiscoveryViewerSchema,
      response: { 200: DiscoveryRankedServicesSchema, 404: ErrorSchema },
    },
    handler: async (req, reply) => {
      const found = await gatherCategory(req.params.id);
      if (!found)
        return reply.code(404).send({ error: 'UNKNOWN_CATEGORY', message: 'No category here' });
      const { category, services, meta } = found;

      const cfg = await activeSearchConfig();
      const now = new Date();
      const position =
        req.body.lat != null && req.body.lng != null
          ? { lat: req.body.lat, lng: req.body.lng }
          : null;

      // Personalisation is for signed-in clients who have not switched
      // it off. A bad or absent token is not an error here — it simply
      // means there is no history to rank with.
      let history = null;
      let personalised = false;
      const claims = await clientClaimsOf(req);
      if (claims) {
        // Under the client's own context, not the bare handle:
        // client_users carries RLS keyed on app.client_id, so a read
        // without it returns nothing at all — and "nothing" reads
        // exactly like "consent is off", which is how this managed to
        // look like working code.
        const me = await withClient(claims.sub, (trx) =>
          trx
            .selectFrom('clientUsers')
            .select('personalisedResults')
            .where('id', '=', claims.sub)
            .executeTakeFirst(),
        );
        if (me?.personalisedResults) {
          history = await viewerHistory(claims.sub, now);
          personalised = true;
        }
      }

      const candidates = candidatesOf(category.id, services, meta);

      // Admission, through the same function the text door uses. A
      // radius the viewer explicitly set is a hard filter and results
      // outside it are absent rather than demoted; without one, "Near
      // me" only sorts, because a toggle that silently hides a salon
      // 6km away is a bug report waiting to happen.
      //
      // There is no category facet here: a category card already is the
      // category.
      const terciles = priceTercilesOf(candidates);
      const cut = applyFilters(
        candidates,
        { radiusKm: req.body.radiusKm, priceBand: req.body.priceBand, categoryId: null },
        position,
        terciles,
      );

      const soon = req.body.now ? await availableNowOf(cut.admitted, now) : null;
      const admitted = soon
        ? cut.admitted.map((c) => ({ ...c, availableAt: soon.get(c.id) ?? null }))
        : cut.admitted;
      const ranked = rank(admitted, { position, history }, cfg.payload, { now });
      const byId = new Map(services.map((s) => [s.id, s]));
      return {
        category,
        services: ranked.map((r) => ({
          ...byId.get(r.candidate.id)!,
          availableAt: r.candidate.availableAt ?? null,
        })),
        rankVersion: cfg.version,
        personalised,
        facets: { categories: [], price: terciles },
        widened: cut.widened,
        hiddenUnpriced: cut.hiddenUnpriced,
        nowRequested: req.body.now,
        availableNow: soon ? [...soon.values()].filter(Boolean).length : 0,
      };
    },
  });

  r.route({
    method: 'GET',
    url: '/discovery/salons/:slug',
    schema: {
      params: z.object({ slug: z.string().min(1) }),
      response: { 200: DiscoverySalonDetailSchema, 404: ErrorSchema },
    },
    handler: async (req, reply) => {
      const listed = await listedBusinesses();
      const biz = listed.find((b) => b.slug === req.params.slug);
      if (!biz)
        return reply.code(404).send({ error: 'UNKNOWN_SALON', message: 'No salon here' });
      const pin = await firstPin(biz.id);
      const { team, products, locations, addr } = await withTenant(biz.id, async (trx) => {
        const team = biz.marketplace.showTeam
          ? await trx
              .selectFrom('employees')
              .select(['id', 'name', 'roleTitle', 'avatar'])
              .where('status', '=', 'active')
              .where('bookable', '=', true)
              .orderBy('name')
              .execute()
          : [];
        const products = await trx
          .selectFrom('products as p')
          .leftJoin('productCategories as c', 'c.id', 'p.categoryId')
          .select(['p.id', 'p.name', 'p.price'])
          .select('c.name as category')
          .where('p.active', '=', true)
          .where('p.own', '=', false)
          .where('p.price', '>', 0)
          .orderBy('p.name')
          .execute();
        // Every ACTIVE location is bookable here — the consumer app
        // needs no widget, only the salon's own key.
        const locations = (
          await trx
            .selectFrom('locations')
            .select(['id', 'name', 'city', 'address', 'lat', 'lng'])
            .where('lifecycle', '=', 'ACTIVE')
            .orderBy('createdAt')
            .execute()
        ).map((l) => ({
          id: l.id,
          name: l.name,
          city: l.city,
          address: l.address,
          lat: l.lat,
          lng: l.lng,
        }));
        // What we print: the business card's address, else the first
        // location's — a salon always has one somewhere.
        const any = await trx
          .selectFrom('locations')
          .select(['address', 'city'])
          .orderBy('name')
          .executeTakeFirst();
        const addr = {
          address: biz.address ?? any?.address ?? null,
          city: biz.city ?? any?.city ?? null,
        };
        return { team, products, locations, addr };
      });
      return {
        id: biz.id,
        slug: biz.slug,
        name: biz.name,
        city: addr.city,
        address: addr.address,
        phone: biz.phone,
        description: biz.description,
        pitch: biz.marketplace.pitch,
        lat: pin.lat,
        lng: pin.lng,
        categories: biz.marketplace.categories,
        gallery: galleryOf(biz.gallery),
        socials: biz.socials,
        showPrices: biz.marketplace.showPrices,
        team: team.map((e) => ({ id: e.id, name: e.name, role: e.roleTitle, avatar: e.avatar })),
        products,
        bookable: locations.length > 0,
        publishableKey: locations.length ? consumerKey(biz.slug) : null,
        locations,
      };
    },
  });
}
