import type { BillingInvoice, BillingLang } from '@velnes/contracts';
import { formatDocDate, formatMinorNumber, formatMoneyMinor, formatPctBp, formatQtyMilli } from '@velnes/contracts';
import { createI18n } from '@velnes/i18n';
import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';

/**
 * The accounting invoice as an A4 PDF (invoicing phase 4, 2026-10-07)
 * — docs/INVOICING.md "Phase 4".
 *
 * A pure presentation layer over the ISSUED document: this function is
 * handed the frozen contract (`BillingInvoice`) and the frozen logo
 * asset it references, and nothing else — no table is read here, no
 * current profile, customer or catalog value can reach the page. No
 * figure is computed: every amount, rate and total is spelled out from
 * the document through `billing-format` (integer arithmetic only).
 *
 * The output is canonical: the same document renders to the same
 * bytes. PDFKit's only sources of variation are the dates in the info
 * dictionary (which also seed the file ID), so both are pinned to the
 * document's own `issuedAt`; fonts are the bundled DejaVu Sans faces,
 * embedded as subsets whose names derive from their order of use.
 * Nothing says when it was rendered.
 *
 * Fonts: DejaVu Sans (regular, bold, oblique), bundled — Macedonian
 * Cyrillic, Albanian Latin (ë, ç) and plain Latin in one face, with no
 * network and no system font involved.
 */

const require = createRequire(import.meta.url);
const FONT = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
const FONT_BOLD = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');
const FONT_OBLIQUE = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Oblique.ttf');

/** Bumped whenever the layout or the fonts change: a document rendered
 *  under one version keeps its hash; a new version must not silently
 *  re-render old documents (see docs/INVOICING.md, Phase 4 deferrals). */
export const RENDERER_VERSION = '2026.10.07-1';

export interface PdfLogo {
  mime: string;
  dataUrl: string;
}
export type LogoOutcome = 'embedded' | 'none' | 'unsupported';

const L = 50;
const R = 545;
const W = R - L;
const TOP = 50;
/** Content stops here; the footer zone (signatory, disclaimer, page) is below. */
const BOTTOM = 738;
const INK = '#1c1c1c';
const MUTED = '#5c5c5c';
const RULE = '#cfcfcf';
const SOFT = '#f3f3f3';

const nonEmpty = (parts: (string | null | undefined)[]) => parts.map((p) => (p ?? '').trim()).filter(Boolean);

/** The logo bytes PDFKit can embed: PNG or JPEG; anything else is reported, never substituted. */
function logoBytes(logo: PdfLogo | null): { buf: Buffer | null; outcome: LogoOutcome } {
  if (!logo) return { buf: null, outcome: 'none' };
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(logo.dataUrl);
  const mime = (m?.[1] ?? logo.mime).toLowerCase();
  if (!m || !['image/png', 'image/jpeg', 'image/jpg'].includes(mime)) return { buf: null, outcome: 'unsupported' };
  return { buf: Buffer.from(m[2]!, 'base64'), outcome: 'embedded' };
}

export async function renderInvoicePdf(doc: BillingInvoice, logo: PdfLogo | null): Promise<{ buffer: Buffer; logo: LogoOutcome }> {
  if (doc.status !== 'issued' || !doc.number || !doc.issuedAt || !doc.issueDate)
    throw new Error('Only an issued document has a canonical PDF');
  const lang: BillingLang = doc.lang;
  const t = createI18n(lang).t;
  const cur = doc.currency;
  const money = (m: number) => formatMinorNumber(m, lang);
  const moneyCur = (m: number) => formatMoneyMinor(m, cur, lang);
  const issuedAt = new Date(doc.issuedAt);
  const vat = doc.vatRegistered;
  const withDiscount = doc.totals.discountMinor > 0 || doc.lines.some((l) => l.allocatedDiscountMinor > 0);

  const pdf = new PDFDocument({
    size: 'A4',
    margins: { top: TOP, bottom: 40, left: L, right: L },
    bufferPages: true,
    info: {
      Title: `${t('pdf.title')} ${doc.number}`,
      Author: doc.issuer.legalName,
      Subject: `${t('pdf.number')} ${doc.number}`,
      Creator: 'Velnes',
      Producer: 'Velnes',
      CreationDate: issuedAt,
      ModDate: issuedAt,
    },
  });
  const chunks: Buffer[] = [];
  pdf.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });
  pdf.registerFont('Body', FONT).registerFont('Bold', FONT_BOLD).registerFont('Oblique', FONT_OBLIQUE);

  let y = TOP;
  const body = (size = 9.5, color = INK) => pdf.font('Body').fontSize(size).fillColor(color);
  const bold = (size = 9.5, color = INK) => pdf.font('Bold').fontSize(size).fillColor(color);
  /** A figure never breaks across lines: one too wide for its cell shrinks (down to 5.5pt) instead. */
  const fit = (text: string, usable: number, size: number) => {
    pdf.fontSize(size);
    const w = pdf.widthOfString(text);
    if (w > usable) pdf.fontSize(Math.max(5, (size * usable) / w - 0.1));
  };
  const rule = (yy: number, x1 = L, x2 = R, color = RULE, width = 0.6) => pdf.moveTo(x1, yy).lineTo(x2, yy).strokeColor(color).lineWidth(width).stroke();

  // ── Header: logo left, title and the document facts right ──────────
  const lg = logoBytes(logo);
  let logoH = 0;
  if (lg.buf) {
    try {
      pdf.image(lg.buf, L, y, { fit: [150, 64] });
      logoH = 64;
    } catch {
      lg.outcome = 'unsupported';
    }
  }
  const hx = 320;
  const hw = R - hx;
  bold(20).text(t('pdf.title'), hx, y, { width: hw, align: 'right', lineBreak: false });
  bold(13).text(doc.number, hx, y + 26, { width: hw, align: 'right', lineBreak: false });
  let hy = y + 48;
  const fact = (label: string, value: string) => {
    body(9, MUTED).text(`${label}: `, hx, hy, { width: hw - 78, align: 'right', lineBreak: false });
    bold(9).text(value, R - 78, hy, { width: 78, align: 'right', lineBreak: false });
    hy += 13;
  };
  fact(t('pdf.issueDate'), formatDocDate(doc.issueDate));
  fact(t('pdf.supplyDate'), formatDocDate(doc.supplyDate));
  if (doc.dueDate) fact(t('pdf.dueDate'), formatDocDate(doc.dueDate));
  y = Math.max(y + logoH, hy) + 18;
  rule(y);
  y += 14;

  // ── Parties: issuer left, buyer and place right ─────────────────────
  const colW = 232;
  const rx = L + colW + 31;
  const block = (x: number, startY: number, draw: () => void) => {
    pdf.x = x;
    pdf.y = startY;
    draw();
    return pdf.y;
  };
  const label = (text: string) => {
    bold(8, MUTED).text(text.toUpperCase(), { width: colW, characterSpacing: 0.4 });
    pdf.moveDown(0.25);
  };
  const line = (text: string, opts: { b?: boolean; muted?: boolean; size?: number } = {}) =>
    (opts.b ? bold(opts.size ?? 9.5) : body(opts.size ?? 9.5, opts.muted ? MUTED : INK)).text(text, { width: colW });
  const kv = (k: string, v: string) => {
    if (v.trim()) line(`${k}: ${v}`, { muted: true });
  };
  const i = doc.issuer;
  const endL = block(L, y, () => {
    label(t('pdf.issuer'));
    line(i.legalName, { b: true, size: 11 });
    if (i.tradingName && i.tradingName !== i.legalName) line(i.tradingName, { muted: true });
    for (const a of nonEmpty([i.address])) line(a);
    const cityLine = nonEmpty([[i.zip, i.city].filter(Boolean).join(' '), i.country]).join(', ');
    if (cityLine) line(cityLine);
    pdf.moveDown(0.3);
    kv(t('pdf.embs'), i.embs);
    kv(t('pdf.edb'), i.edb);
    if (vat) kv(t('pdf.vatNo'), i.vatRegNo);
    const contact = nonEmpty([i.contactEmail, i.phone, i.website]).join(' · ');
    if (contact) kv(t('pdf.contact'), contact);
    if (i.bankAccount) {
      pdf.moveDown(0.3);
      kv(t('pdf.bank'), nonEmpty([i.bankName]).join(''));
      kv(t('pdf.account'), i.bankAccount);
    }
  });
  const b = doc.buyer;
  const endR = block(rx, y, () => {
    label(t('pdf.buyer'));
    if (!b) line(t('inv.walkIn'), { b: true, size: 11 });
    else {
      line(b.name, { b: true, size: 11 });
      for (const a of nonEmpty([b.address])) line(a);
      const cityLine = nonEmpty([[b.zip, b.city].filter(Boolean).join(' '), b.country]).join(', ');
      if (cityLine) line(cityLine);
      if (b.kind === 'company' || b.edb) {
        pdf.moveDown(0.3);
        kv(t('pdf.edb'), b.edb);
        kv(t('pdf.vatNo'), b.vatRegNo);
      }
    }
    pdf.moveDown(0.8);
    label(t('pdf.place'));
    line(doc.location.name, { b: true });
    const place = nonEmpty([doc.location.address, [doc.location.zip, doc.location.city].filter(Boolean).join(' ')]).join(', ');
    if (place) line(place, { muted: true });
  });
  y = Math.max(endL, endR) + 18;

  // ── Lines ────────────────────────────────────────────────────────────
  type Col = { key: string; w: number; align: 'left' | 'right'; head: string };
  const cols: Col[] = vat
    ? [
        { key: 'n', w: 20, align: 'left', head: '#' },
        { key: 'desc', w: withDiscount ? 110 : 156, align: 'left', head: t('pdf.colDesc') },
        { key: 'qty', w: 28, align: 'right', head: t('pdf.colQty') },
        { key: 'unit', w: 40, align: 'left', head: t('pdf.colUnit') },
        { key: 'price', w: 56, align: 'right', head: t('pdf.colUnitPrice') },
        ...(withDiscount ? [{ key: 'disc', w: 46, align: 'right', head: t('pdf.colDiscount') } as Col] : []),
        { key: 'net', w: 56, align: 'right', head: t('pdf.colNet') },
        { key: 'rate', w: 36, align: 'right', head: t('pdf.colVatRate') },
        { key: 'vat', w: 42, align: 'right', head: t('pdf.colVat') },
        { key: 'gross', w: 61, align: 'right', head: t('pdf.colGross') },
      ]
    : [
        { key: 'n', w: 20, align: 'left', head: '#' },
        { key: 'desc', w: withDiscount ? 216 : 266, align: 'left', head: t('pdf.colDesc') },
        { key: 'qty', w: 34, align: 'right', head: t('pdf.colQty') },
        { key: 'unit', w: 48, align: 'left', head: t('pdf.colUnit') },
        { key: 'price', w: 70, align: 'right', head: t('pdf.colUnitPrice') },
        ...(withDiscount ? [{ key: 'disc', w: 50, align: 'right', head: t('pdf.colDiscount') } as Col] : []),
        { key: 'gross', w: 57, align: 'right', head: t('pdf.colAmount') },
      ];
  const xs: Record<string, number> = {};
  let cx = L;
  for (const c of cols) {
    xs[c.key] = cx;
    cx += c.w;
  }
  const GAP = 4;
  const cell = (c: Col, yy: number, text: string, font: 'Body' | 'Bold' = 'Body', color = INK) => {
    pdf.font(font).fontSize(8.5).fillColor(color);
    const x = xs[c.key]! + (c.key === 'unit' ? GAP : 0);
    const usable = c.w - GAP;
    if (c.key !== 'desc') fit(text, usable, 8.5);
    pdf.text(text, x, yy, { width: usable, align: c.align, lineBreak: c.key === 'desc' });
  };
  const tableHead = () => {
    pdf.rect(L, y - 3, W, 16).fill(SOFT);
    for (const c of cols) cell(c, y, c.head, 'Bold', MUTED);
    y += 16;
    rule(y - 1, L, R, RULE, 0.8);
    y += 4;
  };
  const newPage = () => {
    pdf.addPage();
    y = TOP;
  };
  const ensure = (h: number, redrawHead = false) => {
    if (y + h > BOTTOM) {
      newPage();
      if (redrawHead) tableHead();
    }
  };
  body(8, MUTED).text(t('pdf.amountsIn', { currency: cur }), L, y, { width: W, align: 'right', lineBreak: false });
  y += 12;
  tableHead();
  const descCol = cols.find((c) => c.key === 'desc')!;
  doc.lines.forEach((l, idx) => {
    pdf.font('Body').fontSize(8.5);
    const h = Math.max(10, pdf.heightOfString(l.description, { width: descCol.w - GAP }));
    ensure(h + 8, true);
    const unit = l.unit === 'service' ? t('pdf.unit.service') : l.unit === 'pc' ? t('pdf.unit.pc') : l.unit;
    cell(cols[0]!, y, String(idx + 1), 'Body', MUTED);
    cell(descCol, y, l.description);
    cell(cols.find((c) => c.key === 'qty')!, y, formatQtyMilli(l.qtyMilli, lang));
    cell(cols.find((c) => c.key === 'unit')!, y, unit, 'Body', MUTED);
    cell(cols.find((c) => c.key === 'price')!, y, money(l.unitPriceMinor));
    if (withDiscount) cell(cols.find((c) => c.key === 'disc')!, y, l.allocatedDiscountMinor ? `-${money(l.allocatedDiscountMinor)}` : '');
    if (vat) {
      cell(cols.find((c) => c.key === 'net')!, y, money(l.netMinor));
      cell(cols.find((c) => c.key === 'rate')!, y, formatPctBp(l.vatRateBp, lang));
      cell(cols.find((c) => c.key === 'vat')!, y, money(l.vatMinor));
    }
    cell(cols.find((c) => c.key === 'gross')!, y, money(l.grossMinor), 'Bold');
    y += h + 7;
    rule(y - 3, L, R, RULE, 0.4);
  });
  y += 10;

  // ── Totals (kept together) ───────────────────────────────────────────
  const tx = 300;
  const tw = R - tx;
  const totalsH = 22 + (vat ? 18 + 14 * doc.vatBreakdown.length + 10 : 0) + (withDiscount ? 15 : 0) + (vat ? 30 : 0) + 24 + (vat ? 0 : 30);
  ensure(totalsH);
  const trow = (k: string, v: string, opts: { b?: boolean; size?: number } = {}) => {
    const size = opts.size ?? 9.5;
    const vw = opts.b ? 150 : 118;
    (opts.b ? bold(size) : body(size, MUTED)).text(k, tx, y, { width: tw - vw - 2, align: 'right', lineBreak: false });
    if (opts.b) bold(size);
    else body(size);
    fit(v, vw, size);
    pdf.text(v, R - vw, y, { width: vw, align: 'right', lineBreak: false });
    y += size + 6;
  };
  if (vat) {
    // The frozen breakdown, row for row: rate · taxable base · VAT · gross.
    const bx = [tx, tx + 40, tx + 130, tx + 188];
    const bw = [40, 90, 58, R - (tx + 188)];
    pdf.rect(tx, y - 3, tw, 15).fill(SOFT);
    bold(8, MUTED);
    pdf.text(t('pdf.vatRate'), bx[0]!, y, { width: bw[0], lineBreak: false });
    pdf.text(t('pdf.taxableBase'), bx[1]!, y, { width: bw[1], align: 'right', lineBreak: false });
    pdf.text(t('pdf.vatAmount'), bx[2]!, y, { width: bw[2], align: 'right', lineBreak: false });
    pdf.text(t('pdf.colGross'), bx[3]!, y, { width: bw[3], align: 'right', lineBreak: false });
    y += 15;
    for (const r of doc.vatBreakdown) {
      const cells: [string, number, number][] = [[formatPctBp(r.rateBp, lang), bx[0]!, bw[0]!], [money(r.netMinor), bx[1]!, bw[1]!], [money(r.vatMinor), bx[2]!, bw[2]!], [money(r.grossMinor), bx[3]!, bw[3]!]];
      cells.forEach(([text, x, w], ci) => {
        body(8.5);
        fit(text, w - 4, 8.5);
        pdf.text(text, x, y, { width: w - 4, align: ci === 0 ? 'left' : 'right', lineBreak: false });
      });
      y += 14;
    }
    y += 8;
  }
  if (withDiscount) trow(t('pdf.discounts'), `-${moneyCur(doc.totals.discountMinor)}`);
  if (vat) {
    trow(t('pdf.netTotal'), moneyCur(doc.totals.netMinor));
    trow(t('pdf.vatTotal'), moneyCur(doc.totals.vatMinor));
  }
  rule(y, tx, R, INK, 0.9);
  y += 7;
  trow(t('pdf.total'), moneyCur(doc.totals.grossMinor), { b: true, size: 12.5 });
  if (!vat) {
    y += 2;
    body(8, MUTED).text(t('inv.notVatRegistered'), tx, y, { width: tw, align: 'right' });
    y = pdf.y + 4;
  }
  y += 10;

  // ── Payment: tender facts, bank, instructions — information, not value ─
  const para = (text: string, opts: { b?: boolean; muted?: boolean; size?: number; width?: number } = {}) => {
    const w = opts.width ?? W;
    if (opts.b) bold(opts.size ?? 9);
    else body(opts.size ?? 9, opts.muted ? MUTED : INK);
    const h = pdf.heightOfString(text, { width: w });
    ensure(h + 2);
    pdf.text(text, L, y, { width: w });
    y = pdf.y + 2;
  };
  const section = (title: string) => {
    ensure(26);
    bold(8, MUTED).text(title.toUpperCase(), L, y, { width: W, characterSpacing: 0.4 });
    y = pdf.y + 3;
  };
  section(t('pdf.payment'));
  if (doc.origin?.method) para(`${t('pdf.paymentMethod')}: ${doc.origin.method}`);
  if (doc.origin && doc.origin.giftTenderMinor > 0) para(`${t('pdf.giftTender')}: ${moneyCur(doc.origin.giftTenderMinor)}`);
  if (doc.dueDate) para(`${t('pdf.dueDate')}: ${formatDocDate(doc.dueDate)}`);
  if (i.bankAccount) para(`${t('pdf.bank')}: ${nonEmpty([i.bankName, i.bankAccount]).join(' · ')}`);
  if (doc.origin) para(t('pdf.saleRef', { number: doc.origin.saleNumber, date: formatDocDate(doc.origin.saleDate) }), { muted: true, size: 8 });
  if (i.paymentInstructions.trim()) {
    y += 4;
    section(t('pdf.paymentInstructions'));
    para(i.paymentInstructions.trim());
  }
  if (doc.notes.trim()) {
    y += 4;
    section(t('pdf.notes'));
    para(doc.notes.trim());
  }
  if (i.footerText.trim()) {
    y += 6;
    para(i.footerText.trim(), { muted: true, size: 8 });
  }

  // ── Footer on every page: signatory, page, disclaimer, fiscal reference ─
  const range = pdf.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++) {
    pdf.switchToPage(p);
    let fy = BOTTOM + 12;
    rule(fy, L, R, RULE, 0.6);
    fy += 6;
    body(8, MUTED).text(i.signatoryName ? `${t('pdf.signatory')}: ${i.signatoryName}` : '', L, fy, { width: W - 120, lineBreak: false });
    body(8, MUTED).text(t('pdf.page', { n: p - range.start + 1, total: range.count }), R - 120, fy, { width: 120, align: 'right', lineBreak: false });
    fy += 12;
    pdf.font('Oblique').fontSize(8).fillColor(INK).text(t('pdf.disclaimer'), L, fy, { width: W, lineBreak: false });
    fy += 12;
    if (doc.fiscalReceiptRef) body(8, MUTED).text(`${t('pdf.fiscalRef')} ${doc.fiscalReceiptRef}`, L, fy, { width: W, lineBreak: false });
    body(7.5, MUTED).text(`${doc.issuer.legalName} · ${t('pdf.number')} ${doc.number}`, L + 180, fy, { width: W - 180, align: 'right', lineBreak: false, ellipsis: true });
  }
  pdf.end();
  return { buffer: await done, logo: lg.outcome };
}
