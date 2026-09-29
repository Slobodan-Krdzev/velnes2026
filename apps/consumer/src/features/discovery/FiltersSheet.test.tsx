import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_FILTERS } from '../../lib/api/queries.js';
import { FiltersSheet, histogram } from './FiltersSheet.js';

const facets = {
  categories: [
    { id: '11111111-1111-4111-8111-111111111111', name: 'Massage', count: 15 },
    { id: '22222222-2222-4222-8222-222222222222', name: 'Haircuts', count: 41 },
  ],
  price: null,
  prices: [500, 700, 900, 1200, 1500, 1800, 2200, 3000],
  amenities: [
    { key: 'wifi' as const, count: 5 },
    { key: 'sauna' as const, count: 2 },
  ],
};

describe('the filters panel', () => {
  afterEach(cleanup);

  it('buckets prices into bars between the lowest and the highest', () => {
    expect(histogram([100, 100, 200, 300], 4)).toEqual([2, 0, 1, 1]);
    expect(histogram([], 4)).toEqual([]);
    expect(histogram([500, 500], 4)[0]).toBe(2);
  });

  it('applies category (one), range, distance and amenities together, only on the CTA', () => {
    const onApply = vi.fn();
    render(
      <FiltersSheet facets={facets} filters={{ ...NO_FILTERS, radiusKm: 10 }} canDistance nearOn onApply={onApply} onClose={() => undefined} count={(d) => `Show ${d.amenities.length + (d.categoryId ? 1 : 0)} results`} />,
    );
    const dlg = screen.getByRole('dialog', { name: 'Filters' });
    // A category is one, as the door takes it: radios, not boxes.
    fireEvent.click(within(dlg).getByRole('radio', { name: /Haircuts/ }));
    fireEvent.click(within(dlg).getByRole('radio', { name: /Massage/ }));
    expect(within(dlg).getByRole('radio', { name: /Massage/ }).getAttribute('aria-checked')).toBe('true');
    expect(within(dlg).getByRole('radio', { name: /Haircuts/ }).getAttribute('aria-checked')).toBe('false');
    fireEvent.change(within(dlg).getByLabelText('Maximum'), { target: { value: '1500' } });
    fireEvent.click(within(dlg).getByRole('radio', { name: 'Within 5 km' }));
    fireEvent.click(within(dlg).getByRole('button', { name: /Free Wi-Fi/ }));
    expect(onApply).not.toHaveBeenCalled();
    // The CTA counts the draft, not the applied filters.
    fireEvent.click(within(dlg).getByRole('button', { name: 'Show 2 results' }));
    expect(onApply).toHaveBeenCalledWith({
      categoryId: '11111111-1111-4111-8111-111111111111',
      priceBand: null,
      priceMin: null,
      priceMax: 1500,
      amenities: ['wifi'],
      radiusKm: 5,
    });
  });

  it('Clear all takes every refinement off at once, and returns the distance to what Near me set', () => {
    const onApply = vi.fn();
    render(<FiltersSheet facets={facets} filters={{ ...NO_FILTERS, amenities: ['sauna'], priceMax: 1500, radiusKm: 5 }} canDistance nearOn onApply={onApply} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({ categoryId: null, priceBand: null, priceMin: null, priceMax: null, amenities: [], radiusKm: 10 });
  });

  it('offers no distance without a position, no category with only one, and says so when nothing publishes a price', () => {
    render(<FiltersSheet facets={{ ...facets, categories: facets.categories.slice(0, 1), prices: [], amenities: [] }} filters={NO_FILTERS} canDistance={false} nearOn={false} onApply={() => undefined} onClose={() => undefined} />);
    expect(screen.queryByText('Distance')).toBeNull();
    expect(screen.queryByText('Treatments & categories')).toBeNull();
    expect(screen.queryByText('Amenities')).toBeNull();
    expect(screen.getByText('Nothing here publishes a price to narrow by.')).toBeTruthy();
    expect(screen.queryByText('Available now')).toBeNull();
  });
});
