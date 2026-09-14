import { REG_DAYS, type RegProduct, type RegService } from '@velnes/contracts';
import { z } from 'zod';
import { env } from '../../env.js';

/**
 * Phase 2 of AI-onboarding: the Claude extractor. Where the Phase-1
 * parser reads only a page's structured data (JSON-LD/OpenGraph), this
 * hands the page's visible text to the Claude Messages API and asks for
 * a full draft — services and products with prices and durations, each
 * on a category snapped to the HQ taxonomy, plus hours and address.
 *
 * One door, swappable like the insights provider: chosen by
 * env.onboardingProvider. With no ANTHROPIC_API_KEY the call returns
 * null and the caller falls back to the deterministic parser — it never
 * fakes a read. The model only ever sees the salon's own PUBLIC page,
 * never any Velnes data.
 *
 * No SDK dependency: a single guarded `fetch` to the Messages API,
 * fully mockable in tests. The outbound call to api.anthropic.com is a
 * trusted first party — it is NOT the SSRF-guarded fetch of the owner's
 * arbitrary URL (that stays in import.service).
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MAX_TEXT = 14_000; // chars of page text sent to the model
const TIMEOUT_MS = 75_000; // a full price list → dozens of services → longer generation
const MAX_TOKENS = 6000; // headroom for ~40 services + products + hours

/** Strip a page to its visible text: drop script/style/head noise,
 *  turn tags into spaces, collapse whitespace, and truncate. */
export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.slice(0, MAX_TEXT);
}

export interface ExtractInput {
  url: string;
  pageText: string;
  serviceCategories: string[];
  productCategories: string[];
  /** Deterministic baseline, as context and a name/city hint. */
  hints: { name?: string; city?: string; phone?: string };
}

export interface ExtractOutput {
  salon: { name?: string; phone?: string; type?: string };
  legal: { name?: string };
  loc: { street?: string; no?: string; city?: string; zip?: string };
  services: RegService[];
  products: RegProduct[];
  hours: { day: (typeof REG_DAYS)[number]; open: string; close: string; closed: boolean }[];
}

/** The model's raw output — loose; snapped to the strict shapes after. */
const AiExtractSchema = z.object({
  salon: z
    .object({ name: z.string().optional(), phone: z.string().optional(), type: z.string().optional() })
    .partial()
    .optional(),
  legal: z.object({ name: z.string().optional() }).partial().optional(),
  loc: z
    .object({
      street: z.string().optional(),
      no: z.string().optional(),
      city: z.string().optional(),
      zip: z.string().optional(),
    })
    .partial()
    .optional(),
  services: z
    .array(
      z.object({
        name: z.string(),
        category: z.string().optional(),
        durationMin: z.number().optional(),
        price: z.number().optional(),
        currency: z.string().optional(),
      }),
    )
    .default([]),
  products: z
    .array(
      z.object({
        name: z.string(),
        category: z.string().optional(),
        price: z.number().optional(),
        currency: z.string().optional(),
      }),
    )
    .default([]),
  hours: z
    .array(
      z.object({
        day: z.enum(REG_DAYS),
        open: z.string(),
        close: z.string(),
        closed: z.boolean(),
      }),
    )
    .default([]),
});
type AiExtract = z.infer<typeof AiExtractSchema>;

/** Snap a model category to the nearest allowed HQ category. Exact
 *  (case-insensitive) match wins; otherwise the first category, so the
 *  service still lands somewhere the owner can re-file in review — the
 *  extractor never invents a new global taxonomy row. */
function snapCategory(raw: string | undefined, allowed: string[]): string {
  const fallback = allowed[0] ?? 'Other';
  if (!raw) return fallback;
  const hit = allowed.find((c) => c.toLowerCase() === raw.trim().toLowerCase());
  return hit ?? fallback;
}

const clampDuration = (n: number | undefined) => {
  const v = Math.round(n ?? 0);
  return v >= 1 && v <= 24 * 60 ? v : 30; // sane default when unknown
};

/**
 * A price read off a website may be in any currency; the salon's books
 * are in MKD. Convert with reference rates — the denar is officially
 * pegged to the euro (~61.5), so EUR is exact; the others (regional +
 * common tourist currencies) are approximate reference points. The
 * owner reviews every price in the wizard before anything is saved, so
 * an approximate start beats storing "7" when the page meant "€7".
 * A currency we cannot identify is taken as already-MKD, unconverted.
 */
const MKD_PER: Record<string, number> = {
  MKD: 1,
  EUR: 61.5,
  USD: 57,
  GBP: 72,
  CHF: 64,
  RSD: 0.525, // Serbian dinar
  ALL: 0.63, // Albanian lek
  BGN: 31.45, // Bulgarian lev (EUR-pegged)
  BAM: 31.45, // Bosnian convertible mark (EUR-pegged, same as BGN)
  HRK: 8.16, // Croatian kuna (legacy)
  RON: 12.4, // Romanian leu
};
/** Normalise a symbol or code the model returned to an ISO code. */
function normCurrency(raw: string | undefined): string {
  if (!raw) return 'MKD';
  const s = raw.trim().toUpperCase();
  const map: Record<string, string> = {
    '€': 'EUR', EUR: 'EUR', EURO: 'EUR', EUROS: 'EUR',
    $: 'USD', USD: 'USD', 'US$': 'USD',
    '£': 'GBP', GBP: 'GBP',
    'ДЕН': 'MKD', 'ДЕНАР': 'MKD', 'ДЕНАРИ': 'MKD', DEN: 'MKD', MKD: 'MKD',
    CHF: 'CHF', RSD: 'RSD', ALL: 'ALL', LEK: 'ALL', BGN: 'BGN', 'ЛВ': 'BGN',
    KM: 'BAM', BAM: 'BAM', HRK: 'HRK', KN: 'HRK', RON: 'RON', LEI: 'RON',
  };
  return map[s] ?? (/^[A-Z]{3}$/.test(s) ? s : 'MKD');
}
/** Convert a page price + its currency into whole, non-negative MKD. */
function toMkd(amount: number | undefined, currency: string | undefined): number {
  if (!amount || amount <= 0) return 0;
  const rate = MKD_PER[normCurrency(currency)] ?? 1; // unknown → assume MKD
  return Math.max(0, Math.round(amount * rate));
}

/** Build the tool that forces structured output. Categories are enums,
 *  so the model can only choose from the HQ taxonomy. */
function extractTool(serviceCats: string[], productCats: string[]) {
  return {
    name: 'salon_profile',
    description: 'The salon details read from its website.',
    input_schema: {
      type: 'object',
      properties: {
        salon: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            phone: { type: 'string' },
            type: { type: 'string', description: 'e.g. Physiotherapy, Barbershop, Spa' },
          },
        },
        legal: { type: 'object', properties: { name: { type: 'string' } } },
        loc: {
          type: 'object',
          properties: {
            street: { type: 'string' },
            no: { type: 'string' },
            city: { type: 'string' },
            zip: { type: 'string' },
          },
        },
        services: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'category'],
            properties: {
              name: { type: 'string' },
              category: serviceCats.length ? { type: 'string', enum: serviceCats } : { type: 'string' },
              durationMin: { type: 'number', description: 'Minutes; estimate if not stated' },
              price: { type: 'number', description: 'The number shown on the page; 0 if none. Do not convert.' },
              currency: { type: 'string', description: 'ISO 4217 code of the price, e.g. EUR, MKD, USD. Empty if none.' },
            },
          },
        },
        products: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'category'],
            properties: {
              name: { type: 'string' },
              category: productCats.length ? { type: 'string', enum: productCats } : { type: 'string' },
              price: { type: 'number', description: 'The number shown on the page; 0 if none. Do not convert.' },
              currency: { type: 'string', description: 'ISO 4217 code of the price, e.g. EUR, MKD, USD. Empty if none.' },
            },
          },
        },
        hours: {
          type: 'array',
          items: {
            type: 'object',
            required: ['day', 'open', 'close', 'closed'],
            properties: {
              day: { type: 'string', enum: [...REG_DAYS] },
              open: { type: 'string', description: 'HH:MM' },
              close: { type: 'string', description: 'HH:MM' },
              closed: { type: 'boolean' },
            },
          },
        },
      },
    },
  };
}

const SYSTEM = [
  'You extract a wellness/beauty salon profile from the visible text of its own website.',
  'The text may include the salon page plus its linked price list (often a PDF) and',
  'service sub-pages, each marked with a "---" header.',
  'Only report what the text actually supports; never invent services, prices or an address.',
  'Extract INDIVIDUAL services — specific treatments or items — NEVER the category or',
  'section headings that group them. A line like "Facial care" or "Manicure & pedicure"',
  'that has services listed under it is a category: use it only as each service\'s',
  '`category`, and read the real service names (and prices) from the lines beneath it.',
  'On a price list each row is usually "service name … price".',
  'Choose each service and product category from the allowed list given by the tool schema.',
  'Estimate a sensible duration in minutes for each service when the text omits it.',
  'Report each price as the number exactly as shown (do NOT convert it), and set',
  '`currency` to the ISO 4217 code it is shown in (EUR for €, USD for $, GBP for £,',
  'MKD for ден/денари). A bare number with no currency symbol on a price list is the',
  "salon's local currency — MKD for a North Macedonian (.mk) salon.",
  'Use price 0 and an empty currency only when no price is stated anywhere.',
  'Extract at most 40 services and 20 products; if the list is longer, pick the most',
  'representative ones spread across the categories — never return an empty list when',
  'the text clearly contains a price list.',
  'Return your answer only through the salon_profile tool.',
].join(' ');

/** Pull the tool input out of a Messages API response. */
function toolInput(body: unknown): unknown {
  const content = (body as { content?: { type: string; name?: string; input?: unknown }[] })?.content;
  if (!Array.isArray(content)) return null;
  const call = content.find((c) => c.type === 'tool_use' && c.name === 'salon_profile');
  return call?.input ?? null;
}

/** Snap a validated model output onto the strict registration shapes. */
function snap(ai: AiExtract, serviceCats: string[], productCats: string[]): ExtractOutput {
  return {
    salon: {
      ...(ai.salon?.name ? { name: ai.salon.name.slice(0, 80) } : {}),
      ...(ai.salon?.phone ? { phone: ai.salon.phone.slice(0, 40) } : {}),
      ...(ai.salon?.type ? { type: ai.salon.type.slice(0, 40) } : {}),
    },
    legal: ai.legal?.name ? { name: ai.legal.name.slice(0, 120) } : {},
    loc: {
      ...(ai.loc?.street ? { street: ai.loc.street.slice(0, 120) } : {}),
      ...(ai.loc?.no ? { no: ai.loc.no.slice(0, 20) } : {}),
      ...(ai.loc?.city ? { city: ai.loc.city.slice(0, 80) } : {}),
      ...(ai.loc?.zip ? { zip: ai.loc.zip.slice(0, 20) } : {}),
    },
    services: ai.services
      .filter((s) => s.name.trim())
      .slice(0, 40)
      .map((s) => ({
        name: s.name.trim().slice(0, 80),
        category: snapCategory(s.category, serviceCats),
        durationMin: clampDuration(s.durationMin),
        price: toMkd(s.price, s.currency),
      })),
    products: ai.products
      .filter((p) => p.name.trim())
      .slice(0, 40)
      .map((p) => ({
        name: p.name.trim().slice(0, 80),
        category: snapCategory(p.category, productCats),
        price: toMkd(p.price, p.currency),
      })),
    hours: ai.hours.map((h) => ({
      day: h.day,
      open: (h.open || '09:00').slice(0, 5),
      close: (h.close || '17:00').slice(0, 5),
      closed: h.closed,
    })),
  };
}

/**
 * Call Claude to extract a full salon profile. Returns null on any
 * miss — no key, network/timeout error, non-200, or unparseable output
 * — so the caller degrades to the deterministic parser. Never throws.
 */
export async function claudeExtract(input: ExtractInput): Promise<ExtractOutput | null> {
  if (!env.anthropicApiKey) return null; // no key → honest fallback

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const userMsg = [
      `Website: ${input.url}`,
      input.hints.name ? `Known name: ${input.hints.name}` : '',
      input.hints.city ? `Known city: ${input.hints.city}` : '',
      '',
      'Visible page text:',
      input.pageText,
    ]
      .filter(Boolean)
      .join('\n');

    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: env.onboardingModel,
        max_tokens: MAX_TOKENS,
        system: SYSTEM,
        tools: [extractTool(input.serviceCategories, input.productCategories)],
        tool_choice: { type: 'tool', name: 'salon_profile' },
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    if (!res.ok) return null;
    const parsed = AiExtractSchema.safeParse(toolInput(await res.json()));
    if (!parsed.success) return null;
    return snap(parsed.data, input.serviceCategories, input.productCategories);
  } catch {
    return null; // network, timeout, abort — degrade, never fake
  } finally {
    clearTimeout(timer);
  }
}
