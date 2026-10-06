import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';
import { sql } from 'kysely';
import type { Trx } from '../../db/index.js';
import { localIso } from '../scheduling/scheduling.service.js';
import { SupplierError, toOrderContract } from './suppliers.service.js';

/**
 * The invoice as a PDF (Alex, 2026-10-06) — docs/SUPPLIERS.md.
 *
 * A delivered purchase order is invoiced: `ensureInvoiceNo` gives it a
 * number in the supplier's own yearly sequence, once, and `invoicePdf`
 * renders the same document for both sides — supplier and salon, the
 * order's lines with their VAT, net, VAT by rate and the total. Velnes'
 * invoice document, not the fiscal receipt: that waits for the
 * fiscalization decision, and the footer says so.
 *
 * Fonts: DejaVu Sans, bundled — the standard PDF fonts cannot set a
 * Cyrillic salon name.
 */

const require = createRequire(import.meta.url);
const FONT = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
const FONT_BOLD = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');

const den = (n: number) => `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} MKD`;

/** Number a delivered order, once. The caller holds the order's tenant
 *  context (the salon's own step, or a supplier's step that set it). */
export async function ensureInvoiceNo(trx: Trx, orderId: string, now = new Date()): Promise<string> {
  const o = await trx
    .selectFrom('purchaseOrders')
    .select(['id', 'status', 'supplierId', 'invoiceNo'])
    .where('id', '=', orderId)
    .executeTakeFirst();
  if (!o) throw new SupplierError('NOT_FOUND', 'Unknown order');
  if (o.invoiceNo) return o.invoiceNo;
  if (o.status !== 'delivered') throw new SupplierError('WRONG_STATE', 'An order is invoiced when it has been delivered');
  // One sequence per supplier: serialise its numbering.
  await sql`SELECT pg_advisory_xact_lock(hashtext(${o.supplierId}))`.execute(trx);
  const year = now.getFullYear();
  const prefix = `INV-${year}-`;
  const last = await trx
    .selectFrom('purchaseOrders')
    .select(sql<string | null>`max(invoice_no)`.as('m'))
    .where('supplierId', '=', o.supplierId)
    .where('invoiceNo', 'like', `${prefix}%`)
    .executeTakeFirst();
  const n = last?.m ? Number(last.m.slice(prefix.length)) + 1 : 1;
  const invoiceNo = `${prefix}${String(n).padStart(4, '0')}`;
  await trx.updateTable('purchaseOrders').set({ invoiceNo, invoicedAt: now }).where('id', '=', orderId).execute();
  return invoiceNo;
}

export async function invoicePdf(trx: Trx, orderId: string): Promise<{ buffer: Buffer; invoiceNo: string }> {
  const invoiceNo = await ensureInvoiceNo(trx, orderId);
  const order = await toOrderContract(trx, orderId);
  const row = await trx
    .selectFrom('purchaseOrders as o')
    .innerJoin('suppliers as s', 's.id', 'o.supplierId')
    .leftJoin('businesses as b', 'b.id', 'o.tenantId')
    .leftJoin('locations as l', 'l.id', 'o.locationId')
    .select([
      'o.invoicedAt', 'o.createdAt', 'o.track',
      's.name as supplierName', 's.contact as supplierContact', 's.territory as supplierTerritory',
      'b.name as salonName', 'b.vat as salonVat', 'b.address as salonAddress', 'b.city as salonCity',
      'l.name as locationName', 'l.address as locationAddress', 'l.city as locationCity', 'l.zip as locationZip',
    ])
    .where('o.id', '=', orderId)
    .executeTakeFirstOrThrow();
  const legal = await trx
    .selectFrom('legalEntityLocations as ll')
    .innerJoin('legalEntities as le', 'le.id', 'll.legalEntityId')
    .select(['le.name', 'le.taxId', 'le.vatReg'])
    .where('ll.locationId', '=', order.locationId)
    .executeTakeFirst();
  const vatOf = new Map(
    (
      await trx
        .selectFrom('supplierProducts')
        .select(['id', 'vat'])
        .where('id', 'in', order.lines.map((l) => l.supplierProductId))
        .execute()
    ).map((p) => [p.id, Number(p.vat)]),
  );

  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Invoice ${invoiceNo}`, Author: row.supplierName } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  doc.registerFont('Body', FONT).registerFont('Bold', FONT_BOLD);
  const ink = '#2b2118';
  const muted = '#6b625c';
  const line = '#e4ddd6';
  const left = 50;
  const right = 545;

  // ── Head
  doc.font('Bold').fontSize(22).fillColor(ink).text('INVOICE', left, 50);
  doc.font('Body').fontSize(10).fillColor(muted);
  doc.text(invoiceNo, 350, 52, { width: right - 350, align: 'right' });
  doc.text(`Issued ${localIso(row.invoicedAt ?? new Date())}`, 350, 66, { width: right - 350, align: 'right' });
  doc.text(`Order ${order.ref} · placed ${localIso(row.createdAt)}`, 350, 80, { width: right - 350, align: 'right' });
  if (row.track) doc.text(`Tracking ${row.track}`, 350, 94, { width: right - 350, align: 'right' });

  // ── Parties
  const partyTop = 125;
  doc.font('Bold').fontSize(9).fillColor(muted).text('FROM', left, partyTop);
  doc.font('Bold').fontSize(12).fillColor(ink).text(row.supplierName, left, partyTop + 14, { width: 230 });
  doc.font('Body').fontSize(10).fillColor(muted);
  if (row.supplierContact) doc.text(row.supplierContact, { width: 230 });
  if (row.supplierTerritory) doc.text(row.supplierTerritory, { width: 230 });

  doc.font('Bold').fontSize(9).fillColor(muted).text('BILL TO', 320, partyTop);
  doc.font('Bold').fontSize(12).fillColor(ink).text(legal?.name ?? row.salonName ?? 'Salon', 320, partyTop + 14, { width: right - 320 });
  doc.font('Body').fontSize(10).fillColor(muted);
  if (legal?.name && row.salonName && legal.name !== row.salonName) doc.text(row.salonName, { width: right - 320 });
  const taxId = legal?.taxId ?? row.salonVat;
  if (taxId) doc.text(`Tax no. ${taxId}`, { width: right - 320 });
  if (legal?.vatReg) doc.text(`VAT reg. ${legal.vatReg}`, { width: right - 320 });
  const addr = [
    row.locationName && row.locationName !== row.salonName && row.locationName !== legal?.name ? row.locationName : null,
    (row.locationAddress ?? row.salonAddress)?.replace(/\s+/g, ' ').trim(),
    [row.locationZip, row.locationCity ?? row.salonCity].filter(Boolean).join(' '),
  ].filter(Boolean);
  for (const a of addr) doc.text(String(a), { width: right - 320 });

  // ── Lines
  const cols = { n: left, item: left + 22, qty: 330, free: 370, unit: 410, vat: 465, total: 500 };
  let y = Math.max(doc.y, partyTop + 80) + 20;
  const head = (yy: number) => {
    doc.font('Bold').fontSize(9).fillColor(muted);
    doc.text('#', cols.n, yy);
    doc.text('Item', cols.item, yy);
    doc.text('Qty', cols.qty, yy, { width: 35, align: 'right' });
    doc.text('Free', cols.free, yy, { width: 35, align: 'right' });
    doc.text('Unit', cols.unit, yy, { width: 50, align: 'right' });
    doc.text('VAT', cols.vat, yy, { width: 30, align: 'right' });
    doc.text('Total', cols.total, yy, { width: right - cols.total, align: 'right' });
    doc.moveTo(left, yy + 14).lineTo(right, yy + 14).strokeColor(line).lineWidth(0.8).stroke();
  };
  head(y);
  y += 22;
  let net = 0;
  const vatByRate = new Map<number, number>();
  order.lines.forEach((l, i) => {
    if (y > 740) {
      doc.addPage();
      y = 50;
      head(y);
      y += 22;
    }
    const lineNet = l.qty * l.price;
    const rate = vatOf.get(l.supplierProductId) ?? 0;
    net += lineNet;
    vatByRate.set(rate, (vatByRate.get(rate) ?? 0) + (lineNet * rate) / 100);
    doc.font('Body').fontSize(10).fillColor(ink);
    doc.text(String(i + 1), cols.n, y);
    doc.text(l.name, cols.item, y, { width: cols.qty - cols.item - 8, ellipsis: true, lineBreak: false });
    doc.font('Body').fontSize(8).fillColor(muted).text(l.sku, cols.item, y + 12, { width: cols.qty - cols.item - 8, lineBreak: false });
    doc.font('Body').fontSize(10).fillColor(ink);
    doc.text(String(l.qty), cols.qty, y, { width: 35, align: 'right' });
    doc.text(l.free ? String(l.free) : '—', cols.free, y, { width: 35, align: 'right' });
    doc.text(den(l.price).replace(' MKD', ''), cols.unit, y, { width: 50, align: 'right' });
    doc.text(`${rate}%`, cols.vat, y, { width: 30, align: 'right' });
    doc.text(den(lineNet).replace(' MKD', ''), cols.total, y, { width: right - cols.total, align: 'right' });
    y += 26;
    doc.moveTo(left, y - 6).lineTo(right, y - 6).strokeColor(line).lineWidth(0.5).stroke();
  });
  if (order.lines.some((l) => l.free > 0)) {
    doc.font('Body').fontSize(8).fillColor(muted).text('Free units are invoiced at 0 and count for stock.', left, y);
    y += 14;
  }

  // ── Totals (on a fresh page if the lines ran long)
  if (y > 660) {
    doc.addPage();
    y = 50;
  }
  y += 10;
  const totalRow = (label: string, value: string, bold = false) => {
    doc.font(bold ? 'Bold' : 'Body').fontSize(bold ? 12 : 10).fillColor(bold ? ink : muted);
    doc.text(label, 300, y, { width: 140, align: 'right', lineBreak: false });
    doc.text(value, 445, y, { width: right - 445, align: 'right', lineBreak: false });
    y += bold ? 20 : 16;
  };
  totalRow('Net', den(net));
  let vatTotal = 0;
  for (const [rate, amount] of [...vatByRate.entries()].sort((a, b) => a[0] - b[0])) {
    vatTotal += amount;
    totalRow(`VAT ${rate}%`, den(amount));
  }
  doc.moveTo(300, y + 2).lineTo(right, y + 2).strokeColor(ink).lineWidth(0.8).stroke();
  y += 8;
  totalRow('Total incl. VAT', den(net + vatTotal), true);

  // ── Foot — inside the bottom margin, so it never starts a page of its own.
  doc.font('Body').fontSize(8).fillColor(muted);
  doc.text(
    `Issued through Velnes on behalf of ${row.supplierName}. Prices are net; VAT as set per product. This is the Velnes invoice document, not a fiscal receipt — the fiscal receipt follows the fiscalization provider decision.`,
    left,
    760,
    { width: right - left, align: 'center', height: 30 },
  );
  doc.end();
  return { buffer: await done, invoiceNo };
}
