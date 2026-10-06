import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.js';
import { setAccessToken } from '@velnes/client';

/** Accounting invoices (phase 2): the list of drafts and the preview of
 *  one — every figure the server's, rendered as the document will read. */
const LOC = '20000000-0000-4000-8000-000000000001';
const LE = '50000000-0000-4000-8000-000000000001';
const SALE = 'aa000000-0000-4000-8000-000000000001';
const D1 = 'bb000000-0000-4000-8000-000000000001';
const D2 = 'bb000000-0000-4000-8000-000000000002';

const me = {
  id: '40000000-0000-4000-8000-000000000001', name: 'Maria Petrovska', access: 'owner', roleId: '30000000-0000-4000-8000-000000000001',
  locationIds: [LOC], email: 'maria@velnes.mk', tenantId: '10000000-0000-4000-8000-000000000001', lang: 'en',
  perms: { 'billing.read': 'business', 'billing.create': 'business', 'pos.checkout': 'business', 'pos.view_invoices': 'business' },
};
const issuer = { legalEntityId: LE, legalName: 'Velnes Studio DOOEL Skopje', tradingName: 'Velnes Fizio Centar', edb: 'MK4030026512345', vatRegNo: 'MK4030026512345', embs: '7012345', address: 'Partizanski Odredi 14', city: 'Skopje', zip: '1000', country: 'North Macedonia', bankName: 'Komercijalna', bankAccount: '300000001234567', signatoryName: 'Maria Petrovska', contactEmail: '', phone: '', website: '', footerText: '', paymentInstructions: '' };
const location = { locationId: LOC, name: 'Centar', address: 'Makedonija 12', city: 'Skopje', zip: '1000', country: 'North Macedonia', tz: 'Europe/Skopje' };
const line = (id: string, description: string, src: number, disc: number, rateBp: number, registered: boolean) => {
  const gross = src - disc;
  const vat = registered ? Math.round((gross * rateBp) / (10000 + rateBp)) : 0;
  return { id, sort: 0, itemClass: 'service', serviceId: null, productId: null, appointmentId: null, tillLineId: null, description, employeeName: 'Maria', unit: 'service', qtyMilli: 1000, unitPriceMinor: src, sourceAmountMinor: src, allocatedDiscountMinor: disc, vatRateBp: registered ? rateBp : 0, exempt: !registered, netMinor: gross - vat, vatMinor: vat, grossMinor: gross };
};
const draftOf = (id: string, registered: boolean) => {
  const lines = [line('cc000000-0000-4000-8000-000000000001', 'Rehab training', 150000, 3000, 1800, registered), line('cc000000-0000-4000-8000-000000000002', 'Arnica oil', 85000, 2000, 500, registered)];
  const sum = (k: 'netMinor' | 'vatMinor' | 'grossMinor') => lines.reduce((s, l) => s + l[k], 0);
  const rates = [...new Set(lines.map((l) => l.vatRateBp))];
  return {
    id, kind: 'invoice', status: 'draft', number: null, currency: 'MKD', vatRegistered: registered, pricesIncludeVat: true,
    legalEntityId: LE, locationId: LOC, billingCustomerId: null, originSaleId: SALE, originAppointmentId: null,
    supplyDate: '2026-10-06', issueDate: null, dueDate: null, issuedAt: null, issuer, location,
    buyer: { billingCustomerId: null, customerId: null, kind: 'company', name: 'Nova Health DOO', address: 'Bul. Ilinden 5', city: 'Skopje', zip: '1000', country: 'North Macedonia', edb: '', vatRegNo: '', email: '', phone: '' },
    origin: { saleNumber: 'CEN-2026-0413', saleDate: '2026-10-06', method: 'Card', employeeName: 'Maria', saleTotalMinor: sum('grossMinor') + 10000, linesMinor: 235000, cartDiscountMinor: 5000, promoMinor: 0, loyaltyMinor: 0, giftTenderMinor: 0, tipMinor: 10000, flags: ['tip_excluded'] },
    lines,
    totals: { netMinor: sum('netMinor'), vatMinor: sum('vatMinor'), grossMinor: sum('grossMinor'), discountMinor: 5000 },
    vatBreakdown: rates.map((r) => ({ rateBp: r, netMinor: lines.filter((l) => l.vatRateBp === r).reduce((s, l) => s + l.netMinor, 0), vatMinor: lines.filter((l) => l.vatRateBp === r).reduce((s, l) => s + l.vatMinor, 0), grossMinor: lines.filter((l) => l.vatRateBp === r).reduce((s, l) => s + l.grossMinor, 0) })),
    buyerCompleteness: { complete: false, missing: ['edb'], invalid: [] },
    notes: '', createdBy: { id: me.id, name: 'Maria Petrovska' }, createdAt: '2026-10-06T10:00:00.000Z', updatedBy: { id: me.id, name: 'Maria Petrovska' }, updatedAt: '2026-10-06T10:00:00.000Z',
  };
};
const row = (d: ReturnType<typeof draftOf>) => ({ id: d.id, kind: d.kind, status: d.status, number: d.number, currency: d.currency, vatRegistered: d.vatRegistered, legalEntityId: LE, locationId: LOC, billingCustomerId: null, originSaleId: SALE, supplyDate: d.supplyDate, issueDate: null, dueDate: null, totals: d.totals, createdAt: d.createdAt, updatedAt: d.updatedAt, buyerName: d.buyer?.name ?? '', locationName: 'Centar', saleNumber: 'CEN-2026-0413' });

function mockApi(calls: { method: string; path: string; body?: unknown }[]) {
  const d1 = draftOf(D1, true);
  const d2 = draftOf(D2, false);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      const method = init?.method ?? 'GET';
      if (method !== 'GET') calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (path.endsWith('/auth/me')) return ok(me);
      if (path.includes(`/billing/invoices/${D1}`)) return ok(d1);
      if (path.includes(`/billing/invoices/${D2}`)) return ok(d2);
      if (path.includes('/billing/invoices') && method === 'POST') return ok(d1);
      if (path.includes('/billing/invoices')) return ok({ invoices: [row(d1), row(d2)] });
      if (path.includes('/invoices?')) return ok({ invoices: [{ id: SALE, number: 'CEN-2026-0413', date: '2026-10-06', locationId: LOC, customerName: 'Walk-in', employeeName: 'Maria', method: 'Card', status: 'Paid', total: 2400, lines: [{ description: 'Rehab training', qty: 1, unitPrice: 1500, amount: 1500, lineDiscount: 0, vat: 18, itemClass: 'service' }] }] });
      if (path.includes('/locations')) return ok({ locations: [{ id: LOC, name: 'Centar', city: 'Skopje', address: 'x', tz: 'Europe/Skopje', phone: null, rooms: 3, invPrefix: 'CEN-', online: true, cancelHours: 24, opened: null, lifecycle: 'ACTIVE', hours: null }] });
      if (path.includes('/notices')) return ok({ notices: [] });
      if (path.includes('/requests/pending')) return ok({ requests: [], count: 0 });
      return new Response('{}', { status: 404 });
    }),
  );
}
async function open(path: string) {
  window.history.pushState({}, '', path);
  localStorage.setItem('velnes.refresh', 'rt');
  render(<App />);
}

describe('accounting invoices', () => {
  beforeEach(() => {
    localStorage.clear();
    setAccessToken(null);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists drafts apart from till receipts, with no number until issue, and only the live tabs enabled', async () => {
    mockApi([]);
    await open('/invoices');
    await screen.findByText('Accounting invoices');
    expect((await screen.findAllByText('Draft — number assigned when issued')).length).toBe(2);
    expect(screen.getByRole('button', { name: 'Draft' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Issued' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Paid' })).toHaveProperty('disabled', true);
    expect(screen.getAllByText('Nova Health DOO').length).toBe(2);
  });

  it('previews a VAT-registered draft: issuer, buyer with what it still lacks, lines with net/VAT/gross, the breakdown and totals as the server sent them', async () => {
    mockApi([]);
    await open(`/invoices/${D1}`);
    const card = await screen.findByTestId('draft-preview');
    expect(within(card).getByText('Velnes Studio DOOEL Skopje')).toBeDefined();
    expect(within(card).getByText(/ЕДБ MK4030026512345/)).toBeDefined();
    expect(within(card).getByText('Nova Health DOO')).toBeDefined();
    expect(screen.getByTestId('buyer-incomplete').textContent).toContain('tax number (ЕДБ)');
    expect(screen.getByTestId('doc-status').textContent).toBe('Draft');
    const lines = within(screen.getByTestId('draft-lines')).getAllByRole('row');
    expect(lines).toHaveLength(3); // head + 2
    const first = within(lines[1]!).getAllByRole('cell').map((c) => c.textContent);
    // 1470.00 gross at 18 %: VAT 224.24, net 1245.76 — from the mock, not computed here.
    expect(first.join(' | ')).toContain('18%');
    expect(first.join(' | ')).toMatch(/1[.,]470[.,]00/);
    expect(first.join(' | ')).toMatch(/224[.,]24/);
    expect(first.join(' | ')).toMatch(/1[.,]245[.,]76/);
    const vat = screen.getByTestId('vat-breakdown');
    expect(within(vat).getByText('5%')).toBeDefined();
    expect(within(vat).getByText('18%')).toBeDefined();
    const totals = screen.getByTestId('draft-totals').textContent ?? '';
    expect(totals).toMatch(/Total:.*2[.,]300[.,]00/);
    expect(totals).toMatch(/Discounts:.*50[.,]00/);
    expect(totals).toContain('Tip of');
    expect(screen.getByText(/From sale CEN-2026-0413/)).toBeDefined();
  });

  it('a non-VAT issuer shows no VAT columns, no breakdown and says why', async () => {
    mockApi([]);
    await open(`/invoices/${D2}`);
    await screen.findByTestId('draft-preview');
    expect(screen.queryByTestId('vat-breakdown')).toBeNull();
    expect(screen.getByText(/not registered for VAT/)).toBeDefined();
    const head = within(screen.getByTestId('draft-lines')).getAllByRole('columnheader').map((c) => c.textContent);
    expect(head).not.toContain('VAT');
    expect(head).toContain('Gross');
  });

  it('a paid till receipt offers to draft the accounting invoice and lands on the draft', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    mockApi(calls);
    await open('/till/invoices');
    await userEvent.click(await screen.findByText('CEN-2026-0413'));
    await userEvent.click(await screen.findByRole('button', { name: 'Draft accounting invoice' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path.endsWith('/billing/invoices'))?.body).toEqual({ saleId: SALE }));
    await screen.findByTestId('draft-preview');
  });
});
