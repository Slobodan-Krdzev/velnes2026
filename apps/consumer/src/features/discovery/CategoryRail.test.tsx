import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { CategoryVM } from '../../lib/api/mappers.js';
import { CategoryRail } from './CategoryRail.js';

/** The shelf loops by laying the list out three times and stepping the
 *  scroll position back a lap at the seams. Layout itself cannot be
 *  measured here (jsdom has none), so this covers the part that can:
 *  what gets rendered, and when looping is worth doing at all. */

const cat = (n: number): CategoryVM => ({
  id: `c${n}`,
  slug: `c${n}`,
  name: `Category ${n}`,
  img: 'var(--im)',
  iconUrl: null,
});

const railOf = (howMany: number) =>
  render(
    <MemoryRouter>
      <CategoryRail categories={Array.from({ length: howMany }, (_, i) => cat(i + 1))} />
    </MemoryRouter>,
  );

afterEach(cleanup);

describe('the category shelf', () => {
  it('lays a long list out three times, so it can loop either way', () => {
    railOf(10);
    expect(document.querySelectorAll('.catcard')).toHaveLength(30);
    expect(screen.getAllByText('Category 1')).toHaveLength(3);
    // Both directions are offered, because the row has no end.
    expect(screen.getByLabelText('Previous categories')).toBeTruthy();
    expect(screen.getByLabelText('More categories')).toBeTruthy();
  });

  it('leaves a short list alone — a loop of three would just jitter', () => {
    railOf(3);
    expect(document.querySelectorAll('.catcard')).toHaveLength(3);
    expect(screen.queryByLabelText('More categories')).toBeNull();
  });

  it('renders nothing at all before the taxonomy arrives', () => {
    const { container } = railOf(0);
    expect(container.firstChild).toBeNull();
  });
});
