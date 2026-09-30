import { buildIndex, labelsFromDictionaries, type NavEntry } from '@velnes/navsearch';
import { I } from '@velnes/ui';

/**
 * Revelapps HQ's searchable destinations (Alex, 2026-09-30): the seven
 * tabs and the cards inside them. `tab` is the HQ tab; `sub` is the id
 * of the block to scroll to. Visibility follows the same role checks
 * the screens apply (super for the team, super or onboarding for
 * reviews).
 */
export interface HqCtx {
  role: string;
}
const isSuper = (c: HqCtx) => c.role === 'hq_super';
const canReview = (c: HqCtx) => c.role === 'hq_super' || c.role === 'hq_onboard';

export const HQ_NAV: NavEntry<HqCtx>[] = [
  {
    id: 'hq.customers', title: 'hq.tabCustomers', crumbs: [], icon: I.users, quick: true,
    aliases: {
      en: ['customers', 'salons', 'businesses', 'tenants', 'clients'],
      mk: ['клиенти', 'салони', 'бизниси', 'фирми'],
      sq: ['klientët', 'sallonet', 'bizneset', 'firmat'],
    },
    go: { tab: 'customers' },
  },
  {
    id: 'hq.registrations', title: 'hq.newRegistrations', crumbs: ['hq.tabCustomers'], icon: I.register, quick: true,
    aliases: {
      en: ['new registrations', 'pending registrations', 'registration requests', 'intake', 'onboarding queue', 'review registration', 'new salon', 'signups', 'applications'],
      mk: ['нови регистрации', 'регистрации на чекање', 'барања за регистрација', 'преглед на регистрација', 'нов салон', 'пријави'],
      sq: ['regjistrime të reja', 'regjistrime në pritje', 'kërkesa për regjistrim', 'shqyrto regjistrimin', 'sallon i ri', 'aplikimet'],
    },
    go: { tab: 'customers', sub: 'hq-registrations' },
  },
  {
    id: 'hq.approve', title: 'navs.hq.approve', crumbs: ['hq.tabCustomers', 'hq.newRegistrations'], icon: I.check, visible: canReview,
    aliases: {
      en: ['approve salon', 'approve registration', 'verify and activate', 'activate salon', 'decline registration', 'request changes'],
      mk: ['одобри салон', 'одобри регистрација', 'верификувај', 'активирај салон', 'одбиј регистрација', 'побарај измени'],
      sq: ['mirato sallonin', 'mirato regjistrimin', 'verifiko dhe aktivizo', 'aktivizo sallonin', 'refuzo regjistrimin', 'kërko ndryshime'],
    },
    go: { tab: 'customers', sub: 'hq-registrations' },
  },
  {
    id: 'hq.newLocations', title: 'hq.newLocations', crumbs: ['hq.tabCustomers'], icon: I.home,
    aliases: {
      en: ['new locations', 'location review', 'pending locations', 'approve location'],
      mk: ['нови локации', 'преглед на локација', 'локации на чекање', 'одобри локација'],
      sq: ['lokacione të reja', 'shqyrtimi i lokacionit', 'lokacione në pritje', 'mirato lokacionin'],
    },
    go: { tab: 'customers', sub: 'hq-new-locations' },
  },
  {
    id: 'hq.businesses', title: 'hq.businesses', crumbs: ['hq.tabCustomers'], icon: I.clipboard,
    aliases: {
      en: ['businesses', 'business list', 'all salons', 'add business', 'business detail', 'legal entity', 'enter workspace'],
      mk: ['бизниси', 'листа на бизниси', 'сите салони', 'додади бизнис', 'правен субјект', 'влези во работен простор'],
      sq: ['bizneset', 'lista e bizneseve', 'të gjitha sallonet', 'shto biznes', 'subjekti ligjor', 'hyr në hapësirën e punës'],
    },
    go: { tab: 'customers', sub: 'hq-businesses' },
  },
  {
    id: 'hq.categories', title: 'hq.tabCategories', crumbs: [], icon: I.tag, quick: true,
    aliases: {
      en: ['categories', 'service categories', 'taxonomy', 'category images', 'rename category'],
      mk: ['категории', 'категории на услуги', 'слики на категории', 'преименувај категорија'],
      sq: ['kategoritë', 'kategoritë e shërbimeve', 'imazhet e kategorive', 'riemërto kategorinë'],
    },
    go: { tab: 'categories', sub: 'hq-svc-categories' },
  },
  {
    id: 'hq.prodCategories', title: 'hq.prodCategories', crumbs: ['hq.tabCategories'], icon: I.bottle,
    aliases: {
      en: ['product categories', 'products taxonomy'],
      mk: ['категории на производи'],
      sq: ['kategoritë e produkteve'],
    },
    go: { tab: 'categories', sub: 'hq-prod-categories' },
  },
  {
    id: 'hq.categoryRequests', title: 'hq.categoryRequests', crumbs: ['hq.tabCategories'], icon: I.note,
    aliases: {
      en: ['category requests', 'requested categories', 'new category request', 'approve category'],
      mk: ['барања за категории', 'побарани категории', 'одобри категорија'],
      sq: ['kërkesat për kategori', 'kategori të kërkuara', 'mirato kategorinë'],
    },
    go: { tab: 'categories', sub: 'hq-category-requests' },
  },
  {
    id: 'hq.suppliers', title: 'hq.tabSuppliers', crumbs: [], icon: I.products, quick: true,
    aliases: {
      en: ['suppliers', 'official suppliers', 'brands', 'carriage', 'invite supplier', 'add supplier', 'wholesale'],
      mk: ['добавувачи', 'официјални добавувачи', 'брендови', 'покани добавувач', 'додади добавувач'],
      sq: ['furnitorët', 'furnitorë zyrtarë', 'markat', 'fto furnitor', 'shto furnitor'],
    },
    go: { tab: 'suppliers' },
  },
  {
    id: 'hq.tickets', title: 'support.hqTitle', crumbs: [], icon: I.info, quick: true,
    aliases: {
      en: ['support tickets', 'tickets', 'support', 'help requests', 'reply to ticket'],
      mk: ['тикети', 'поддршка', 'барања за помош', 'одговори на тикет'],
      sq: ['biletat', 'mbështetja', 'kërkesat për ndihmë', 'përgjigju biletës'],
    },
    go: { tab: 'tickets' },
  },
  {
    id: 'hq.team', title: 'hq.tabTeam', crumbs: [], icon: I.user, visible: isSuper,
    aliases: {
      en: ['hq team', 'team', 'people', 'hq users', 'add hq user', 'invite colleague'],
      mk: ['hq тим', 'тим', 'луѓе', 'корисници', 'додади корисник', 'покани колега'],
      sq: ['ekipi hq', 'ekipi', 'njerëzit', 'përdoruesit', 'shto përdorues', 'fto koleg'],
    },
    go: { tab: 'team', sub: 'hq-people' },
  },
  {
    id: 'hq.roles', title: 'hq.hqRoles', crumbs: ['hq.tabTeam'], icon: I.user, visible: isSuper,
    aliases: {
      en: ['hq roles', 'roles', 'permissions', 'who can do what'],
      mk: ['улоги', 'дозволи', 'права'],
      sq: ['rolet', 'lejet', 'të drejtat'],
    },
    go: { tab: 'team', sub: 'hq-roles' },
  },
  {
    id: 'hq.outbox', title: 'hq.outbox', crumbs: ['hq.tabTeam'], icon: I.mail, visible: isSuper,
    aliases: {
      en: ['mail outbox', 'outbox', 'sent emails', 'email log', 'mails'],
      mk: ['излезна пошта', 'испратени пораки', 'дневник на е-пошта'],
      sq: ['posta dalëse', 'e-mailet e dërguara', 'regjistri i e-maileve'],
    },
    go: { tab: 'team', sub: 'hq-outbox' },
  },
  {
    id: 'hq.search', title: 'hq.tabSearch', crumbs: [], icon: I.pulse,
    aliases: {
      en: ['search lab', 'search settings', 'search configuration', 'ranking weights', 'dry run', 'publish weights', 'synonyms'],
      mk: ['лабораторија за пребарување', 'поставки за пребарување', 'тежини', 'рангирање', 'синоними'],
      sq: ['laboratori i kërkimit', 'cilësimet e kërkimit', 'peshat', 'renditja', 'sinonimet'],
    },
    go: { tab: 'search' },
  },
  {
    id: 'hq.misses', title: 'navs.hq.misses', crumbs: ['hq.tabSearch'], icon: I.search,
    aliases: {
      en: ['search misses', 'not found', 'zero results', 'missed searches', 'what people search for'],
      mk: ['пропуштени пребарувања', 'не е пронајдено', 'без резултати', 'што бараат луѓето'],
      sq: ['kërkime pa rezultat', 'nuk u gjet', 'zero rezultate', 'çfarë kërkojnë njerëzit'],
    },
    go: { tab: 'search', sub: 'hq-misses' },
  },
  {
    id: 'hq.loyalty', title: 'hq.loyalty', crumbs: ['hq.tabCustomers'], icon: I.users,
    aliases: {
      en: ['loyalty', 'points', 'loyalty points', 'rewards', 'velnes points', 'consumer points', 'balance'],
      mk: ['лојалност', 'поени', 'поени за лојалност', 'награди', 'velnes поени', 'салдо'],
      sq: ['besnikëri', 'pikë', 'pikë besnikërie', 'shpërblime', 'pikë velnes', 'bilanci'],
    },
    go: { tab: 'customers', sub: 'hq-loyalty' },
  },
  {
    id: 'hq.audit', title: 'hq.tabAudit', crumbs: [], icon: I.note,
    aliases: {
      en: ['platform log', 'audit log', 'audit', 'history', 'who did what', 'activity'],
      mk: ['платформски дневник', 'дневник', 'ревизија', 'историја', 'кој што направил', 'активност'],
      sq: ['regjistri i platformës', 'regjistri', 'auditimi', 'historiku', 'kush çfarë bëri', 'aktiviteti'],
    },
    go: { tab: 'audit' },
  },
];

export const HQ_INDEX = buildIndex(HQ_NAV, labelsFromDictionaries);
