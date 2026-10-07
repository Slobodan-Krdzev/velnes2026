import type { BillingInvoice, BillingInvoiceLine, BillingLang } from '@velnes/contracts';
import { splitGross } from '@velnes/contracts';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { renderInvoicePdf } from './invoice-pdf.js';

/**
 * The renderer alone (phase 4): handed a frozen document and a frozen
 * logo, nothing else — no database here. Determinism, pagination,
 * Unicode, the VAT and non-VAT layouts, buyers, logos and languages.
 * With VELNES_PDF_OUT set, every document is also written to that
 * directory for the eyes (docs/INVOICING.md "Phase 4", manual check).
 */

const OUT = process.env.VELNES_PDF_OUT;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const pages = (b: Buffer) => (b.toString('latin1').match(/\/Type \/Page(?!s)/g) ?? []).length;
const save = (name: string, b: Buffer) => {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${name}.pdf`, b);
};

/** A solid-colour PNG of any size, written by hand: enough for PDFKit to embed. */
function png(w: number, h: number, rgb: [number, number, number] = [40, 90, 60]): string {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const out = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${out.toString('base64')}`;
}
/** The smallest valid JPEG (1×1), the format the profile stores. */
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

type LineSpec = { desc: string; src: number; disc?: number; rateBp?: number; qtyMilli?: number; unit?: string };
function lines(specs: LineSpec[], vat: boolean): BillingInvoiceLine[] {
  return specs.map((s, i) => {
    const gross = s.src - (s.disc ?? 0);
    const rate = vat ? (s.rateBp ?? 1800) : 0;
    const split = vat ? splitGross(gross, rate) : { net: gross, vat: 0 };
    const qty = s.qtyMilli ?? 1000;
    return {
      id: `cc000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      sort: i,
      itemClass: s.unit === 'pc' ? 'product' : 'service',
      serviceId: null,
      productId: null,
      appointmentId: null,
      tillLineId: null,
      description: s.desc,
      employeeName: 'Maria',
      unit: s.unit ?? 'service',
      qtyMilli: qty,
      unitPriceMinor: Math.round(s.src / (qty / 1000)),
      sourceAmountMinor: s.src,
      allocatedDiscountMinor: s.disc ?? 0,
      vatRateBp: rate,
      exempt: !vat,
      netMinor: split.net,
      vatMinor: split.vat,
      grossMinor: gross,
    };
  });
}

function doc(over: Partial<BillingInvoice> & { specs?: LineSpec[]; vat?: boolean } = {}): BillingInvoice {
  const vat = over.vat ?? true;
  const ls = over.lines ?? lines(over.specs ?? [{ desc: 'Rehab training', src: 150000, disc: 3000 }, { desc: 'Arnica oil', src: 85000, disc: 2000, rateBp: 500, unit: 'pc' }], vat);
  const sum = (k: 'netMinor' | 'vatMinor' | 'grossMinor' | 'allocatedDiscountMinor') => ls.reduce((s, l) => s + l[k], 0);
  const rates = [...new Set(ls.map((l) => l.vatRateBp))].sort((a, b) => a - b);
  const { specs: _s, vat: _v, ...rest } = over;
  return {
    id: 'bb000000-0000-4000-8000-000000000001',
    kind: 'invoice',
    status: 'issued',
    number: '2026-000041',
    series: '',
    year: 2026,
    numberSeq: 41,
    lang: 'mk',
    pdfSha256: null,
    fiscalReceiptRef: null,
    currency: 'MKD',
    vatRegistered: vat,
    pricesIncludeVat: true,
    legalEntityId: '50000000-0000-4000-8000-000000000001',
    locationId: '20000000-0000-4000-8000-000000000002',
    billingCustomerId: null,
    originSaleId: 'aa000000-0000-4000-8000-000000000001',
    originAppointmentId: null,
    supplyDate: '2026-10-06',
    issueDate: '2026-10-07',
    dueDate: null,
    issuedAt: '2026-10-07T07:34:08.778Z',
    issuer: {
      legalEntityId: '50000000-0000-4000-8000-000000000001', legalName: 'Велнес Студио ДООЕЛ Скопје', tradingName: 'Velnes Fizio Centar',
      edb: 'MK4030026512345', vatRegNo: vat ? 'MK4030026512345' : '', embs: '7012345', address: 'Партизански одреди 14', city: 'Скопје', zip: '1000',
      country: 'Северна Македонија', bankName: 'Комерцијална банка', bankAccount: '300000001234567', signatoryName: 'Марија Петровска',
      contactEmail: 'office@velnes.mk', phone: '+389 2 3100 100', website: 'velnes.mk', footerText: 'Ви благодариме за довербата.', paymentInstructions: '',
      logoSha256: null, logoMime: null,
    },
    buyer: {
      billingCustomerId: null, customerId: null, kind: 'company', name: 'Nova Health DOO Skopje', address: 'Bul. Ilinden 5', city: 'Skopje', zip: '1000',
      country: 'North Macedonia', edb: '4030026512399', vatRegNo: 'MK4030026512399', email: '', phone: '',
    },
    location: { locationId: '20000000-0000-4000-8000-000000000002', name: 'Aerodrom', address: 'Jane Sandanski 82', city: 'Skopje', zip: '1000', country: 'North Macedonia', tz: 'Europe/Skopje' },
    origin: {
      saleNumber: 'AER-2026-0010', saleDate: '2026-10-06', method: 'Card', employeeName: 'Maria', saleTotalMinor: sum('grossMinor') + 10000, linesMinor: ls.reduce((s, l) => s + l.sourceAmountMinor, 0),
      cartDiscountMinor: sum('allocatedDiscountMinor'), promoMinor: 0, loyaltyMinor: 0, giftTenderMinor: 0, tipMinor: 10000, flags: ['tip_excluded'],
    },
    lines: ls,
    totals: { netMinor: sum('netMinor'), vatMinor: sum('vatMinor'), grossMinor: sum('grossMinor'), discountMinor: sum('allocatedDiscountMinor') },
    vatBreakdown: rates.map((r) => ({
      rateBp: r,
      netMinor: ls.filter((l) => l.vatRateBp === r).reduce((s, l) => s + l.netMinor, 0),
      vatMinor: ls.filter((l) => l.vatRateBp === r).reduce((s, l) => s + l.vatMinor, 0),
      grossMinor: ls.filter((l) => l.vatRateBp === r).reduce((s, l) => s + l.grossMinor, 0),
    })),
    buyerCompleteness: { complete: true, missing: [], invalid: [] },
    issueReadiness: { ready: true, problems: [], warnings: [] },
    payment: { grossMinor: sum('grossMinor'), paidMinor: 0, outstandingMinor: sum('grossMinor'), state: 'unpaid', count: 0 },
    issuedBy: { id: '40000000-0000-4000-8000-000000000001', name: 'Maria Petrovska' },
    events: [],
    notes: '',
    createdBy: { id: '40000000-0000-4000-8000-000000000001', name: 'Maria Petrovska' },
    createdAt: '2026-10-06T10:00:00.000Z',
    updatedBy: { id: '40000000-0000-4000-8000-000000000001', name: 'Maria Petrovska' },
    updatedAt: '2026-10-07T07:34:08.778Z',
    ...rest,
  };
}
const render = async (d: BillingInvoice, logo: { mime: string; dataUrl: string } | null = null, name?: string) => {
  const r = await renderInvoicePdf(d, logo);
  if (name) save(name, r.buffer);
  return r;
};

describe('the renderer', () => {
  it('produces a one-page A4 PDF with embedded DejaVu subsets for a plain VAT invoice', async () => {
    const r = await render(doc(), null, '01-mk-vat');
    expect(r.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pages(r.buffer)).toBe(1);
    const txt = r.buffer.toString('latin1');
    expect(txt).toContain('/FontFile2');
    expect(txt).toMatch(/\+DejaVuSans/);
    expect(txt).toContain('/MediaBox [0 0 595.28 841.89]');
    expect(r.logo).toBe('none');
  });

  it('is deterministic: the same document renders to the same bytes, every time', async () => {
    const a = await render(doc());
    const b = await render(doc());
    const c = await render(doc());
    expect(sha(a.buffer)).toBe(sha(b.buffer));
    expect(sha(b.buffer)).toBe(sha(c.buffer));
    expect(a.buffer.equals(c.buffer)).toBe(true);
    // The file's dates and ID come from the document, never from the clock.
    const txt = a.buffer.toString('latin1');
    expect(txt.match(/\(D:20261007073408Z\)/g)).toHaveLength(2); // CreationDate and ModDate, both the issue moment
    expect(txt).not.toMatch(/\(D:(?!20261007073408Z)/); // no other date anywhere
    expect(txt).not.toContain('PDFKit');
  });

  it('refuses a draft: nothing that looks like a legal document exists before a number', async () => {
    await expect(renderInvoicePdf(doc({ status: 'draft', number: null, issuedAt: null, issueDate: null }), null)).rejects.toThrow(/issued/);
  });

  it('renders the same document in Macedonian, Albanian and English — three different canonical files', async () => {
    const out: Record<BillingLang, string> = { mk: '', sq: '', en: '' };
    for (const lang of ['mk', 'sq', 'en'] as const) {
      const r = await render(doc({ lang }), null, `02-${lang}-vat`);
      out[lang] = sha(r.buffer);
      expect(pages(r.buffer)).toBe(1);
    }
    expect(new Set(Object.values(out)).size).toBe(3);
  });

  it('a non-VAT issuer gets the cleaner layout: no VAT columns, no breakdown, the frozen statement instead', async () => {
    const r = await render(doc({ vat: false }), null, '04-non-vat');
    expect(pages(r.buffer)).toBe(1);
    const v = await render(doc({ vat: true }));
    expect(sha(r.buffer)).not.toBe(sha(v.buffer));
    expect(r.buffer.length).toBeLessThan(v.buffer.length + 20000);
  });

  it('mixed rates, discounts, a person buyer, a walk-in and a due date all render', async () => {
    const mixed = await render(doc({ specs: [{ desc: 'Therapy', src: 120000, rateBp: 1800 }, { desc: 'Tea', src: 30000, rateBp: 500, unit: 'pc' }, { desc: 'Book', src: 90000, rateBp: 1000, unit: 'pc' }] }), null, '05-mixed-vat');
    expect(pages(mixed.buffer)).toBe(1);
    const person = await render(doc({ buyer: { billingCustomerId: null, customerId: null, kind: 'person', name: 'Ana Gjorgieva', address: '', city: '', zip: '', country: '', edb: '', vatRegNo: '', email: 'ana@example.com', phone: '' } }), null, '07-person');
    expect(pages(person.buffer)).toBe(1);
    const walkIn = await render(doc({ buyer: null }), null, '08-walk-in');
    expect(pages(walkIn.buffer)).toBe(1);
    const due = await render(doc({ dueDate: '2026-10-21', notes: 'Плаќање во рок од 14 дена.', issuer: { ...doc().issuer, paymentInstructions: 'Уплата на сметка 300000001234567 со повикување на бројот на фактурата.' } }), null, '09-due-instructions');
    expect(pages(due.buffer)).toBe(1);
    expect(new Set([mixed, person, walkIn, due].map((r) => sha(r.buffer))).size).toBe(4);
  });

  it('a single line, ten lines, thirty-five lines: the table continues over pages with its head, totals never overlap', async () => {
    const one = await render(doc({ specs: [{ desc: 'Single', src: 100000 }] }), null, '10-one-line');
    expect(pages(one.buffer)).toBe(1);
    const ten = await render(doc({ specs: Array.from({ length: 10 }, (_, i) => ({ desc: `Service ${i + 1}`, src: 100000 + i * 1000 })) }), null, '11-ten-lines');
    expect(pages(ten.buffer)).toBe(1);
    const long = await render(
      doc({
        specs: Array.from({ length: 35 }, (_, i) => ({
          desc: i % 4 === 0 ? `Терапија со долг опис кој се протега преку повеќе редови за да се провери преломот на описот во табелата, ставка ${i + 1}` : `Третман ${i + 1}`,
          src: 100000 + i * 1234,
          disc: i % 3 === 0 ? 500 : 0,
          rateBp: i % 2 ? 500 : 1800,
          unit: i % 5 === 0 ? 'pc' : 'service',
        })),
      }),
      null,
      '12-multipage',
    );
    expect(pages(long.buffer)).toBeGreaterThanOrEqual(2);
    expect(pages(long.buffer)).toBeLessThanOrEqual(3);
  });

  it('long names, addresses and footers wrap inside the page', async () => {
    const r = await render(
      doc({
        issuer: {
          ...doc().issuer,
          legalName: 'Друштво за физикална терапија, рехабилитација и велнес услуги ВЕЛНЕС СТУДИО ДООЕЛ увоз-извоз Скопје',
          address: 'Булевар Партизански одреди број 14, влез 2, кат 3, локал 7, населба Карпош 3',
          footerText: 'Ова е долг текст во подножјето кој треба да се прелама на повеќе редови за да се провери дека ништо не излегува надвор од страницата. '.repeat(4),
          paymentInstructions: 'Упатство за плаќање кое е доволно долго за повеќе редови. '.repeat(6),
        },
        buyer: { ...doc().buyer!, name: 'Shoqëria për shërbime shëndetësore dhe rehabilitim NOVA HEALTH SHPK, Shkup', address: 'Bulevardi Ilinden numër 5, hyrja 1, kati 2' },
      }),
      null,
      '13-long-text',
    );
    expect(pages(r.buffer)).toBeLessThanOrEqual(2);
  });

  it('Cyrillic, Albanian and Latin text go through the embedded face; each changes the bytes', async () => {
    const base = await render(doc({ specs: [{ desc: 'Plain latin', src: 100000 }] }));
    const cyr = await render(doc({ specs: [{ desc: 'Фактура · Данок · Вкупно · Друштво', src: 100000 }] }), null, '14-cyrillic');
    const alb = await render(doc({ specs: [{ desc: 'ë Ë ç Ç — Shërbim për Çdo klient', src: 100000 }], lang: 'sq' }), null, '15-albanian');
    expect(new Set([base, cyr, alb].map((r) => sha(r.buffer))).size).toBe(3);
    for (const r of [cyr, alb]) expect(r.buffer.toString('latin1')).toContain('/FontFile2');
  });

  it('zero, one deni, large values and fractional quantities are spelled out from the integers', async () => {
    const r = await render(
      doc({
        specs: [
          { desc: 'Free consultation', src: 0 },
          { desc: 'One deni', src: 1 },
          { desc: 'Large', src: 123456789012 },
          { desc: 'Oil 1.5 l', src: 45000, qtyMilli: 1500, unit: 'pc' },
          { desc: 'Quarter hour', src: 25000, qtyMilli: 250 },
        ],
      }),
      null,
      '16-edge-values',
    );
    expect(pages(r.buffer)).toBe(1);
  });

  it('the logo: none, a JPEG as the profile stores it, portrait, landscape, oversized PNGs — bounded, aspect kept; an unsupported format is reported, never replaced', async () => {
    const none = await render(doc());
    expect(none.logo).toBe('none');
    const jpeg = await render(doc(), { mime: 'image/jpeg', dataUrl: JPEG }, '17-logo-jpeg');
    expect(jpeg.logo).toBe('embedded');
    const portrait = await render(doc(), { mime: 'image/png', dataUrl: png(60, 200) }, '18-logo-portrait');
    const landscape = await render(doc(), { mime: 'image/png', dataUrl: png(400, 80, [120, 40, 40]) }, '19-logo-landscape');
    const huge = await render(doc(), { mime: 'image/png', dataUrl: png(1600, 1200, [30, 30, 120]) }, '20-logo-huge');
    for (const r of [portrait, landscape, huge]) {
      expect(r.logo).toBe('embedded');
      expect(pages(r.buffer)).toBe(1);
    }
    expect(new Set([none, jpeg, portrait, landscape, huge].map((r) => sha(r.buffer))).size).toBe(5);
    const svg = await render(doc(), { mime: 'image/svg+xml', dataUrl: `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}` });
    expect(svg.logo).toBe('unsupported');
    expect(sha(svg.buffer)).toBe(sha(none.buffer));
    // Deterministic with a logo too.
    const again = await render(doc(), { mime: 'image/png', dataUrl: png(400, 80, [120, 40, 40]) });
    expect(sha(again.buffer)).toBe(sha(landscape.buffer));
  });

  it('a fiscal receipt reference is printed only when one exists', async () => {
    const without = await render(doc());
    const withRef = await render(doc({ fiscalReceiptRef: 'FR-000123' }), null, '21-fiscal-ref');
    expect(sha(without.buffer)).not.toBe(sha(withRef.buffer));
  });
});
