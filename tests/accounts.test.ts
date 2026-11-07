import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  loadAccountRegistry,
  saveAccountRegistry,
  createAccount,
  switchActiveAccount,
  removeAccount,
  upsertAccount,
  isValidAccountRecord,
  isValidAccountRegistry,
  createDefaultAccount,
  createFreshRegistryWithDefault,
  parseGoogleAccountLabel,
  parseGoogleAccountsResponse,
  AccountRecord,
  AccountRegistry
} from '../src/main/accounts.js';

describe('Multi-Account Registry Engine', () => {
  let tempDir: string;
  let testAccountsPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jules-accounts-test-'));
    testAccountsPath = path.join(tempDir, 'accounts.json');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe('Loading & Empty State', () => {
    it('returns empty registry when accounts file does not exist', () => {
      const registry = loadAccountRegistry(testAccountsPath);
      expect(registry).toEqual({
        activeAccountId: '',
        accounts: []
      });
      expect(fs.existsSync(testAccountsPath)).toBe(false);
    });

    it('creates missing directories automatically when saving', () => {
      const nestedPath = path.join(tempDir, 'nested', 'deep', 'accounts.json');
      const emptyRegistry: AccountRegistry = { activeAccountId: '', accounts: [] };

      expect(() => saveAccountRegistry(emptyRegistry, nestedPath)).not.toThrow();
      expect(fs.existsSync(nestedPath)).toBe(true);
    });
  });

  describe('Atomic Writes & Persistence', () => {
    it('atomically saves and reloads registry without leaving temporary files', () => {
      const sampleAccount: AccountRecord = {
        id: 'acc-123',
        email: 'developer@example.com',
        name: 'Lead Dev',
        partition: 'persist:acct-acc-123',
        createdAt: 1000,
        lastUsedAt: 2000
      };

      const registry: AccountRegistry = {
        activeAccountId: 'acc-123',
        accounts: [sampleAccount]
      };

      saveAccountRegistry(registry, testAccountsPath);

      expect(fs.existsSync(testAccountsPath)).toBe(true);

      // Verify no temporary files remain
      const files = fs.readdirSync(tempDir);
      const tmpFiles = files.filter((f) => f.endsWith('.tmp'));
      expect(tmpFiles).toHaveLength(0);

      const loaded = loadAccountRegistry(testAccountsPath);
      expect(loaded).toEqual(registry);
    });
  });

  describe('Corrupt JSON & Schema Recovery', () => {
    it('backs up corrupted JSON syntax to accounts.json.corrupt.<timestamp> and returns fresh default registry', () => {
      const corruptContent = '{ "activeAccountId": "broken", "accounts": [ { invalid json';
      fs.writeFileSync(testAccountsPath, corruptContent, 'utf8');

      const registry = loadAccountRegistry(testAccountsPath);

      // Verify it did not throw and returned a valid fresh registry
      expect(registry).toBeDefined();
      expect(registry.accounts).toHaveLength(1);
      const defaultAcct = registry.accounts[0];
      expect(defaultAcct).toBeDefined();
      expect(registry.activeAccountId).toBe(defaultAcct?.id);
      expect(defaultAcct?.partition).toBe('persist:spike');

      // Verify backup file was created with the corrupted contents
      const files = fs.readdirSync(tempDir);
      const backupFiles = files.filter((f) => f.startsWith('accounts.json.corrupt.'));
      expect(backupFiles.length).toBeGreaterThanOrEqual(1);

      const backupContent = fs.readFileSync(path.join(tempDir, backupFiles[0]!), 'utf8');
      expect(backupContent).toBe(corruptContent);
    });

    it('backs up invalid schema structure and returns fresh default registry', () => {
      const invalidSchema = JSON.stringify({
        activeAccountId: 9999, // Should be string
        accounts: 'not-an-array' // Should be array
      });
      fs.writeFileSync(testAccountsPath, invalidSchema, 'utf8');

      const registry = loadAccountRegistry(testAccountsPath);

      expect(registry.accounts).toHaveLength(1);
      expect(typeof registry.activeAccountId).toBe('string');
      expect(registry.activeAccountId.length).toBeGreaterThan(0);

      const files = fs.readdirSync(tempDir);
      const backupFiles = files.filter((f) => f.startsWith('accounts.json.corrupt.'));
      expect(backupFiles.length).toBeGreaterThanOrEqual(1);
    });

    it('backs up when an account item inside accounts fails schema validation', () => {
      const invalidAccountRecord = JSON.stringify({
        activeAccountId: 'acc-1',
        accounts: [
          {
            id: 'acc-1',
            email: 'test@example.com'
            // Missing required name, partition, createdAt, lastUsedAt
          }
        ]
      });
      fs.writeFileSync(testAccountsPath, invalidAccountRecord, 'utf8');

      const registry = loadAccountRegistry(testAccountsPath);
      expect(registry.accounts).toHaveLength(1);
      expect(registry.accounts[0]?.partition).toBe('persist:spike');
    });
  });

  describe('Account Lifecycle (Create, Switch, Remove, Upsert)', () => {
    it('creates accounts with UUIDs and persist:acct-<uuid> partitions', () => {
      const account1 = createAccount('user1@example.com', 'User One', testAccountsPath);

      expect(account1.id).toBeDefined();
      expect(typeof account1.id).toBe('string');
      expect(account1.partition).toBe(`persist:acct-${account1.id}`);
      expect(account1.email).toBe('user1@example.com');
      expect(account1.name).toBe('User One');
      expect(account1.createdAt).toBeGreaterThan(0);
      expect(account1.lastUsedAt).toBe(account1.createdAt);

      const registry = loadAccountRegistry(testAccountsPath);
      expect(registry.activeAccountId).toBe(account1.id);
      expect(registry.accounts).toHaveLength(1);
      expect(registry.accounts[0]?.id).toBe(account1.id);
    });

    it('creates multiple accounts, keeping first account active until switched', () => {
      const account1 = createAccount('first@example.com', 'First User', testAccountsPath);
      const account2 = createAccount('second@example.com', 'Second User', testAccountsPath);

      expect(account2.partition).toBe(`persist:acct-${account2.id}`);
      expect(account1.id).not.toBe(account2.id);

      const registry = loadAccountRegistry(testAccountsPath);
      expect(registry.accounts).toHaveLength(2);
      expect(registry.activeAccountId).toBe(account1.id);
    });

    it('switches active account and updates lastUsedAt timestamp', () => {
      const account1 = createAccount('user1@example.com', 'User 1', testAccountsPath);
      const account2 = createAccount('user2@example.com', 'User 2', testAccountsPath);

      expect(loadAccountRegistry(testAccountsPath).activeAccountId).toBe(account1.id);

      const switched = switchActiveAccount(account2.id, testAccountsPath);
      expect(switched).not.toBeNull();
      expect(switched?.id).toBe(account2.id);
      expect(switched?.lastUsedAt).toBeGreaterThanOrEqual(account2.lastUsedAt);

      const registry = loadAccountRegistry(testAccountsPath);
      expect(registry.activeAccountId).toBe(account2.id);

      // Verify switching to non-existent account returns null and does not change active account
      const invalidSwitch = switchActiveAccount('non-existent-uuid', testAccountsPath);
      expect(invalidSwitch).toBeNull();
      const unchangedRegistry = loadAccountRegistry(testAccountsPath);
      expect(unchangedRegistry.activeAccountId).toBe(account2.id);
    });

    it('removes non-active account while preserving current active account', () => {
      const account1 = createAccount('user1@example.com', 'User 1', testAccountsPath);
      const account2 = createAccount('user2@example.com', 'User 2', testAccountsPath);

      const result = removeAccount(account2.id, testAccountsPath);
      expect(result.success).toBe(true);
      expect(result.nextAccountId).toBe(account1.id);

      const registry = loadAccountRegistry(testAccountsPath);
      expect(registry.accounts).toHaveLength(1);
      expect(registry.activeAccountId).toBe(account1.id);
    });

    it('removes active account and automatically selects next available account', () => {
      const account1 = createAccount('user1@example.com', 'User 1', testAccountsPath);
      const account2 = createAccount('user2@example.com', 'User 2', testAccountsPath);

      // Active is account1
      const result = removeAccount(account1.id, testAccountsPath);
      expect(result.success).toBe(true);
      expect(result.nextAccountId).toBe(account2.id);

      const registry = loadAccountRegistry(testAccountsPath);
      expect(registry.accounts).toHaveLength(1);
      expect(registry.activeAccountId).toBe(account2.id);
    });

    it('handles empty state properly when the last remaining account is removed', () => {
      const account = createAccount('only@example.com', 'Only User', testAccountsPath);

      const result = removeAccount(account.id, testAccountsPath);
      expect(result.success).toBe(true);
      expect(result.nextAccountId).toBeUndefined();

      const registry = loadAccountRegistry(testAccountsPath);
      expect(registry.accounts).toHaveLength(0);
      expect(registry.activeAccountId).toBe('');
    });

    it('returns success: false when attempting to remove non-existent account', () => {
      const account = createAccount('user@example.com', 'User', testAccountsPath);
      const result = removeAccount('missing-id', testAccountsPath);

      expect(result.success).toBe(false);
      expect(result.nextAccountId).toBe(account.id);

      const registry = loadAccountRegistry(testAccountsPath);
      expect(registry.accounts).toHaveLength(1);
    });

    it('upserts new account and updates existing account', () => {
      const initialRecord: AccountRecord = {
        id: 'manual-1',
        email: 'manual@example.com',
        name: 'Manual Account',
        partition: 'persist:acct-manual-1',
        createdAt: 100,
        lastUsedAt: 100
      };

      upsertAccount(initialRecord, testAccountsPath);
      let registry = loadAccountRegistry(testAccountsPath);
      expect(registry.accounts).toHaveLength(1);
      expect(registry.accounts[0]?.name).toBe('Manual Account');
      expect(registry.activeAccountId).toBe('manual-1');

      // Update existing record
      const updatedRecord: AccountRecord = {
        ...initialRecord,
        name: 'Updated Manual Account',
        avatarUrl: 'https://example.com/avatar.png',
        lastUsedAt: 500
      };

      upsertAccount(updatedRecord, testAccountsPath);
      registry = loadAccountRegistry(testAccountsPath);
      expect(registry.accounts).toHaveLength(1);
      expect(registry.accounts[0]?.name).toBe('Updated Manual Account');
      expect(registry.accounts[0]?.avatarUrl).toBe('https://example.com/avatar.png');
      expect(registry.accounts[0]?.lastUsedAt).toBe(500);
    });
  });

  describe('Validation & Helpers', () => {
    it('validates account records correctly', () => {
      expect(isValidAccountRecord(null)).toBe(false);
      expect(isValidAccountRecord('string')).toBe(false);
      expect(isValidAccountRecord({})).toBe(false);

      const validRecord: AccountRecord = {
        id: 'acc-1',
        email: 'test@example.com',
        name: 'Test',
        partition: 'persist:acct-1',
        createdAt: 1,
        lastUsedAt: 2
      };
      expect(isValidAccountRecord(validRecord)).toBe(true);

      const withAvatar: AccountRecord = {
        ...validRecord,
        avatarUrl: 'https://avatar.url'
      };
      expect(isValidAccountRecord(withAvatar)).toBe(true);

      const invalidAvatar = {
        ...validRecord,
        avatarUrl: 12345
      };
      expect(isValidAccountRecord(invalidAvatar)).toBe(false);
    });

    it('validates account registries correctly', () => {
      expect(isValidAccountRegistry(null)).toBe(false);
      expect(isValidAccountRegistry({ activeAccountId: '1' })).toBe(false);
      expect(isValidAccountRegistry({ activeAccountId: 1, accounts: [] })).toBe(false);
      expect(isValidAccountRegistry({ activeAccountId: '', accounts: [] })).toBe(true);
    });

    it('creates fresh default registry with default account', () => {
      const defaultAccount = createDefaultAccount();
      expect(defaultAccount.id).toBeDefined();
      expect(defaultAccount.partition).toBe('persist:spike');

      const freshRegistry = createFreshRegistryWithDefault();
      expect(freshRegistry.accounts).toHaveLength(1);
      expect(freshRegistry.activeAccountId).toBe(freshRegistry.accounts[0]?.id);
    });
  });

  describe('Google Profile Parsing', () => {
    it('parses Google Account aria-label formats', () => {
      expect(parseGoogleAccountLabel('')).toBeNull();
      expect(parseGoogleAccountLabel('Some other button')).toBeNull();

      const res1 = parseGoogleAccountLabel('Google Account: Alice Smith (alice@google.com)');
      expect(res1).toEqual({ name: 'Alice Smith', email: 'alice@google.com' });

      const res2 = parseGoogleAccountLabel('Google Account: bob@example.com');
      expect(res2).toEqual({ name: 'bob', email: 'bob@example.com' });

      const res3 = parseGoogleAccountLabel('Google Account: Charlie Brown\ncharlie@gmail.com');
      expect(res3).toEqual({ name: 'Charlie Brown', email: 'charlie@gmail.com' });
    });

    it('parses Google ListAccounts JSON responses', () => {
      expect(parseGoogleAccountsResponse('')).toBeNull();
      expect(parseGoogleAccountsResponse('not json at all')).toBeNull();

      // raw string with email
      const rawFallback = parseGoogleAccountsResponse('<html>user is dev@test.com</html>');
      expect(rawFallback).toEqual({ name: 'dev', email: 'dev@test.com' });

      // standard Google ListAccounts XSSI prefix )]}' format
      const mockListAccounts = `)]}'\n[["c", "user@example.com", "User Name", "https://avatar.url"]]`;
      const res = parseGoogleAccountsResponse(mockListAccounts);
      expect(res?.email).toBe('user@example.com');
      expect(res?.name).toBe('User Name');
    });
  });
});
