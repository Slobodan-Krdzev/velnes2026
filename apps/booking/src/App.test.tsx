import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';

describe('Velnes Booking app shell', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the typed health response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            status: 'ok',
            version: '0.0.1',
            time: new Date().toISOString(),
          }),
      }),
    );
    render(<App />);
    expect(screen.getByText('Velnes Booking')).toBeDefined();
    await waitFor(() => {
      expect(screen.getByText(/API ok/)).toBeDefined();
    });
  });
});
