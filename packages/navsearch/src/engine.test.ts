import { describe, expect, it } from 'vitest';
import { buildIndex, quickLinks, search } from './rank.js';
import { canon, editDistance, queryTokens, tokens } from './normalize.js';
import { labelsFromDictionaries } from './labels.js';
import type { NavEntry } from './types.js';

/**
 * The engine, on a registry shaped like the workspace's: titles are
 * real i18n keys (so all three languages are indexed), aliases are
 * search-only. What matters: the same destination from every way a
 * person would ask for it, in any language, however the UI is set.
 */
type Ctx = { can: (k: string) => boolean; locations: { id: string }[] };
const perm = (k: string) => (c: Ctx) => c.can(k);

const REG: NavEntry<Ctx>[] = [
  { id: 'settings', title: 'nav.settings', crumbs: [], icon: 'g', aliases: { en: ['settings'], mk: ['поставки'], sq: ['cilësimet'] }, go: { path: '/settings' }, visible: perm('users.manage') },
  {
    id: 'locations', title: 'settings.locations', crumbs: ['nav.settings'], icon: 'h', quick: true, visible: perm('locations.manage'),
    aliases: { en: ['locations', 'location', 'branches', 'edit location'], mk: ['локации', 'локација', 'филијали'], sq: ['lokacionet', 'lokacioni'] },
    go: { path: '/settings?tab=locations' },
  },
  {
    id: 'amenities', title: 'lset.amenities', crumbs: ['nav.settings', 'settings.locations'], icon: 'a', visible: perm('locations.manage'),
    terms: ['amenity.wifi', 'amenity.free_parking', 'amenity.sauna'],
    aliases: {
      en: ['amenities', 'amenity', 'facilities', 'salon amenities', 'location amenities', 'wifi', 'parking', 'sauna', 'shower', 'lockers'],
      mk: ['погодности', 'погодност', 'содржини', 'погодности на салон', 'погодности на локација', 'вифи', 'паркинг', 'сауна', 'туш', 'гардероба'],
      sq: ['lehtësirat', 'lehtësira', 'komoditetet', 'wifi', 'parkim', 'sauna', 'dush'],
    },
    go: (c) => (c.locations.length === 1 ? { path: `/settings?tab=locations&edit=${c.locations[0]!.id}&focus=amenities` } : { path: '/settings?tab=locations&focus=amenities' }),
  },
  {
    id: 'hours', title: 'settings.openingHours', crumbs: ['nav.settings'], icon: 'c', quick: true, visible: perm('locations.manage'),
    aliases: { en: ['working hours', 'opening hours', 'schedule', 'hours'], mk: ['работно време', 'работни часови', 'отворено'], sq: ['orari i punës', 'orari', 'orët e punës'] },
    go: { path: '/settings?tab=calendar' },
  },
  {
    id: 'team', title: 'settings.team', crumbs: ['nav.settings'], icon: 'u', quick: true, visible: perm('users.manage'),
    aliases: { en: ['team', 'employees', 'staff', 'workers'], mk: ['тим', 'вработени', 'персонал'], sq: ['ekipi', 'punonjësit', 'stafi'] },
    go: { path: '/settings?tab=team' },
  },
  {
    id: 'invite', title: 'navs.ws.invite', crumbs: ['nav.settings', 'settings.team'], icon: 'p', visible: perm('users.manage'),
    aliases: { en: ['add employee', 'add worker', 'invite employee', 'new employee'], mk: ['додади вработен', 'покани вработен', 'нов вработен'], sq: ['shto punonjës', 'fto punonjës'] },
    go: { path: '/settings?tab=team&open=invite' },
  },
  {
    id: 'services', title: 'navs.ws.services', crumbs: ['nav.catalog'], icon: 's', quick: true, visible: perm('catalog.view'),
    aliases: { en: ['services', 'treatments', 'add service', 'prices'], mk: ['услуги', 'третмани', 'додади услуга', 'цени'], sq: ['shërbimet', 'trajtimet', 'shto shërbim'] },
    go: { path: '/catalog?tab=services' },
  },
  {
    id: 'payments', title: 'settings.sales', crumbs: ['nav.settings'], icon: 'r', visible: perm('payments.manage'),
    aliases: { en: ['payments', 'payment methods', 'accept cards'], mk: ['плаќања', 'начини на плаќање'], sq: ['pagesat'] },
    go: { path: '/settings?tab=sales' },
  },
];
const INDEX = buildIndex(REG, labelsFromDictionaries);
const owner: Ctx = { can: () => true, locations: [{ id: 'L1' }] };
const staff: Ctx = { can: (k) => k === 'catalog.view', locations: [{ id: 'L1' }] };
const top = (q: string, ctx: Ctx = owner) => search(INDEX, q, ctx)[0]?.entry.id;
const ids = (q: string, ctx: Ctx = owner) => search(INDEX, q, ctx).map((r) => r.entry.id);

describe('normalisation', () => {
  it('folds case, accents and punctuation', () => {
    expect(canon('  Orari i Punës! ')).toBe('orari i punes');
    expect(canon('Çmimet')).toBe('cmimet');
  });
  it('transliterates Macedonian Cyrillic and collapses the digraphs people skip', () => {
    expect(canon('погодности')).toBe('pogodnosti');
    expect(canon('плаќања')).toBe(canon('plakjanja'));
    expect(canon('плаќања')).toBe(canon('plakanja'));
    expect(canon('веднаш')).toBe(canon('vednas'));
    expect(canon('веднаш')).toBe(canon('vednash'));
    expect(canon('работно време')).toBe('rabotno vreme');
    expect(canon('џез')).toBe(canon('dzez'));
  });
  it('tokenises and drops filler and intent verbs, but never everything', () => {
    // The digraph collapse is lossy on purpose and applies to every script: 'ch' → 'c'.
    expect(tokens('change the amenities')).toEqual(['cange', 'the', 'amenities']);
    expect(queryTokens('change the amenities').content).toEqual(['amenities']);
    expect(queryTokens('смени ги погодностите').content).toEqual(['pogodnostite']);
    expect(queryTokens('add').content).toEqual(['add']);
  });
  it('measures small typos, transpositions included', () => {
    expect(editDistance('amenities', 'amenites')).toBe(1);
    expect(editDistance('amenities', 'amenitys')).toBe(2);
    expect(editDistance('rabotno', 'rabtono')).toBe(1);
  });
});

describe('the amenities destination, from every way of asking', () => {
  it.each([
    'amenities', 'Amenities', 'amenity', 'change amenities', 'edit amenities', 'manage amenities', 'salon amenities', 'location amenities', 'wifi', 'parking', 'free wi-fi',
    'погодности', 'погодност', 'смени погодности', 'промени погодности', 'уреди погодности', 'погодности на салон', 'вифи', 'паркинг', 'сауна',
    'pogodnosti', 'smeni pogodnosti', 'promeni pogodnosti', 'uredi pogodnosti', 'pogodnosti na lokacija', 'tus', 'garderoba',
    'lehtësirat', 'lehtesirat', 'ndrysho lehtësirat', 'komoditetet', 'parkim', 'dush',
  ])('%s → amenities', (q) => {
    expect(top(q)).toBe('amenities');
  });
});

describe('the other core destinations', () => {
  it.each([
    ['working hours', 'hours'], ['change opening hours', 'hours'], ['работно време', 'hours'], ['rabotno vreme', 'hours'], ['orari i punës', 'hours'], ['orari i punes', 'hours'],
    ['employees', 'team'], ['staff', 'team'], ['вработени', 'team'], ['vraboteni', 'team'], ['punonjësit', 'team'], ['punonjesit', 'team'],
    ['add employee', 'invite'], ['add worker', 'invite'], ['додади вработен', 'invite'], ['dodadi vraboten', 'invite'], ['shto punonjës', 'invite'],
    ['services', 'services'], ['treatments', 'services'], ['услуги', 'services'], ['uslugi', 'services'], ['shërbimet', 'services'],
  ])('%s → %s', (q, id) => {
    expect(top(q)).toBe(id);
  });
});

describe('ranking', () => {
  it('specific intent beats the broad category', () => {
    expect(top('amenities')).toBe('amenities');
    expect(ids('amenities')).not.toContain('settings');
    expect(top('change working hours')).toBe('hours');
    const r = ids('change working hours');
    if (r.includes('settings')) expect(r.indexOf('hours')).toBeLessThan(r.indexOf('settings'));
  });
  it('a broad word lists the broad page first, then what belongs to it', () => {
    const r = ids('location');
    expect(r[0]).toBe('locations');
    expect(r).toContain('amenities');
  });
  it('tolerates small typos on longer words, not on short ones', () => {
    expect(top('amenites')).toBe('amenities');
    expect(top('amenitys')).toBe('amenities');
    expect(top('pogodnsti')).toBe('amenities');
    expect(top('rabtno vreme')).toBe('hours');
    expect(top('employes')).toBe('team');
    expect(search(INDEX, 'a', owner)).toEqual([]);
    expect(search(INDEX, 'wf', owner)).toEqual([]);
  });
  it('multi-word queries survive filler words', () => {
    expect(top('change the amenities')).toBe('amenities');
    expect(top('i want to change my working hours')).toBe('hours');
    expect(top('каде се погодностите')).toBe('amenities');
  });
  it('returns at most eight, never a destination below the floor', () => {
    expect(search(INDEX, 'settings', owner).length).toBeLessThanOrEqual(8);
    expect(search(INDEX, 'zzzzqqq', owner)).toEqual([]);
  });
});

describe('permissions', () => {
  it('never offers a screen the viewer cannot open, whichever word they type', () => {
    for (const q of ['payments', 'sales', 'плаќања', 'plakanja', 'pagesat', 'accept cards', 'Sales']) expect(ids(q, staff)).not.toContain('payments');
    for (const q of ['payments', 'плаќања', 'pagesat']) expect(ids(q, owner)).toContain('payments');
    expect(ids('amenities', staff)).toEqual([]);
    expect(top('services', staff)).toBe('services');
  });
  it('quick links follow the same rule', () => {
    expect(quickLinks(INDEX, staff).map((e) => e.id)).toEqual(['services']);
    expect(quickLinks(INDEX, owner).map((e) => e.id)).toEqual(['locations', 'hours', 'team', 'services']);
  });
});

describe('the target', () => {
  it('goes straight into the one location, and to the list when there are several', () => {
    const one = search(INDEX, 'amenities', owner)[0]!.entry;
    const go = typeof one.go === 'function' ? one.go : () => one.go;
    expect(go(owner)).toEqual({ path: '/settings?tab=locations&edit=L1&focus=amenities' });
    expect(go({ ...owner, locations: [{ id: 'L1' }, { id: 'L2' }] })).toEqual({ path: '/settings?tab=locations&focus=amenities' });
  });
  it('refuses a duplicate id', () => {
    expect(() => buildIndex([REG[0]!, REG[0]!], labelsFromDictionaries)).toThrow(/duplicate/);
  });
});
