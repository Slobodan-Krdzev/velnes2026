import { describe, expect, it } from 'vitest';
import { createI18n } from '@velnes/i18n';
import { quickLinks, search } from '@velnes/navsearch';
import { HQ_INDEX, HQ_NAV, type HqCtx } from './navsearch.js';

const sup: HqCtx = { role: 'hq_super' };
const support: HqCtx = { role: 'hq_support' };
const top = (q: string, ctx: HqCtx = sup) => search(HQ_INDEX, q, ctx)[0]?.entry.id;
const ids = (q: string, ctx: HqCtx = sup) => search(HQ_INDEX, q, ctx).map((r) => r.entry.id);

describe('the HQ registry', () => {
  it('has a title in three languages for every destination', () => {
    const langs = (['en', 'mk', 'sq'] as const).map((l) => createI18n(l));
    for (const e of HQ_NAV) for (const k of [e.title, ...e.crumbs]) for (const i of langs) expect(i.t(k), k).not.toBe(k);
  });

  it.each([
    ['pending registrations', 'hq.registrations'], ['new salon', 'hq.registrations'], ['регистрации', 'hq.registrations'], ['registracii', 'hq.registrations'], ['regjistrime të reja', 'hq.registrations'],
    ['approve salon', 'hq.approve'], ['одобри салон', 'hq.approve'], ['odobri salon', 'hq.approve'], ['mirato sallonin', 'hq.approve'],
    ['businesses', 'hq.businesses'], ['бизниси', 'hq.businesses'],
    ['tickets', 'hq.tickets'], ['тикети', 'hq.tickets'], ['biletat', 'hq.tickets'],
    ['categories', 'hq.categories'], ['категории', 'hq.categories'], ['kategoritë', 'hq.categories'],
    ['search misses', 'hq.misses'], ['zero results', 'hq.misses'],
    ['platform log', 'hq.audit'], ['дневник', 'hq.audit'],
    ['suppliers', 'hq.suppliers'], ['добавувачи', 'hq.suppliers'], ['furnitorët', 'hq.suppliers'],
  ])('%s → %s', (q, id) => {
    expect(top(q)).toBe(id);
  });

  it('keeps the team and approvals to the roles that have them', () => {
    for (const q of ['team', 'hq team', 'roles', 'outbox', 'тим', 'ekipi']) expect(ids(q, support).some((id) => ['hq.team', 'hq.roles', 'hq.outbox'].includes(id))).toBe(false);
    expect(ids('approve salon', support)).not.toContain('hq.approve');
    expect(top('team')).toBe('hq.team');
    expect(top('approve salon', { role: 'hq_onboard' })).toBe('hq.approve');
    expect(quickLinks(HQ_INDEX, support).map((e) => e.id)).not.toContain('hq.team');
  });

  it('every target names a real tab', () => {
    const tabs = new Set(['customers', 'categories', 'suppliers', 'tickets', 'team', 'search', 'audit']);
    for (const e of HQ_NAV) expect(tabs.has((e.go as { tab: string }).tab), e.id).toBe(true);
  });
});
