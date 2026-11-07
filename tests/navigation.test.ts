import { describe, it, expect } from 'vitest';
import { isAllowedHost, isOAuthUrl, ALLOWED_NAVIGATION_HOSTS } from '../src/main/navigation.js';

describe('Navigation & Host Validation', () => {
  it('allows core Jules and Google OAuth hosts', () => {
    expect(isAllowedHost('https://jules.google.com')).toBe(true);
    expect(isAllowedHost('https://jules.google.com/session')).toBe(true);
    expect(isAllowedHost('https://accounts.google.com/signin/v2')).toBe(true);
    expect(isAllowedHost('https://myaccount.google.com')).toBe(true);
    expect(isAllowedHost('https://apis.google.com/js/api.js')).toBe(true);
  });

  it('rejects external URLs', () => {
    expect(isAllowedHost('https://github.com/OSINTCabal/VibeDeck')).toBe(false);
    expect(isAllowedHost('https://google.com')).toBe(false);
    expect(isAllowedHost('https://malicious-site.com')).toBe(false);
    expect(isAllowedHost('invalid-url')).toBe(false);
  });

  it('correctly identifies OAuth URLs', () => {
    expect(isOAuthUrl('https://accounts.google.com/o/oauth2/auth')).toBe(true);
    expect(isOAuthUrl('https://jules.google.com')).toBe(false);
    expect(isOAuthUrl('https://github.com')).toBe(false);
  });

  it('includes standard allowed hosts list', () => {
    expect(ALLOWED_NAVIGATION_HOSTS).toContain('jules.google.com');
    expect(ALLOWED_NAVIGATION_HOSTS).toContain('accounts.google.com');
  });
});
