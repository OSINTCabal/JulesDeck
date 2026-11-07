import { describe, it, expect } from 'vitest';
import {
  buildUserAgent,
  deriveClientHints,
  sanitizeRequestHeaders,
  isGoogleAuthUrl,
  OAUTH_COMPAT_USER_AGENT
} from '../src/main/identity.js';

describe('Identity & Client Hints', () => {
  const chromeVersion = '156.0.8078.48';
  const expectedUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.48 Safari/537.36';

  it('builds a clean User-Agent without Electron or application branding', () => {
    const ua = buildUserAgent(chromeVersion);
    expect(ua).toBe(expectedUA);
    expect(ua).not.toContain('Electron');
    expect(ua).not.toContain('jules-desktop');
    expect(ua).toContain(`Chrome/${chromeVersion}`);
  });

  it('throws an error if Chrome version is empty', () => {
    expect(() => buildUserAgent('')).toThrow('Chrome version must not be empty');
  });

  it('correctly identifies Google OAuth URLs', () => {
    expect(isGoogleAuthUrl('https://accounts.google.com/v3/signin/identifier')).toBe(true);
    expect(isGoogleAuthUrl('https://accounts.google.com/ServiceLogin')).toBe(true);
    expect(isGoogleAuthUrl('https://oauth2.googleapis.com/token')).toBe(true);
    expect(isGoogleAuthUrl('https://jules.google.com/session')).toBe(false);
    expect(isGoogleAuthUrl('https://github.com')).toBe(false);
  });

  it('derives consistent Client Hints based on Chrome version', () => {
    const hints = deriveClientHints({ chromeVersion, arch: 'x64' });
    expect(hints.brands).toBe('"Not(A:Brand";v="99", "Google Chrome";v="156", "Chromium";v="156"');
    expect(hints.mobile).toBe('?0');
    expect(hints.platform).toBe('"Linux"');
    expect(hints.fullVersionList).toBe(`"Not(A:Brand";v="99.0.0.0", "Google Chrome";v="${chromeVersion}", "Chromium";v="${chromeVersion}"`);
    expect(hints.arch).toBe('"x86"');
    expect(hints.bitness).toBe('"64"');
  });

  it('sanitizes request headers for standard endpoints and strips Electron tokens', () => {
    const rawHeaders: Record<string, string> = {
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Electron/45.0.0 Safari/537.36',
      'sec-ch-ua': '"Electron";v="45", "Chromium";v="156"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Linux"',
      'Sec-CH-UA-Full-Version-List': '"Electron";v="45.0.0", "Chromium";v="156.0.8078.48"',
      'accept': 'text/html'
    };

    const sanitized = sanitizeRequestHeaders(
      rawHeaders,
      chromeVersion,
      expectedUA,
      'x64',
      'https://jules.google.com/session'
    );

    expect(sanitized['User-Agent']).toBe(expectedUA);
    expect(sanitized['sec-ch-ua']).toBe('"Not(A:Brand";v="99", "Google Chrome";v="156", "Chromium";v="156"');
    expect(sanitized['sec-ch-ua-mobile']).toBe('?0');
    expect(sanitized['sec-ch-ua-platform']).toBe('"Linux"');
    expect(sanitized['sec-ch-ua-full-version-list']).toBe(
      `"Not(A:Brand";v="99.0.0.0", "Google Chrome";v="${chromeVersion}", "Chromium";v="${chromeVersion}"`
    );
    expect(sanitized['accept']).toBe('text/html');

    for (const val of Object.values(sanitized)) {
      expect(val).not.toContain('Electron');
    }
  });

  it('suppresses client hints and uses OAuth fallback identity for Google Auth endpoints', () => {
    const rawHeaders: Record<string, string> = {
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Electron/45.0.0 Safari/537.36',
      'sec-ch-ua': '"Chromium";v="156"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Linux"'
    };

    const sanitized = sanitizeRequestHeaders(
      rawHeaders,
      chromeVersion,
      expectedUA,
      'x64',
      'https://accounts.google.com/v3/signin/identifier'
    );

    expect(sanitized['User-Agent']).toBe(OAUTH_COMPAT_USER_AGENT);
    expect(sanitized['sec-ch-ua']).toBeUndefined();
    expect(sanitized['sec-ch-ua-mobile']).toBeUndefined();
    expect(sanitized['sec-ch-ua-platform']).toBeUndefined();
  });
});
