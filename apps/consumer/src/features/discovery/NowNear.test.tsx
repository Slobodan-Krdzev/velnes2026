import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { NowNearD, NowNearM, type NowNear } from './cards.js';

/** The "available now near you" cards: what the search door said, on a
 *  card — the start it can make, the distance, the price, the links. */
const one: NowNear = {
  km: 1.25,
  s: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Sports massage',
    category: 'Massage',
    durationMin: 45,
    price: 1900,
    priceFrom: 1500,
    salon: {
      slug: 'velnes-fizio',
      name: 'Velnes Fizio Centar',
      city: 'Skopje',
      photo: null,
      lat: 41.99,
      lng: 21.43,
      bookable: true,
      showPrices: true,
    },
    availableAt: '14:30',
  } as NowNear['s'],
};

describe('available now near you', () => {
  afterEach(cleanup);

  it('names the start it can make, the distance and the from-price', () => {
    render(
      <MemoryRouter>
        <NowNearD n={one} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Sports massage')).toBeTruthy();
    expect(screen.getByText(/1,2 km from you|1,3 km from you/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Now · 14:30/ })).toBeTruthy();
    expect(screen.getByText(/1.500 MKD/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /View & book/ })).toBeTruthy();
  });

  it('says nothing about distance when the viewer has no position', () => {
    render(
      <MemoryRouter>
        <NowNearM n={{ ...one, km: null }} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/from you/)).toBeNull();
    expect(screen.getByRole('button', { name: /Now · 14:30/ })).toBeTruthy();
  });
});
