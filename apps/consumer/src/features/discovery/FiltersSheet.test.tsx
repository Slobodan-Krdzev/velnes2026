import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_FILTERS } from '../../lib/api/queries.js';
import { FiltersSheet, histogram } from './FiltersSheet.js';

const facets = {
  categories: [],
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
    const bars = histogram([100, 100, 200, 300], 4);
    expect(bars).toEqual([2, 0, 1, 1]);
    expect(histogram([], 4)).toEqual([]);
    expect(histogram([500, 500], 4)[0]).toBe(2);
  });

  it('applies the range, when and amenities together, only on Show results', () => {
    const onApply = vi.fn();
    render(<FiltersSheet facets={facets} filters={NO_FILTERS} onApply={onApply} onClose={() => undefined} />);
    const dlg = screen.getByRole('dialog', { name: 'Filters' });
    expect(within(dlg).getByText('Free Wi-Fi')).toBeTruthy();
    expect(within(dlg).getByText('3.000 MKD+')).toBeTruthy();
    fireEvent.change(within(dlg).getByLabelText('Maximum'), { target: { value: '1500' } });
    fireEvent.click(within(dlg).getByRole('button', { name: /Free Wi-Fi/ }));
    fireEvent.click(within(dlg).getByRole('button', { name: /Available now/ }));
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Show results' }));
    expect(onApply).toHaveBeenCalledWith({ priceMin: null, priceMax: 1500, now: true, amenities: ['wifi'] });
  });

  it('handles at the ends mean any price; Clear all resets the panel', () => {
    const onApply = vi.fn();
    render(<FiltersSheet facets={facets} filters={{ ...NO_FILTERS, amenities: ['sauna'], now: true }} onApply={onApply} onClose={() => undefined} />);
    const dlg = screen.getByRole('dialog', { name: 'Filters' });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Clear all' }));
    fireEvent.click(within(dlg).getByRole('button', { name: 'Show results' }));
    expect(onApply).toHaveBeenCalledWith({ priceMin: null, priceMax: null, now: false, amenities: [] });
  });

  it('says so when nothing publishes a price, and offers no amenities it does not have', () => {
    render(<FiltersSheet facets={{ ...facets, prices: [], amenities: [] }} filters={NO_FILTERS} onApply={() => undefined} onClose={() => undefined} />);
    expect(screen.getByText('Nothing here publishes a price to narrow by.')).toBeTruthy();
    expect(screen.queryByText('Amenities')).toBeNull();
  });
});
