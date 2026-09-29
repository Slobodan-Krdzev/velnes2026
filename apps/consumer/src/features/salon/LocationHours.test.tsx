import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LocationHours, todayIndex } from './LocationHours.js';

describe('a location’s week on the salon page', () => {
  afterEach(cleanup);

  it('keys today the way the template does: Monday is 0', () => {
    expect(todayIndex(new Date(2026, 5, 1))).toBe(0); // a Monday
    expect(todayIndex(new Date(2026, 5, 7))).toBe(6); // a Sunday
  });

  it('prints every day, a closed day says so, and today is marked', () => {
    render(
      <LocationHours
        hours={{ '0': [['09:00', '20:00']], '1': [['09:00', '13:00'], ['15:00', '19:00']], '2': [['09:00', '20:00']], '3': [['09:00', '20:00']], '4': [['09:00', '20:00']], '5': [['10:00', '16:00']], '6': null }}
        now={new Date(2026, 5, 2)} // a Tuesday
      />,
    );
    expect(screen.getByText('Opening hours')).toBeTruthy();
    const rows = screen.getAllByRole('definition').map((dd) => dd.textContent);
    expect(rows).toEqual(['09:00–20:00', '09:00–13:00, 15:00–19:00', '09:00–20:00', '09:00–20:00', '09:00–20:00', '10:00–16:00', 'Closed']);
    const today = document.querySelector('.lh-row.today')!;
    expect(today.textContent).toContain('Today');
    expect(today.textContent).toContain('09:00–13:00, 15:00–19:00');
  });

  it('shows nothing when the location has no week set', () => {
    const { container } = render(<LocationHours hours={null} />);
    expect(container.innerHTML).toBe('');
  });
});
