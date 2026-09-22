import { afterEach, describe, expect, it, vi } from 'vitest';

// A mutable fake env so a single file can exercise both the keyed path
// and the no-key degradation. Hoisted so the vi.mock factory can see it.
const { fakeEnv } = vi.hoisted(() => ({
  fakeEnv: { anthropicApiKey: 'test-key', onboardingModel: 'claude-sonnet-5', onboardingProvider: 'claude' },
}));
vi.mock('../../env.js', () => ({ env: fakeEnv }));

const { claudeExtract, htmlToText } = await import('./extract.provider.js');

/** A stubbed Anthropic Messages response carrying one tool_use call. */
function anthropicReturns(input: unknown, status = 200) {
  const body = { content: [{ type: 'tool_use', name: 'salon_profile', input }] };
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe('the Claude onboarding extractor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    fakeEnv.anthropicApiKey = 'test-key';
  });

  it('snaps categories to the taxonomy and clamps duration/price', async () => {
    vi.stubGlobal(
      'fetch',
      anthropicReturns({
        salon: { name: 'Glow Bar', type: 'Beauty salon' },
        services: [
          { name: 'Signature facial', category: 'MANUAL THERAPY', durationMin: 50, price: 1500 },
          { name: 'Quick trim', category: 'Not a real category', durationMin: 0, price: -5 },
        ],
        products: [{ name: 'Face serum', category: 'Retail', price: 800 }],
        hours: [{ day: 'mon', open: '09:00', close: '18:00', closed: false }],
      }),
    );

    const out = await claudeExtract({
      url: 'https://glow.mk/',
      pageText: 'Glow Bar — facials and trims',
      serviceCategories: ['Manual therapy', 'Recovery'],
      productCategories: ['Retail'],
      hints: {},
    });

    expect(out).not.toBeNull();
    // Case-insensitive match snaps to the canonical taxonomy name.
    expect(out!.services[0]).toEqual({
      name: 'Signature facial',
      category: 'Manual therapy',
      durationMin: 50,
      price: 1500,
    });
    // Unknown category → first allowed; 0 duration → 30; negative price → 0.
    expect(out!.services[1]).toEqual({
      name: 'Quick trim',
      category: 'Manual therapy',
      durationMin: 30,
      price: 0,
    });
    // Size, opening stock and cost are the owner's to fill in the wizard;
    // a website rarely says.
    expect(out!.products[0]).toEqual({
      name: 'Face serum',
      category: 'Retail',
      price: 800,
      sizeMl: null,
      stock: 0,
      cost: null,
    });
    expect(out!.salon.type).toBe('Beauty salon');
    expect(out!.hours[0]).toEqual({ day: 'mon', open: '09:00', close: '18:00', closed: false });
  });

  it('converts foreign-currency prices to whole MKD', async () => {
    vi.stubGlobal(
      'fetch',
      anthropicReturns({
        services: [
          { name: 'Express facial', category: 'Skin care', durationMin: 30, price: 7, currency: 'EUR' },
          { name: 'Deluxe facial', category: 'Skin care', durationMin: 60, price: 500, currency: 'MKD' },
          { name: 'Symbol facial', category: 'Skin care', durationMin: 30, price: 10, currency: '€' },
          { name: 'No-currency facial', category: 'Skin care', durationMin: 30, price: 900 },
        ],
        products: [{ name: 'Serum', category: 'Retail', price: 20, currency: 'USD' }],
        hours: [],
      }),
    );
    const out = await claudeExtract({
      url: 'https://x.mk/',
      pageText: 'prices',
      serviceCategories: ['Skin care'],
      productCategories: ['Retail'],
      hints: {},
    });
    const p = (n: string) => out!.services.find((s) => s.name === n)!.price;
    expect(p('Express facial')).toBe(431); // 7 EUR × 61.5 → 430.5 → 431
    expect(p('Deluxe facial')).toBe(500); // already MKD, unchanged
    expect(p('Symbol facial')).toBe(615); // € symbol recognised → 10 × 61.5
    expect(p('No-currency facial')).toBe(900); // no currency → treated as MKD
    expect(out!.products[0]!.price).toBe(1140); // 20 USD × 57
  });

  it('sends the model and tool the API expects', async () => {
    const spy = anthropicReturns({ services: [], products: [], hours: [] });
    vi.stubGlobal('fetch', spy);
    await claudeExtract({
      url: 'https://x.mk/',
      pageText: 'hi',
      serviceCategories: ['Manual therapy'],
      productCategories: [],
      hints: { name: 'X' },
    });
    const [, init] = spy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('claude-sonnet-5');
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'salon_profile' });
    // The category enum is constrained to the taxonomy we passed.
    const svc = body.tools[0].input_schema.properties.services.items.properties.category;
    expect(svc.enum).toEqual(['Manual therapy']);
  });

  it('degrades to null with no key, never calling the model', async () => {
    fakeEnv.anthropicApiKey = '';
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const out = await claudeExtract({
      url: 'https://x.mk/',
      pageText: 'hi',
      serviceCategories: [],
      productCategories: [],
      hints: {},
    });
    expect(out).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('degrades to null on a non-200 or unparseable output', async () => {
    vi.stubGlobal('fetch', anthropicReturns({}, 500));
    expect(
      await claudeExtract({ url: 'x', pageText: '', serviceCategories: [], productCategories: [], hints: {} }),
    ).toBeNull();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));
    expect(
      await claudeExtract({ url: 'x', pageText: '', serviceCategories: [], productCategories: [], hints: {} }),
    ).toBeNull();
  });

  it('htmlToText keeps visible text and drops scripts/styles/tags', () => {
    const text = htmlToText(
      '<html><head><style>a{color:red}</style><script>steal()</script></head><body><h1>Hi</h1> there &amp; welcome</body></html>',
    );
    expect(text).toBe('Hi there & welcome');
    expect(text).not.toContain('steal');
  });
});
