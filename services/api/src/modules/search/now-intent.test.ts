import { describe, expect, it } from 'vitest';
import { readNow } from './now-intent.js';

/** "Now", read out of a query in any of the three languages. */
describe('the "now" in a query', () => {
  it('reads it in English, and hands back the rest', () => {
    expect(readNow('massage now')).toEqual({ q: 'massage', now: true });
    expect(readNow('Now massage')).toEqual({ q: 'massage', now: true });
    expect(readNow('haircut right now')).toEqual({ q: 'haircut', now: true });
    expect(readNow('facial asap')).toEqual({ q: 'facial', now: true });
  });

  it('reads it in Macedonian — Cyrillic, and as typed on a Latin keyboard', () => {
    expect(readNow('масажа сега')).toEqual({ q: 'масажа', now: true });
    expect(readNow('веднаш масажа')).toEqual({ q: 'масажа', now: true });
    expect(readNow('masaza sega')).toEqual({ q: 'masaza', now: true });
    expect(readNow('frizer vednash')).toEqual({ q: 'frizer', now: true });
  });

  it('reads it in Albanian, with or without diacritics', () => {
    expect(readNow('masazh tani')).toEqual({ q: 'masazh', now: true });
    expect(readNow('tash masazh')).toEqual({ q: 'masazh', now: true });
    expect(readNow('masazh menjëherë')).toEqual({ q: 'masazh', now: true });
    expect(readNow('masazh menjehere')).toEqual({ q: 'masazh', now: true });
  });

  it('is whole-word: "nowhere" is not now, and neither is a salon called Tanit', () => {
    expect(readNow('nowhere spa')).toEqual({ q: 'nowhere spa', now: false });
    expect(readNow('tanit')).toEqual({ q: 'tanit', now: false });
    expect(readNow('Deep tissue massage')).toEqual({ q: 'deep tissue massage', now: false });
  });

  it('"now" on its own is a request for anything, now', () => {
    expect(readNow('now')).toEqual({ q: '', now: true });
    expect(readNow('  сега ')).toEqual({ q: '', now: true });
    expect(readNow('')).toEqual({ q: '', now: false });
  });
});
