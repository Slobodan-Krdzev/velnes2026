import { afterEach, describe, expect, it, vi } from 'vitest';
import { businessOnboardingUrl } from './business.js';

describe('where "Velnes for Business" goes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('names the workspace app on the same domain, at its onboarding', () => {
    vi.stubGlobal('location', { protocol: 'https:', hostname: 'marketplace.slobodankrdzev.com' });
    expect(businessOnboardingUrl()).toBe('https://workspace.slobodankrdzev.com/onboarding');
  });

  it('falls back to the workspace dev server on localhost', () => {
    vi.stubGlobal('location', { protocol: 'http:', hostname: 'localhost' });
    expect(businessOnboardingUrl()).toBe('http://localhost:5173/onboarding');
  });
});
