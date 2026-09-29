import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SalonAmenities } from './SalonAmenities.js';

describe('amenities on the salon page', () => {
  afterEach(cleanup);

  it('shows nothing at all for a location that has none', () => {
    const { container } = render(<SalonAmenities keys={[]} idPrefix="d" />);
    expect(container.innerHTML).toBe('');
  });

  it('lists every amenity in the vocabulary’s order, with nothing to expand', () => {
    render(<SalonAmenities keys={['sauna', 'coffee_tea', 'wifi', 'shower', 'lockers', 'free_parking', 'steam_room', 'pet_friendly']} idPrefix="d" />);
    expect(screen.getByText('Amenities')).toBeTruthy();
    const rows = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toEqual(['Free Wi-Fi', 'Free parking', 'Shower', 'Lockers', 'Sauna', 'Steam room', 'Coffee / Tea', 'Pet friendly']);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
