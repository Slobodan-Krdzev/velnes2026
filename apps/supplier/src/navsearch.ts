import { buildIndex, labelsFromDictionaries, type NavEntry } from '@velnes/navsearch';
import { I } from '@velnes/ui';

/**
 * The supplier portal's searchable destinations (Alex, 2026-09-30):
 * the nine tabs and the actions inside them. `tab` switches the
 * portal tab; `sub` names a block to scroll to or an action to open
 * (`add-product`, `bulk-prices`, `add-promotion`). Visibility is the
 * role check the screens themselves apply.
 */
export interface PoCtx {
  role: string;
}
const owner = (c: PoCtx) => c.role === 'sr_owner';
const catalogEdit = (c: PoCtx) => c.role === 'sr_owner' || c.role === 'sr_catalog';
const promoEdit = (c: PoCtx) => c.role === 'sr_owner' || c.role === 'sr_account';

export const SUPPLIER_NAV: NavEntry<PoCtx>[] = [
  {
    id: 'po.dashboard', title: 'po.tabDashboard', crumbs: [], icon: I.reports, quick: true,
    aliases: {
      en: ['dashboard', 'home', 'overview', 'today', 'start'],
      mk: ['табла', 'почетна', 'преглед', 'денес'],
      sq: ['paneli', 'ballina', 'përmbledhje', 'sot'],
    },
    go: { tab: 'dashboard' },
  },
  {
    id: 'po.orders', title: 'po.tabOrders', crumbs: [], icon: I.invoice, quick: true,
    aliases: {
      en: ['orders', 'open orders', 'new orders', 'order status', 'shipped', 'delivered', 'accept order', 'invoice', 'credit note', 'disputes'],
      mk: ['нарачки', 'отворени нарачки', 'нови нарачки', 'статус на нарачка', 'испратено', 'испорачано', 'прифати нарачка', 'фактура', 'кредитна нота', 'спорови'],
      sq: ['porositë', 'porosi të hapura', 'porosi të reja', 'statusi i porosisë', 'dërguar', 'dorëzuar', 'prano porosinë', 'fatura', 'notë krediti', 'mosmarrëveshjet'],
    },
    go: { tab: 'orders' },
  },
  {
    id: 'po.salons', title: 'po.tabSalons', crumbs: [], icon: I.users, quick: true,
    aliases: {
      en: ['salons', 'customers', 'connected salons', 'connection requests', 'clients', 'buyers', 'export csv'],
      mk: ['салони', 'клиенти', 'поврзани салони', 'барања за поврзување', 'купувачи', 'извоз'],
      sq: ['sallonet', 'klientët', 'sallonet e lidhura', 'kërkesat për lidhje', 'blerësit', 'eksport'],
    },
    go: { tab: 'salons' },
  },
  {
    id: 'po.catalog', title: 'po.tabCatalog', crumbs: [], icon: I.products, quick: true,
    aliases: {
      en: ['catalog', 'products', 'product list', 'prices', 'stock', 'inventory', 'rrp', 'buy price'],
      mk: ['каталог', 'производи', 'листа на производи', 'цени', 'залиха', 'инвентар', 'набавна цена'],
      sq: ['katalogu', 'produktet', 'lista e produkteve', 'çmimet', 'stoku', 'inventari', 'çmimi i blerjes'],
    },
    go: { tab: 'catalog' },
  },
  {
    id: 'po.addProduct', title: 'navs.po.addProduct', crumbs: ['po.tabCatalog'], icon: I.plus, visible: catalogEdit,
    aliases: {
      en: ['add product', 'new product', 'create product', 'import list', 'import products'],
      mk: ['додади производ', 'нов производ', 'креирај производ', 'увези листа', 'увоз на производи'],
      sq: ['shto produkt', 'produkt i ri', 'krijo produkt', 'importo listën', 'importo produkte'],
    },
    go: { tab: 'catalog', sub: 'add-product' },
  },
  {
    id: 'po.bulkPrices', title: 'navs.po.bulkPrices', crumbs: ['po.tabCatalog'], icon: I.tag, visible: catalogEdit,
    aliases: {
      en: ['bulk update', 'bulk price update', 'change prices', 'update prices', 'raise prices', 'price increase'],
      mk: ['групна промена', 'групна промена на цени', 'смени цени', 'ажурирај цени', 'зголеми цени', 'поскапување'],
      sq: ['përditësim masiv', 'përditësim masiv i çmimeve', 'ndrysho çmimet', 'përditëso çmimet', 'rrit çmimet'],
    },
    go: { tab: 'catalog', sub: 'bulk-prices' },
  },
  {
    id: 'po.promotions', title: 'po.tabPromotions', crumbs: [], icon: I.tag,
    aliases: {
      en: ['promotions', 'promos', 'discounts', 'deals', 'campaigns', 'special offers'],
      mk: ['промоции', 'попусти', 'акции', 'кампањи', 'специјални понуди'],
      sq: ['promocionet', 'zbritjet', 'ofertat', 'fushatat', 'oferta speciale'],
    },
    go: { tab: 'promotions' },
  },
  {
    id: 'po.addPromotion', title: 'navs.po.addPromotion', crumbs: ['po.tabPromotions'], icon: I.plus, visible: promoEdit,
    aliases: {
      en: ['add promotion', 'new promotion', 'create promotion', 'new discount', 'new deal'],
      mk: ['додади промоција', 'нова промоција', 'креирај промоција', 'нов попуст', 'нова акција'],
      sq: ['shto promocion', 'promocion i ri', 'krijo promocion', 'zbritje e re'],
    },
    go: { tab: 'promotions', sub: 'add-promotion' },
  },
  {
    id: 'po.academy', title: 'po.tabAcademy', crumbs: [], icon: I.note,
    aliases: {
      en: ['academy', 'training', 'courses', 'education', 'tutorials'],
      mk: ['академија', 'обука', 'курсеви', 'едукација'],
      sq: ['akademia', 'trajnimi', 'kurset', 'edukimi'],
    },
    go: { tab: 'academy' },
  },
  {
    id: 'po.reports', title: 'po.tabReports', crumbs: [], icon: I.pulse, quick: true,
    aliases: {
      en: ['reports', 'statistics', 'stats', 'sales', 'revenue', 'by salon', 'last 90 days', 'analytics'],
      mk: ['извештаи', 'статистика', 'продажба', 'приход', 'по салон', 'последни 90 дена', 'аналитика'],
      sq: ['raportet', 'statistikat', 'shitjet', 'të ardhurat', 'sipas sallonit', '90 ditët e fundit', 'analitika'],
    },
    go: { tab: 'reports' },
  },
  {
    id: 'po.support', title: 'nav.support', crumbs: [], icon: I.info,
    aliases: {
      en: ['support', 'help', 'ticket', 'contact velnes', 'report a problem', 'question'],
      mk: ['поддршка', 'помош', 'тикет', 'контакт', 'пријави проблем', 'прашање'],
      sq: ['mbështetja', 'ndihmë', 'kërkesë', 'kontakto velnes', 'raporto problem', 'pyetje'],
    },
    go: { tab: 'support' },
  },
  {
    id: 'po.settings', title: 'po.tabSettings', crumbs: [], icon: I.gear, visible: owner,
    aliases: {
      en: ['settings', 'configuration', 'preferences', 'account'],
      mk: ['поставки', 'подесувања', 'конфигурација', 'сметка'],
      sq: ['cilësimet', 'konfigurimi', 'preferencat', 'llogaria'],
    },
    go: { tab: 'settings' },
  },
  {
    id: 'po.company', title: 'po.company', crumbs: ['po.tabSettings'], icon: I.clipboard, visible: owner,
    aliases: {
      en: ['company', 'company information', 'company details', 'business name', 'address', 'phone number', 'contact details', 'logo', 'vat number'],
      mk: ['компанија', 'информации за компанија', 'податоци за фирма', 'име на фирма', 'адреса', 'телефон', 'контакт', 'лого', 'даночен број'],
      sq: ['kompania', 'informacioni i kompanisë', 'të dhënat e kompanisë', 'emri i biznesit', 'adresa', 'numri i telefonit', 'kontakti', 'logo', 'numri i tvsh'],
    },
    go: { tab: 'settings', sub: 'po-company' },
  },
  {
    id: 'po.roles', title: 'po.roles', crumbs: ['po.tabSettings'], icon: I.user, visible: owner,
    aliases: {
      en: ['roles', 'permissions', 'access rights', 'who can do what'],
      mk: ['улоги', 'дозволи', 'права', 'права на пристап'],
      sq: ['rolet', 'lejet', 'të drejtat', 'të drejtat e qasjes'],
    },
    go: { tab: 'settings', sub: 'po-roles' },
  },
  {
    id: 'po.people', title: 'po.people', crumbs: ['po.tabSettings'], icon: I.users, visible: owner,
    aliases: {
      en: ['people', 'users', 'team', 'employees', 'add user', 'invite user', 'colleagues', 'staff'],
      mk: ['луѓе', 'корисници', 'тим', 'вработени', 'додади корисник', 'покани корисник', 'колеги'],
      sq: ['njerëzit', 'përdoruesit', 'ekipi', 'punonjësit', 'shto përdorues', 'fto përdorues', 'kolegët'],
    },
    go: { tab: 'settings', sub: 'po-people' },
  },
];

export const SUPPLIER_INDEX = buildIndex(SUPPLIER_NAV, labelsFromDictionaries);
