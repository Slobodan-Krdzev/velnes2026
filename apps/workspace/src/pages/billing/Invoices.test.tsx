import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, queryClient } from '../../App.js';
import { setAccessToken } from '@velnes/client';

/** Accounting invoices (phase 2): the list of drafts and the preview of
 *  one — every figure the server's, rendered as the document will read. */
const LOC = '20000000-0000-4000-8000-000000000001';
const LE = '50000000-0000-4000-8000-000000000001';
const SALE = 'aa000000-0000-4000-8000-000000000001';
const D1 = 'bb000000-0000-4000-8000-000000000001';
const D2 = 'bb000000-0000-4000-8000-000000000002';
const D3 = 'bb000000-0000-4000-8000-000000000003';
const EV = 'dd000000-0000-4000-8000-00000000000';

const me = {
  id: '40000000-0000-4000-8000-000000000001', name: 'Maria Petrovska', access: 'owner', roleId: '30000000-0000-4000-8000-000000000001',
  locationIds: [LOC], email: 'maria@velnes.mk', tenantId: '10000000-0000-4000-8000-000000000001', lang: 'en',
  perms: { 'billing.read': 'business', 'billing.create': 'business', 'billing.issue': 'business', 'billing.record_payment': 'business', 'pos.checkout': 'business', 'pos.view_invoices': 'business' },
};
const issuer = { legalEntityId: LE, legalName: 'Velnes Studio DOOEL Skopje', tradingName: 'Velnes Fizio Centar', edb: 'MK4030026512345', vatRegNo: 'MK4030026512345', embs: '7012345', address: 'Partizanski Odredi 14', city: 'Skopje', zip: '1000', country: 'North Macedonia', bankName: 'Komercijalna', bankAccount: '300000001234567', signatoryName: 'Maria Petrovska', contactEmail: '', phone: '', website: '', footerText: '', paymentInstructions: '', logoSha256: null, logoMime: null };
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
    id, kind: 'invoice', status: 'draft', number: null, series: null, year: null, numberSeq: null, lang: 'mk', pdfSha256: null, fiscalReceiptRef: null, currency: 'MKD', vatRegistered: registered, pricesIncludeVat: true,
    legalEntityId: LE, locationId: LOC, billingCustomerId: null, originSaleId: SALE, originAppointmentId: null,
    supplyDate: '2026-10-06', issueDate: null, dueDate: null, issuedAt: null, issuer, location,
    buyer: { billingCustomerId: null, customerId: null, kind: 'company', name: 'Nova Health DOO', address: 'Bul. Ilinden 5', city: 'Skopje', zip: '1000', country: 'North Macedonia', edb: '', vatRegNo: '', email: '', phone: '' },
    origin: { saleNumber: 'CEN-2026-0413', saleDate: '2026-10-06', method: 'Card', employeeName: 'Maria', saleTotalMinor: sum('grossMinor') + 10000, linesMinor: 235000, cartDiscountMinor: 5000, promoMinor: 0, loyaltyMinor: 0, giftTenderMinor: 0, tipMinor: 10000, flags: ['tip_excluded'] },
    lines,
    totals: { netMinor: sum('netMinor'), vatMinor: sum('vatMinor'), grossMinor: sum('grossMinor'), discountMinor: 5000 },
    vatBreakdown: rates.map((r) => ({ rateBp: r, netMinor: lines.filter((l) => l.vatRateBp === r).reduce((s, l) => s + l.netMinor, 0), vatMinor: lines.filter((l) => l.vatRateBp === r).reduce((s, l) => s + l.vatMinor, 0), grossMinor: lines.filter((l) => l.vatRateBp === r).reduce((s, l) => s + l.grossMinor, 0) })),
    buyerCompleteness: { complete: false, missing: ['edb'], invalid: [] },
    issueReadiness: { ready: false, problems: [{ part: 'buyer', field: 'edb', reason: 'missing' }], warnings: [] },
    payment: { grossMinor: sum('grossMinor'), paidMinor: 0, outstandingMinor: sum('grossMinor'), state: 'unpaid', count: 0 },
    issuedBy: null,
    events: [{ id: `${EV}1`, kind: 'created', at: '2026-10-06T10:00:00.000Z', actorName: 'Maria Petrovska', source: 'API', data: {} }],
    notes: '', createdBy: { id: me.id, name: 'Maria Petrovska' }, createdAt: '2026-10-06T10:00:00.000Z', updatedBy: { id: me.id, name: 'Maria Petrovska' }, updatedAt: '2026-10-06T10:00:00.000Z',
  };
};
/** A ready draft, and what the server answers once it is issued. */
const readyDraft = (id: string) => {
  const d = draftOf(id, true);
  return { ...d, buyer: { ...d.buyer, edb: 'MK4032011501234' }, buyerCompleteness: { complete: true, missing: [], invalid: [] }, issueReadiness: { ready: true, problems: [], warnings: [{ code: 'supply_to_issue_gap', params: { days: 12 } }] } };
};
const issuedOf = (d: ReturnType<typeof readyDraft>) => ({
  ...d, status: 'issued', number: '2026-000041', series: '', year: 2026, numberSeq: 41, issueDate: '2026-10-18', issuedAt: '2026-10-18T09:30:00.000Z',
  issuedBy: { id: me.id, name: 'Maria Petrovska' }, issueReadiness: { ready: true, problems: [], warnings: [] }, pdfSha256: 'ab'.repeat(32),
  payment: { grossMinor: d.totals.grossMinor, paidMinor: 100000, outstandingMinor: d.totals.grossMinor - 100000, state: 'partially_paid', count: 1 },
  events: [...d.events, { id: `${EV}2`, kind: 'issued', at: '2026-10-18T09:30:00.000Z', actorName: 'Maria Petrovska', source: 'API', data: { number: '2026-000041' } }],
  updatedAt: '2026-10-18T09:30:00.000Z',
});
const row = (d: ReturnType<typeof draftOf>) => ({ id: d.id, kind: d.kind, status: d.status, number: d.number, currency: d.currency, vatRegistered: d.vatRegistered, legalEntityId: LE, locationId: LOC, billingCustomerId: null, originSaleId: SALE, supplyDate: d.supplyDate, issueDate: null, dueDate: null, totals: d.totals, createdAt: d.createdAt, updatedAt: d.updatedAt, buyerName: d.buyer?.name ?? '', locationName: 'Centar', saleNumber: 'CEN-2026-0413', paidMinor: 0, paymentState: 'unpaid' });

const paymentOf = (id: string, amountMinor: number, source: 'sale' | 'manual', method: string, reference = '') => ({
  id, amountMinor, currency: 'MKD', method, source, paidAt: '2026-10-05T10:00:00.000Z', paidOn: '2026-10-05', reference, provider: null, providerPaymentId: null,
  originSaleId: source === 'sale' ? SALE : null, originSaleNumber: source === 'sale' ? 'CEN-2026-0413' : null, note: '', recordedBy: { id: me.id, name: 'Maria Petrovska' }, createdAt: '2026-10-07T08:00:00.000Z',
});
function mockApi(calls: { method: string; path: string; body?: unknown }[], opts: { perms?: Record<string, string>; issueFails?: boolean; overpay?: boolean } = {}) {
  const d1 = draftOf(D1, true);
  const d2 = draftOf(D2, false);
  const d3 = readyDraft(D3);
  let d3Issued = false;
  const gross = d3.totals.grossMinor;
  const ledger = { payments: [paymentOf('ee000000-0000-4000-8000-000000000001', 100000, 'sale', 'Card')], summary: { grossMinor: gross, paidMinor: 100000, outstandingMinor: gross - 100000, state: 'partially_paid', count: 1 } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      const method = init?.method ?? 'GET';
      if (method !== 'GET') calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (path.endsWith('/auth/me')) return ok({ ...me, perms: opts.perms ?? me.perms });
      if (path.endsWith('/logo')) return new Response(null, { status: 204 });
      if (path.endsWith(`/billing/invoices/${D3}/payments`) && method === 'POST') {
        if (opts.overpay) return new Response(JSON.stringify({ error: 'OVERPAYMENT', message: 'too much', outstandingMinor: gross - 100000, paidMinor: 100000, grossMinor: gross }), { status: 422 });
        const b = JSON.parse(String(init?.body)) as { amountMinor: number; method: string; reference: string };
        ledger.payments = [...ledger.payments, paymentOf('ee000000-0000-4000-8000-000000000002', b.amountMinor, 'manual', b.method, b.reference)];
        const paid = ledger.payments.reduce((s, p) => s + p.amountMinor, 0);
        ledger.summary = { grossMinor: gross, paidMinor: paid, outstandingMinor: gross - paid, state: paid >= gross ? 'paid' : 'partially_paid', count: ledger.payments.length };
        return ok(ledger);
      }
      if (path.endsWith(`/billing/invoices/${D3}/payments`)) return ok(ledger);
      if (/\/pdf(\?download=1)?$/.test(path)) return new Response('%PDF-1.3 fake', { status: 200, headers: { 'content-type': 'application/pdf' } });
      if (path.includes(`/billing/invoices/${D1}`) && method === 'PATCH') return ok({ ...d1, lang: (JSON.parse(String(init?.body)) as { lang: string }).lang });
      if (path.endsWith(`/billing/invoices/${D3}/issue`)) {
        if (opts.issueFails)
          return new Response(JSON.stringify({ error: 'ISSUE_BLOCKED', message: 'blocked', problems: [{ part: 'issuer', field: 'signatoryName', reason: 'missing' }, { part: 'sale', field: 'status', reason: 'changed' }] }), { status: 422 });
        d3Issued = true;
        return ok(issuedOf(d3));
      }
      if (path.includes(`/billing/invoices/${D1}`)) return ok(d1);
      if (path.includes(`/billing/invoices/${D2}`)) return ok(d2);
      if (path.includes(`/billing/invoices/${D3}`)) return ok(d3Issued ? issuedOf(d3) : d3);
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
    queryClient.clear();
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
    expect(screen.getByRole('button', { name: 'Issued' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Paid' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Credited' })).toHaveProperty('disabled', true);
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

  describe('issuing (phase 3)', () => {
    it('a draft that is not ready says so; the modal lists the problems and will not confirm', async () => {
      mockApi([]);
      await open(`/invoices/${D1}`);
      await screen.findByTestId('draft-preview');
      expect(screen.getByTestId('issue-readiness').textContent).toContain('1 to fix');
      await userEvent.click(screen.getByTestId('issue-btn'));
      expect(await screen.findByText('Issue this invoice?')).toBeDefined();
      expect(screen.getByText(/assigns the final invoice number and freezes this document/)).toBeDefined();
      expect(screen.getByTestId('issue-problems').textContent).toContain('Buyer: tax number (ЕДБ) — missing');
      expect(screen.getByTestId('issue-confirm')).toHaveProperty('disabled', true);
    });

    it('issues only after deliberate confirmation, with one key, and then shows the issued document: number, badge, who and when, history, no issue button', async () => {
      const calls: { method: string; path: string; body?: unknown }[] = [];
      mockApi(calls);
      await open(`/invoices/${D3}`);
      await screen.findByTestId('draft-preview');
      expect(screen.getByTestId('issue-readiness').textContent).toBe('Ready to issue');
      expect(screen.getByTestId('doc-number').textContent).toBe('Draft — number assigned when issued');
      await userEvent.click(screen.getByTestId('issue-btn'));
      // Nothing was sent by opening the modal.
      expect(calls.filter((c) => c.path.endsWith('/issue'))).toHaveLength(0);
      expect(screen.getByTestId('issue-warnings').textContent).toContain('12 days after the supply');
      await userEvent.click(screen.getByTestId('issue-confirm'));
      await waitFor(() => expect(calls.filter((c) => c.path.endsWith(`/billing/invoices/${D3}/issue`))).toHaveLength(1));
      const sent = calls.find((c) => c.path.endsWith('/issue'))!.body as { key: string };
      expect(sent.key.length).toBeGreaterThanOrEqual(8);
      await waitFor(() => expect(screen.getByTestId('doc-number').textContent).toBe('2026-000041'));
      expect(screen.getByTestId('doc-status').textContent).toBe('Issued');
      expect(screen.queryByTestId('issue-btn')).toBeNull();
      expect(screen.queryByTestId('buyer-incomplete')).toBeNull();
      expect(screen.getByText(/Issue date/).textContent).toContain('18.10.2026');
      expect(screen.getByTestId('doc-note').textContent).toContain('issued and permanent');
      expect(screen.getByTestId('doc-note').textContent).toContain('Issued by Maria Petrovska on 2026-10-18 09:30');
      expect(screen.getByTestId('doc-history').textContent).toContain('Issued as 2026-000041');
      expect(screen.getByTestId('doc-history').textContent).toContain('Draft created');
      // No edit, delete, cancel or back-to-draft controls exist on an issued document.
      expect(screen.queryByRole('button', { name: /edit|delete|cancel|draft/i })).toBeNull();
    });

    it('when the server refuses, the structured problems are shown — nothing is assumed issued', async () => {
      const calls: { method: string; path: string; body?: unknown }[] = [];
      mockApi(calls, { issueFails: true });
      await open(`/invoices/${D3}`);
      await screen.findByTestId('draft-preview');
      await userEvent.click(screen.getByTestId('issue-btn'));
      await userEvent.click(screen.getByTestId('issue-confirm'));
      const problems = await screen.findByTestId('issue-problems');
      expect(problems.textContent).toContain('Issuer: authorised signatory — missing');
      expect(problems.textContent).toContain('Sale: sale status — changed since the draft');
      expect(screen.getByTestId('doc-status').textContent).toBe('Draft');
      expect(screen.getByTestId('doc-number').textContent).toBe('Draft — number assigned when issued');
    });

    it('without billing.issue there is no issue button, and the page says which right it takes', async () => {
      mockApi([], { perms: { 'billing.read': 'business', 'billing.create': 'business' } });
      await open(`/invoices/${D3}`);
      await screen.findByTestId('draft-preview');
      expect(screen.queryByTestId('issue-btn')).toBeNull();
      expect(screen.getByText(/needs the “Issue accounting invoices” right/)).toBeDefined();
    });
  });

  describe('the PDF (phase 4)', () => {
    it('a draft offers the language choice and no PDF; choosing a language PATCHes the draft', async () => {
      const calls: { method: string; path: string; body?: unknown }[] = [];
      mockApi(calls);
      await open(`/invoices/${D1}`);
      await screen.findByTestId('draft-preview');
      expect(screen.queryByTestId('pdf-preview')).toBeNull();
      expect(screen.queryByTestId('pdf-download')).toBeNull();
      const select = screen.getByLabelText('Invoice language:') as HTMLSelectElement;
      expect(select.value).toBe('mk');
      await userEvent.selectOptions(select, 'sq');
      await waitFor(() => expect(calls.find((c) => c.method === 'PATCH' && c.path.endsWith(`/billing/invoices/${D1}`))?.body).toEqual({ lang: 'sq' }));
      await waitFor(() => expect((screen.getByLabelText('Invoice language:') as HTMLSelectElement).value).toBe('sq'));
    });

    it('an issued document shows its fixed language and hash, and fetches the one canonical PDF for preview and for download', async () => {
      const calls: { method: string; path: string; body?: unknown }[] = [];
      mockApi(calls);
      const opened: string[] = [];
      const openSpy = vi.spyOn(window, 'open').mockImplementation((url) => { opened.push(String(url)); return null; });
      const makeUrl = (b: Blob) => `blob:${b.type}`;
      (window.URL as unknown as { createObjectURL: typeof makeUrl }).createObjectURL = makeUrl;
      (globalThis.URL as unknown as { createObjectURL: typeof makeUrl }).createObjectURL = makeUrl;
      await open(`/invoices/${D3}`);
      await screen.findByTestId('draft-preview');
      await userEvent.click(screen.getByTestId('issue-btn'));
      await userEvent.click(screen.getByTestId('issue-confirm'));
      await waitFor(() => expect(screen.getByTestId('doc-status').textContent).toBe('Issued'));
      expect(screen.queryByLabelText('Invoice language:')).toBeNull();
      expect(screen.getByTestId('doc-lang').textContent).toBe('Македонски');
      expect(screen.getByTestId('pdf-sha').textContent).toContain('ab'.repeat(32));
      await userEvent.click(screen.getByTestId('pdf-preview'));
      await waitFor(() => expect(opened).toEqual(['blob:application/pdf']));
      const fetched = () => (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/pdf'));
      expect(fetched()).toEqual([expect.stringMatching(new RegExp(`/billing/invoices/${D3}/pdf$`))]);
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      await userEvent.click(screen.getByTestId('pdf-download'));
      await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
      expect(fetched()[1]).toMatch(new RegExp(`/billing/invoices/${D3}/pdf\\?download=1$`));
      click.mockRestore();
      openSpy.mockRestore();
    });
  });

  describe('payments (phase 5)', () => {
    const issueD3 = async () => {
      await open(`/invoices/${D3}`);
      await screen.findByTestId('draft-preview');
      await userEvent.click(screen.getByTestId('issue-btn'));
      await userEvent.click(screen.getByTestId('issue-confirm'));
      await waitFor(() => expect(screen.getByTestId('doc-status').textContent).toBe('Issued'));
    };

    it('an issued document shows the server\'s summary and ledger: total, paid, outstanding, state, the POS sale row', async () => {
      mockApi([]);
      await issueD3();
      const summary = await screen.findByTestId('payment-summary');
      expect(summary.textContent).toMatch(/Invoice total.*2[.,]300[.,]00/);
      expect(summary.textContent).toMatch(/Paid.*1[.,]000[.,]00/);
      expect(summary.textContent).toMatch(/Outstanding.*1[.,]300[.,]00/);
      expect(screen.getByTestId('payment-state').textContent).toBe('Partially paid');
      const rows = within(await screen.findByTestId('payment-history')).getAllByRole('row');
      expect(rows).toHaveLength(2);
      expect(rows[1]!.textContent).toContain('5.10.2026');
      expect(rows[1]!.textContent).toContain('Card');
      expect(rows[1]!.textContent).toContain('POS sale · CEN-2026-0413');
      expect(screen.queryByTestId('payment-block')).not.toBeNull();
    });

    it('a draft shows no payment block', async () => {
      mockApi([]);
      await open(`/invoices/${D1}`);
      await screen.findByTestId('draft-preview');
      expect(screen.queryByTestId('payment-block')).toBeNull();
    });

    it('Record payment: the modal says Velnes moves no money, defaults to the outstanding amount, POSTs what was typed, and the document becomes Paid', async () => {
      const calls: { method: string; path: string; body?: unknown }[] = [];
      mockApi(calls);
      await issueD3();
      await screen.findByTestId('payment-summary');
      await userEvent.click(screen.getByTestId('record-payment'));
      expect(await screen.findByText('Record a payment')).toBeDefined();
      expect(screen.getByText(/Velnes will not process or transfer money/)).toBeDefined();
      const amount = screen.getByLabelText(/Amount \(MKD\)/) as HTMLInputElement;
      expect(amount.value).toBe('1300.00');
      await userEvent.type(screen.getByLabelText(/Reference/), 'MK202610071234');
      await userEvent.click(screen.getByTestId('pay-submit'));
      await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path.endsWith('/payments'))?.body).toMatchObject({ amountMinor: 130000, method: 'Bank transfer', reference: 'MK202610071234', currency: 'MKD' }));
      const sent = calls.find((c) => c.method === 'POST' && c.path.endsWith('/payments'))!.body as { key: string; paidOn: string };
      expect(sent.key.length).toBeGreaterThanOrEqual(8);
      expect(sent.paidOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      await waitFor(() => expect(screen.getByTestId('payment-state').textContent).toBe('Paid'));
      expect(within(screen.getByTestId('payment-history')).getAllByRole('row')).toHaveLength(3);
      expect(screen.queryByTestId('record-payment')).toBeNull(); // nothing outstanding
      expect(screen.getByTestId('doc-number').textContent).toBe('2026-000041'); // the document itself did not move
    });

    it('an overpayment refused by the server is shown with what is outstanding', async () => {
      mockApi([], { overpay: true });
      await issueD3();
      await screen.findByTestId('payment-summary');
      await userEvent.click(screen.getByTestId('record-payment'));
      await userEvent.click(await screen.findByTestId('pay-submit'));
      expect((await screen.findByTestId('pay-error')).textContent).toMatch(/Only .*1[.,]300[.,]00.* is outstanding/);
    });

    it('without billing.record_payment there is no Record payment button', async () => {
      mockApi([], { perms: { 'billing.read': 'business', 'billing.create': 'business', 'billing.issue': 'business' } });
      await issueD3();
      await screen.findByTestId('payment-summary');
      expect(screen.queryByTestId('record-payment')).toBeNull();
      expect(screen.getByText(/needs the “Record payments” right/)).toBeDefined();
    });
  });
});
