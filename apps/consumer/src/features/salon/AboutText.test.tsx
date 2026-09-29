import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AboutText } from './Salon.js';

describe('About, folded', () => {
  afterEach(cleanup);
  it('a short description just stands', () => {
    render(<AboutText text="Best haircuts in town." />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelector('.about-p.fold')).toBeNull();
  });
  it('a long one folds to five lines and opens on Read more, closes on Read less', () => {
    render(<AboutText text={'Lorem ipsum dolor sit amet. '.repeat(20)} />);
    expect(document.querySelector('.about-p.fold')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Read more' }));
    expect(document.querySelector('.about-p.fold')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Read less' }));
    expect(document.querySelector('.about-p.fold')).toBeTruthy();
  });
});
