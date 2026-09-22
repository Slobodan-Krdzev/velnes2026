import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Rail } from './Rail.js';

/** The sliding rows: an arrow scrolls the track and never leaves the
 *  page; the arrow at an end is switched off. jsdom lays nothing out,
 *  so the track's measurements are stated. */
function lay(el: HTMLElement, { scrollWidth, clientWidth, scrollLeft }: { scrollWidth: number; clientWidth: number; scrollLeft: number }) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
  Object.defineProperty(el, 'scrollLeft', { configurable: true, value: scrollLeft, writable: true });
}

describe('Rail', () => {
  afterEach(cleanup);

  it('the next arrow scrolls the track forward by about a view, and the back arrow is off at the start', () => {
    const { container } = render(
      <Rail track="reco2">
        <article>one</article>
        <article>two</article>
      </Rail>,
    );
    const track = container.querySelector<HTMLElement>('.rail-track')!;
    lay(track, { scrollWidth: 2000, clientWidth: 1000, scrollLeft: 0 });
    const scrollBy = vi.fn();
    track.scrollBy = scrollBy as unknown as HTMLElement['scrollBy'];
    fireEvent.scroll(track);
    expect((screen.getByLabelText('Scroll back') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Scroll forward') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByLabelText('Scroll forward'));
    expect(scrollBy).toHaveBeenCalledWith({ left: 900, behavior: 'smooth' });
    // Nothing navigated: the row is still on the page.
    expect(container.querySelector('.rail')).not.toBeNull();
  });

  it('at the end the next arrow is off and the back arrow scrolls backwards', () => {
    const { container } = render(
      <Rail track="avail4">
        <article>one</article>
      </Rail>,
    );
    const track = container.querySelector<HTMLElement>('.rail-track')!;
    lay(track, { scrollWidth: 2000, clientWidth: 1000, scrollLeft: 1000 });
    const scrollBy = vi.fn();
    track.scrollBy = scrollBy as unknown as HTMLElement['scrollBy'];
    fireEvent.scroll(track);
    expect((screen.getByLabelText('Scroll forward') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Scroll back'));
    expect(scrollBy).toHaveBeenCalledWith({ left: -900, behavior: 'smooth' });
  });
});
