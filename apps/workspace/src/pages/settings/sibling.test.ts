import { siblingAppUrl } from '@velnes/ui';
import { afterEach, describe, expect, it } from 'vitest';

/** A sibling app's origin follows from this app's own hostname, so
 *  nothing has to be configured on the host; an explicit URL still wins. */
describe('siblingAppUrl', () => {
  const original = window.location;
  const at = (href: string) => {
    Object.defineProperty(window, 'location', { configurable: true, value: new URL(href) });
  };
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: original });
  });

  it('swaps the first label in production', () => {
    at('https://workspace.slobodankrdzev.com/settings');
    expect(siblingAppUrl(undefined, 'employee', 5174)).toBe('https://employee.slobodankrdzev.com');
    at('https://hq.slobodankrdzev.com/');
    expect(siblingAppUrl(undefined, 'workspace', 5173)).toBe('https://workspace.slobodankrdzev.com');
  });

  it('falls back to the sibling dev port on localhost', () => {
    at('http://localhost:5173/');
    expect(siblingAppUrl(undefined, 'employee', 5174)).toBe('http://localhost:5174');
  });

  it('an explicit URL wins, without a trailing slash', () => {
    at('https://workspace.slobodankrdzev.com/');
    expect(siblingAppUrl('https://staff.example.org/', 'employee', 5174)).toBe('https://staff.example.org');
  });
});
