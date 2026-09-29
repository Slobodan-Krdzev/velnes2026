import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SalonAmenities } from './SalonAmenities.js';

describe('amenities on the salon page', () => {
  afterEach(cleanup);

  it('shows nothing at all for a location that has none', () => {
    const { container } = render(<SalonAmenities keys={[]} idPrefix="d" />);
    expect(container.innerHTML).toBe('');
  });

  it('shows up to six in the vocabulary’s order, and the rest behind "Show all"', () => {
    render(<SalonAmenities keys={['sauna', 'coffee_tea', 'wifi', 'shower', 'lockers', 'free_parking', 'steam_room', 'pet_friendly']} idPrefix="d" />);
    expect(screen.getByText('Amenities')).toBeTruthy();
    const rows = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toEqual(['Free Wi-Fi', 'Free parking', 'Shower', 'Lockers', 'Sauna', 'Steam room']);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 8 amenities' }));
    const dlg = screen.getByRole('dialog', { name: 'Amenities' });
    expect(dlg.textContent).toContain('Facilities');
    expect(dlg.textContent).toContain('Spa & wellness');
    expect(dlg.textContent).toContain('Customer experience');
    expect(dlg.textContent).toContain('Coffee / Tea');
    expect(dlg.textContent).toContain('Pet friendly');
  });

  it('has no "Show all" when six or fewer', () => {
    render(<SalonAmenities keys={['wifi', 'sauna']} idPrefix="m" />);
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
  });
});
