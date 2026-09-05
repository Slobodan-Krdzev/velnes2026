import type { FlightdeckOpportunity } from '@velnes/contracts';
import { env } from '../../env.js';

/**
 * The insights engine behind the flightdeck's opportunities and Kumo
 * strip. One door, two providers — chosen by env.insightProvider, the
 * same swappable shape as mailTransport:
 *
 *   'rules'  → derive everything from the salon's own signals. Real,
 *              honest, no external call. This is the default.
 *   'claude' → hand the same signals to the Claude Messages API for
 *              ranking, phrasing and a novel Kumo insight. Prepared
 *              below but inert until an ANTHROPIC_API_KEY is set; with
 *              no key it degrades to 'rules' rather than fake an answer.
 *
 * The provider only ever sees AGGREGATED signals — counts, sums, a
 * weekday — never raw customer rows. That keeps the eventual model
 * call free of personal data by construction.
 */

export interface InsightSignals {
  /** Regulars (≥3 past visits) with no appointment in `sinceDays`. */
  quietRegulars: { count: number; value: number; sinceDays: number };
  /** Non-own products sitting on the shelf with stock but no recent sale. */
  slowProducts: { count: number; value: number; topNames: string[] };
  /** How far below the team's own average product-attach the floor sits. */
  upsell: { gap: number; value: number } | null;
  /** The historically quietest weekday, if the calendar shows one. */
  quietestWeekday: string | null;
}

export interface InsightResult {
  opportunities: FlightdeckOpportunity[];
  kumo: { text: string; actionTarget: string; ai: boolean } | null;
  provider: 'rules' | 'claude';
}

const money = (n: number) => `${n.toLocaleString('en-US').replace(/,/g, '.')} ден`;

/** The rules provider: signals → cards, deterministically. Only a
 *  signal with real weight becomes a card; the strongest lead. */
export function rulesInsights(s: InsightSignals): InsightResult {
  const opps: FlightdeckOpportunity[] = [];

  if (s.quietRegulars.count > 0)
    opps.push({
      key: 'quiet-regulars',
      icon: 'users',
      title: 'Bring back quiet regulars',
      detail: `${s.quietRegulars.count} regular${s.quietRegulars.count === 1 ? '' : 's'} who used to come in have not booked in over ${s.quietRegulars.sinceDays} days.`,
      value: s.quietRegulars.value,
      actionLabel: 'See who they are',
      actionTarget: 'customers',
    });

  if (s.upsell && s.upsell.value > 0)
    opps.push({
      key: 'upsell',
      icon: 'pulse',
      title: 'Lift treatment upsells',
      detail: `The floor sells ${money(s.upsell.gap)} per treatment below the team's own average.`,
      value: s.upsell.value,
      actionLabel: 'Open the numbers',
      actionTarget: 'reports',
    });

  if (s.slowProducts.count > 0)
    opps.push({
      key: 'slow-products',
      icon: 'bottle',
      title: 'Promote slow products',
      detail: `${s.slowProducts.count} product${s.slowProducts.count === 1 ? '' : 's'} with margin ${s.slowProducts.count === 1 ? 'is' : 'are'} sitting on the shelf: ${s.slowProducts.topNames.join(', ')}.`,
      value: s.slowProducts.value,
      actionLabel: 'View the products',
      actionTarget: 'catalog',
    });

  opps.sort((a, b) => b.value - a.value);

  const kumo = s.quietestWeekday
    ? {
        text: `${s.quietestWeekday} mornings are historically your quietest hours. Customers you have not seen in a while have filled mornings like these before — a targeted offer is worth a look.`,
        actionTarget: 'marketing',
        ai: false,
      }
    : null;

  return { opportunities: opps.slice(0, 3), kumo, provider: 'rules' };
}

/**
 * The Claude provider — prepared, not yet live. The moment a key is
 * provisioned this builds the prompt from the same aggregated signals
 * and asks the model for ranked opportunities + one Kumo insight,
 * returning them in the exact InsightResult shape. Until then it
 * returns null so the caller falls back to rules; it never invents.
 */
export async function claudeInsights(s: InsightSignals): Promise<InsightResult | null> {
  if (!env.anthropicApiKey) return null; // no key → honest fallback, never fake

  // ── Ready for wiring (needs the @anthropic-ai/sdk dependency and the
  //    ANTHROPIC_API_KEY). The contract below is intentionally fixed so
  //    the rest of the flightdeck never changes when this turns on:
  //
  //   const client = new Anthropic({ apiKey: env.anthropicApiKey });
  //   const msg = await client.messages.create({
  //     model: 'claude-sonnet-5',
  //     max_tokens: 1024,
  //     system: INSIGHTS_SYSTEM_PROMPT,          // "You are Kumo, …"
  //     messages: [{ role: 'user', content: JSON.stringify(s) }],
  //     tools: [INSIGHTS_TOOL],                   // forces structured output
  //     tool_choice: { type: 'tool', name: 'insights' },
  //   });
  //   const out = extractToolResult(msg);         // { opportunities, kumo }
  //   return { ...out, provider: 'claude' };
  //
  // The signals `s` are already aggregated (no PII), so the prompt
  // carries no personal data. Cache the result per tenant per day.
  void s;
  return null;
}

/** Pick the provider from env; a claude miss degrades to rules. */
export async function computeInsights(s: InsightSignals): Promise<InsightResult> {
  if (env.insightProvider === 'claude') {
    const ai = await claudeInsights(s);
    if (ai) return ai;
  }
  return rulesInsights(s);
}
