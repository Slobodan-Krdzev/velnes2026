/**
 * Towns, for the search sheet's "Where?" (Alex, 2026-09-28).
 *
 * Two lists, both static and honest about what they are:
 *
 *  - `FAMOUS_TOWNS` — the well-known places offered as quick picks under
 *    "Nearby", in this order. A pick is a filter on `businesses.city`;
 *    a town nobody is in yet says so on its row and answers honestly on
 *    the results page.
 *  - `KNOWN_TOWNS` — the gazetteer the field autocompletes from: the
 *    towns of North Macedonia and the larger ones of Albania and Kosovo
 *    (the wizard's three countries), with Cyrillic and Albanian aliases
 *    where people type them. The platform's own towns (those with
 *    salons, from the towns door) are merged in front, with counts.
 *
 * Latin names are the canonical form because that is how salons enter
 * their town at registration; matching is accent-insensitive.
 */

export interface KnownTown {
  name: string;
  aliases?: string[];
}

export const FAMOUS_TOWNS = ['Skopje', 'Bitola', 'Kumanovo', 'Ohrid', 'Prilep', 'Tetovo', 'Veles', 'Štip'] as const;

export const KNOWN_TOWNS: KnownTown[] = [
  { name: 'Skopje', aliases: ['Скопје', 'Shkup'] },
  { name: 'Bitola', aliases: ['Битола', 'Manastir'] },
  { name: 'Kumanovo', aliases: ['Куманово', 'Kumanovë'] },
  { name: 'Ohrid', aliases: ['Охрид', 'Ohër'] },
  { name: 'Prilep', aliases: ['Прилеп'] },
  { name: 'Tetovo', aliases: ['Тетово', 'Tetovë'] },
  { name: 'Veles', aliases: ['Велес'] },
  { name: 'Štip', aliases: ['Штип', 'Stip', 'Shtip'] },
  { name: 'Gostivar', aliases: ['Гостивар'] },
  { name: 'Strumica', aliases: ['Струмица', 'Strumicë'] },
  { name: 'Kavadarci', aliases: ['Кавадарци'] },
  { name: 'Kočani', aliases: ['Кочани', 'Kocani'] },
  { name: 'Struga', aliases: ['Струга', 'Strugë'] },
  { name: 'Kičevo', aliases: ['Кичево', 'Kicevo', 'Kërçovë'] },
  { name: 'Radoviš', aliases: ['Радовиш', 'Radovis'] },
  { name: 'Gevgelija', aliases: ['Гевгелија'] },
  { name: 'Debar', aliases: ['Дебар', 'Dibër'] },
  { name: 'Kriva Palanka', aliases: ['Крива Паланка'] },
  { name: 'Sveti Nikole', aliases: ['Свети Николе'] },
  { name: 'Negotino', aliases: ['Неготино'] },
  { name: 'Delčevo', aliases: ['Делчево', 'Delcevo'] },
  { name: 'Vinica', aliases: ['Виница'] },
  { name: 'Resen', aliases: ['Ресен'] },
  { name: 'Probištip', aliases: ['Пробиштип', 'Probistip'] },
  { name: 'Berovo', aliases: ['Берово'] },
  { name: 'Kratovo', aliases: ['Кратово'] },
  { name: 'Makedonski Brod', aliases: ['Македонски Брод'] },
  { name: 'Demir Hisar', aliases: ['Демир Хисар'] },
  { name: 'Demir Kapija', aliases: ['Демир Капија'] },
  { name: 'Valandovo', aliases: ['Валандово'] },
  { name: 'Bogdanci', aliases: ['Богданци'] },
  { name: 'Pehčevo', aliases: ['Пехчево', 'Pehcevo'] },
  { name: 'Makedonska Kamenica', aliases: ['Македонска Каменица'] },
  { name: 'Kruševo', aliases: ['Крушево', 'Krusevo'] },
  { name: 'Dojran', aliases: ['Дојран'] },
  { name: 'Tirana', aliases: ['Tiranë', 'Тирана'] },
  { name: 'Durrës', aliases: ['Durres', 'Драч'] },
  { name: 'Shkodër', aliases: ['Shkoder', 'Скадар'] },
  { name: 'Elbasan' },
  { name: 'Vlorë', aliases: ['Vlore', 'Валона'] },
  { name: 'Korçë', aliases: ['Korce', 'Корча'] },
  { name: 'Pogradec' },
  { name: 'Pristina', aliases: ['Prishtinë', 'Prishtina', 'Приштина'] },
  { name: 'Prizren', aliases: ['Призрен'] },
  { name: 'Peja', aliases: ['Pejë', 'Peć', 'Пеќ'] },
  { name: 'Gjakova', aliases: ['Gjakovë', 'Ѓаковица'] },
  { name: 'Mitrovica', aliases: ['Mitrovicë', 'Митровица'] },
  { name: 'Ferizaj', aliases: ['Урошевац'] },
  { name: 'Gjilan', aliases: ['Гњилане'] },
];

/** Accent- and case-insensitive: "stip" finds "Štip", "Скопје" finds Skopje. */
export function normTown(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export interface TownHit {
  name: string;
  /** Salons listed there, when the platform knows of any. */
  salons: number;
}

/**
 * Autocomplete: the platform's own towns (with their counts) merged
 * with the gazetteer, matched on the name or any alias by prefix first,
 * then anywhere in the word; towns with salons first, then the
 * gazetteer's order. At most `limit`.
 */
export function matchTowns(query: string, platform: TownHit[], limit = 8): TownHit[] {
  const q = normTown(query);
  if (!q) return [];
  const counts = new Map(platform.map((p) => [normTown(p.name), p.salons]));
  // A platform town keeps its gazetteer aliases, so "Скопје" still
  // finds the Skopje that has salons.
  const byName = new Map(KNOWN_TOWNS.map((k) => [normTown(k.name), k]));
  const all: KnownTown[] = [
    ...platform.map((p): KnownTown => {
      const known = byName.get(normTown(p.name));
      return known?.aliases ? { name: p.name, aliases: known.aliases } : { name: p.name };
    }),
    ...KNOWN_TOWNS.filter((k) => !counts.has(normTown(k.name))),
  ];
  const score = (k: KnownTown): number => {
    const names = [k.name, ...(k.aliases ?? [])].map(normTown);
    if (names.some((n) => n.startsWith(q))) return 2;
    if (names.some((n) => n.includes(q))) return 1;
    return 0;
  };
  return all
    .map((k, i) => ({ k, s: score(k), i }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (counts.get(normTown(b.k.name)) ?? 0) - (counts.get(normTown(a.k.name)) ?? 0) || a.i - b.i)
    .slice(0, limit)
    .map((x) => ({ name: x.k.name, salons: counts.get(normTown(x.k.name)) ?? 0 }));
}
