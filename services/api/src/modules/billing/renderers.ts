import type { BillingInvoice } from '@velnes/contracts';
import { RENDERER_VERSION as V1, renderInvoicePdf as renderV1, type LogoOutcome, type PdfLogo } from './invoice-pdf.js';

/**
 * The renderer registry (phase 4 follow-up, 2026-10-07). An issued
 * document's canonical PDF is bound to the renderer version that
 * produced it (`billing_invoices.pdf_renderer`, written with the hash,
 * permanent by trigger). A later layout is a NEW version added here;
 * the old one stays, byte for byte, so old documents keep reproducing
 * their hash. A version that is not registered cannot render — that is
 * an integrity failure, never a fallback to the current layout.
 *
 * Rules for a change to the layout or the fonts:
 *   1. copy the renderer to a new module, bump its version string;
 *   2. register it here as CURRENT;
 *   3. never edit a registered version again.
 */
export type Renderer = (doc: BillingInvoice, logo: PdfLogo | null) => Promise<{ buffer: Buffer; logo: LogoOutcome }>;

export const RENDERERS: Readonly<Record<string, Renderer>> = Object.freeze({
  [V1]: renderV1,
});
export const CURRENT_RENDERER_VERSION = V1;

/** The renderer a document is bound to, or the current one for a document not yet hashed. */
export function rendererFor(version: string | null): { version: string; render: Renderer } {
  const v = version ?? CURRENT_RENDERER_VERSION;
  const render = RENDERERS[v];
  if (!render) throw new Error(`renderer ${v} is not registered`);
  return { version: v, render };
}
