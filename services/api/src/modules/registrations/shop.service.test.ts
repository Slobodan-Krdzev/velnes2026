import { describe, expect, it } from 'vitest';
import { collectShopLinks, crawlShop, guessProductCategory, paginationLinks, parsePrice, parseProductTiles } from './shop.service.js';

/**
 * The web shop read as a catalogue (Alex, 2026-10-02): tiles of three
 * shop families, prices in the shapes salons write them, pagination,
 * and the bounded walk — all on fixtures, no network.
 */
const HOME = 'https://shop.example.mk/';
const OPENCART = `<html><body>
<nav><a href="/kerastase">KÉRASTASE</a><a href="/olaplex">OLAPLEX</a><a href="/account/login">најавете се</a>
<a href="/checkout/cart">Кошничка</a><a href="/information/contact">Контакт</a>
<a href="/kerastase/kerastase-bain-hydra-glaze-hydrating-brightening-shampoo-for-long-frizz-prone-hair-refill-500ml">x</a></nav>
<div class="box-product product-list">
 <div>
  <div class="image"><a href="/kerastase/kerastase-13"><img src="/image/cache/data/k/trio-400x400.jpg" alt="Kérastase Mini Hero Trio Set"></a></div>
  <div class="name"><a href="/kerastase/kerastase-13">Kérastase Mini Hero Trio Set</a></div>
  <div class="description">Сет од мини производи за нега на косата.</div>
  <div class="price">3.300 ден.</div>
 </div>
 <div>
  <div class="image"><a href="/kerastase/bain-satin"><img src="/image/cache/data/k/satin-400x400.jpg" alt="Kérastase Bain Satin Riche 500ml"></a></div>
  <div class="name"><a href="/kerastase/bain-satin">Kérastase Bain Satin Riche 500ml</a></div>
  <div class="price"><span class="price-old">2.900 ден.</span> <span class="price-new">2.650 ден.</span></div>
 </div>
 <div>
  <div class="name"><a href="/kerastase/elixir">Kérastase Elixir Ultime 75ml</a></div>
  <div class="price">4.450 ден.</div>
 </div>
</div>
<div class="pagination"><a href="/kerastase?page=2">2</a><a href="/kerastase?page=3">3</a><a href="/olaplex?page=2">x</a></div>
</body></html>`;
const WOO = `<ul class="products">
<li class="product type-product"><a href="https://shop.example.mk/product/olaplex-no-3/" class="woocommerce-LoopProduct-link"><img data-src="https://shop.example.mk/wp-content/uploads/no3.jpg" src="data:image/gif;base64,R0lGOD" alt=""><h2 class="woocommerce-loop-product__title">Olaplex No. 3 Hair Perfector 100ml</h2><span class="price"><del><span class="woocommerce-Price-amount">€ 32,00</span></del><ins><span class="woocommerce-Price-amount">€ 28,50</span></ins></span></a><a href="/?add-to-cart=1" class="button">Add to cart</a></li>
<li class="product"><a href="https://shop.example.mk/product/no-4/"><h2 class="woocommerce-loop-product__title">Olaplex No. 4 Shampoo 250ml</h2><span class="price"><span class="woocommerce-Price-amount">1,850.00 MKD</span></span></a></li>
<li class="product"><a href="https://shop.example.mk/product/no-5/"><h2 class="woocommerce-loop-product__title">Olaplex No. 5 Conditioner 250ml</h2><span class="price">1.850 ден</span></a></li>
</ul><nav><a href="https://shop.example.mk/shop/page/2/">2</a></nav>`;
const JSONLD = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList","itemListElement":[{"@type":"Product","name":"Moroccanoil Treatment 100ml","image":"https://shop.example.mk/i/mo.jpg","description":"Argan oil treatment.","url":"https://shop.example.mk/p/mo","offers":{"@type":"Offer","price":"2200","priceCurrency":"MKD"}}]}</script></head><body></body></html>`;

describe('prices as salons write them', () => {
  it('reads thousands dots, decimal commas, symbols before and after', () => {
    expect(parsePrice('1.090 ден.')).toEqual({ amount: 1090, currency: 'MKD' });
    expect(parsePrice('€ 28,50')).toEqual({ amount: 28.5, currency: 'EUR' });
    expect(parsePrice('1,850.00 MKD')).toEqual({ amount: 1850, currency: 'MKD' });
    expect(parsePrice('2650 den')).toEqual({ amount: 2650, currency: 'MKD' });
    expect(parsePrice('$12')).toEqual({ amount: 12, currency: 'USD' });
    expect(parsePrice('no price here')).toBeNull();
  });
});

describe('product tiles', () => {
  it('OpenCart: name, the current price when there is an old one, image, description; one product per link', () => {
    const tiles = parseProductTiles(OPENCART, HOME + 'kerastase');
    expect(tiles.map((t) => [t.name, t.price, t.currency])).toEqual([
      ['Kérastase Mini Hero Trio Set', 3300, 'MKD'],
      ['Kérastase Bain Satin Riche 500ml', 2650, 'MKD'],
      ['Kérastase Elixir Ultime 75ml', 4450, 'MKD'],
    ]);
    expect(tiles[0]!.img).toBe('https://shop.example.mk/image/cache/data/k/trio-400x400.jpg');
    expect(tiles[0]!.description).toBe('Сет од мини производи за нега на косата.');
    expect(tiles[1]!.img).toContain('satin-400x400');
  });
  it('WooCommerce: the sale price, the lazy image, the title inside the link; the add-to-cart link is not a product', () => {
    const tiles = parseProductTiles(WOO, HOME + 'shop/');
    expect(tiles.map((t) => [t.name, t.price, t.currency])).toEqual([
      ['Olaplex No. 3 Hair Perfector 100ml', 28.5, 'EUR'],
      ['Olaplex No. 4 Shampoo 250ml', 1850, 'MKD'],
      ['Olaplex No. 5 Conditioner 250ml', 1850, 'MKD'],
    ]);
    expect(tiles[0]!.img).toBe('https://shop.example.mk/wp-content/uploads/no3.jpg');
  });
  it('JSON-LD Product data is read as it is', () => {
    const tiles = parseProductTiles(JSONLD, HOME);
    expect(tiles).toEqual([{ name: 'Moroccanoil Treatment 100ml', price: 2200, currency: 'MKD', img: 'https://shop.example.mk/i/mo.jpg', description: 'Argan oil treatment.', url: 'https://shop.example.mk/p/mo' }]);
  });
});

describe('listing pages and pagination', () => {
  it('offers brand and category links first, never account, cart, contact or long product slugs', () => {
    const links = collectShopLinks(OPENCART, HOME);
    expect(links.slice(0, 2)).toEqual(['https://shop.example.mk/kerastase', 'https://shop.example.mk/olaplex']);
    expect(links.some((l) => /account|cart|contact|refill-500ml/.test(l))).toBe(false);
  });
  it('reads the other pages of the same listing only', () => {
    expect(paginationLinks(OPENCART, HOME + 'kerastase')).toEqual(['https://shop.example.mk/kerastase?page=2', 'https://shop.example.mk/kerastase?page=3']);
    expect(paginationLinks(WOO, HOME + 'shop/')).toEqual(['https://shop.example.mk/shop/page/2/']);
  });
});

describe('the walk', () => {
  it('follows listings and their pages within the limits, dedupes by link and by name', async () => {
    const page2 = OPENCART.replace('kerastase-13', 'kerastase-14').replace('Mini Hero Trio Set', 'Mini Hero Trio Set').replace('bain-satin', 'bain-satin-2').replace('Bain Satin Riche 500ml', 'Bain Satin Riche 250ml');
    const site: Record<string, string> = {
      'https://shop.example.mk/kerastase': OPENCART,
      'https://shop.example.mk/kerastase?page=2': page2,
      'https://shop.example.mk/kerastase?page=3': '<html><body>nothing</body></html>',
      'https://shop.example.mk/olaplex': WOO.replace(/shop\/page\/2\//, 'olaplex?page=2'),
    };
    const fetched: string[] = [];
    const out = await crawlShop('<a href="/kerastase">K</a><a href="/olaplex">O</a>', HOME, async (u) => {
      fetched.push(u);
      return site[u] ?? null;
    });
    expect(out.listings).toBe(2);
    // Listings are walked a few at a time, so only the set is fixed.
    expect(out.products.map((p) => p.name).sort()).toEqual(
      [
        'Kérastase Mini Hero Trio Set',
        'Kérastase Bain Satin Riche 500ml',
        'Kérastase Elixir Ultime 75ml',
        'Kérastase Bain Satin Riche 250ml',
        'Olaplex No. 3 Hair Perfector 100ml',
        'Olaplex No. 4 Shampoo 250ml',
        'Olaplex No. 5 Conditioner 250ml',
      ].sort(),
    );
    expect(fetched).toContain('https://shop.example.mk/kerastase?page=3');
  });
  it('stops at the product limit', async () => {
    const out = await crawlShop('<a href="/kerastase">K</a>', HOME, async () => OPENCART, { candidates: 40, pages: 80, pagesPerListing: 15, products: 2, minTiles: 3, concurrency: 4, budgetMs: 60_000 });
    expect(out.products).toHaveLength(2);
  });
});

describe('a category from the name', () => {
  const cats = ['Home exercise', 'Recovery aids', 'Supports', 'Hair care', 'Skin care'];
  it('files hair, skin and gear by family, else the first', () => {
    expect(guessProductCategory('Kérastase Bain Satin Riche шампон', cats)).toBe('Hair care');
    expect(guessProductCategory('Hydrating face cream SPF 30', cats)).toBe('Skin care');
    expect(guessProductCategory('Resistance band set', cats)).toBe('Home exercise');
    expect(guessProductCategory('Gift voucher', cats)).toBe('Home exercise');
  });
});
