import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapResults, snapTo, type MapResult } from './MapResults.js';

vi.mock('../../lib/geo.js', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    useUserLocation: () => ({ status: 'unsupported', position: null, decision: null, decide: () => undefined, locate: () => undefined, disable: () => undefined }),
  };
});

const r = (i: number): MapResult => ({
  id: `salon-${i}`,
  lat: 41.99 + i * 0.01,
  lng: 21.42,
  name: `Salon ${i}`,
  city: 'Skopje',
  photo: 'none',
  hasPhoto: false,
  pitch: 'Deep, honest massage',
  rating: null,
  bookable: true,
  treatment: 'Sports massage',
  price: '1.900 MKD',
  availableAt: i === 2 ? '14:30' : null,
  href: `/salon/salon-${i}`,
});

function mount(results: MapResult[], onClose = () => undefined) {
  return render(
    <MemoryRouter>
      <MapResults results={results} onClose={onClose} />
    </MemoryRouter>,
  );
}

describe('the map as another view of the answer', () => {
  afterEach(cleanup);

  it('snaps to the nearest state, and a decisive flick goes one step further', () => {
    expect(snapTo(0.44 * 800, 800, 0)).toBe('default');
    expect(snapTo(0.2 * 800, 800, -10)).toBe('collapsed');
    // Flicked up from default by more than a twelfth of the screen: expanded.
    expect(snapTo(0.44 * 800 + 90, 800, 90)).toBe('expanded');
    // Flicked down from default: collapsed.
    expect(snapTo(0.44 * 800 - 90, 800, -90)).toBe('collapsed');
    expect(snapTo(0.9 * 800, 800, 0)).toBe('expanded');
  });

  it('counts the places in the sheet, opens at the default height with cards, and the first is selected', () => {
    mount([r(1), r(2), r(3)]);
    const dlg = screen.getByRole('dialog', { name: 'Map view' });
    expect(within(dlg).getByText('3 places')).toBeTruthy();
    expect(dlg.querySelector('.mr-sheet')?.getAttribute('data-state')).toBe('default');
    const cards = within(dlg).getAllByRole('button', { name: /Salon \d/ });
    expect(cards).toHaveLength(3);
    expect(cards[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(within(dlg).getByText('Available now · starts 14:30')).toBeTruthy();
  });

  it('tapping a card selects it — one selection for the marker and the card', () => {
    mount([r(1), r(2)]);
    const dlg = screen.getByRole('dialog', { name: 'Map view' });
    const cards = within(dlg).getAllByRole('button', { name: /Salon \d/ });
    fireEvent.click(cards[1]!);
    expect(cards[1]!.getAttribute('aria-pressed')).toBe('true');
    expect(cards[0]!.getAttribute('aria-pressed')).toBe('false');
  });

  it('one place is said in the singular; none shows the honest note and no cards', () => {
    mount([r(1)]);
    expect(screen.getByText('1 place')).toBeTruthy();
    cleanup();
    mount([]);
    expect(screen.getByText('No salon here has placed itself on the map yet.')).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: /Salon/ })).toHaveLength(0);
  });

  it('closes from the floating button, leaving the page to keep its state', () => {
    const onClose = vi.fn();
    mount([r(1)], onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
