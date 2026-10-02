import { AMENITY_KEYS, type PermKey } from '@velnes/contracts';
import { buildIndex, labelsFromDictionaries, type NavEntry } from '@velnes/navsearch';
import { I } from '@velnes/ui';

/**
 * The workspace's searchable destinations (Alex, 2026-09-30): every
 * page, every settings section, and the things people ask for by what
 * they want to do — "change amenities", "add worker", "salon photos".
 *
 * Titles and breadcrumbs are the i18n keys the screens already use, so
 * a result reads in the viewer's language; aliases are search-only, in
 * English, Macedonian (Cyrillic — the Latin-keyboard forms are derived)
 * and Albanian. Visibility is the same `can()` that hides the sidebar
 * tiles and the settings sections. Targets are real URLs: the settings
 * page reads `?tab=`, `?edit=`, `?focus=`, `?loc=`, `?sub=`, `?open=`,
 * and the tabbed pages read `?tab=` / `?type=`.
 */
export interface WsCtx {
  can: (key: PermKey) => boolean;
  /** The locations the viewer may work in — one means "go straight in". */
  locations: { id: string }[];
}

const perm = (k: PermKey) => (c: WsCtx) => c.can(k);

/** A location's own setting: with one location the panel opens on it;
 *  with several, the list, where the person picks — never a guess. */
const inLocation = (focus: string) => (c: WsCtx) =>
  c.locations.length === 1
    ? { path: `/settings?tab=locations&edit=${c.locations[0]!.id}&focus=${focus}` }
    : { path: `/settings?tab=locations&focus=${focus}` };

const SET = ['nav.settings'];

export const WORKSPACE_NAV: NavEntry<WsCtx>[] = [
  {
    id: 'ws.flightdeck', title: 'nav.flightdeck', crumbs: [], icon: I.home, quick: true,
    aliases: {
      en: ['dashboard', 'home', 'overview', 'today', 'start'],
      mk: ['почетна', 'преглед', 'табла', 'денес', 'почеток'],
      sq: ['paneli', 'ballina', 'faqja kryesore', 'sot', 'fillimi'],
    },
    go: { path: '/' },
  },
  {
    id: 'ws.calendar', title: 'nav.calendar', crumbs: [], icon: I.calendar, quick: true, visible: perm('appointments.view_own'),
    aliases: {
      en: ['bookings', 'appointments', 'schedule', 'agenda', 'book appointment', 'new appointment', 'add booking', 'day view', 'week view'],
      mk: ['календар', 'термини', 'резервации', 'закажување', 'закажи термин', 'распоред', 'нов термин', 'додади резервација', 'дневен преглед', 'неделен преглед'],
      sq: ['kalendari', 'terminet', 'rezervimet', 'orari', 'cakto termin', 'termin i ri', 'shto rezervim', 'pamja ditore', 'pamja javore'],
    },
    go: { path: '/calendar' },
  },
  {
    id: 'ws.calendar.requests', title: 'nav.requests', crumbs: ['nav.flightdeck'], icon: I.calendar, visible: perm('appointments.view_own'),
    aliases: {
      en: ['booking requests', 'pending requests', 'reschedule requests', 'reschedule', 'booking changes', 'change requests', 'move appointment', 'customer requests', 'cancellations', 'cancelled appointments', 'accept', 'decline'],
      mk: ['барања за резервација', 'барања за презакажување', 'презакажување', 'промени на термини', 'барања', 'преместување термин', 'откажувања', 'откажани термини'],
      sq: ['kërkesa rezervimi', 'kërkesa për ndryshim orari', 'ndryshim orari', 'ndryshime terminesh', 'kërkesa', 'zhvendos termin', 'anulime', 'termine të anuluara'],
    },
    go: { path: '/requests' },
  },
  {
    id: 'ws.till', title: 'nav.till', crumbs: [], icon: I.register, quick: true, visible: perm('pos.checkout'),
    aliases: {
      en: ['cash register', 'checkout', 'pos', 'point of sale', 'sale', 'sell', 'pay', 'payment', 'take payment', 'gift cards', 'till'],
      mk: ['каса', 'наплата', 'наплати', 'продажба', 'продај', 'плаќање', 'плати', 'подарок картички', 'сметка'],
      sq: ['arka', 'pagesa', 'shitje', 'shit', 'paguaj', 'kartat dhuratë', 'llogaria'],
    },
    go: { path: '/till' },
  },
  {
    id: 'ws.invoices', title: 'till.invoices', crumbs: ['nav.till'], icon: I.invoice, visible: perm('pos.view_invoices'),
    aliases: {
      en: ['invoices', 'receipts', 'refunds', 'refund', 'invoice history', 'sales history'],
      mk: ['фактури', 'сметки', 'поврат', 'рефундирање', 'историја на продажба'],
      sq: ['faturat', 'kthimet', 'rimbursim', 'historiku i shitjeve'],
    },
    go: { path: '/till/invoices' },
  },
  {
    id: 'ws.catalog.services', title: 'navs.ws.services', crumbs: ['nav.catalog'], icon: I.products, quick: true, visible: perm('catalog.view'),
    aliases: {
      en: ['catalog', 'services', 'treatments', 'add service', 'new service', 'service prices', 'prices', 'price list', 'duration', 'menu'],
      mk: ['каталог', 'услуги', 'третмани', 'додади услуга', 'нова услуга', 'цени', 'ценовник', 'времетраење', 'мени'],
      sq: ['katalogu', 'shërbimet', 'trajtimet', 'shto shërbim', 'shërbim i ri', 'çmimet', 'lista e çmimeve', 'kohëzgjatja', 'menyja'],
    },
    go: { path: '/catalog?tab=services' },
  },
  {
    id: 'ws.catalog.products', title: 'navs.ws.products', crumbs: ['nav.catalog'], icon: I.bottle, visible: perm('catalog.view'),
    aliases: {
      en: ['products', 'retail', 'stock', 'inventory', 'stock levels', 'add product'],
      mk: ['производи', 'залиха', 'залихи', 'инвентар', 'додади производ', 'малопродажба'],
      sq: ['produktet', 'stoku', 'inventari', 'shto produkt', 'shitje me pakicë'],
    },
    go: { path: '/catalog?tab=products' },
  },
  {
    id: 'ws.catalog.categories', title: 'navs.ws.categories', crumbs: ['nav.catalog'], icon: I.tag, visible: perm('catalog.view'),
    aliases: {
      en: ['categories', 'service categories', 'request category', 'new category'],
      mk: ['категории', 'категории на услуги', 'побарај категорија', 'нова категорија'],
      sq: ['kategoritë', 'kategoritë e shërbimeve', 'kërko kategori', 'kategori e re'],
    },
    go: { path: '/catalog?tab=categories' },
  },
  {
    id: 'ws.catalog.combos', title: 'navs.ws.combos', crumbs: ['nav.catalog'], icon: I.package, visible: perm('catalog.view'),
    aliases: {
      en: ['combos', 'packages', 'bundles', 'combo deals'],
      mk: ['пакети', 'комбинации', 'комбо'],
      sq: ['paketat', 'kombinimet', 'kombo'],
    },
    go: { path: '/catalog?tab=combos' },
  },
  {
    id: 'ws.suppliers', title: 'nav.suppliers', crumbs: [], icon: I.invoice, visible: perm('suppliers.manage'),
    aliases: {
      en: ['suppliers', 'supplier', 'order supplies', 'purchase order', 'supplier catalog', 'wholesale'],
      mk: ['добавувачи', 'добавувач', 'набавки', 'нарачај материјали', 'каталог на добавувач'],
      sq: ['furnitorët', 'furnitori', 'furnizimet', 'porosit materiale', 'katalogu i furnitorit'],
    },
    go: { path: '/suppliers' },
  },
  {
    id: 'ws.suppliers.orders', title: 'sup.tabOrders', crumbs: ['nav.suppliers'], icon: I.clipboard, visible: perm('suppliers.manage'),
    aliases: {
      en: ['orders', 'purchase orders', 'my orders', 'order status'],
      mk: ['нарачки', 'мои нарачки', 'статус на нарачка'],
      sq: ['porositë', 'porositë e mia', 'statusi i porosisë'],
    },
    go: { path: '/suppliers?tab=orders' },
  },
  {
    id: 'ws.suppliers.deliveries', title: 'sup.tabDeliveries', crumbs: ['nav.suppliers'], icon: I.package, visible: perm('suppliers.manage'),
    aliases: {
      en: ['deliveries', 'receive delivery', 'goods received', 'delivery'],
      mk: ['испораки', 'прием', 'примена испорака', 'достава'],
      sq: ['dërgesat', 'prano dërgesën', 'dorëzimi'],
    },
    go: { path: '/suppliers?tab=deliveries' },
  },
  {
    id: 'ws.customers', title: 'nav.customers', crumbs: [], icon: I.users, quick: true, visible: perm('customers.view_assigned'),
    aliases: {
      en: ['customers', 'clients', 'customer list', 'add customer', 'client card', 'customer file', 'visit history'],
      mk: ['клиенти', 'муштерии', 'листа на клиенти', 'додади клиент', 'картон на клиент', 'историја на посети'],
      sq: ['klientët', 'lista e klientëve', 'shto klient', 'karta e klientit', 'historiku i vizitave'],
    },
    go: { path: '/customers' },
  },
  {
    id: 'ws.marketing.offers', title: 'mkt.tabOffers', crumbs: ['nav.marketing'], icon: I.mail, visible: perm('marketing.personal_offers'),
    aliases: {
      en: ['marketing', 'offers', 'last minute offers', 'personal offers', 'promotions', 'deals', 'send offer'],
      mk: ['маркетинг', 'понуди', 'понуди во последен момент', 'лични понуди', 'промоции', 'испрати понуда'],
      sq: ['marketingu', 'ofertat', 'oferta të minutës së fundit', 'oferta personale', 'promocione', 'dërgo ofertë'],
    },
    go: { path: '/marketing?tab=offers' },
  },
  {
    id: 'ws.marketing.discounts', title: 'mkt.tabDiscounts', crumbs: ['nav.marketing'], icon: I.tag, visible: perm('marketing.personal_offers'),
    aliases: {
      en: ['discount codes', 'promo codes', 'coupons', 'vouchers', 'discount', 'create code'],
      mk: ['кодови за попуст', 'промо кодови', 'купони', 'ваучери', 'попуст', 'креирај код'],
      sq: ['kodet e zbritjes', 'kode promocionale', 'kupona', 'zbritje', 'krijo kod'],
    },
    go: { path: '/marketing?tab=discounts' },
  },
  {
    id: 'ws.marketing.premium', title: 'mkt.tabPremium', crumbs: ['nav.marketing'], icon: I.sparkle, visible: perm('marketing.personal_offers'),
    aliases: {
      en: ['velnes premium', 'premium', 'members', 'membership', 'premium members'],
      mk: ['премиум', 'членови', 'членство', 'премиум членови'],
      sq: ['premium', 'anëtarët', 'anëtarësimi'],
    },
    go: { path: '/marketing?tab=premium' },
  },
  {
    id: 'ws.marketing.loyalty', title: 'mkt.tabLoyalty', crumbs: ['nav.marketing'], icon: I.giftcard, visible: perm('marketing.personal_offers'),
    aliases: {
      en: ['loyalty', 'loyalty card', 'loyalty points', 'points', 'rewards'],
      mk: ['лојалност', 'картичка за лојалност', 'поени', 'награди'],
      sq: ['besnikëria', 'karta e besnikërisë', 'pikët', 'shpërblimet'],
    },
    go: { path: '/marketing?tab=loyalty' },
  },
  {
    id: 'ws.reports', title: 'nav.reports', crumbs: [], icon: I.reports, quick: true, visible: perm('reports.view_own'),
    aliases: {
      en: ['reports', 'statistics', 'stats', 'revenue', 'turnover', 'sales report', 'vat report', 'export csv', 'analytics'],
      mk: ['извештаи', 'статистика', 'приход', 'промет', 'извештај за продажба', 'ддв', 'извоз', 'аналитика'],
      sq: ['raportet', 'statistikat', 'të ardhurat', 'qarkullimi', 'raporti i shitjeve', 'tvsh', 'eksport', 'analitika'],
    },
    go: { path: '/reports' },
  },
  {
    id: 'ws.marketing.reviews', title: 'mkt.tabReviews', crumbs: ['nav.marketing'], icon: I.sparkle, visible: perm('reviews.view'),
    aliases: {
      en: ['reviews', 'ratings', 'customer reviews', 'feedback', 'stars', 'what customers said', 'reputation', 'professional ratings'],
      mk: ['рецензии', 'оценки', 'рејтинг', 'коментари', 'мислења', 'ѕвезди', 'што кажаа клиентите', 'оценки на вработени'],
      sq: ['recensionet', 'vlerësimet', 'komentet', 'yjet', 'çfarë thanë klientët', 'reputacioni', 'vlerësimet e profesionistëve'],
    },
    go: { path: '/marketing?tab=reviews' },
  },
  {
    id: 'ws.support', title: 'nav.support', crumbs: [], icon: I.info,
    aliases: {
      en: ['support', 'help', 'contact velnes', 'ticket', 'report a problem', 'bug', 'question'],
      mk: ['поддршка', 'помош', 'контакт', 'тикет', 'пријави проблем', 'грешка', 'прашање'],
      sq: ['mbështetja', 'ndihmë', 'kontakto velnes', 'kërkesë', 'raporto problem', 'gabim', 'pyetje'],
    },
    go: { path: '/support' },
  },
  // ── Settings ────────────────────────────────────────────────────
  {
    id: 'ws.settings', title: 'nav.settings', crumbs: [], icon: I.gear, visible: perm('users.manage'),
    aliases: { en: ['settings', 'configuration', 'preferences'], mk: ['поставки', 'подесувања', 'конфигурација'], sq: ['cilësimet', 'konfigurimi', 'preferencat'] },
    go: { path: '/settings' },
  },
  {
    id: 'ws.settings.general', title: 'settings.general', crumbs: SET, icon: I.gear, visible: perm('locations.manage'),
    aliases: {
      en: ['general settings', 'language', 'change language', 'timezone', 'time zone'],
      mk: ['општи поставки', 'јазик', 'смени јазик', 'временска зона'],
      sq: ['cilësimet e përgjithshme', 'gjuha', 'ndrysho gjuhën', 'zona kohore'],
    },
    go: { path: '/settings?tab=general' },
  },
  {
    id: 'ws.settings.company', title: 'settings.company', crumbs: SET, icon: I.clipboard, visible: perm('locations.manage'),
    aliases: {
      en: ['company information', 'company info', 'salon name', 'business name', 'phone number', 'salon phone', 'address', 'description', 'pitch', 'website', 'legal entity', 'vat number', 'company details'],
      mk: ['компанија', 'информации за салонот', 'име на салон', 'име на бизнис', 'телефон', 'телефонски број', 'адреса', 'опис', 'веб страница', 'правен субјект', 'даночен број', 'податоци за фирма'],
      sq: ['kompania', 'informacioni i sallonit', 'emri i sallonit', 'emri i biznesit', 'numri i telefonit', 'telefoni', 'adresa', 'përshkrimi', 'faqja e internetit', 'subjekti ligjor', 'numri i tvsh'],
    },
    go: { path: '/settings?tab=company' },
  },
  {
    id: 'ws.settings.socials', title: 'navs.ws.socials', crumbs: [...SET, 'settings.company'], icon: I.chain, visible: perm('locations.manage'),
    aliases: {
      en: ['social media', 'social links', 'instagram', 'facebook', 'tiktok', 'socials'],
      mk: ['социјални мрежи', 'инстаграм', 'фејсбук', 'тикток', 'линкови'],
      sq: ['rrjetet sociale', 'instagram', 'facebook', 'tiktok', 'lidhjet'],
    },
    go: { path: '/settings?tab=company&focus=socials' },
  },
  {
    id: 'ws.settings.gallery', title: 'navs.ws.gallery', crumbs: [...SET, 'settings.company'], icon: I.grid, visible: perm('locations.manage'),
    aliases: {
      en: ['gallery', 'photos', 'pictures', 'images', 'upload photos', 'salon photos', 'salon pictures', 'change photos'],
      mk: ['галерија', 'слики', 'фотографии', 'прикачи слики', 'слики од салонот', 'фотографии од салон'],
      sq: ['galeria', 'fotografitë', 'fotot', 'imazhet', 'ngarko foto', 'fotot e sallonit'],
    },
    go: { path: '/settings?tab=company&focus=gallery' },
  },
  {
    id: 'ws.settings.locations', title: 'settings.locations', crumbs: SET, icon: I.home, quick: true, visible: perm('locations.manage'),
    aliases: {
      en: ['locations', 'location', 'branches', 'rooms', 'map pin', 'location settings', 'edit location'],
      mk: ['локации', 'локација', 'филијали', 'простории', 'мапа', 'поставки за локација', 'уреди локација'],
      sq: ['lokacionet', 'lokacioni', 'degët', 'dhomat', 'harta', 'cilësimet e lokacionit', 'ndrysho lokacionin'],
    },
    go: { path: '/settings?tab=locations' },
  },
  {
    id: 'ws.settings.addLocation', title: 'navs.ws.addLocation', crumbs: [...SET, 'settings.locations'], icon: I.plus, visible: perm('locations.manage'),
    aliases: {
      en: ['add location', 'new location', 'open another location', 'second salon', 'new branch'],
      mk: ['додади локација', 'нова локација', 'отвори нова локација', 'втор салон', 'нова филијала'],
      sq: ['shto lokacion', 'lokacion i ri', 'hap lokacion tjetër', 'sallon i dytë', 'degë e re'],
    },
    go: { path: '/settings?tab=locations&open=add' },
  },
  {
    id: 'ws.settings.amenities', title: 'lset.amenities', crumbs: [...SET, 'settings.locations'], icon: I.hands, visible: perm('locations.manage'),
    terms: AMENITY_KEYS.map((k) => `amenity.${k}`),
    aliases: {
      en: ['amenities', 'amenity', 'facilities', 'facility', 'salon amenities', 'location amenities', 'wifi', 'parking', 'wheelchair access', 'sauna', 'shower', 'lockers', 'air conditioning', 'card payment', 'what we offer'],
      mk: ['погодности', 'погодност', 'содржини', 'погодности на салон', 'погодности на локација', 'вифи', 'паркинг', 'пристап за инвалидска количка', 'сауна', 'туш', 'гардероба', 'клима', 'плаќање со картичка'],
      sq: ['lehtësirat', 'lehtësira', 'komoditetet', 'lehtësirat e sallonit', 'lehtësirat e lokacionit', 'wifi', 'parkim', 'qasje me karrocë', 'sauna', 'dush', 'dollapë', 'klimë', 'pagesë me kartë'],
    },
    go: inLocation('amenities'),
  },
  {
    id: 'ws.settings.cancel', title: 'navs.ws.cancel', crumbs: [...SET, 'settings.locations'], icon: I.x, visible: perm('locations.manage'),
    aliases: {
      en: ['cancellation', 'cancellation policy', 'cancellation window', 'free cancellation', 'cancel hours', 'cancellation rules', 'no show'],
      mk: ['откажување', 'политика за откажување', 'рок за откажување', 'бесплатно откажување', 'правила за откажување'],
      sq: ['anulimi', 'politika e anulimit', 'afati i anulimit', 'anulim falas', 'rregullat e anulimit'],
    },
    go: inLocation('cancel'),
  },
  {
    id: 'ws.settings.hours', title: 'settings.openingHours', crumbs: SET, icon: I.clock, quick: true, visible: perm('locations.manage'),
    aliases: {
      en: ['working hours', 'opening hours', 'business hours', 'open close times', 'hours', 'when we are open', 'schedule', 'working time', 'opening times'],
      mk: ['работно време', 'работни часови', 'време на отворање', 'отворено', 'затворено', 'кога работиме', 'распоред на работа'],
      sq: ['orari i punës', 'orari', 'orët e punës', 'hapur', 'mbyllur', 'kur punojmë', 'koha e punës'],
    },
    go: { path: '/settings?tab=calendar' },
  },
  {
    id: 'ws.settings.exceptions', title: 'navs.ws.exceptions', crumbs: [...SET, 'settings.openingHours'], icon: I.calendar, visible: perm('locations.manage'),
    aliases: {
      en: ['holidays', 'public holidays', 'closed days', 'exceptions', 'special hours', 'day off', 'closed on', 'vacation'],
      mk: ['празници', 'државни празници', 'неработни денови', 'исклучоци', 'посебно работно време', 'слободен ден', 'затворено на', 'одмор'],
      sq: ['festat', 'festat zyrtare', 'ditët e mbyllura', 'përjashtimet', 'orar special', 'ditë pushimi', 'pushime'],
    },
    go: { path: '/settings?tab=calendar&sub=exceptions' },
  },
  {
    id: 'ws.settings.team', title: 'settings.team', crumbs: SET, icon: I.users, quick: true, visible: perm('users.manage'),
    aliases: {
      en: ['team', 'employees', 'staff', 'workers', 'users', 'access', 'my team', 'employee list', 'colleagues'],
      mk: ['тим', 'вработени', 'персонал', 'работници', 'корисници', 'пристап', 'мој тим', 'листа на вработени', 'колеги'],
      sq: ['ekipi', 'punonjësit', 'stafi', 'punëtorët', 'përdoruesit', 'qasja', 'ekipi im', 'lista e punonjësve', 'kolegët'],
    },
    go: { path: '/settings?tab=team' },
  },
  {
    id: 'ws.settings.invite', title: 'navs.ws.invite', crumbs: [...SET, 'settings.team'], icon: I.plus, visible: perm('users.manage'),
    aliases: {
      en: ['add employee', 'add worker', 'invite employee', 'new employee', 'hire', 'add staff', 'add user', 'invite user', 'another worker'],
      mk: ['додади вработен', 'додади работник', 'покани вработен', 'нов вработен', 'вработи', 'додади корисник', 'покани корисник'],
      sq: ['shto punonjës', 'shto punëtor', 'fto punonjës', 'punonjës i ri', 'punëso', 'shto përdorues', 'fto përdorues'],
    },
    go: { path: '/settings?tab=team&open=invite' },
  },
  {
    id: 'ws.settings.roles', title: 'settings.roles', crumbs: SET, icon: I.user, visible: perm('roles.manage'),
    aliases: {
      en: ['roles', 'permissions', 'access rights', 'who can see what', 'manager role', 'role'],
      mk: ['улоги', 'дозволи', 'права', 'права на пристап', 'кој што гледа', 'улога'],
      sq: ['rolet', 'lejet', 'të drejtat', 'të drejtat e qasjes', 'kush sheh çfarë', 'roli'],
    },
    go: { path: '/settings?tab=roles' },
  },
  {
    id: 'ws.settings.schedules', title: 'navs.ws.schedules', crumbs: [...SET, 'settings.employees'], icon: I.clock, visible: perm('users.manage'),
    aliases: {
      en: ['employee hours', 'staff schedule', 'shifts', 'availability', 'skills', 'who does what', 'bookable', 'employee services', 'schedules'],
      mk: ['работно време на вработени', 'распоред на вработени', 'смени', 'достапност', 'вештини', 'кој што работи', 'услуги на вработен'],
      sq: ['orari i punonjësve', 'turnet', 'disponueshmëria', 'aftësitë', 'kush çfarë bën', 'shërbimet e punonjësit'],
    },
    go: { path: '/settings?tab=employees' },
  },
  {
    id: 'ws.settings.ranking', title: 'settings.ranking', crumbs: SET, icon: I.pulse, visible: perm('ranking.manage'),
    aliases: {
      en: ['ranking', 'employee ranking', 'leaderboard', 'targets', 'performance'],
      mk: ['рангирање', 'ранг листа', 'цели', 'перформанси'],
      sq: ['renditja', 'tabela e renditjes', 'objektivat', 'performanca'],
    },
    go: { path: '/settings?tab=ranking' },
  },
  {
    id: 'ws.settings.booking', title: 'settings.booking', crumbs: SET, icon: I.chain, visible: perm('widget.manage'),
    aliases: {
      en: ['online booking', 'booking page', 'widget', 'website booking', 'embed', 'booking link', 'book online'],
      mk: ['онлајн резервации', 'страница за резервации', 'виџет', 'резервации преку веб', 'линк за резервација'],
      sq: ['rezervimi online', 'faqja e rezervimeve', 'widget', 'rezervim nga faqja', 'lidhja e rezervimit'],
    },
    go: { path: '/settings?tab=booking' },
  },
  {
    id: 'ws.settings.marketplace', title: 'settings.marketplace', crumbs: SET, icon: I.sparkle, visible: perm('widget.manage'),
    aliases: {
      en: ['marketplace', 'velnes app', 'listing', 'show prices', 'hide prices', 'visibility', 'public profile', 'be found', 'listed'],
      mk: ['маркетплејс', 'апликација velnes', 'листинг', 'прикажи цени', 'сокриј цени', 'видливост', 'јавен профил'],
      sq: ['tregu', 'aplikacioni velnes', 'listimi', 'shfaq çmimet', 'fshih çmimet', 'dukshmëria', 'profili publik'],
    },
    go: { path: '/settings?tab=marketplace' },
  },
  {
    id: 'ws.settings.customers', title: 'settings.customersSection', crumbs: SET, icon: I.users, visible: perm('customers.view_business'),
    aliases: {
      en: ['customer groups', 'customer discounts', 'customer settings', 'customer form'],
      mk: ['групи на клиенти', 'попусти за клиенти', 'поставки за клиенти'],
      sq: ['grupet e klientëve', 'zbritjet për klientët', 'cilësimet e klientëve'],
    },
    go: { path: '/settings?tab=customers' },
  },
  {
    id: 'ws.settings.sales', title: 'settings.sales', crumbs: SET, icon: I.register, visible: perm('payments.manage'),
    aliases: {
      en: ['sales settings', 'invoice prefix', 'invoice numbers', 'vat rate', 'tax', 'payment methods', 'accept cards', 'card payments', 'cash register settings', 'payments'],
      mk: ['поставки за продажба', 'префикс на фактура', 'броеви на фактури', 'ддв', 'данок', 'начини на плаќање', 'картички', 'плаќања', 'поставки за каса'],
      sq: ['cilësimet e shitjeve', 'prefiksi i faturës', 'numrat e faturave', 'tvsh', 'taksa', 'mënyrat e pagesës', 'pranimi i kartave', 'pagesat', 'cilësimet e arkës'],
    },
    go: { path: '/settings?tab=sales' },
  },
  {
    id: 'ws.settings.audit', title: 'settings.audit', crumbs: SET, icon: I.note, visible: perm('roles.manage'),
    aliases: {
      en: ['audit log', 'history', 'who changed what', 'activity log', 'changes'],
      mk: ['дневник', 'ревизија', 'историја', 'кој што променил', 'активност', 'промени'],
      sq: ['regjistri i auditimit', 'historiku', 'kush çfarë ndryshoi', 'aktiviteti', 'ndryshimet'],
    },
    go: { path: '/settings?tab=audit' },
  },
  {
    id: 'ws.settings.employeeApp', title: 'navs.ws.employeeApp', crumbs: [...SET, 'settings.team'], icon: I.phone, visible: perm('users.manage'),
    aliases: {
      en: ['employee app', 'sign-in link', 'qr code', 'staff app', 'mobile app for staff'],
      mk: ['апликација за вработени', 'линк за најава', 'qr код', 'мобилна апликација'],
      sq: ['aplikacioni i punonjësve', 'lidhja e kyçjes', 'kodi qr', 'aplikacioni celular'],
    },
    go: { path: '/settings?tab=team&open=app' },
  },
];

export const WORKSPACE_INDEX = buildIndex(WORKSPACE_NAV, labelsFromDictionaries);
