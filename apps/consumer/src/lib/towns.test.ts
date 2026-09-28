import { describe, expect, it } from 'vitest';
import { FAMOUS_TOWNS, matchTowns } from './towns.js';

describe('towns for "Where?"', () => {
  const platform = [
    { name: 'Skopje', salons: 5 },
    { name: 'Ohrid', salons: 1 },
  ];
  it('names the well-known places, Skopje first', () => {
    expect(FAMOUS_TOWNS[0]).toBe('Skopje');
    expect(FAMOUS_TOWNS).toContain('Kumanovo');
    expect(FAMOUS_TOWNS).toContain('Veles');
  });
  it('autocompletes by prefix first, accent- and script-insensitive, counts where the platform has salons', () => {
    expect(matchTowns('sko', platform)[0]).toEqual({ name: 'Skopje', salons: 5 });
    expect(matchTowns('Скоп', platform)[0]?.name).toBe('Skopje');
    expect(matchTowns('stip', platform)[0]?.name).toBe('Štip');
    expect(matchTowns('ohr', platform)[0]).toEqual({ name: 'Ohrid', salons: 1 });
    expect(matchTowns('kum', platform)[0]).toEqual({ name: 'Kumanovo', salons: 0 });
  });
  it('a town the platform knows outranks a gazetteer town on the same match', () => {
    const hits = matchTowns('o', [{ name: 'Ohrid', salons: 1 }]).map((h) => h.name);
    expect(hits[0]).toBe('Ohrid');
  });
  it('says nothing for nothing, and never more than the limit', () => {
    expect(matchTowns('  ', platform)).toEqual([]);
    expect(matchTowns('a', platform, 3)).toHaveLength(3);
  });
});
