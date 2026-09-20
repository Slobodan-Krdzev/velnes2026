import { API_PREFIX, SearchResultsSchema } from '@velnes/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../db/index.js';
import { resetAdmittedCache } from './discovery.routes.js';
import { buildServer } from '../server.js';

/**
 * Step 7 of the Search phase — docs/SEARCH.md.
 *
 * A submitted search. The rules under test are the ones a customer
 * would notice being broken: typing a salon's name goes there, typing
 * something that only resembles it never does, and a typed query is
 * answered by the same pipeline a category card is — not a second one.
 *
 * Against the seeded world, which is one listed salon — Velnes Fizio
 * Centar — and its eight physiotherapy treatments across four
 * categories. Deliberately not the developer's database: a suite
 * written against whatever is sitting in dev passes for one person.
 */

const app = await buildServer();
const P = `${API_PREFIX}/public`;

async function search(body: Record<string, unknown>) {
  resetAdmittedCache();
  const res = await app.inject({ method: 'POST', url: `${P}/discovery/search`, payload: body });
  expect(res.statusCode).toBe(200);
  return SearchResultsSchema.parse(res.json());
}
const q = (text: string) => search({ q: text });

describe('a submitted search', () => {
  beforeAll(() => app.ready());
  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('says nothing at all below the threshold, and echoes what was asked', async () => {
    const r = await q('v');
    expect(r.services).toEqual([]);
    expect(r.directSalon).toBeNull();
    expect(r.how).toBe('none');
    // Echoed, so a client can throw away a response that arrives late.
    expect(r.q).toBe('v');
  });

  describe('naming a salon outright', () => {
    it('goes there instead of answering with a page', async () => {
      const r = await q('Velnes Fizio Centar');
      expect(r.how).toBe('salon');
      expect(r.directSalon?.slug).toBe('velnes-fizio');
      // Nothing is ranked, because there is nothing to rank: this is an
      // address, not a search.
      expect(r.services).toEqual([]);
      expect(r.ambiguous).toBe(false);
    });

    it('ignores case and spacing, because typing is not an exam', async () => {
      const r = await q('  velnes   fizio centar ');
      expect(r.directSalon?.slug).toBe('velnes-fizio');
    });

    it('refuses on a prefix — half a name is not a name', async () => {
      const r = await q('Velnes');
      expect(r.directSalon).toBeNull();
      // And the salon is still offered, rather than the page pretending
      // it found nothing.
      expect(r.salons.map((s) => s.slug)).toContain('velnes-fizio');
    });

    it('never redirects on something the text merely resembles', async () => {
      // One letter away from the whole name. A typo must not be able to
      // land somebody inside a salon.
      const r = await q('Velnes Fizio Centarr');
      expect(r.directSalon).toBeNull();
      expect(r.how).not.toBe('salon');
    });
  });

  describe('naming a treatment', () => {
    it('leads with it, and fills the page from its category — saying so', async () => {
      const r = await q('Sports massage');
      expect(r.how).toBe('service');
      expect(r.services[0]?.name).toBe('Sports massage');
      // Its Recovery sibling comes too. That is a broadening, and a
      // broadening is always labelled.
      expect(r.services.length).toBeGreaterThan(1);
      expect(r.widened).toBe('category');
    });

    it('finds what the text only resembles', async () => {
      const r = await q('sport masage');
      expect(r.how).toBe('fuzzy');
      expect(r.services.map((s) => s.name)).toContain('Sports massage');
      expect(r.directSalon).toBeNull();
    });
  });

  describe('naming an intent', () => {
    it('reads a synonym as a category and answers with the whole of it', async () => {
      // "fizio" is four categories in the term table; the seeded world
      // publishes services in all four.
      const r = await q('fizio');
      expect(r.how).toBe('category');
      expect(r.services.length).toBeGreaterThanOrEqual(4);
      // An intent asked for a category outright — nothing was widened
      // to fill the page.
      expect(r.widened).toBeNull();
    });

    it('offers no category that nobody publishes in', async () => {
      // "nails" is a real term, and this world sells no manicures. The
      // honest answer is an empty page, not somebody else's services.
      const r = await q('nails');
      expect(r.services).toEqual([]);
      expect(r.directSalon).toBeNull();
    });
  });

  it('understands nothing gracefully', async () => {
    const r = await q('qqzzxw');
    expect(r.how).toBe('none');
    expect(r.services).toEqual([]);
    expect(r.salons).toEqual([]);
    expect(r.directSalon).toBeNull();
  });

  it('is one pipeline, not two', async () => {
    // A typed intent and the category card for the same intent are two
    // entrances to one room: the same admission decides who is in it,
    // and the same versioned rules decide the order.
    const cats = await app.inject({ method: 'GET', url: `${P}/discovery/categories` });
    const manual = (cats.json() as { categories: { id: string; name: string }[] }).categories.find(
      (c) => c.name === 'Manual therapy',
    )!;
    const byCard = await app.inject({
      method: 'POST',
      url: `${P}/discovery/categories/${manual.id}/services`,
      payload: {},
    });
    const byText = await q('manual therapy');

    expect(byText.rankVersion).toBe(byCard.json().rankVersion);
    const ids = (xs: { id: string }[]) => xs.map((s) => s.id).sort();
    expect(ids(byText.services)).toEqual(ids(byCard.json().services));
  });

  it('adds text relevance to that pipeline and nothing else', async () => {
    // The order may legitimately differ from the card's, and only for
    // this reason: the text named something, and a service whose name
    // answers the text outranks one that only shares its category. If
    // the two doors ever diverge further than this, they have become
    // two ranking systems.
    const r = await q('manual therapy');
    expect(r.services[0]?.name).toBe('Manual therapy, spine');
  });

  it('does not personalise for somebody who is not signed in', async () => {
    const r = await q('fizio');
    expect(r.personalised).toBe(false);
    // And still says which rules produced the order.
    expect(r.rankVersion).toBeGreaterThan(0);
  });

  it('admits only what the consumer surface admits', async () => {
    // Every result is bookable and belongs to the one listed salon —
    // the Phase B admission, unchanged by the text door.
    const r = await q('fizio');
    expect(r.services.length).toBeGreaterThan(0);
    for (const s of r.services) {
      expect(s.salon.slug).toBe('velnes-fizio');
      expect(s.salon.bookable, 'unbookable never competes here').toBe(true);
    }
  });
});
