import { describe, it, expect } from 'vitest';
import { ChromeCookieImporter } from '../src/main/cookieimport.js';

describe('ChromeCookieImporter', () => {
  const importer = new ChromeCookieImporter();

  it('instantiates and provides expected methods', () => {
    expect(importer).toBeDefined();
    expect(typeof importer.findChromeCookieDb).toBe('function');
    expect(typeof importer.getEncryptionKey).toBe('function');
    expect(typeof importer.extractAndDecryptCookies).toBe('function');
    expect(typeof importer.importToSession).toBe('function');
  });

  it('locates or safely checks for Chrome cookie database', () => {
    const dbPath = importer.findChromeCookieDb();
    // On Linux test machine, this may return path or null
    if (dbPath) {
      expect(typeof dbPath).toBe('string');
      expect(dbPath).toContain('Cookies');
    } else {
      expect(dbPath).toBeNull();
    }
  });

  it('derives a valid 16-byte AES encryption key', () => {
    const key = importer.getEncryptionKey();
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(16);
  });
});
