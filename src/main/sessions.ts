/**
 * Persistent Standalone Session Management for JulesDeck.
 *
 * Provides atomic persistence, schema recovery, and CRUD operations for
 * standalone sessions stored in standalone-sessions.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import type {
  StandaloneSessionRecord,
  JulesSessionItem
} from '../shared/types.js';

export type { StandaloneSessionRecord, JulesSessionItem };

/**
 * Resolves the path to standalone-sessions.json.
 * Priority:
 * 1. customFilePath (if provided)
 * 2. JULESDECK_SESSIONS_FILE environment variable
 * 3. Electron app.getPath('userData')/standalone-sessions.json
 * 4. Fallback: ~/.config/JulesDeck/standalone-sessions.json
 */
export function getStandaloneSessionsFilePath(customPath?: string): string {
  if (customPath && customPath.trim()) {
    return customPath.trim();
  }
  if (process.env.JULESDECK_SESSIONS_FILE && process.env.JULESDECK_SESSIONS_FILE.trim()) {
    return process.env.JULESDECK_SESSIONS_FILE.trim();
  }
  try {
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'standalone-sessions.json');
    }
  } catch {
    // Electron app not ready or running in headless testing
  }
  return path.join(os.homedir(), '.config', 'JulesDeck', 'standalone-sessions.json');
}

/**
 * Validates whether an unknown object conforms to StandaloneSessionRecord schema.
 */
export function isValidStandaloneSessionRecord(obj: unknown): obj is StandaloneSessionRecord {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return false;
  }
  const r = obj as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    r.id.trim() !== '' &&
    typeof r.title === 'string' &&
    typeof r.prompt === 'string' &&
    typeof r.engine === 'string' &&
    typeof r.model === 'string' &&
    typeof r.workspacePath === 'string' &&
    typeof r.status === 'string' &&
    Array.isArray(r.planSteps) &&
    Array.isArray(r.messages) &&
    typeof r.createdAt === 'number' &&
    typeof r.updatedAt === 'number'
  );
}

/**
 * Backs up a corrupted session file with a timestamp.
 */
function backupCorruptSessionsFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      const backupPath = `${filePath}.corrupt.${Date.now()}`;
      fs.copyFileSync(filePath, backupPath);
      console.warn(`[SESSIONS] Corrupted sessions file backed up to: ${backupPath}`);
    }
  } catch (err) {
    console.warn('[SESSIONS] Failed to back up corrupted sessions file:', err);
  }
}

/**
 * Loads all standalone session records from disk, sorted by updatedAt descending.
 * Returns empty array if file does not exist or is corrupted.
 */
export function loadStandaloneSessions(customFilePath?: string): StandaloneSessionRecord[] {
  const filePath = getStandaloneSessionsFilePath(customFilePath);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.warn(`[SESSIONS] Failed to read ${filePath}:`, err);
    return [];
  }

  if (!raw.trim()) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn(`[SESSIONS] Invalid schema in ${filePath}: expected array`);
      backupCorruptSessionsFile(filePath);
      return [];
    }
    const valid = parsed.filter(isValidStandaloneSessionRecord);
    return valid.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (err) {
    console.warn(`[SESSIONS] Malformed JSON in ${filePath}:`, err);
    backupCorruptSessionsFile(filePath);
    return [];
  }
}

/**
 * Atomically writes standalone session records to disk.
 */
export function saveStandaloneSessions(
  sessions: StandaloneSessionRecord[],
  customFilePath?: string
): void {
  const filePath = getStandaloneSessionsFilePath(customFilePath);
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  const serialized = JSON.stringify(sessions, null, 2);

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
 * Retrieves a single standalone session by its ID.
 */
export function getStandaloneSession(
  sessionId: string,
  customFilePath?: string
): StandaloneSessionRecord | null {
  if (!sessionId || !sessionId.trim()) {
    return null;
  }
  const sessions = loadStandaloneSessions(customFilePath);
  const found = sessions.find((s) => s.id === sessionId.trim());
  return found ?? null;
}

/**
 * Upserts a standalone session record.
 * Merges partial data into existing session if found, or inserts a new session with defaults.
 */
export function upsertStandaloneSession(
  partial: Partial<StandaloneSessionRecord> & { id: string },
  customFilePath?: string
): StandaloneSessionRecord {
  const sessions = loadStandaloneSessions(customFilePath);
  const now = Date.now();
  const existingIndex = sessions.findIndex((s) => s.id === partial.id);

  let updatedRecord: StandaloneSessionRecord;

  if (existingIndex >= 0) {
    const existing = sessions[existingIndex];
    if (!existing) {
      throw new Error(`Session ${partial.id} not found at index ${existingIndex}`);
    }
    updatedRecord = {
      ...existing,
      ...partial,
      updatedAt: partial.updatedAt ?? now
    };
    sessions[existingIndex] = updatedRecord;
  } else {
    updatedRecord = {
      id: partial.id,
      mode: partial.mode ?? 'repo',
      title: partial.title ?? partial.prompt ?? 'Untitled Session',
      prompt: partial.prompt ?? partial.title ?? '',
      engine: partial.engine ?? 'gemini-cli',
      model: partial.model ?? 'default',
      githubRepo: partial.githubRepo,
      baseBranch: partial.baseBranch,
      taskBranch: partial.taskBranch,
      workspacePath: partial.workspacePath ?? '',
      status: partial.status ?? 'planning',
      planSteps: partial.planSteps ?? [],
      messages: partial.messages ?? [],
      terminalOutput: partial.terminalOutput,
      prUrl: partial.prUrl,
      createdAt: partial.createdAt ?? now,
      updatedAt: partial.updatedAt ?? now
    };
    sessions.unshift(updatedRecord);
  }

  saveStandaloneSessions(sessions, customFilePath);
  return updatedRecord;
}

/**
 * Deletes a standalone session by ID.
 * Returns true if a session was removed, false otherwise.
 */
export function deleteStandaloneSession(
  sessionId: string,
  customFilePath?: string
): boolean {
  if (!sessionId || !sessionId.trim()) {
    return false;
  }
  const targetId = sessionId.trim();
  const sessions = loadStandaloneSessions(customFilePath);
  const filtered = sessions.filter((s) => s.id !== targetId);

  if (filtered.length === sessions.length) {
    return false;
  }

  saveStandaloneSessions(filtered, customFilePath);
  return true;
}

/**
 * Clears standalone sessions.
 * If sessionIds is provided and non-empty, clears only those IDs.
 * If omitted or empty, clears all standalone sessions.
 */
export function clearStandaloneSessions(
  sessionIds?: string[],
  customFilePath?: string
): boolean {
  if (sessionIds && sessionIds.length > 0) {
    const idSet = new Set(sessionIds.map((id) => id.trim()));
    const sessions = loadStandaloneSessions(customFilePath);
    const filtered = sessions.filter((s) => !idSet.has(s.id));
    saveStandaloneSessions(filtered, customFilePath);
    return true;
  }
  saveStandaloneSessions([], customFilePath);
  return true;
}

/**
 * Formats a timestamp into human-readable relative duration.
 */
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (diffSec < 60) {
    return 'Just now';
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  const diffWeeks = Math.floor(diffDays / 7);
  return `${diffWeeks}w ago`;
}

/**
 * Maps StandaloneSessionRecord[] to JulesSessionItem[] for unified UI display.
 */
export function toJulesSessionItems(
  records: StandaloneSessionRecord[],
  now = Date.now()
): JulesSessionItem[] {
  return records.map((record) => {
    const lastActiveTimestamp = record.updatedAt || record.createdAt || now;
    const repoName =
      record.githubRepo ||
      (record.workspacePath ? path.basename(record.workspacePath) : 'standalone');

    return {
      id: record.id,
      description: record.title || record.prompt || 'Untitled Session',
      repo: repoName,
      lastActive: formatRelativeTime(lastActiveTimestamp, now),
      status: record.status,
      mode: record.mode,
      engine: record.engine,
      model: record.model,
      branch: record.taskBranch || record.baseBranch,
      prUrl: record.prUrl,
      workspacePath: record.workspacePath
    };
  });
}
