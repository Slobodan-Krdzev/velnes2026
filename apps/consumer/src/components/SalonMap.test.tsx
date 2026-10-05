import { describe, expect, it } from 'vitest';
import { ratingHtml, velnesPinHtml, type MapPin } from './SalonMap.js';

/** The Velnes pin (Alex, 2026-10-05): a white circle ringed in the brand
 *  colour with the mark inside; selected, a pill with the salon's public
 *  line and its verified score. */
const pin: MapPin = {
  lat: 41.99,
  lng: 21.43,
  label: 'Velnes Fizio <Centar>',
  pitch: 'Physiotherapy that gets you moving again',
  rating: { avg: 4.75, count: 12 },
  price: 'from 1.500 MKD',
  sub2: 'Now · 14:30',
};

describe('the Velnes map pin', () => {
  it('carries the mark in a ringed circle', () => {
    const html = velnesPinHtml(pin, false);
    expect(html).toContain('class="vpin"');
    expect(html).toContain('vpin-dot');
    expect(html).toContain('vpin-mark');
    expect(html).not.toContain('vpin-lbl');
  });

  it('selected, says the name, the public line, the score and the card line — escaped', () => {
    const html = velnesPinHtml(pin, true);
    expect(html).toContain('class="vpin sel"');
    expect(html).toContain('<b>Velnes Fizio &lt;Centar&gt;</b>');
    expect(html).toContain('<small class="vpin-pitch">Physiotherapy that gets you moving again</small>');
    expect(html).toContain('<b>4.8</b><span class="c">(12)</span>');
    expect(html).toContain('<small>from 1.500 MKD · Now · 14:30</small>');
  });

  it('shows no star for a salon nobody has reviewed', () => {
    expect(ratingHtml(null)).toBe('');
    expect(ratingHtml({ avg: 0, count: 0 })).toBe('');
    expect(velnesPinHtml({ ...pin, rating: null, pitch: null }, true)).not.toContain('vrate');
  });
});
