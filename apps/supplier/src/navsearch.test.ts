import { describe, expect, it } from 'vitest';
import { createI18n } from '@velnes/i18n';
import { quickLinks, search } from '@velnes/navsearch';
import { SUPPLIER_INDEX, SUPPLIER_NAV, type PoCtx } from './navsearch.js';

const owner: PoCtx = { role: 'sr_owner' };
const analyst: PoCtx = { role: 'sr_analyst' };
const top = (q: string, ctx: PoCtx = owner) => search(SUPPLIER_INDEX, q, ctx)[0]?.entry.id;
const ids = (q: string, ctx: PoCtx = owner) => search(SUPPLIER_INDEX, q, ctx).map((r) => r.entry.id);

describe('the supplier registry', () => {
  it('has a title in three languages for every destination', () => {
    const langs = (['en', 'mk', 'sq'] as const).map((l) => createI18n(l));
    for (const e of SUPPLIER_NAV) for (const k of [e.title, ...e.crumbs]) for (const i of langs) expect(i.t(k), k).not.toBe(k);
  });

  it.each([
    ['products', 'po.catalog'], ['catalog', 'po.catalog'], ['производи', 'po.catalog'], ['proizvodi', 'po.catalog'], ['produktet', 'po.catalog'],
    ['add product', 'po.addProduct'], ['нов производ', 'po.addProduct'], ['dodadi proizvod', 'po.addProduct'], ['shto produkt', 'po.addProduct'],
    ['change prices', 'po.bulkPrices'], ['смени цени', 'po.bulkPrices'], ['ndrysho çmimet', 'po.bulkPrices'],
    ['orders', 'po.orders'], ['нарачки', 'po.orders'], ['naracki', 'po.orders'], ['porositë', 'po.orders'], ['open orders', 'po.orders'],
    ['salons', 'po.salons'], ['customers', 'po.salons'], ['салони', 'po.salons'], ['sallonet', 'po.salons'],
    ['company information', 'po.company'], ['податоци за фирма', 'po.company'], ['numri i telefonit', 'po.company'],
    ['promotions', 'po.promotions'], ['промоции', 'po.promotions'], ['add promotion', 'po.addPromotion'],
    ['reports', 'po.reports'], ['извештаи', 'po.reports'], ['raportet', 'po.reports'],
    ['settings', 'po.settings'], ['поставки', 'po.settings'], ['cilësimet', 'po.settings'],
  ])('%s → %s', (q, id) => {
    expect(top(q)).toBe(id);
  });

  it('keeps settings and editing actions to the roles that have them', () => {
    for (const q of ['settings', 'company', 'roles', 'people', 'поставки', 'cilësimet', 'users']) expect(ids(q, analyst).some((id) => ['po.settings', 'po.company', 'po.roles', 'po.people'].includes(id))).toBe(false);
    expect(ids('add product', analyst)).not.toContain('po.addProduct');
    expect(ids('add promotion', analyst)).not.toContain('po.addPromotion');
    expect(top('products', analyst)).toBe('po.catalog');
    expect(quickLinks(SUPPLIER_INDEX, analyst).map((e) => e.id)).toContain('po.orders');
  });

  it('every target names a real tab', () => {
    const tabs = new Set(['dashboard', 'orders', 'salons', 'catalog', 'promotions', 'academy', 'reports', 'support', 'settings']);
    for (const e of SUPPLIER_NAV) expect(tabs.has((e.go as { tab: string }).tab), e.id).toBe(true);
  });
});
