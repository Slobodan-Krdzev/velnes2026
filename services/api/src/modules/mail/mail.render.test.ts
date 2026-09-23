import { describe, expect, it } from 'vitest';
import { renderMail } from './mail.render.js';

/** The Velnes mail layout: brand, prose, code, button — and nothing a
 *  customer typed can become markup. */
describe('renderMail', () => {
  it('wraps the prose in the Velnes layout with the subject as the heading', () => {
    const { html, text } = renderMail({
      subject: 'Booked at Velnes Fizio Centar',
      body: 'Sports massage on 2026-10-01 at 10:00 is booked.\n\nSee you there.\nBring a towel.',
      salon: 'Velnes Fizio Centar',
    });
    expect(html).toContain('#FF8D67'); // the coral
    expect(html).toContain('<h1');
    expect(html).toContain('Booked at Velnes Fizio Centar');
    expect(html).toContain('<p style=');
    expect(html).toContain('See you there.<br>Bring a towel.');
    expect(html).toContain('Sent by Velnes for Velnes Fizio Centar.');
    expect(text).toContain('Sports massage on 2026-10-01 at 10:00 is booked.');
  });

  it('sets a one-time code large and turns the call to action into a button', () => {
    const { html, text } = renderMail({
      subject: 'Your Velnes verification code',
      body: 'Your Velnes verification code is 482913.',
      meta: { code: '482913', cta: { label: 'Pay for your booking', url: 'https://velnes.mk/pay/abc?t=1' } },
    });
    expect(html).toContain('letter-spacing:8px');
    expect(html).toContain('>482913<');
    expect(html).toContain('href="https://velnes.mk/pay/abc?t=1"');
    expect(html).toContain('>Pay for your booking</a>');
    expect(text).toContain('Pay for your booking: https://velnes.mk/pay/abc?t=1');
    expect(html).toContain('Sent by Velnes.');
  });

  it('escapes what people typed and still links bare URLs', () => {
    const { html } = renderMail({
      subject: 'Note from <script>alert(1)</script>',
      body: 'Their note: "Bring <b>cash</b>" & see https://velnes.mk/x.',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;Bring &lt;b&gt;cash&lt;/b&gt;&quot; &amp; see');
    expect(html).toContain('<a href="https://velnes.mk/x"');
  });
});
