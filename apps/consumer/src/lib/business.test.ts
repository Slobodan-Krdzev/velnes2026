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

  it('keeps the machine IP a phone on the LAN uses, with the workspace port (not workspace.168.0.25)', () => {
    vi.stubGlobal('location', { protocol: 'http:', hostname: '192.168.0.25' });
    expect(businessOnboardingUrl()).toBe('http://192.168.0.25:5173/onboarding');
  });
});
