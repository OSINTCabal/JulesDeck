/**
 * Client Identity & User-Agent setup for Google OAuth / Jules compatibility.
 * Eliminates Electron tokens, derives consistent Chromium Client Hints,
 * and provides OAuth-safe fallback identities when Google's Botguard
 * blocks embedded Chromium webviews (error 403 / rrk=46).
 */

export interface ClientHintsConfig {
  chromeVersion: string;
  arch?: string;
}

export interface ClientHintsValues {
  brands: string;
  mobile: string;
  platform: string;
  fullVersionList: string;
  arch: string;
  bitness: string;
  platformVersion: string;
  model: string;
}

export const OAUTH_COMPAT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64; rv:134.0) Gecko/20100101 Firefox/134.0';

/**
 * Builds the exact Chrome Linux User-Agent string:
 * Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/<chromeVersion> Safari/537.36
 */
export function buildUserAgent(chromeVersion: string): string {
  if (!chromeVersion) {
    throw new Error('Chrome version must not be empty');
  }
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
}

/**
 * Returns true if a given URL is a Google Authentication / OAuth endpoint.
 */
export function isGoogleAuthUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'accounts.google.com' ||
      host.endsWith('.accounts.google.com') ||
      host === 'accounts.youtube.com' ||
      host === 'oauth2.googleapis.com'
    );
  } catch {
    return url.includes('accounts.google.com');
  }
}

/**
 * Derives consistent Client Hints from Chrome version and platform architecture.
 */
export function deriveClientHints(config: ClientHintsConfig): ClientHintsValues {
  const { chromeVersion, arch = 'x64' } = config;
  const majorVersion = chromeVersion.split('.')[0] || '156';

  return {
    brands: `"Not(A:Brand";v="99", "Google Chrome";v="${majorVersion}", "Chromium";v="${majorVersion}"`,
    mobile: '?0',
    platform: '"Linux"',
    fullVersionList: `"Not(A:Brand";v="99.0.0.0", "Google Chrome";v="${chromeVersion}", "Chromium";v="${chromeVersion}"`,
    arch: arch === 'x64' ? '"x86"' : `"${arch}"`,
    bitness: arch === 'x64' ? '"64"' : '"32"',
    platformVersion: '""',
    model: '""'
  };
}

/**
 * Normalizes request headers so that User-Agent and any Sec-CH-UA* Client Hints
 * match an official desktop browser without leaking Electron tokens.
 */
export function sanitizeRequestHeaders(
  headers: Record<string, string | string[] | undefined>,
  chromeVersion: string,
  userAgent: string,
  arch = 'x64',
  url?: string
): Record<string, string> {
  const isAuth = url ? isGoogleAuthUrl(url) : false;
  const effectiveUA = isAuth ? OAUTH_COMPAT_USER_AGENT : userAgent;

  const result: Record<string, string> = {};
  const hints = deriveClientHints({ chromeVersion, arch });

  let hasClientHints = false;

  for (const [key, val] of Object.entries(headers)) {
    if (val === undefined) continue;
    const lower = key.toLowerCase();
    const strVal = Array.isArray(val) ? val.join(', ') : String(val);

    if (lower === 'user-agent') {
      result['User-Agent'] = effectiveUA;
      continue;
    }

    if (lower.startsWith('sec-ch-ua')) {
      if (isAuth) {
        continue;
      }
      hasClientHints = true;
      continue;
    }

    result[key] = strVal;
  }

  result['User-Agent'] = effectiveUA;

  if (isAuth) {
    return result;
  }

  if (hasClientHints) {
    result['sec-ch-ua'] = hints.brands;
    result['sec-ch-ua-mobile'] = hints.mobile;
    result['sec-ch-ua-platform'] = hints.platform;
  }

  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'sec-ch-ua-full-version-list') {
      result['sec-ch-ua-full-version-list'] = hints.fullVersionList;
    } else if (lower === 'sec-ch-ua-arch') {
      result['sec-ch-ua-arch'] = hints.arch;
    } else if (lower === 'sec-ch-ua-bitness') {
      result['sec-ch-ua-bitness'] = hints.bitness;
    } else if (lower === 'sec-ch-ua-platform-version') {
      result['sec-ch-ua-platform-version'] = hints.platformVersion;
    } else if (lower === 'sec-ch-ua-model') {
      result['sec-ch-ua-model'] = hints.model;
    }
  }

  return result;
}
