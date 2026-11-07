/**
 * Multi-Account Registry Engine.
 *
 * Manages accounts and isolated Chromium partition profiles for Jules Desktop.
 * Provides atomic persistence, corrupt JSON recovery, and account lifecycle management.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import type { AccountRecord, AccountRegistry } from '../shared/types.js';

export type { AccountRecord, AccountRegistry };

export interface RemoveAccountResult {
  success: boolean;
  nextAccountId?: string;
}

/**
 * Resolves the accounts.json storage path.
 * Defaults to `path.join(app.getPath('userData'), 'accounts.json')`.
 */
export function getAccountRegistryFilePath(customPath?: string): string {
  if (customPath) {
    return customPath;
  }
  try {
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'accounts.json');
    }
  } catch {
    // Fallback if app is not ready or in headless testing environment
  }
  return path.join(process.cwd(), 'accounts.json');
}

/**
 * Validates whether an unknown object conforms to AccountRecord schema.
 */
export function isValidAccountRecord(obj: unknown): obj is AccountRecord {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return false;
  }
  const r = obj as Record<string, unknown>;
  if (
    typeof r.id !== 'string' ||
    r.id.trim() === '' ||
    typeof r.email !== 'string' ||
    typeof r.name !== 'string' ||
    typeof r.partition !== 'string' ||
    r.partition.trim() === '' ||
    typeof r.createdAt !== 'number' ||
    typeof r.lastUsedAt !== 'number'
  ) {
    return false;
  }
  if (r.avatarUrl !== undefined && typeof r.avatarUrl !== 'string') {
    return false;
  }
  return true;
}

/**
 * Validates whether an unknown object conforms to AccountRegistry schema.
 */
export function isValidAccountRegistry(obj: unknown): obj is AccountRegistry {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return false;
  }
  const r = obj as Record<string, unknown>;
  if (typeof r.activeAccountId !== 'string') {
    return false;
  }
  if (!Array.isArray(r.accounts)) {
    return false;
  }
  for (const item of r.accounts) {
    if (!isValidAccountRecord(item)) {
      return false;
    }
  }
  return true;
}

/**
 * Parses Google Account aria-label (e.g. "Google Account: Alice Smith\nalice@google.com")
 */
export function parseGoogleAccountLabel(ariaLabel: string): { name?: string; email?: string } | null {
  if (!ariaLabel || typeof ariaLabel !== 'string') return null;
  const trimmed = ariaLabel.trim();
  if (!trimmed.toLowerCase().includes('google account')) return null;

  const emailMatch = trimmed.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  const email = emailMatch ? emailMatch[1] : undefined;

  let name: string | undefined;
  const afterPrefix = trimmed.replace(/^google account:?\s*/i, '');
  if (email) {
    const beforeEmail = afterPrefix.replace(email, '').replace(/[()\n\r–—-]/g, '').trim();
    if (beforeEmail.length > 0 && !beforeEmail.includes('@')) {
      name = beforeEmail;
    }
  } else if (afterPrefix.length > 0) {
    name = afterPrefix.replace(/[()\n\r]/g, '').trim();
  }

  if (!name && email) {
    name = email.split('@')[0];
  }

  if (!name && !email) return null;
  return { name, email };
}

/**
 * Parses Google accounts JSON or ListAccounts response format.
 */
export function parseGoogleAccountsResponse(rawText: string): { name?: string; email?: string } | null {
  if (!rawText || typeof rawText !== 'string') return null;
  try {
    const cleaned = rawText.replace(/^\)]}'\s*/, '').trim();
    const parsed = JSON.parse(cleaned);

    const text = JSON.stringify(parsed);
    const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (!emailMatch || !emailMatch[1]) return null;
    const email = emailMatch[1];

    let name: string | undefined;
    if (Array.isArray(parsed)) {
      const flatten = (arr: unknown[]): unknown[] =>
        arr.reduce<unknown[]>((acc, val) => acc.concat(Array.isArray(val) ? flatten(val) : val), []);
      const flat = flatten(parsed);
      const emailIdx = flat.indexOf(email);
      const isValidName = (c: unknown): c is string =>
        typeof c === 'string' &&
        c.trim().length >= 2 &&
        !c.includes('@') &&
        !c.startsWith('http') &&
        !/^\d+$/.test(c.trim());

      if (emailIdx >= 0 && emailIdx + 1 < flat.length && isValidName(flat[emailIdx + 1])) {
        name = String(flat[emailIdx + 1]).trim();
      } else if (emailIdx > 0 && isValidName(flat[emailIdx - 1])) {
        name = String(flat[emailIdx - 1]).trim();
      }
    }
    return { name: name || email.split('@')[0], email };
  } catch {
    const emailMatch = rawText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch && emailMatch[1]) {
      const email = emailMatch[1];
      return { name: email.split('@')[0], email };
    }
    return null;
  }
}

/**
 * Creates a default fallback account record.
 */
export function createDefaultAccount(overrides?: Partial<AccountRecord>): AccountRecord {
  const id = overrides?.id ?? randomUUID();
  const now = Date.now();
  return {
    id,
    email: overrides?.email ?? '',
    name: overrides?.name ?? 'Default Account',
    partition: overrides?.partition ?? 'persist:spike',
    createdAt: overrides?.createdAt ?? now,
    lastUsedAt: overrides?.lastUsedAt ?? now,
    ...(overrides?.avatarUrl ? { avatarUrl: overrides.avatarUrl } : {})
  };
}

/**
 * Creates a fresh registry populated with a single default account.
 */
export function createFreshRegistryWithDefault(): AccountRegistry {
  const defaultAccount = createDefaultAccount();
  return {
    activeAccountId: defaultAccount.id,
    accounts: [defaultAccount]
  };
}

/**
 * Handles corrupted or invalid registry files:
 * Makes a backup copy `accounts.json.corrupt.<timestamp>` and returns a fresh registry with a default account.
 */
function handleCorruptedFile(filePath: string): AccountRegistry {
  const timestamp = Date.now();
  let backupPath = `${filePath}.corrupt.${timestamp}`;

  // Ensure unique backup filename in case of tight timestamp collisions
  let counter = 1;
  while (fs.existsSync(backupPath)) {
    backupPath = `${filePath}.corrupt.${timestamp}_${counter++}`;
  }

  try {
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, backupPath);
      console.warn(`[ACCOUNTS] Corrupted registry backed up to: ${backupPath}`);
    }
  } catch (backupErr) {
    console.error(`[ACCOUNTS] Failed to create corrupt registry backup:`, backupErr);
  }

  const fresh = createFreshRegistryWithDefault();
  try {
    saveAccountRegistry(fresh, filePath);
  } catch {
    // ignore
  }
  return fresh;
}

/**
 * Loads the account registry from disk.
 * - If file does not exist, returns a default/empty registry `{ activeAccountId: '', accounts: [] }`.
 * - If corrupted or invalid schema, backs up to `accounts.json.corrupt.<timestamp>` and returns fresh registry.
 */
export function loadAccountRegistry(customPath?: string): AccountRegistry {
  const filePath = getAccountRegistryFilePath(customPath);

  if (!fs.existsSync(filePath)) {
    return {
      activeAccountId: '',
      accounts: []
    };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (readErr) {
    console.error(`[ACCOUNTS] Failed to read account registry file at ${filePath}:`, readErr);
    return handleCorruptedFile(filePath);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (parseErr) {
    console.error(`[ACCOUNTS] Malformed JSON in account registry at ${filePath}:`, parseErr);
    return handleCorruptedFile(filePath);
  }

  if (!isValidAccountRegistry(parsed)) {
    console.error(`[ACCOUNTS] Invalid schema structure in account registry at ${filePath}`);
    return handleCorruptedFile(filePath);
  }

  return parsed;
}

/**
 * Atomically saves the account registry to disk.
 * Writes to a unique `.tmp` file in the same directory, then uses `fs.renameSync` for atomic replacement.
 */
export function saveAccountRegistry(registry: AccountRegistry, customPath?: string): void {
  const filePath = getAccountRegistryFilePath(customPath);
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  const serialized = JSON.stringify(registry, null, 2);

  try {
    fs.writeFileSync(tmpPath, serialized, 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // Ignore cleanup error
      }
    }
    throw err;
  }
}

/**
 * Creates a new account record with a generated UUID and `persist:acct-<uuid>` partition,
 * appends it to the registry, and saves to disk.
 */
export function createAccount(email: string, name: string, customPath?: string): AccountRecord {
  const registry = loadAccountRegistry(customPath);
  const id = randomUUID();
  const now = Date.now();

  const record: AccountRecord = {
    id,
    email,
    name,
    partition: `persist:acct-${id}`,
    createdAt: now,
    lastUsedAt: now
  };

  registry.accounts.push(record);

  // If no active account is currently set or active account is missing from list, activate the newly created one
  if (!registry.activeAccountId || !registry.accounts.some((a) => a.id === registry.activeAccountId)) {
    registry.activeAccountId = id;
  }

  saveAccountRegistry(registry, customPath);
  return record;
}

/**
 * Switches the active account to `accountId`, updates its `lastUsedAt` timestamp, and saves to disk.
 * Returns the updated AccountRecord or null if not found.
 */
export function switchActiveAccount(accountId: string, customPath?: string): AccountRecord | null {
  const registry = loadAccountRegistry(customPath);
  const account = registry.accounts.find((a) => a.id === accountId);

  if (!account) {
    return null;
  }

  registry.activeAccountId = account.id;
  account.lastUsedAt = Date.now();

  saveAccountRegistry(registry, customPath);
  return account;
}

/**
 * Removes an account from the registry by its ID.
 * If the removed account was active, selects the next available account or handles empty state.
 */
export function removeAccount(accountId: string, customPath?: string): RemoveAccountResult {
  const registry = loadAccountRegistry(customPath);
  const index = registry.accounts.findIndex((a) => a.id === accountId);

  if (index === -1) {
    return {
      success: false,
      nextAccountId: registry.activeAccountId || undefined
    };
  }

  registry.accounts.splice(index, 1);

  let nextAccountId: string | undefined = registry.activeAccountId;

  if (registry.activeAccountId === accountId) {
    const nextAccount = registry.accounts[0];
    if (nextAccount) {
      registry.activeAccountId = nextAccount.id;
      nextAccountId = nextAccount.id;
    } else {
      registry.activeAccountId = '';
      nextAccountId = undefined;
    }
  }

  saveAccountRegistry(registry, customPath);
  return {
    success: true,
    nextAccountId
  };
}

/**
 * Inserts or updates an account record in the registry and saves to disk.
 */
export function upsertAccount(record: AccountRecord, customPath?: string): void {
  const registry = loadAccountRegistry(customPath);
  const index = registry.accounts.findIndex((a) => a.id === record.id);

  if (index >= 0) {
    registry.accounts[index] = { ...record };
  } else {
    registry.accounts.push({ ...record });
  }

  if (!registry.activeAccountId) {
    registry.activeAccountId = record.id;
  }

  saveAccountRegistry(registry, customPath);
}
