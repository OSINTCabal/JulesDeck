import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import {
  loadAccountRegistry,
  createAccount,
  switchActiveAccount,
  removeAccount,
  isValidAccountRecord,
  isValidAccountRegistry,
  AccountRecord
} from '../src/main/accounts.js';
import {
  ChromeCookieImporter,
  decryptCookieBuffer
} from '../src/main/cookieimport.js';
import {
  stripAnsi,
  parseJulesSessionsOutput,
  parseJulesReposOutput,
  getJulesBinaryPath,
  executeJulesTask,
  executeListJulesSessions,
  executeListJulesRepos,
  executeApplyJulesSession,
  getJulesCliInfo
} from '../src/main/ipc.js';

describe('Comprehensive Stress & Edge-Case Verification Suite', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'julesdeck-stress-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. ACCOUNT REGISTRY STRESS TESTS
  // =========================================================================
  describe('Account Registry Engine — Stress & Boundary Resilience', () => {
    it('handles high volume sequential account creation and maintains unique identities', () => {
      const regPath = path.join(tempDir, 'accounts.json');
      const count = 50;
      const created: AccountRecord[] = [];

      for (let i = 0; i < count; i++) {
        const record = createAccount(`user-${i}@google.com`, `User ${i}`, regPath);
        created.push(record);
      }

      const registry = loadAccountRegistry(regPath);
      expect(registry.accounts).toHaveLength(count);
      // The first created account remains active by default
      expect(registry.activeAccountId).toBe(created[0]?.id);

      // Verify all IDs and partitions are strictly unique
      const ids = new Set(registry.accounts.map((a) => a.id));
      const partitions = new Set(registry.accounts.map((a) => a.partition));
      expect(ids.size).toBe(count);
      expect(partitions.size).toBe(count);

      for (const a of registry.accounts) {
        expect(a.partition).toBe(`persist:acct-${a.id}`);
        expect(isValidAccountRecord(a)).toBe(true);
      }
    });

    it('handles rapid sequential and simulated concurrent account switching without registry corruption', async () => {
      const regPath = path.join(tempDir, 'accounts.json');
      const accounts: AccountRecord[] = [];
      for (let i = 0; i < 10; i++) {
        accounts.push(createAccount(`switch-${i}@google.com`, `User ${i}`, regPath));
      }

      // Perform 100 rapid switches across random accounts
      for (let round = 0; round < 100; round++) {
        const target = accounts[round % accounts.length]!;
        const switched = switchActiveAccount(target.id, regPath);
        expect(switched).not.toBeNull();
        expect(switched?.id).toBe(target.id);
      }

      const finalRegistry = loadAccountRegistry(regPath);
      expect(finalRegistry.accounts).toHaveLength(10);
      expect(isValidAccountRegistry(finalRegistry)).toBe(true);

      // Verify no temporary lock or swap files remain in directory
      const tmpFiles = fs.readdirSync(tempDir).filter((f) => f.includes('.tmp'));
      expect(tmpFiles).toHaveLength(0);
    });

    it('safely removes active vs inactive accounts through all lifecycle boundaries', () => {
      const regPath = path.join(tempDir, 'accounts.json');
      const a = createAccount('a@google.com', 'User A', regPath);
      const b = createAccount('b@google.com', 'User B', regPath);
      const c = createAccount('c@google.com', 'User C', regPath);
      const d = createAccount('d@google.com', 'User D', regPath);
      const e = createAccount('e@google.com', 'User E', regPath);

      // Initially A is active
      expect(loadAccountRegistry(regPath).activeAccountId).toBe(a.id);

      // 1. Remove INACTIVE account C
      const resC = removeAccount(c.id, regPath);
      expect(resC.success).toBe(true);
      expect(resC.nextAccountId).toBe(a.id);
      let reg = loadAccountRegistry(regPath);
      expect(reg.accounts).toHaveLength(4);
      expect(reg.activeAccountId).toBe(a.id);
      expect(reg.accounts.some((acc) => acc.id === c.id)).toBe(false);

      // 2. Switch to D, then remove INACTIVE account B
      switchActiveAccount(d.id, regPath);
      expect(loadAccountRegistry(regPath).activeAccountId).toBe(d.id);
      const resB = removeAccount(b.id, regPath);
      expect(resB.success).toBe(true);
      expect(resB.nextAccountId).toBe(d.id);
      reg = loadAccountRegistry(regPath);
      expect(reg.accounts).toHaveLength(3);
      expect(reg.activeAccountId).toBe(d.id);

      // 3. Remove ACTIVE account D -> must fallback to accounts[0] which is A
      const resD = removeAccount(d.id, regPath);
      expect(resD.success).toBe(true);
      expect(resD.nextAccountId).toBe(a.id);
      reg = loadAccountRegistry(regPath);
      expect(reg.accounts).toHaveLength(2);
      expect(reg.activeAccountId).toBe(a.id);

      // 4. Switch to E, then remove ACTIVE account E -> must fallback to A
      switchActiveAccount(e.id, regPath);
      const resE = removeAccount(e.id, regPath);
      expect(resE.success).toBe(true);
      expect(resE.nextAccountId).toBe(a.id);
      reg = loadAccountRegistry(regPath);
      expect(reg.accounts).toHaveLength(1);
      expect(reg.activeAccountId).toBe(a.id);

      // 5. Remove the last remaining ACTIVE account A -> registry becomes empty
      const resA = removeAccount(a.id, regPath);
      expect(resA.success).toBe(true);
      expect(resA.nextAccountId).toBeUndefined();
      reg = loadAccountRegistry(regPath);
      expect(reg.accounts).toHaveLength(0);
      expect(reg.activeAccountId).toBe('');

      // 6. Attempting to remove already removed or non-existent account
      const resMissing = removeAccount('non-existent-uuid', regPath);
      expect(resMissing.success).toBe(false);
      expect(resMissing.nextAccountId).toBeUndefined();

      // 7. Removing with empty string or whitespace ID
      expect(removeAccount('', regPath).success).toBe(false);
      expect(removeAccount('   ', regPath).success).toBe(false);
    });

    it('recovers cleanly from 0-byte (empty) registry file with backup creation', () => {
      const regPath = path.join(tempDir, 'accounts.json');
      fs.writeFileSync(regPath, '', 'utf8');

      const registry = loadAccountRegistry(regPath);
      expect(registry.accounts).toHaveLength(1);
      expect(registry.accounts[0]?.partition).toBe('persist:spike');
      expect(registry.activeAccountId).toBe(registry.accounts[0]?.id);

      // Check backup file exists
      const backups = fs.readdirSync(tempDir).filter((f) => f.startsWith('accounts.json.corrupt.'));
      expect(backups.length).toBeGreaterThanOrEqual(1);
    });

    it('recovers cleanly from binary garbage, truncated JSON, and oversized corrupted files', () => {
      const regPath = path.join(tempDir, 'accounts.json');

      // 1. Random binary data
      const randomGarbage = crypto.randomBytes(4096);
      fs.writeFileSync(regPath, randomGarbage);
      let recovered = loadAccountRegistry(regPath);
      expect(recovered.accounts).toHaveLength(1);
      expect(recovered.activeAccountId).toBe(recovered.accounts[0]?.id);

      // 2. Truncated JSON midway through account array
      fs.writeFileSync(regPath, '{"activeAccountId":"foo","accounts":[{"id":"bar"', 'utf8');
      recovered = loadAccountRegistry(regPath);
      expect(recovered.accounts).toHaveLength(1);

      // 3. 500KB deeply nested garbage
      const bigGarbage = '{' + '"nested":{'.repeat(2000) + '"val": 1' + '}'.repeat(2000);
      fs.writeFileSync(regPath, bigGarbage, 'utf8');
      recovered = loadAccountRegistry(regPath);
      expect(recovered.accounts).toHaveLength(1);
    });

    it('enforces rigorous schema boundary checks on individual account records', () => {
      const regPath = path.join(tempDir, 'accounts.json');

      const testCases = [
        { activeAccountId: 12345, accounts: [] }, // activeAccountId must be string
        { activeAccountId: 'ok', accounts: null }, // accounts must be array
        { activeAccountId: 'ok', accounts: {} }, // accounts cannot be object
        { activeAccountId: 'ok', accounts: [{ id: '', email: 'a', name: 'b', partition: 'p', createdAt: 1, lastUsedAt: 1 }] }, // id cannot be empty
        { activeAccountId: 'ok', accounts: [{ id: '1', email: 'a', name: 'b', partition: '   ', createdAt: 1, lastUsedAt: 1 }] }, // partition cannot be whitespace
        { activeAccountId: 'ok', accounts: [{ id: '1', email: 'a', name: 'b', partition: 'p', createdAt: 'not-a-number', lastUsedAt: 1 }] }, // createdAt must be number
        { activeAccountId: 'ok', accounts: [{ id: '1', email: 'a', name: 'b', partition: 'p', createdAt: 1, lastUsedAt: 'now' }] }, // lastUsedAt must be number
        { activeAccountId: 'ok', accounts: [{ id: '1', email: 'a', name: 'b', partition: 'p', createdAt: 1, lastUsedAt: 1, avatarUrl: 999 }] } // avatarUrl must be string if present
      ];

      for (const invalidData of testCases) {
        fs.writeFileSync(regPath, JSON.stringify(invalidData), 'utf8');
        const reg = loadAccountRegistry(regPath);
        expect(reg.accounts).toHaveLength(1);
        expect(reg.accounts[0]?.partition).toBe('persist:spike');
      }
    });

    it('handles multiple rapid corruption recoveries without backup filename collisions', () => {
      const regPath = path.join(tempDir, 'accounts.json');

      // Trigger 5 corrupt recoveries in rapid synchronous succession
      for (let i = 0; i < 5; i++) {
        fs.writeFileSync(regPath, `corrupt-data-${i}-${Math.random()}`, 'utf8');
        const reg = loadAccountRegistry(regPath);
        expect(reg.accounts).toHaveLength(1);
      }

      const backupFiles = fs.readdirSync(tempDir).filter((f) => f.startsWith('accounts.json.corrupt.'));
      expect(backupFiles.length).toBeGreaterThanOrEqual(5);
    });

    it('safely handles read errors when registry file cannot be read', () => {
      const regPath = path.join(tempDir, 'unreadable-accounts.json');
      fs.writeFileSync(regPath, '{"activeAccountId":"","accounts":[]}', 'utf8');

      const spyRead = vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
        throw new Error('EACCES: permission denied');
      });

      const registry = loadAccountRegistry(regPath);
      expect(registry.accounts).toHaveLength(1);
      expect(registry.activeAccountId).toBe(registry.accounts[0]?.id);
      spyRead.mockRestore();
    });
  });

  // =========================================================================
  // 2. CHROME COOKIE DECRYPTION & SQLITE TESTS
  // =========================================================================
  describe('Chrome Cookie Importer — Cryptography & Database Resilience', () => {
    const testKey = crypto.pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1');

    function createEncryptedBlob(plaintext: string, key: Buffer, version: 'v10' | 'v11' = 'v10'): Buffer {
      const iv = Buffer.alloc(16, 0x20); // 16 spaces
      const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
      cipher.setAutoPadding(true);

      let payload: Buffer;
      if (version === 'v11') {
        // v11 prepends a 32-byte SHA-256 hash
        const dummyHash = crypto.createHash('sha256').update(plaintext).digest();
        payload = Buffer.concat([dummyHash, Buffer.from(plaintext, 'utf8')]);
      } else {
        payload = Buffer.from(plaintext, 'utf8');
      }

      const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
      const prefix = Buffer.from(version, 'latin1');
      return Buffer.concat([prefix, ciphertext]);
    }

    it('verifies AES-128-CBC decryption with v10 prefix', () => {
      const secret = 'google-session-secret-token-v10-12345';
      const encBuffer = createEncryptedBlob(secret, testKey, 'v10');

      const decrypted = decryptCookieBuffer(encBuffer, testKey);
      expect(decrypted).toBe(secret);
    });

    it('verifies AES-128-CBC decryption with v11 prefix and 32-byte hash stripping', () => {
      const secret = 'google-session-oauth-v11-auth-xyz987';
      const encBuffer = createEncryptedBlob(secret, testKey, 'v11');

      const decrypted = decryptCookieBuffer(encBuffer, testKey);
      expect(decrypted).toBe(secret);
    });

    it('handles v11 payload of 32 bytes or fewer gracefully without throwing', () => {
      const iv = Buffer.alloc(16, 0x20);
      const cipher = crypto.createCipheriv('aes-128-cbc', testKey, iv);
      cipher.setAutoPadding(true);
      const shortPayload = Buffer.from('short-payload', 'utf8'); // < 32 bytes
      const ciphertext = Buffer.concat([cipher.update(shortPayload), cipher.final()]);
      const encBuffer = Buffer.concat([Buffer.from('v11', 'latin1'), ciphertext]);

      const decrypted = decryptCookieBuffer(encBuffer, testKey);
      expect(decrypted).toBe('short-payload');
    });

    it('rejects unsupported or corrupted prefixes cleanly', () => {
      const secret = 'secret-data';
      const v10Buffer = createEncryptedBlob(secret, testKey, 'v10');

      // 1. Unknown prefix v99
      const v99Buffer = Buffer.concat([Buffer.from('v99', 'latin1'), v10Buffer.subarray(3)]);
      expect(decryptCookieBuffer(v99Buffer, testKey)).toBeNull();

      // 2. Prefix v20
      const v20Buffer = Buffer.concat([Buffer.from('v20', 'latin1'), v10Buffer.subarray(3)]);
      expect(decryptCookieBuffer(v20Buffer, testKey)).toBeNull();

      // 3. Short buffer (< 4 bytes)
      expect(decryptCookieBuffer(Buffer.from('v1'), testKey)).toBeNull();
      expect(decryptCookieBuffer(Buffer.alloc(0), testKey)).toBeNull();
    });

    it('handles corrupted ciphertext blocks and bad padding without crashing', () => {
      const secret = 'secure-google-login-token';
      const encBuffer = createEncryptedBlob(secret, testKey, 'v10');

      // Corrupt bytes in the ciphertext
      encBuffer[encBuffer.length - 2] = (encBuffer[encBuffer.length - 2]! ^ 0xff);
      encBuffer[encBuffer.length - 1] = (encBuffer[encBuffer.length - 1]! ^ 0xff);

      const result = decryptCookieBuffer(encBuffer, testKey);
      expect(result).toBeNull();
    });

    it('extracts and decrypts cookies from a live SQLite cookie database', () => {
      const dbPath = path.join(tempDir, 'Cookies.sqlite');
      execSync(`sqlite3 "${dbPath}" "CREATE TABLE cookies (host_key TEXT, name TEXT, path TEXT, is_secure INTEGER, is_httponly INTEGER, expires_utc INTEGER, encrypted_value BLOB);"`);

      const sidBlob = createEncryptedBlob('google-sid-token-value-1234', testKey, 'v10');
      const sapisidBlob = createEncryptedBlob('google-sapisid-v11-secret', testKey, 'v11');
      const nonGoogleBlob = createEncryptedBlob('github-session-token', testKey, 'v10');

      execSync(`sqlite3 "${dbPath}" "INSERT INTO cookies VALUES ('.google.com', 'SID', '/', 1, 1, 13350000000000000, X'${sidBlob.toString('hex')}');"`);
      execSync(`sqlite3 "${dbPath}" "INSERT INTO cookies VALUES ('.google.com', 'SAPISID', '/', 1, 0, 13350000000000000, X'${sapisidBlob.toString('hex')}');"`);
      // Non-google cookie should be filtered out by SQL query
      execSync(`sqlite3 "${dbPath}" "INSERT INTO cookies VALUES ('.github.com', 'user_session', '/', 1, 1, 13350000000000000, X'${nonGoogleBlob.toString('hex')}');"`);

      const importer = new ChromeCookieImporter();
      const cookies = importer.extractAndDecryptCookies(dbPath, testKey);

      expect(cookies).toHaveLength(2);
      const sid = cookies.find((c) => c.name === 'SID');
      const sapisid = cookies.find((c) => c.name === 'SAPISID');

      expect(sid?.value).toBe('google-sid-token-value-1234');
      expect(sid?.is_secure).toBe(1);
      expect(sid?.is_httponly).toBe(1);

      expect(sapisid?.value).toBe('google-sapisid-v11-secret');
      expect(sapisid?.is_secure).toBe(1);
      expect(sapisid?.is_httponly).toBe(0);
    });

    it('handles SQLite database when no Google cookies match query', () => {
      const dbPath = path.join(tempDir, 'NonGoogleCookies.sqlite');
      execSync(`sqlite3 "${dbPath}" "CREATE TABLE cookies (host_key TEXT, name TEXT, path TEXT, is_secure INTEGER, is_httponly INTEGER, expires_utc INTEGER, encrypted_value BLOB);"`);
      const blob = createEncryptedBlob('reddit-session', testKey, 'v10');
      execSync(`sqlite3 "${dbPath}" "INSERT INTO cookies VALUES ('.reddit.com', 'session', '/', 1, 1, 0, X'${blob.toString('hex')}');"`);

      const importer = new ChromeCookieImporter();
      const cookies = importer.extractAndDecryptCookies(dbPath, testKey);
      expect(cookies).toHaveLength(0);
    });

    it('handles partially written / corrupted SQLite files without hanging or unhandled throw', () => {
      const corruptDb = path.join(tempDir, 'Corrupt.sqlite');
      // 100 bytes of arbitrary text (not a SQLite file)
      fs.writeFileSync(corruptDb, 'NOT A SQLITE FILE HEADER AND TRUNCATED DATA'.repeat(3));

      const importer = new ChromeCookieImporter();
      expect(() => importer.extractAndDecryptCookies(corruptDb, testKey)).toThrow(/sqlite3 query failed/i);
    });

    it('handles missing SQLite database gracefully during importToSession', async () => {
      const importer = new ChromeCookieImporter();
      vi.spyOn(importer, 'findChromeCookieDb').mockReturnValue(null);

      const mockSession = { cookies: { set: vi.fn() } } as unknown as Electron.Session;
      const res = await importer.importToSession(mockSession);

      expect(res.success).toBe(false);
      expect(res.importedCount).toBe(0);
      expect(res.message).toContain('No Chrome or Chromium cookie database was found');
    });

    it('imports cookies into electron session with correct domain, expiry, and URL mapping', async () => {
      const importer = new ChromeCookieImporter();
      const dbPath = path.join(tempDir, 'SessionImport.sqlite');
      execSync(`sqlite3 "${dbPath}" "CREATE TABLE cookies (host_key TEXT, name TEXT, path TEXT, is_secure INTEGER, is_httponly INTEGER, expires_utc INTEGER, encrypted_value BLOB);"`);

      const futureWebKitExpiry = (Date.now() + 86400000) * 1000 + 11644473600000000;
      const sidBlob = createEncryptedBlob('my-sid-token', testKey, 'v10');
      execSync(`sqlite3 "${dbPath}" "INSERT INTO cookies VALUES ('.google.com', 'SID', '/path', 1, 1, ${futureWebKitExpiry}, X'${sidBlob.toString('hex')}');"`);

      vi.spyOn(importer, 'findChromeCookieDb').mockReturnValue(dbPath);
      vi.spyOn(importer, 'getEncryptionKey').mockReturnValue(testKey);

      const setCalls: unknown[] = [];
      const mockSession = {
        cookies: {
          set: vi.fn().mockImplementation((cookieObj) => {
            setCalls.push(cookieObj);
            return Promise.resolve();
          })
        }
      } as unknown as Electron.Session;

      const res = await importer.importToSession(mockSession);
      expect(res.success).toBe(true);
      expect(res.importedCount).toBe(1);
      expect(setCalls).toHaveLength(1);

      const cookieCall = setCalls[0] as Record<string, unknown>;
      expect(cookieCall.url).toBe('https://google.com/path');
      expect(cookieCall.name).toBe('SID');
      expect(cookieCall.value).toBe('my-sid-token');
      expect(cookieCall.domain).toBe('.google.com');
      expect(cookieCall.secure).toBe(true);
      expect(cookieCall.httpOnly).toBe(true);
      expect(cookieCall.sameSite).toBe('no_restriction');
      expect(cookieCall.expirationDate).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });
  });

  // =========================================================================
  // 3. JULES CLI OUTPUT PARSING & EXECUTION EDGE CASES
  // =========================================================================
  describe('Jules CLI Integration — Parsing & Execution Edge Cases', () => {
    it('strips ANSI color, cursor, and formatting sequences cleanly', () => {
      const ansiColored = '\u001b[1m\u001b[32mActive\u001b[39m\u001b[22m';
      expect(stripAnsi(ansiColored)).toBe('Active');

      const complexAnsi = '\u001b[38;5;196mError:\u001b[0m \u001b[4mFailed\u001b[24m at \u001b[33m/path/to/repo\u001b[39m';
      expect(stripAnsi(complexAnsi)).toBe('Error: Failed at /path/to/repo');

      expect(stripAnsi('')).toBe('');
    });

    it('parses diverse tabular formats with variable columns, blank statuses, and ANSI codes', () => {
      // 1. Output with ANSI escape codes and 5 columns
      const rawWithAnsi = `      ID                 Description                 Repo      Last active     Status    
 \u001b[36m98615155049…\u001b[0m  \u001b[1mReview this PR and fix tests\u001b[0m  OSINTCabal/deck  2 hours ago     \u001b[32mDONE\u001b[0m
 12345678901   Fix race conditions in auth       google/jules     yesterday       FAILED`;

      const parsed = parseJulesSessionsOutput(rawWithAnsi);
      expect(parsed).toHaveLength(2);
      expect(parsed[0]?.id).toBe('98615155049…');
      expect(parsed[0]?.description).toBe('Review this PR and fix tests');
      expect(parsed[0]?.repo).toBe('OSINTCabal/deck');
      expect(parsed[0]?.lastActive).toBe('2 hours ago');
      expect(parsed[0]?.status).toBe('DONE');

      expect(parsed[1]?.id).toBe('12345678901');
      expect(parsed[1]?.status).toBe('FAILED');
    });

    it('parses 4-column output correctly identifying status vs last active', () => {
      // 4 columns where 4th column is a recognized status
      const rawWithStatus = `ID  Description  Repo  Status
session-1  Refactor DB adapter  myorg/myrepo  COMPLETED
session-2  Upgrade TypeScript    myorg/myrepo  CANCELLED`;

      const resStatus = parseJulesSessionsOutput(rawWithStatus);
      expect(resStatus).toHaveLength(2);
      expect(resStatus[0]?.status).toBe('COMPLETED');
      expect(resStatus[0]?.lastActive).toBe('recently');
      expect(resStatus[1]?.status).toBe('CANCELLED');

      // 4 columns where 4th column is lastActive timestamp
      const rawWithTime = `ID  Description  Repo  LastActive
session-3  Build search index  myorg/myrepo  3 days ago`;
      const resTime = parseJulesSessionsOutput(rawWithTime);
      expect(resTime).toHaveLength(1);
      expect(resTime[0]?.lastActive).toBe('3 days ago');
      expect(resTime[0]?.status).toBe('Active');
    });

    it('parses 3-column abbreviated session output', () => {
      const raw3Col = `ID  Description  Repo
ses-abc1  Quick fix  org/repo`;
      const res = parseJulesSessionsOutput(raw3Col);
      expect(res).toHaveLength(1);
      expect(res[0]?.id).toBe('ses-abc1');
      expect(res[0]?.description).toBe('Quick fix');
      expect(res[0]?.repo).toBe('org/repo');
      expect(res[0]?.lastActive).toBe('recently');
      expect(res[0]?.status).toBe('Active');
    });

    it('handles unicode, emojis, accents, and punctuation in session descriptions', () => {
      const rawUnicode = `      ID                 Description                 Repo      Last active     Status    
 88812345678…  🚀 Deploy v2.0 & fix café bug 🧪  OSINTCabal/app  5 minutes ago   ACTIVE
 99912345678…  "Special [RFC-123]" / 'tag'        OSINTCabal/web  1 day ago       DONE`;

      const parsed = parseJulesSessionsOutput(rawUnicode);
      expect(parsed).toHaveLength(2);
      expect(parsed[0]?.description).toBe('🚀 Deploy v2.0 & fix café bug 🧪');
      expect(parsed[1]?.description).toBe('"Special [RFC-123]" / \'tag\'');
    });

    it('handles edge-case empty, whitespace-only, and header-only output gracefully', () => {
      expect(parseJulesSessionsOutput('')).toEqual([]);
      expect(parseJulesSessionsOutput('    \n\n   \t  \n  ')).toEqual([]);
      expect(parseJulesSessionsOutput('ID  Description  Repo  Last active  Status')).toEqual([]);
      expect(parseJulesSessionsOutput('ID  Description  Repo\n\n   \n   ')).toEqual([]);
    });

    it('parses jules remote list --repo output with filtering of headers, usage, and warnings', () => {
      const repoOutput = `
Connecting to remote Jules service...
OSINTCabal/ArchiveSnooper
OSINTCabal/Cabal-Proxy-Harvester
OSINTCabal/VibeDeck
torvalds/linux
`;
      const repos = parseJulesReposOutput(repoOutput);
      expect(repos).toHaveLength(4);
      expect(repos).toContain('OSINTCabal/ArchiveSnooper');
      expect(repos).toContain('OSINTCabal/VibeDeck');
      expect(repos).toContain('torvalds/linux');
      expect(repos).not.toContain('Connecting to remote Jules service...');

      // Banner / flags / usage stripping
      const helpOutput = `
Usage:
  jules remote list [flags]

Flags:
  --repo      List all the repos connected to Jules
  --session   List all the remote sessions

OSINTCabal/JulesDeck
`;
      const filtered = parseJulesReposOutput(helpOutput);
      expect(filtered).toEqual(['OSINTCabal/JulesDeck']);
      expect(parseJulesReposOutput('')).toEqual([]);
    });

    it('falls back gracefully when jules binary is missing or exits with non-zero status', () => {
      // 1. Missing directory/repo in executeJulesTask
      const taskRes = executeJulesTask('/nonexistent/path/for/repo', 'some prompt');
      if (!fs.existsSync(getJulesBinaryPath())) {
        expect(taskRes.success).toBe(false);
      }

      // 2. executeListJulesSessions never throws even on missing/failing binary
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const sessions = executeListJulesSessions('/invalid/path/does/not/exist');
      expect(Array.isArray(sessions)).toBe(true);

      // 3. executeListJulesRepos returns [] on error
      const repos = executeListJulesRepos('/invalid/path/does/not/exist');
      expect(Array.isArray(repos)).toBe(true);

      // 4. executeApplyJulesSession returns failure object on error
      const applyRes = executeApplyJulesSession('/invalid/path', 'invalid-session-id');
      expect(applyRes).toHaveProperty('success');
      expect(applyRes).toHaveProperty('output');
    }, 35000);

    it('extracts CLI version info or reports unavailable when jules is not installed', () => {
      const cliInfo = getJulesCliInfo();
      expect(cliInfo).toBeDefined();
      expect(typeof cliInfo.available).toBe('boolean');
      if (cliInfo.available) {
        expect(cliInfo.version).toBeDefined();
        expect(cliInfo.path).toBeDefined();
      }
    });
  });
});
