import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BIZFAB_SETTLE_MS, BizFab } from './BizFab.js';

/** The phone home's floating "Velnes for Business": the desktop door,
 *  hidden while the page scrolls, back once it has been still. */
describe('the floating business button', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('is the same door as the desktop header button', () => {
    render(<BizFab />);
    const a = screen.getByRole('link', { name: 'Velnes for Business' });
    expect(a.getAttribute('href')).toMatch(/\/onboarding$/);
    expect(a.className).toBe('m-bizfab');
  });

  it('steps aside while the page scrolls and returns once it is still', () => {
    render(<BizFab />);
    const a = screen.getByTestId('bizfab');
    act(() => {
      fireEvent.scroll(window);
    });
    expect(a.className).toContain('hid');
    expect(a.getAttribute('tabindex')).toBe('-1');
    // Still scrolling: the timer restarts, the button stays away.
    act(() => {
      vi.advanceTimersByTime(BIZFAB_SETTLE_MS - 20);
      fireEvent.scroll(window);
      vi.advanceTimersByTime(BIZFAB_SETTLE_MS - 20);
    });
    expect(a.className).toContain('hid');
    act(() => {
      vi.advanceTimersByTime(40);
    });
    expect(a.className).toBe('m-bizfab');
    expect(a.getAttribute('tabindex')).toBeNull();
  });
});
