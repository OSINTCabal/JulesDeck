/**
 * System-Browser Handoff & Cookie Importer
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync, execFileSync } from 'node:child_process';
import { shell } from 'electron';

export interface DecryptedCookie {
  host_key: string;
  name: string;
  path: string;
  is_secure: number;
  is_httponly: number;
  expires_utc: number;
  value: string;
}

export interface CookieImportResult {
  success: boolean;
  importedCount: number;
  message: string;
  details?: string;
}

/**
 * Decrypts a Chromium Linux encrypted cookie buffer.
 * Supports v10 (pure AES-128-CBC) and v11 (AES-128-CBC with 32-byte SHA-256 prefix).
 * Returns null if decryption fails or format is unrecognized.
 */
export function decryptCookieBuffer(enc: Buffer, key: Buffer): string | null {
  if (enc.length < 4) return null;

  const prefix = enc.subarray(0, 3).toString('latin1');
  if (prefix !== 'v10' && prefix !== 'v11') {
    return null;
  }

  try {
    const iv = Buffer.alloc(16, 0x20); // 16 spaces
    const ciphertext = enc.subarray(3);
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(true);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    if (prefix === 'v11') {
      // In Linux Chromium v11, the first 32 bytes are a verification hash (SHA-256)
      return decrypted.length > 32
        ? decrypted.subarray(32).toString('utf8')
        : decrypted.toString('utf8');
    }

    // v10 is pure AES-128-CBC decrypted plaintext
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

export interface ICookieImporter {
  openInSystemBrowser(targetUrl?: string): Promise<void>;
  findChromeCookieDb(): string | null;
  getEncryptionKey(): Buffer;
  extractAndDecryptCookies(dbPath: string, key: Buffer): DecryptedCookie[];
  importToSession(ses: Electron.Session): Promise<CookieImportResult>;
}

export class ChromeCookieImporter implements ICookieImporter {
  async openInSystemBrowser(targetUrl = 'https://jules.google.com'): Promise<void> {
    await shell.openExternal(targetUrl);
  }

  findChromeCookieDb(): string | null {
    const home = os.homedir();
    const candidatePaths = [
      path.join(home, '.config', 'google-chrome', 'Default', 'Cookies'),
      path.join(home, '.config', 'google-chrome', 'Default', 'Network', 'Cookies'),
      path.join(home, '.config', 'chromium', 'Default', 'Cookies'),
      path.join(home, '.config', 'chromium', 'Default', 'Network', 'Cookies'),
      path.join(home, '.config', 'google-chrome-beta', 'Default', 'Cookies'),
      path.join(home, '.config', 'BraveSoftware', 'Brave-Browser', 'Default', 'Cookies')
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    return null;
  }

  getEncryptionKey(): Buffer {
    let password = 'peanuts';
    try {
      const secret = execSync('secret-tool lookup application chrome', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000
      }).trim();
      if (secret) {
        password = secret;
      }
    } catch {
      // Fall back to 'peanuts' per Linux Chromium defaults
    }

    return crypto.pbkdf2Sync(password, 'saltysalt', 1, 16, 'sha1');
  }

  extractAndDecryptCookies(dbPath: string, key: Buffer): DecryptedCookie[] {
    const tmpCopy = path.join(
      os.tmpdir(),
      `jules_cookie_import_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`
    );

    try {
      fs.copyFileSync(dbPath, tmpCopy);
    } catch (err) {
      throw new Error(`Failed to copy Chrome cookie database: ${String(err)}`, { cause: err });
    }

    const query =
      'SELECT host_key, name, path, is_secure, is_httponly, expires_utc, hex(encrypted_value) as enc_hex ' +
      "FROM cookies WHERE host_key LIKE '%google.com' OR host_key LIKE '%googleusercontent.com';";

    let rawOutput: string;
    try {
      rawOutput = execFileSync('sqlite3', ['-json', tmpCopy, query], {
        encoding: 'utf8',
        timeout: 8000,
        stdio: ['ignore', 'pipe', 'ignore']
      });
    } catch (err) {
      try {
        fs.unlinkSync(tmpCopy);
      } catch {
        // ignore
      }
      throw new Error(`sqlite3 query failed on cookie database: ${String(err)}`, { cause: err });
    } finally {
      try {
        if (fs.existsSync(tmpCopy)) fs.unlinkSync(tmpCopy);
      } catch {
        // ignore
      }
    }

    let rows: Array<{
      host_key: string;
      name: string;
      path: string;
      is_secure: number;
      is_httponly: number;
      expires_utc: number;
      enc_hex: string;
    }>;

    try {
      rows = JSON.parse(rawOutput || '[]');
    } catch {
      return [];
    }

    const results: DecryptedCookie[] = [];

    for (const row of rows) {
      if (!row.enc_hex) continue;
      const enc = Buffer.from(row.enc_hex, 'hex');
      const value = decryptCookieBuffer(enc, key);
      if (value !== null) {
        results.push({
          host_key: row.host_key,
          name: row.name,
          path: row.path || '/',
          is_secure: row.is_secure,
          is_httponly: row.is_httponly,
          expires_utc: row.expires_utc,
          value
        });
      }
    }

    return results;
  }

  async importToSession(ses: Electron.Session): Promise<CookieImportResult> {
    const dbPath = this.findChromeCookieDb();
    if (!dbPath) {
      return {
        success: false,
        importedCount: 0,
        message: 'No Chrome or Chromium cookie database was found on this system.',
        details: 'Expected ~/.config/google-chrome/Default/Cookies'
      };
    }

    let key: Buffer;
    try {
      key = this.getEncryptionKey();
    } catch (err) {
      return {
        success: false,
        importedCount: 0,
        message: 'Failed to access desktop secret service (org.freedesktop.secrets / libsecret).',
        details: String(err)
      };
    }

    let cookies: DecryptedCookie[];
    try {
      cookies = this.extractAndDecryptCookies(dbPath, key);
    } catch (err) {
      return {
        success: false,
        importedCount: 0,
        message: 'Failed to read or decrypt cookies from Chrome database.',
        details: String(err)
      };
    }

    if (cookies.length === 0) {
      return {
        success: false,
        importedCount: 0,
        message: 'No Google session cookies found in your system Chrome browser.',
        details: 'Open https://jules.google.com in Google Chrome, sign in, then try import again.'
      };
    }

    let importedCount = 0;
    for (const cookie of cookies) {
      try {
        const cleanHost = cookie.host_key.startsWith('.')
          ? cookie.host_key.slice(1)
          : cookie.host_key;
        const url = `http${cookie.is_secure === 1 ? 's' : ''}://${cleanHost}${cookie.path || '/'}`;

        let expirationDate: number | undefined;
        if (cookie.expires_utc && cookie.expires_utc > 0) {
          const unixMs = (cookie.expires_utc - 11644473600000000) / 1000;
          if (unixMs > Date.now()) {
            expirationDate = Math.floor(unixMs / 1000);
          }
        }

        await ses.cookies.set({
          url,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.host_key.startsWith('.') ? cookie.host_key : undefined,
          path: cookie.path || '/',
          secure: cookie.is_secure === 1,
          httpOnly: cookie.is_httponly === 1,
          sameSite: cookie.is_secure === 1 ? 'no_restriction' : 'lax',
          expirationDate
        });
        importedCount++;
      } catch (err) {
        console.warn(`[COOKIE:SET:WARN] Failed to set ${cookie.name} on ${cookie.host_key}:`, err);
      }
    }

    return {
      success: importedCount > 0,
      importedCount,
      message: `Successfully imported ${importedCount} session cookies from system Google Chrome.`
    };
  }
}
