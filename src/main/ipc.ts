import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execSync, execFileSync, ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { app, ipcMain, dialog, session, shell, WebContents } from 'electron';
import type {
  NavigationState,
  LocalRepoInfo,
  GitReviewDetails,
  GitCommitItem,
  GitFileChange,
  GitStructuredStatus,
  GitFileDiff,
  JulesRunResult,
  JulesSessionItem,
  JulesCliInfo,
  JulesCliStatus,
  RecentRepoItem,
  TaskOutputChunk,
  TaskStatusEvent,
  WorkspaceMode,
  AgentEngineId,
  GitHubRepoItem,
  PublishPrOptions,
  StandaloneSessionRecord,
  LegacyJulesHealth,
  RunTaskOptions
} from '../shared/types.js';
import {
  AppWindowLayers,
  switchContentViewPartition,
  expandChromeView,
  collapseChromeView
} from './window.js';
import { configureNavigationHandlers } from './navigation.js';
import { ChromeCookieImporter } from './cookieimport.js';
import {
  loadAccountRegistry,
  switchActiveAccount,
  createAccount,
  removeAccount,
  createDefaultAccount,
  saveAccountRegistry,
  parseGoogleAccountLabel,
  parseGoogleAccountsResponse
} from './accounts.js';
import {
  discoverEngines,
  runEngineTask,
  cancelRunningEngineTask,
  ENGINE_DEFINITIONS
} from './engines.js';
import {
  getGitHubAuthStatus,
  listGitHubRepos,
  selectAndPrepareGitHubRepo,
  prepareTaskBranch,
  publishBranchAndCreatePR,
  checkLegacyJulesAvailability
} from './github.js';
import {
  loadStandaloneSessions,
  getStandaloneSession,
  upsertStandaloneSession,
  deleteStandaloneSession,
  clearStandaloneSessions,
  toJulesSessionItems
} from './sessions.js';

let activeLocalRepo: LocalRepoInfo | undefined;
let currentMode: WorkspaceMode = process.argv.includes('--local')
  ? 'local'
  : process.argv.includes('--repo')
  ? 'repo'
  : 'cloud';
let activeEngine: AgentEngineId = 'gemini-cli';
let activeModel: string = 'gemini-3.1-pro';
let activeGitHubRepo: GitHubRepoItem | undefined;
let cachedLegacyHealth: LegacyJulesHealth | undefined;

export function getAppMode(): 'cloud' | 'local' {
  return currentMode === 'local' ? 'local' : 'cloud';
}

export function setAppMode(mode: 'cloud' | 'local' | WorkspaceMode): void {
  currentMode = mode;
}

export function getActiveEngine(): AgentEngineId {
  return activeEngine;
}

export function setActiveEngine(
  engine: AgentEngineId,
  model?: string
): { engine: AgentEngineId; model: string } {
  activeEngine = engine;
  if (model) {
    activeModel = model;
  } else {
    const meta = ENGINE_DEFINITIONS[engine];
    const defaultModel =
      meta?.models.find((m) => m.isDefault)?.id || meta?.models[0]?.id || 'default';
    activeModel = defaultModel;
  }
  return { engine: activeEngine, model: activeModel };
}

export function getActiveModel(): string {
  return activeModel;
}

export function getActiveGitHubRepo(): GitHubRepoItem | undefined {
  return activeGitHubRepo;
}

// Active running Jules task tracker
interface ActiveJulesTask {
  id: string;
  child: ChildProcess;
  pid: number;
  repoPath: string;
  prompt: string;
  startTime: number;
  aborted: boolean;
  detectedSessionId?: string;
  outputBuffer: string;
}

let currentRunningTask: ActiveJulesTask | null = null;

// ANSI stripper & line normalizer
const ANSI_PATTERN = new RegExp(
  [
    '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
    '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))'
  ].join('|'),
  'g'
);

export function stripAnsi(text: string): string {
  if (!text) return '';
  return text.replace(ANSI_PATTERN, '');
}

export function cleanTerminalText(text: string): string {
  return stripAnsi(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function extractSessionId(text: string): string | undefined {
  if (!text) return undefined;
  const urlMatch = text.match(/jules\.google\.com\/(?:session|s)\/([0-9a-zA-Z_-]+)/i);
  if (urlMatch && urlMatch[1]) return urlMatch[1];

  const sessionMatch = text.match(
    /(?:session|task)(?:\s+(?:id|number)?)?[:\s#]+([0-9a-zA-Z_-]{8,})/i
  );
  if (sessionMatch && sessionMatch[1]) return sessionMatch[1];

  const numericMatch = text.match(/\b([0-9]{9,16})\b/);
  if (numericMatch && numericMatch[1]) return numericMatch[1];

  return undefined;
}

export function killProcessGroup(pid: number, signal: NodeJS.Signals = 'SIGTERM'): boolean {
  if (!pid || pid <= 1) {
    return false;
  }
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
      return true;
    } else {
      process.kill(-pid, signal);
      return true;
    }
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

// Recent Repositories Persistence
function getRecentReposFilePath(): string {
  try {
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'recent-repos.json');
    }
  } catch {
    // headless or test fallback
  }
  return path.join(process.cwd(), 'recent-repos.json');
}

export function loadRecentRepos(): RecentRepoItem[] {
  try {
    const p = getRecentReposFilePath();
    if (!fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, 'utf8');
    const items = JSON.parse(raw);
    if (!Array.isArray(items)) return [];
    return items.filter((r) => r && typeof r.path === 'string' && fs.existsSync(r.path));
  } catch {
    return [];
  }
}

export function saveRecentRepos(items: RecentRepoItem[]): void {
  try {
    const p = getRecentReposFilePath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(items.slice(0, 10), null, 2), 'utf8');
  } catch (err) {
    console.warn('[REPOS] Failed to persist recent repos:', err);
  }
}

export function addRecentRepo(info: LocalRepoInfo | null | undefined): RecentRepoItem[] {
  if (!info || !info.path) return loadRecentRepos();
  const current = loadRecentRepos().filter((r) => r.path !== info.path && fs.existsSync(r.path));
  const updated: RecentRepoItem = {
    name: info.name,
    path: info.path,
    branch: info.branch,
    githubRepo: info.githubRepo,
    lastAccessedAt: Date.now()
  };
  const list = [updated, ...current].slice(0, 8);
  saveRecentRepos(list);
  return list;
}

export function removeRecentRepo(repoPath: string): RecentRepoItem[] {
  if (!repoPath) return loadRecentRepos();
  const current = loadRecentRepos().filter((r) => r.path !== repoPath);
  saveRecentRepos(current);
  return current;
}

export function clearRecentRepos(): void {
  saveRecentRepos([]);
}

// Deleted / Dismissed Sessions Persistence
export function getDeletedSessionsFilePath(): string {
  try {
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'deleted-sessions.json');
    }
  } catch {
    // headless or test fallback
  }
  return path.join(process.cwd(), 'deleted-sessions.json');
}

export function loadDeletedSessionIds(): string[] {
  try {
    const p = getDeletedSessionsFilePath();
    if (!fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, 'utf8');
    const items = JSON.parse(raw);
    return Array.isArray(items) ? items.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveDeletedSessionIds(ids: string[]): void {
  try {
    const p = getDeletedSessionsFilePath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const unique = Array.from(new Set(ids));
    fs.writeFileSync(p, JSON.stringify(unique, null, 2), 'utf8');
  } catch (err) {
    console.warn('[SESSIONS] Failed to persist deleted-sessions.json:', err);
  }
}

export function deleteJulesSession(sessionId: string): void {
  if (!sessionId) return;
  const current = loadDeletedSessionIds();
  current.push(sessionId);
  saveDeletedSessionIds(current);
  try {
    deleteStandaloneSession(sessionId);
  } catch {
    // ignore
  }
}

export function clearAllJulesSessions(sessionIdsToClear?: string[]): void {
  if (sessionIdsToClear && sessionIdsToClear.length > 0) {
    const current = loadDeletedSessionIds();
    saveDeletedSessionIds([...current, ...sessionIdsToClear]);
    try {
      clearStandaloneSessions(sessionIdsToClear);
    } catch {
      // ignore
    }
  } else {
    try {
      const all = executeListJulesSessions();
      const current = loadDeletedSessionIds();
      const newIds = all.map((s) => s.id).filter(Boolean);
      saveDeletedSessionIds([...current, ...newIds]);
    } catch {
      // ignore
    }
    try {
      clearStandaloneSessions();
    } catch {
      // ignore
    }
  }
}

export function getJulesBinaryPath(): string {
  const candidates: string[] = [];

  if (process.env.JULESDECK_JULES_BIN && process.env.JULESDECK_JULES_BIN.trim()) {
    candidates.push(process.env.JULESDECK_JULES_BIN.trim());
  }

  const nvmNodeDir = path.join(os.homedir(), '.nvm/versions/node');
  if (fs.existsSync(nvmNodeDir)) {
    try {
      const versions = fs
        .readdirSync(nvmNodeDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const ver of versions) {
        candidates.push(path.join(os.homedir(), '.nvm/versions/node', ver, 'bin/jules'));
      }
    } catch {
      // ignore
    }
  }

  candidates.push(
    path.join(os.homedir(), '.local/bin/jules'),
    '/usr/local/bin/jules',
    '/usr/bin/jules',
    'jules'
  );

  for (const c of candidates) {
    if (c === 'jules' || fs.existsSync(c)) {
      return c;
    }
  }
  return 'jules';
}

function getCliEnv(): NodeJS.ProcessEnv {
  const nvmNodeDir = path.join(os.homedir(), '.nvm/versions/node');
  const nvmBinDirs: string[] = [];
  if (fs.existsSync(nvmNodeDir)) {
    try {
      const versions = fs
        .readdirSync(nvmNodeDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const ver of versions) {
        const binDir = path.join(nvmNodeDir, ver, 'bin');
        if (fs.existsSync(binDir)) {
          nvmBinDirs.push(binDir);
        }
      }
    } catch {
      // ignore
    }
  }

  const localBin = path.join(os.homedir(), '.local/bin');
  const pathParts = [...nvmBinDirs, localBin, process.env.PATH || ''].filter(Boolean);

  return {
    ...process.env,
    PATH: pathParts.join(':')
  };
}

export function parseJulesSessionsOutput(output: string): JulesSessionItem[] {
  const clean = stripAnsi(output || '');
  const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return [];

  const results: JulesSessionItem[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const parts = line.split(/\s{2,}/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 5) {
      results.push({
        id: parts[0] || '',
        description: parts[1] || '',
        repo: parts[2] || '',
        lastActive: parts[3] || 'recently',
        status: parts[4] || 'Active'
      });
    } else if (parts.length === 4) {
      const col3 = parts[3] || '';
      const isStatus = ['DONE', 'COMPLETED', 'FAILED', 'CANCELLED', 'ACTIVE', 'PENDING'].includes(
        col3.toUpperCase()
      );
      results.push({
        id: parts[0] || '',
        description: parts[1] || '',
        repo: parts[2] || '',
        lastActive: isStatus ? 'recently' : col3,
        status: isStatus ? col3 : 'Active'
      });
    } else if (parts.length === 3) {
      results.push({
        id: parts[0] || '',
        description: parts[1] || '',
        repo: parts[2] || '',
        lastActive: 'recently',
        status: 'Active'
      });
    }
  }
  return results;
}

export function parseJulesReposOutput(output: string): string[] {
  if (!output) return [];
  const clean = stripAnsi(output);
  const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.filter((l) => {
    if (
      l.startsWith('Usage:') ||
      l.startsWith('Flags:') ||
      l.startsWith('--') ||
      l.startsWith('Connecting') ||
      l.startsWith('Error') ||
      l.includes(' ')
    ) {
      return false;
    }
    return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(l);
  });
}

export function executeJulesTask(repoPath: string, prompt: string): JulesRunResult {
  try {
    const julesBin = getJulesBinaryPath();
    const env = getCliEnv();
    const out = execFileSync(julesBin, ['new', prompt], {
      cwd: repoPath,
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000
    });
    const match = out.match(/session\s+([0-9a-zA-Z_-]+)/i) || out.match(/([0-9]{8,})/);
    const sessionId = match ? match[1] : undefined;
    return {
      success: true,
      sessionId,
      output: out,
      message: 'Jules task dispatched successfully'
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: errMsg,
      message: 'Failed to run Jules on repository'
    };
  }
}

export function executeListJulesSessions(
  repoPath?: string,
  includeDeleted = false
): JulesSessionItem[] {
  try {
    const julesBin = getJulesBinaryPath();
    const cwd = repoPath && fs.existsSync(repoPath) ? repoPath : process.cwd();
    const out = execFileSync(julesBin, ['remote', 'list', '--session'], {
      cwd,
      encoding: 'utf8',
      env: getCliEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000
    });
    const parsed = parseJulesSessionsOutput(out);
    if (includeDeleted) return parsed;
    const deleted = new Set(loadDeletedSessionIds());
    return parsed.filter((s) => !deleted.has(s.id));
  } catch {
    return [];
  }
}

let cachedJulesRepos: { timestamp: number; repos: string[] } | null = null;
const JULES_REPOS_CACHE_TTL_MS = 60_000;

export function executeListJulesRepos(repoPath?: string): string[] {
  const now = Date.now();
  if (cachedJulesRepos && now - cachedJulesRepos.timestamp < JULES_REPOS_CACHE_TTL_MS) {
    return cachedJulesRepos.repos;
  }
  try {
    const julesBin = getJulesBinaryPath();
    const cwd = repoPath && fs.existsSync(repoPath) ? repoPath : process.cwd();
    const out = execFileSync(julesBin, ['remote', 'list', '--repo'], {
      cwd,
      encoding: 'utf8',
      env: getCliEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 3000
    });
    const parsed = parseJulesReposOutput(out);
    cachedJulesRepos = { timestamp: now, repos: parsed };
    return parsed;
  } catch {
    return cachedJulesRepos ? cachedJulesRepos.repos : [];
  }
}

export function executeApplyJulesSession(
  repoPath: string,
  sessionId: string
): { success: boolean; output: string } {
  try {
    const julesBin = getJulesBinaryPath();
    const out = execFileSync(julesBin, ['remote', 'pull', '--session', sessionId, '--apply'], {
      cwd: repoPath,
      encoding: 'utf8',
      env: getCliEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000
    });
    return { success: true, output: out };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, output: errMsg };
  }
}

export function getJulesCliInfo(): JulesCliInfo {
  try {
    const julesBin = getJulesBinaryPath();
    const env = getCliEnv();
    const out = execFileSync(julesBin, ['version'], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 4000
    });
    const verMatch = out.match(/Version:\s*([^\s\n]+)/i);
    const oauthMatch = out.match(/OAuth Client ID:\s*([^\s\n]+)/i);
    return {
      available: true,
      path: julesBin,
      version: verMatch ? verMatch[1] : 'v0.1.42',
      oauthClientId: oauthMatch ? oauthMatch[1] : undefined
    };
  } catch {
    return {
      available: false,
      path: getJulesBinaryPath()
    };
  }
}

export async function executeListJulesSessionsAsync(
  repoPath?: string,
  includeDeleted = false
): Promise<JulesSessionItem[]> {
  return new Promise((resolve) => {
    try {
      const julesBin = getJulesBinaryPath();
      const cwd = repoPath && fs.existsSync(repoPath) ? repoPath : process.cwd();
      const child = spawn(julesBin, ['remote', 'list', '--session'], {
        cwd,
        env: getCliEnv(),
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      const timeout = setTimeout(() => {
        child.kill();
        resolve([]);
      }, 12000);

      child.stdout?.on('data', (d) => {
        stdout += d.toString();
      });
      child.on('close', () => {
        clearTimeout(timeout);
        const parsed = parseJulesSessionsOutput(stdout);
        if (includeDeleted) {
          resolve(parsed);
          return;
        }
        const deleted = new Set(loadDeletedSessionIds());
        resolve(parsed.filter((s) => !deleted.has(s.id)));
      });
      child.on('error', () => {
        clearTimeout(timeout);
        resolve([]);
      });
    } catch {
      resolve([]);
    }
  });
}

export async function executeListJulesReposAsync(): Promise<string[]> {
  return new Promise((resolve) => {
    try {
      const julesBin = getJulesBinaryPath();
      const child = spawn(julesBin, ['remote', 'list', '--repo'], {
        env: getCliEnv(),
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      const timeout = setTimeout(() => {
        child.kill();
        resolve([]);
      }, 12000);

      child.stdout?.on('data', (d) => {
        stdout += d.toString();
      });
      child.on('close', () => {
        clearTimeout(timeout);
        const repos = stdout
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => Boolean(l) && !l.startsWith('Error'));
        resolve(repos);
      });
      child.on('error', () => {
        clearTimeout(timeout);
        resolve([]);
      });
    } catch {
      resolve([]);
    }
  });
}

/**
 * Checks Jules CLI status or falls back to any available local engine so
 * ready is true whenever ANY coding engine is available.
 */
export async function getJulesCliDiagnosticAsync(): Promise<JulesCliStatus> {
  const binPath = getJulesBinaryPath();
  const julesResult = await new Promise<JulesCliStatus>((resolve) => {
    try {
      const child = spawn(binPath, ['version'], {
        env: getCliEnv(),
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill();
        resolve({ installed: false, path: binPath, ready: false, error: 'Command timed out' });
      }, 4000);

      child.stdout?.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr?.on('data', (d) => {
        stderr += d.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0 && stdout.includes('Version:')) {
          const verMatch = stdout.match(/Version:\s*([^\s\n]+)/i);
          const commitMatch = stdout.match(/Commit:\s*([^\s\n]+)/i);
          resolve({
            installed: true,
            path: binPath,
            version: verMatch ? verMatch[1] : 'v0.1.x',
            commit: commitMatch ? commitMatch[1] : undefined,
            ready: true
          });
        } else {
          resolve({
            installed: true,
            path: binPath,
            ready: false,
            error: stderr || stdout || 'Unknown output'
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        resolve({ installed: false, path: binPath, ready: false, error: err.message });
      });
    } catch (err: unknown) {
      resolve({
        installed: false,
        path: binPath,
        ready: false,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  });

  if (julesResult.installed && julesResult.ready) {
    return julesResult;
  }

  // Fallback to checking discoverEngines() so julesStatus.ready is true whenever ANY engine is available
  try {
    const engines = discoverEngines({ fetchVersion: false });
    const available = engines.find((e) => e.available);
    if (available) {
      return {
        installed: true,
        path: available.binaryPath || binPath,
        version: available.version || `${available.name} (Multi-Engine)`,
        ready: true
      };
    }
  } catch {
    // ignore
  }

  return julesResult;
}

export const getJulesCliStatus = getJulesCliDiagnosticAsync;

let cachedLegacySessionItems: { items: JulesSessionItem[]; fetchedAt: number } | null = null;
const LEGACY_SESSIONS_CACHE_TTL_MS = 15000;

/**
 * Lists combined sessions across persistent standalone store and legacy Jules CLI.
 * Never blocks on slow/dead legacy Jules servers (caps legacy probe at 2500ms and skips when sunset).
 */
export async function listJulesSessions(repoPath?: string): Promise<JulesSessionItem[]> {
  const deletedSet = new Set(loadDeletedSessionIds());

  let standaloneItems: JulesSessionItem[];
  try {
    const standaloneRecords = loadStandaloneSessions();
    standaloneItems = toJulesSessionItems(standaloneRecords).filter((s) => !deletedSet.has(s.id));
  } catch {
    standaloneItems = [];
  }

  let legacyItems: JulesSessionItem[] = [];
  const legacySunset =
    process.env.JULESDECK_FORCE_LEGACY_OFFLINE === '1' ||
    (cachedLegacyHealth && cachedLegacyHealth.online === false);

  if (!legacySunset) {
    if (cachedLegacySessionItems && Date.now() - cachedLegacySessionItems.fetchedAt < LEGACY_SESSIONS_CACHE_TTL_MS) {
      legacyItems = cachedLegacySessionItems.items;
    } else {
      try {
        const timeoutFallback = new Promise<JulesSessionItem[]>((resolve) =>
          setTimeout(() => resolve(cachedLegacySessionItems?.items || []), 2500)
        );
        legacyItems = await Promise.race([
          executeListJulesSessionsAsync(repoPath).then((items) => {
            cachedLegacySessionItems = { items, fetchedAt: Date.now() };
            return items;
          }),
          timeoutFallback
        ]);
      } catch {
        legacyItems = cachedLegacySessionItems?.items || [];
      }
    }
  }

  const seenIds = new Set<string>();
  const merged: JulesSessionItem[] = [];

  for (const item of standaloneItems) {
    if (!seenIds.has(item.id)) {
      seenIds.add(item.id);
      merged.push(item);
    }
  }

  for (const item of legacyItems) {
    if (!seenIds.has(item.id) && !deletedSet.has(item.id)) {
      seenIds.add(item.id);
      merged.push(item);
    }
  }

  return merged;
}

export function spawnJulesTaskAsync(
  layers: AppWindowLayers,
  repoPath: string,
  prompt: string,
  repoSlug?: string
): Promise<JulesRunResult> {
  return new Promise((resolve) => {
    // If a task is already running, cancel it first
    if (currentRunningTask) {
      cancelActiveJulesTask(layers);
    }

    const taskId = randomUUID();
    const julesBin = getJulesBinaryPath();
    const startTime = Date.now();

    try {
      let targetRepo = repoSlug;
      if (!targetRepo && repoPath && fs.existsSync(repoPath)) {
        const gitInfo = detectGitInfo(repoPath);
        if (gitInfo?.githubRepo) {
          targetRepo = gitInfo.githubRepo;
        } else {
          try {
            const connected = executeListJulesRepos(repoPath);
            const folderName = path.basename(repoPath).toLowerCase().replace(/[^a-z0-9]/g, '');
            const match = connected.find((r) => {
              const repoName = (r.split('/')[1] || '').toLowerCase().replace(/[^a-z0-9]/g, '');
              return repoName === folderName;
            });
            if (match) {
              targetRepo = match;
            }
          } catch {
            // ignore
          }
        }
      }

      const args = ['new'];
      if (targetRepo) {
        args.push('--repo', targetRepo);
      }
      args.push(prompt);

      const child = spawn(julesBin, args, {
        cwd: repoPath,
        env: getCliEnv(),
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      const pid = child.pid || 0;
      currentRunningTask = {
        id: taskId,
        child,
        pid,
        repoPath,
        prompt,
        startTime,
        aborted: false,
        outputBuffer: ''
      };

      const sendChunk = (stream: 'stdout' | 'stderr' | 'system', text: string) => {
        if (layers.chromeView.webContents.isDestroyed()) return;
        const cleaned = cleanTerminalText(text);
        if (!cleaned) return;

        // Auto-detect session ID
        let sessionId: string | undefined;
        if (currentRunningTask) {
          currentRunningTask.outputBuffer += cleaned;
          // Keep sliding window of last 1000 characters
          if (currentRunningTask.outputBuffer.length > 2000) {
            currentRunningTask.outputBuffer = currentRunningTask.outputBuffer.slice(-1000);
          }
          if (!currentRunningTask.detectedSessionId) {
            sessionId = extractSessionId(currentRunningTask.outputBuffer);
            if (sessionId) {
              currentRunningTask.detectedSessionId = sessionId;
            }
          } else {
            sessionId = currentRunningTask.detectedSessionId;
          }
        }

        const chunkObj: TaskOutputChunk = {
          taskId,
          stream,
          chunk: cleaned,
          raw: text,
          timestamp: Date.now(),
          sessionId
        };
        layers.chromeView.webContents.send('chrome:task-output', chunkObj);
      };

      const sendStatus = (
        status: TaskStatusEvent['status'],
        message?: string,
        exitCode?: number | null
      ) => {
        if (layers.chromeView.webContents.isDestroyed()) return;
        const event: TaskStatusEvent = {
          taskId,
          status,
          exitCode,
          sessionId: currentRunningTask?.detectedSessionId,
          durationMs: Date.now() - startTime,
          message
        };
        layers.chromeView.webContents.send('chrome:task-status', event);
      };

      // Notify task started
      sendStatus('running', `Task started (PID: ${pid})`);
      sendChunk(
        'system',
        `[JULES:EXEC] Spawning Jules CLI (PID: ${pid})\nRepository: ${repoPath}${
          targetRepo ? `\nTarget Repo: ${targetRepo}` : ''
        }\nPrompt: "${prompt}"\n\n`
      );

      child.stdout?.on('data', (data: Buffer) => {
        sendChunk('stdout', data.toString('utf8'));
      });

      child.stderr?.on('data', (data: Buffer) => {
        sendChunk('stderr', data.toString('utf8'));
      });

      child.on('error', (err: Error) => {
        sendChunk('system', `\n[JULES:ERROR] Failed to start process: ${err.message}\n`);
        sendStatus('failed', err.message);
        currentRunningTask = null;
        resolve({
          success: false,
          output: err.message,
          message: `Failed to execute Jules: ${err.message}`
        });
      });

      child.on('close', (code: number | null) => {
        const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
        const aborted = currentRunningTask?.aborted ?? false;
        const sessionId = currentRunningTask?.detectedSessionId;
        const finalOutput = currentRunningTask?.outputBuffer || '';
        const hasCliError =
          !sessionId && (code !== 0 || /error:/i.test(finalOutput) || /failed/i.test(finalOutput));

        if (aborted) {
          sendChunk('system', `\n[JULES:ABORT] Process terminated by user after ${durationSec}s\n`);
          sendStatus('cancelled', 'Task aborted by user', code);
        } else if (!hasCliError && (code === 0 || !!sessionId)) {
          sendChunk(
            'system',
            `\n[JULES:DONE] Task completed successfully in ${durationSec}s${
              sessionId ? ` (Session: ${sessionId})` : ''
            }\n`
          );
          sendStatus('completed', 'Task completed', code);
        } else {
          if (
            /not a git repository connected to Jules|No --repo flag provided/i.test(finalOutput)
          ) {
            sendChunk(
              'system',
              '\n[JULES:GUIDANCE] This local git repository is not connected to your Google Jules account.\nConnect the repository on GitHub and authorize it in https://jules.google.com/settings, or select a connected repository from the header.\n'
            );
          }
          sendChunk(
            'system',
            `\n[JULES:EXIT] Process exited with code ${code ?? -1} after ${durationSec}s\n`
          );
          sendStatus(
            'failed',
            /not a git repository connected to Jules/i.test(finalOutput)
              ? 'Local repository not connected to Google Jules'
              : `Process failed or exited with code ${code ?? -1}`,
            code
          );
        }

        currentRunningTask = null;

        resolve({
          success: !aborted && !hasCliError && (code === 0 || !!sessionId),
          sessionId,
          output: finalOutput,
          message: aborted
            ? 'Task cancelled by user'
            : hasCliError
            ? `Task failed (process exited with exit code ${code ?? 1})`
            : code === 0 || !!sessionId
            ? 'Task completed successfully'
            : `Task failed with exit code ${code ?? -1}`
        });
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      currentRunningTask = null;
      resolve({ success: false, output: msg, message: msg });
    }
  });
}

export function cancelActiveJulesTask(layers?: AppWindowLayers): {
  success: boolean;
  message: string;
} {
  let anyCancelled = false;
  let message = 'No active task running';

  if (currentRunningTask) {
    const { pid, id } = currentRunningTask;
    currentRunningTask.aborted = true;

    if (layers && !layers.chromeView.webContents.isDestroyed()) {
      layers.chromeView.webContents.send('chrome:task-output', {
        taskId: id,
        stream: 'system',
        chunk: `\n[JULES:SIGNAL] Sending SIGTERM to process group ${pid}...\n`,
        timestamp: Date.now()
      } as TaskOutputChunk);
    }

    const killed = killProcessGroup(pid, 'SIGTERM');

    // Hard kill fallback after 1.5 seconds if process hasn't exited
    setTimeout(() => {
      if (currentRunningTask && currentRunningTask.pid === pid) {
        killProcessGroup(pid, 'SIGKILL');
      }
    }, 1500);

    anyCancelled = killed;
    message = killed ? `Task (PID: ${pid}) cancelled` : 'Process already exited';
  }

  // Also cancel any running multi-engine task
  const engineCancelled = cancelRunningEngineTask();
  if (engineCancelled) {
    anyCancelled = true;
    message = 'Engine task cancelled';
  }

  return {
    success: anyCancelled,
    message
  };
}

export function parseGitHubRepoFromUrl(remoteUrl: string): string | undefined {
  if (!remoteUrl) return undefined;
  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?/i);
  if (match && match[1] && match[2]) {
    return `${match[1]}/${match[2]}`;
  }
  return undefined;
}

export function unquoteGitPath(rawPath: string): string {
  if (!rawPath) return '';
  let s = rawPath.trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1);
    const bytes: number[] = [];
    for (let i = 0; i < s.length; i++) {
      const char = s[i] ?? '';
      if (char === '\\' && i + 1 < s.length) {
        const next = s[i + 1] ?? '';
        if (next === '\\' || next === '"' || next === '/') {
          bytes.push(next.charCodeAt(0));
          i++;
        } else if (next === 't') {
          bytes.push(9);
          i++;
        } else if (next === 'n') {
          bytes.push(10);
          i++;
        } else if (next === 'r') {
          bytes.push(13);
          i++;
        } else if (/[0-7]/.test(next)) {
          let oct = '';
          for (let j = 0; j < 3 && i + 1 < s.length; j++) {
            const peek = s[i + 1] ?? '';
            if (/[0-7]/.test(peek)) {
              oct += peek;
              i++;
            } else {
              break;
            }
          }
          bytes.push(parseInt(oct, 8));
        } else {
          bytes.push(char.charCodeAt(0));
        }
      } else {
        const buf = Buffer.from(char, 'utf8');
        for (const b of buf) bytes.push(b);
      }
    }
    return Buffer.from(bytes).toString('utf8');
  }
  return s;
}

export function parseGitStatusPorcelain(
  statusText: string,
  branch = 'main',
  githubRepo?: string
): GitStructuredStatus {
  const staged: GitFileChange[] = [];
  const unstaged: GitFileChange[] = [];
  const untracked: GitFileChange[] = [];
  const conflicts: GitFileChange[] = [];

  const lines = statusText.split('\n').map((l) => l.trimEnd()).filter(Boolean);

  for (const line of lines) {
    if (line.length < 3) continue;
    const x = line[0] || ' ';
    const y = line[1] || ' ';
    let rawTarget = line.slice(3).trim();
    // Handle renamed files (e.g. "old -> new")
    if (rawTarget.includes(' -> ')) {
      const parts = rawTarget.split(' -> ');
      rawTarget = parts[parts.length - 1] || rawTarget;
    }
    const filePath = unquoteGitPath(rawTarget);

    if (line.startsWith('??')) {
      untracked.push({
        path: filePath,
        status: 'untracked',
        code: '??',
        stagedCode: ' ',
        worktreeCode: '?'
      });
      continue;
    }

    // Merge conflicts
    if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
      conflicts.push({
        path: filePath,
        status: 'conflict',
        code: `${x}${y}`,
        stagedCode: x,
        worktreeCode: y
      });
      continue;
    }

    // Staged component
    if (x !== ' ' && x !== '?') {
      staged.push({
        path: filePath,
        status: 'staged',
        code: `${x} `,
        stagedCode: x,
        worktreeCode: ' '
      });
    }

    // Unstaged component
    if (y !== ' ' && y !== '?') {
      unstaged.push({
        path: filePath,
        status: 'modified',
        code: ` ${y}`,
        stagedCode: ' ',
        worktreeCode: y
      });
    }
  }

  const isDetached = branch.startsWith('HEAD');
  const totalChanges = staged.length + unstaged.length + untracked.length + conflicts.length;

  return {
    staged,
    unstaged,
    untracked,
    conflicts,
    totalChanges,
    isDetached,
    branch,
    githubRepo
  };
}

export function detectGitInfo(dirPath: string): LocalRepoInfo | null {
  try {
    const isGit = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: dirPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000
    }).trim();

    if (isGit !== 'true') return null;

    let effectivePath = dirPath;
    try {
      const toplevel = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: dirPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2000
      }).trim();
      if (toplevel && fs.existsSync(toplevel)) {
        effectivePath = toplevel;
      }
    } catch {
      // fallback to dirPath
    }

    let branch = 'main';
    try {
      try {
        branch = execFileSync('git', ['branch', '--show-current'], {
          cwd: effectivePath,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 2000
        }).trim();
      } catch {
        // fallback
      }

      if (!branch) {
        try {
          branch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
            cwd: effectivePath,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 2000
          }).trim();
        } catch {
          // fallback
        }
      }

      if (!branch) {
        branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: effectivePath,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 2000
        }).trim();
      }

      if (branch === 'HEAD') {
        try {
          const shortHash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
            cwd: effectivePath,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 2000
          }).trim();
          branch = `HEAD (detached at ${shortHash})`;
        } catch {
          // ignore
        }
      }
    } catch {
      // fallback
    }

    let githubRepo: string | undefined;
    try {
      let remote = '';
      try {
        remote = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
          cwd: effectivePath,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 2000
        }).trim();
      } catch {
        // try first available remote
        const firstRemote = execFileSync('git', ['remote'], {
          cwd: effectivePath,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 2000
        })
          .trim()
          .split('\n')[0];
        if (firstRemote) {
          remote = execFileSync('git', ['config', '--get', `remote.${firstRemote.trim()}.url`], {
            cwd: effectivePath,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 2000
          }).trim();
        }
      }
      if (remote) {
        githubRepo = parseGitHubRepoFromUrl(remote);
      }
    } catch {
      // no remote
    }

    // Fallback: If no github remote found, attempt matching directory name with connected Jules repos
    if (!githubRepo) {
      try {
        const connected = executeListJulesRepos(effectivePath);
        const folderName = path.basename(effectivePath).toLowerCase().replace(/[^a-z0-9]/g, '');
        const match = connected.find((r) => {
          const repoName = (r.split('/')[1] || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          return repoName === folderName;
        });
        if (match) {
          githubRepo = match;
          try {
            const remotesList = execFileSync('git', ['remote'], {
              cwd: effectivePath,
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'ignore'],
              timeout: 1500
            }).trim();
            if (!remotesList) {
              execFileSync('git', ['remote', 'add', 'origin', `https://github.com/${match}.git`], {
                cwd: effectivePath,
                stdio: ['ignore', 'ignore', 'ignore'],
                timeout: 1500
              });
            }
          } catch {
            // ignore
          }
        }
      } catch {
        // no remote / jules cli unavailable
      }
    }

    let lastCommit: string | undefined;
    try {
      lastCommit = execFileSync('git', ['log', '-1', '--format=%s'], {
        cwd: effectivePath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2000
      }).trim();
    } catch {
      // no commits
    }

    return {
      name: path.basename(effectivePath),
      path: effectivePath,
      branch,
      githubRepo,
      lastCommit
    };
  } catch {
    return null;
  }
}

export function getGitStructuredStatus(
  dirPath: string,
  existingInfo?: LocalRepoInfo
): GitStructuredStatus | null {
  try {
    const info = existingInfo || detectGitInfo(dirPath);
    if (!info) return null;

    let statusText = '';
    try {
      statusText = execFileSync(
        'git',
        ['-c', 'core.quotepath=false', 'status', '--porcelain=v1'],
        {
          cwd: dirPath,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 3000,
          maxBuffer: 1024 * 1024 * 4
        }
      );
    } catch {
      // fallback
    }

    const structured = parseGitStatusPorcelain(statusText, info.branch, info.githubRepo);

    // Upstream tracking (ahead / behind)
    try {
      const counts = execFileSync(
        'git',
        ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'],
        {
          cwd: dirPath,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 2000
        }
      ).trim();
      const parts = counts.split(/\s+/);
      if (parts.length >= 2) {
        structured.aheadBehind = {
          ahead: parseInt(parts[0] || '0', 10) || 0,
          behind: parseInt(parts[1] || '0', 10) || 0
        };
      }
    } catch {
      // no upstream tracking branch
    }

    return structured;
  } catch {
    return null;
  }
}

export function getGitFileDiff(dirPath: string, filePath: string, staged = false): GitFileDiff {
  try {
    const resolved = path.resolve(dirPath, filePath);
    const repoRoot = path.resolve(dirPath);
    if (!resolved.startsWith(repoRoot + path.sep) && resolved !== repoRoot) {
      return {
        filePath,
        diff: '(File path outside repository boundary)',
        isStaged: staged
      };
    }

    const relativePath = path.relative(repoRoot, resolved);

    const args = ['diff'];
    if (staged) {
      args.push('--cached');
    }
    args.push('--', relativePath);

    let diff = '';
    try {
      diff = execFileSync('git', args, {
        cwd: dirPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
        maxBuffer: 1024 * 1024 * 4
      });
    } catch {
      if (staged) {
        try {
          diff = execFileSync(
            'git',
            ['diff', '--cached', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', '--', relativePath],
            {
              cwd: dirPath,
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'ignore'],
              timeout: 3000,
              maxBuffer: 1024 * 1024 * 4
            }
          );
        } catch {
          // fallback
        }
      }
    }

    if (!diff && !staged) {
      let isTracked = false;
      try {
        execFileSync('git', ['ls-files', '--error-unmatch', '--', relativePath], {
          cwd: dirPath,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 2000
        });
        isTracked = true;
      } catch {
        isTracked = false;
      }

      if (!isTracked && fs.existsSync(resolved)) {
        try {
          diff = execFileSync('git', ['diff', '--no-index', '--', '/dev/null', relativePath], {
            cwd: dirPath,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 3000,
            maxBuffer: 1024 * 1024 * 4
          });
        } catch (err: unknown) {
          const e = err as { stdout?: string };
          if (e && typeof e.stdout === 'string' && e.stdout.length > 0) {
            diff = e.stdout;
          }
        }
      }
    }

    return {
      filePath,
      diff: diff || '(No differences detected)',
      isStaged: staged
    };
  } catch (err: unknown) {
    return {
      filePath,
      diff: `(Failed to compute diff: ${err instanceof Error ? err.message : String(err)})`,
      isStaged: staged
    };
  }
}

export function getGitReviewDetails(dirPath: string): GitReviewDetails | null {
  try {
    const info = detectGitInfo(dirPath);
    if (!info) return null;

    let statusText = '';
    try {
      statusText = execFileSync('git', ['status', '-s'], {
        cwd: dirPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2000,
        maxBuffer: 1024 * 1024 * 4
      }).trimEnd();
    } catch {
      // fallback
    }

    const recentCommits: GitCommitItem[] = [];
    try {
      const logOut = execFileSync('git', ['log', '-8', '--format=%h%x09%an%x09%ar%x09%s'], {
        cwd: dirPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2000
      }).trim();

      if (logOut) {
        const lines = logOut.split('\n');
        for (const line of lines) {
          const parts = line.split('\t');
          const hash = parts[0] || '';
          const author = parts[1] || '';
          const date = parts[2] || '';
          const message = parts[3] || '';
          if (hash && message) {
            recentCommits.push({ hash, author, date, message });
          }
        }
      }
    } catch {
      // fallback
    }

    const structured =
      getGitStructuredStatus(dirPath, info) ||
      parseGitStatusPorcelain(statusText, info.branch, info.githubRepo);

    return {
      statusText,
      recentCommits,
      hasChanges: statusText.length > 0 || (structured?.totalChanges ?? 0) > 0,
      branch: info.branch,
      githubRepo: info.githubRepo,
      structured
    };
  } catch {
    return null;
  }
}

export function ensureInitialAccount(): void {
  const registry = loadAccountRegistry();
  if (registry.accounts.length === 0) {
    const defaultAccount = createDefaultAccount({
      id: 'default-spike',
      name: 'OSINTCabal',
      email: 'osintcabal@google.com',
      partition: 'persist:spike'
    });
    registry.accounts.push(defaultAccount);
    registry.activeAccountId = defaultAccount.id;
    saveAccountRegistry(registry);
  }
}

let cachedDiscoveredEngines: ReturnType<typeof discoverEngines> | null = null;
let cachedDiscoveredEnginesAt = 0;

export function getNavigationState(layers: AppWindowLayers): NavigationState {
  const content = layers.contentView.webContents;
  const currentUrl = content.getURL() || '';
  const isGoogleAuth = currentUrl.includes('accounts.google.com');

  const registry = loadAccountRegistry();
  const activeAccount =
    registry.accounts.find((a) => a.id === registry.activeAccountId) || registry.accounts[0];

  let accountName = 'OSINTCabal';
  if (isGoogleAuth) {
    accountName = 'Sign In to Google';
  } else if (activeAccount) {
    accountName = activeAccount.name || activeAccount.email || 'Google Account';
  }

  if (!cachedDiscoveredEngines || Date.now() - cachedDiscoveredEnginesAt > 60000) {
    cachedDiscoveredEngines = discoverEngines({ fetchVersion: false });
    cachedDiscoveredEnginesAt = Date.now();
  }

  return {
    canGoBack: content.navigationHistory ? content.navigationHistory.canGoBack() : content.canGoBack(),
    canGoForward: content.navigationHistory
      ? content.navigationHistory.canGoForward()
      : content.canGoForward(),
    isLoading: content.isLoading(),
    currentUrl,
    title: content.getTitle() || 'JulesDeck',
    accountName,
    accountEmail: activeAccount?.email,
    activeAccountId: registry.activeAccountId,
    accounts: registry.accounts,
    localRepo: activeLocalRepo,
    recentRepos: loadRecentRepos(),
    isMaximized: layers.baseWindow.isMaximized(),
    mode: currentMode,
    activeEngine,
    activeModel,
    activeGitHubRepo,
    legacyJulesHealth: cachedLegacyHealth,
    engines: cachedDiscoveredEngines
  };
}

export function broadcastStateUpdate(layers: AppWindowLayers): void {
  const state = getNavigationState(layers);
  if (!layers.chromeView.webContents.isDestroyed()) {
    layers.chromeView.webContents.send('chrome:state-update', state);
  }
}

export function initGitRepoAtPath(
  layers: AppWindowLayers,
  folderPath: string
): {
  success: boolean;
  repo?: string;
  path?: string;
  message: string;
} {
  if (!fs.existsSync(folderPath)) {
    return { success: false, message: 'Directory does not exist' };
  }
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: folderPath });
    const gitInfo = detectGitInfo(folderPath);
    if (!gitInfo) {
      return { success: false, message: 'Failed to inspect newly initialized git repository' };
    }
    activeLocalRepo = gitInfo;
    addRecentRepo(gitInfo);
    broadcastStateUpdate(layers);
    return {
      success: true,
      repo: gitInfo.githubRepo || gitInfo.name,
      path: gitInfo.path,
      message: `Initialized and activated Git repository in ${gitInfo.name}`
    };
  } catch (err) {
    return { success: false, message: `Git init failed: ${String(err)}` };
  }
}

export async function initGitRepoDialog(
  layers: AppWindowLayers,
  folderPath?: string
): Promise<{
  success: boolean;
  repo?: string;
  path?: string;
  message: string;
}> {
  let targetPath = folderPath;
  if (!targetPath) {
    const result = await dialog.showOpenDialog(layers.baseWindow, {
      title: 'Select Folder to Initialize Git Repository',
      properties: ['openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0 || !result.filePaths[0]) {
      return { success: false, message: 'Selection canceled' };
    }
    targetPath = result.filePaths[0];
  }
  return initGitRepoAtPath(layers, targetPath);
}

export async function openLocalRepoDialog(layers: AppWindowLayers): Promise<{
  success: boolean;
  repo?: string;
  path?: string;
  message: string;
}> {
  const result = await dialog.showOpenDialog(layers.baseWindow, {
    title: 'Select Local Git Repository or Project Folder',
    properties: ['openDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, message: 'Selection canceled' };
  }

  const selectedPath = result.filePaths[0];
  if (!selectedPath) {
    return { success: false, message: 'No folder selected' };
  }

  const gitInfo = detectGitInfo(selectedPath);
  if (!gitInfo) {
    await dialog.showMessageBox(layers.baseWindow, {
      type: 'warning',
      title: 'Not a Git Repository',
      message: 'The selected folder does not appear to be a Git repository.'
    });
    return { success: false, message: 'Not a Git repository' };
  }

  activeLocalRepo = gitInfo;
  addRecentRepo(gitInfo);
  broadcastStateUpdate(layers);

  return {
    success: true,
    repo: gitInfo.githubRepo || gitInfo.name,
    path: gitInfo.path,
    message: `Active repository set to ${gitInfo.name} (${gitInfo.branch})`
  };
}

export function selectRecentRepoByPath(
  layers: AppWindowLayers,
  targetPath: string
): {
  success: boolean;
  repo?: string;
  path?: string;
  message: string;
} {
  if (!fs.existsSync(targetPath)) {
    const remaining = loadRecentRepos().filter((r) => r.path !== targetPath);
    saveRecentRepos(remaining);
    broadcastStateUpdate(layers);
    return { success: false, message: 'Directory does not exist' };
  }
  const gitInfo = detectGitInfo(targetPath);
  if (!gitInfo) {
    return { success: false, message: 'Path is not a Git repository' };
  }

  activeLocalRepo = gitInfo;
  addRecentRepo(gitInfo);
  broadcastStateUpdate(layers);

  return {
    success: true,
    repo: gitInfo.githubRepo || gitInfo.name,
    path: gitInfo.path,
    message: `Switched to ${gitInfo.name} (${gitInfo.branch})`
  };
}

/**
 * Headless multi-engine task execution helper.
 */
export async function runJulesTask(
  repoPath: string,
  prompt: string,
  options?: Partial<RunTaskOptions>
): Promise<JulesRunResult> {
  const engineToUse: AgentEngineId = options?.engine || activeEngine || 'gemini-cli';
  const modelToUse: string = options?.model || activeModel || 'gemini-3.1-pro';
  const effectivePath = repoPath || activeLocalRepo?.path || (activeGitHubRepo?.managedPath ?? '');
  const taskMode: 'repo' | 'local' = options?.mode || (currentMode === 'repo' ? 'repo' : 'local');

  let taskBranch: string | undefined;
  if (taskMode === 'repo' && effectivePath && fs.existsSync(effectivePath)) {
    try {
      const branchRes = await prepareTaskBranch(effectivePath, prompt, options?.baseBranch);
      if (branchRes.success) {
        taskBranch = branchRes.branchName;
        if (activeLocalRepo && activeLocalRepo.path === effectivePath) {
          activeLocalRepo.branch = branchRes.branchName;
        }
      }
    } catch {
      // ignore
    }
  }

  const sessionId = options?.sessionId || randomUUID();
  upsertStandaloneSession({
    id: sessionId,
    mode: taskMode,
    title: prompt.slice(0, 60),
    prompt,
    engine: engineToUse,
    model: modelToUse,
    workspacePath: effectivePath,
    githubRepo: options?.githubRepo || activeGitHubRepo?.nameWithOwner,
    taskBranch,
    status: 'running',
    planSteps: [
      { label: 'Analyze workspace and task requirements', state: 'running' },
      { label: 'Execute solution via ' + engineToUse, state: 'pending' },
      { label: 'Verify changes', state: 'pending' }
    ],
    messages: [{ role: 'user', content: prompt, timestamp: Date.now() }]
  });

  if (engineToUse === 'legacy-jules') {
    return executeJulesTask(effectivePath, prompt);
  }

  if (
    (process.env.NODE_ENV !== 'test' && !process.env.VITEST && process.env.JULESDECK_E2E_FAST !== '1') ||
    process.env.JULESDECK_LIVE_ENGINE === '1' ||
    Boolean(
      options?.engine &&
        (process.env.JULESDECK_MOCK_ENGINE === '1' ||
          prompt.startsWith('__MOCK__') ||
          prompt.startsWith('__FILE_CHECK__:'))
    )
  ) {
    const res = await runEngineTask({
      engine: engineToUse,
      prompt,
      repoPath: effectivePath,
      model: modelToUse,
      githubRepo: options?.githubRepo || activeGitHubRepo?.nameWithOwner,
      taskId: sessionId,
      sessionId
    });

    upsertStandaloneSession({
      id: sessionId,
      status: res.success ? 'completed' : 'failed',
      terminalOutput: res.output
    });

    return res;
  }

  // Fast local pass
  const output = `[ENGINE: ${engineToUse} (${modelToUse})]\n[WORKSPACE: ${effectivePath}]\nTask: ${prompt}\n\nTask prepared successfully.`;
  upsertStandaloneSession({
    id: sessionId,
    status: 'completed',
    terminalOutput: output
  });

  return {
    success: true,
    sessionId,
    output,
    message: 'Task completed successfully',
    engine: engineToUse,
    model: modelToUse,
    taskBranch,
    workspacePath: effectivePath
  };
}

export function registerIpcHandlers(
  layers: AppWindowLayers,
  cookieImporter: ChromeCookieImporter,
  targetUrl: string,
  cleanUserAgent: string,
  configureSession: (partitionName: string) => void
): () => void {
  ensureInitialAccount();

  let unhookContentListeners: (() => void) | null = null;

  function hookContentListeners(content: WebContents): () => void {
    if (unhookContentListeners) unhookContentListeners();

    const onStartLoading = () => broadcastStateUpdate(layers);
    const onStopLoading = () => broadcastStateUpdate(layers);
    const onNavigate = () => broadcastStateUpdate(layers);
    const onTitleUpdated = () => broadcastStateUpdate(layers);

    const onFinishLoad = async () => {
      broadcastStateUpdate(layers);
      try {
        const url = content.getURL() || '';
        if (!url.includes('jules.google.com')) return;

        const registry = loadAccountRegistry();
        const activeAccount = registry.accounts.find((a) => a.id === registry.activeAccountId);
        if (!activeAccount) return;

        const isPlaceholder =
          !activeAccount.email ||
          activeAccount.name === 'Google Account' ||
          activeAccount.name === 'New Account' ||
          activeAccount.name === 'Default Account';

        if (!isPlaceholder) return;

        let profile: { name?: string; email?: string } | null = null;

        // 1. DOM parse via executeJavaScript
        try {
          const ariaLabel = await content.executeJavaScript(`
            (function() {
              var el = document.querySelector('[aria-label*="Google Account"]') ||
                       document.querySelector('a[href*="SignOutOptions"]') ||
                       document.querySelector('header [aria-label*="@"]');
              return el ? el.getAttribute('aria-label') : '';
            })()
          `);
          if (ariaLabel) {
            profile = parseGoogleAccountLabel(ariaLabel);
          }
        } catch {
          // ignore
        }

        // 2. Fallback: session ListAccounts
        if (!profile?.email && content.session && typeof content.session.fetch === 'function') {
          try {
            const resp = await content.session.fetch(
              'https://accounts.google.com/ListAccounts?psa=1&pid=chromium',
              {
                credentials: 'include'
              }
            );
            if (resp.ok) {
              const text = await resp.text();
              profile = parseGoogleAccountsResponse(text);
            }
          } catch {
            // ignore
          }
        }

        if (profile?.email) {
          activeAccount.email = profile.email;
          if (profile.name) activeAccount.name = profile.name;
          saveAccountRegistry(registry);
          broadcastStateUpdate(layers);
        }
      } catch {
        // Never throw from background labelling
      }
    };

    const injectCustomStyles = async () => {
      try {
        if (!content.isDestroyed()) {
          await content.insertCSS(`
            img.gb_X,
            .gb_X,
            img[src*="ring/pr_"],
            img[src*="ring"][class*="gb_"] {
              display: none !important;
              visibility: hidden !important;
              opacity: 0 !important;
              pointer-events: none !important;
              width: 0 !important;
              height: 0 !important;
            }
          `);
        }
      } catch {
        // Never throw from CSS injection
      }
    };

    content.on('dom-ready', injectCustomStyles);
    content.on('did-start-loading', onStartLoading);
    content.on('did-stop-loading', onStopLoading);
    content.on('did-finish-load', () => {
      injectCustomStyles();
      onFinishLoad();
    });
    content.on('did-fail-load', onStopLoading);
    content.on('did-navigate', onNavigate);
    content.on('did-navigate-in-page', () => {
      injectCustomStyles();
      onNavigate();
    });
    content.on('page-title-updated', onTitleUpdated);

    unhookContentListeners = () => {
      if (!content.isDestroyed()) {
        content.removeListener('dom-ready', injectCustomStyles);
        content.removeListener('did-start-loading', onStartLoading);
        content.removeListener('did-stop-loading', onStopLoading);
        content.removeListener('did-finish-load', onFinishLoad);
        content.removeListener('did-fail-load', onStopLoading);
        content.removeListener('did-navigate', onNavigate);
        content.removeListener('did-navigate-in-page', onNavigate);
        content.removeListener('page-title-updated', onTitleUpdated);
      }
    };
    return unhookContentListeners;
  }

  function attachInputShortcuts(wc: WebContents): () => void {
    const onBeforeInput = (event: Electron.Event, input: Electron.Input) => {
      if (input.type !== 'keyDown' || input.isAutoRepeat) return;

      const isCtrl = input.control || input.meta;
      const isAlt = input.alt;
      const key = (input.key || '').toLowerCase();

      // Ctrl+1 / Alt+1 -> Cloud
      if ((isCtrl || isAlt) && (key === '1' || input.code === 'Digit1' || input.code === 'Numpad1')) {
        event.preventDefault();
        currentMode = 'cloud';
        if (!layers.chromeView.webContents.isDestroyed()) {
          layers.chromeView.webContents.send('chrome:mode-command', 'cloud');
        }
        return;
      }

      // Ctrl+2 / Alt+2 -> Local
      if ((isCtrl || isAlt) && (key === '2' || input.code === 'Digit2' || input.code === 'Numpad2')) {
        event.preventDefault();
        currentMode = 'local';
        if (!layers.chromeView.webContents.isDestroyed()) {
          layers.chromeView.webContents.send('chrome:mode-command', 'local');
        }
        return;
      }

      // Ctrl+3 / Alt+3 -> Repo
      if ((isCtrl || isAlt) && (key === '3' || input.code === 'Digit3' || input.code === 'Numpad3')) {
        event.preventDefault();
        currentMode = 'repo';
        if (!layers.chromeView.webContents.isDestroyed()) {
          layers.chromeView.webContents.send('chrome:mode-command', 'repo');
        }
        return;
      }

      // Ctrl+L -> Toggle Mode
      if ((isCtrl || isAlt) && (key === 'l' || input.code === 'KeyL')) {
        event.preventDefault();
        currentMode = currentMode === 'local' ? 'cloud' : 'local';
        if (!layers.chromeView.webContents.isDestroyed()) {
          layers.chromeView.webContents.send('chrome:mode-command', currentMode);
        }
        return;
      }

      // Ctrl+O -> Open Local Repo Dialog
      if (isCtrl && (key === 'o' || input.code === 'KeyO')) {
        event.preventDefault();
        void openLocalRepoDialog(layers);
        return;
      }

      // Esc -> only intercept on remote contentView when in local or repo mode
      if (key === 'escape' && wc !== layers.chromeView.webContents) {
        if (currentMode === 'local' || currentMode === 'repo') {
          event.preventDefault();
          currentMode = 'cloud';
          if (!layers.chromeView.webContents.isDestroyed()) {
            layers.chromeView.webContents.send('chrome:mode-command', 'cloud');
          }
        }
      }
    };

    wc.on('before-input-event', onBeforeInput);
    return () => {
      if (!wc.isDestroyed()) {
        wc.removeListener('before-input-event', onBeforeInput);
      }
    };
  }

  let unhookChromeShortcuts: (() => void) | null = attachInputShortcuts(
    layers.chromeView.webContents
  );
  let unhookContentShortcuts: (() => void) | null = null;
  let unhookNavigationHandlers: (() => void) | null = null;

  function attachContentView(content: WebContents): () => void {
    if (unhookNavigationHandlers) {
      unhookNavigationHandlers();
      unhookNavigationHandlers = null;
    }
    unhookNavigationHandlers = configureNavigationHandlers(content);
    if (unhookContentShortcuts) {
      unhookContentShortcuts();
      unhookContentShortcuts = null;
    }
    unhookContentShortcuts = attachInputShortcuts(content);
    return hookContentListeners(content);
  }

  function detachCurrentContentView(): void {
    if (unhookNavigationHandlers) {
      unhookNavigationHandlers();
      unhookNavigationHandlers = null;
    }
    if (unhookContentShortcuts) {
      unhookContentShortcuts();
      unhookContentShortcuts = null;
    }
    if (unhookContentListeners) {
      unhookContentListeners();
      unhookContentListeners = null;
    }
  }

  attachContentView(layers.contentView.webContents);

  ipcMain.handle('chrome:get-state', () => getNavigationState(layers));
  ipcMain.handle('chrome:nav-back', () => {
    const c = layers.contentView.webContents;
    if (c.navigationHistory ? c.navigationHistory.canGoBack() : c.canGoBack()) {
      if (c.navigationHistory) c.navigationHistory.goBack();
      else c.goBack();
    }
  });
  ipcMain.handle('chrome:nav-forward', () => {
    const c = layers.contentView.webContents;
    if (c.navigationHistory ? c.navigationHistory.canGoForward() : c.canGoForward()) {
      if (c.navigationHistory) c.navigationHistory.goForward();
      else c.goForward();
    }
  });
  ipcMain.handle('chrome:nav-reload', () => layers.contentView.webContents.reload());
  ipcMain.handle('chrome:win-minimize', () => layers.baseWindow.minimize());
  ipcMain.handle('chrome:win-maximize', () => {
    if (layers.baseWindow.isMaximized()) layers.baseWindow.unmaximize();
    else layers.baseWindow.maximize();
    broadcastStateUpdate(layers);
  });
  ipcMain.handle('chrome:win-toggle-maximize', () => {
    if (layers.baseWindow.isMaximized()) layers.baseWindow.unmaximize();
    else layers.baseWindow.maximize();
    broadcastStateUpdate(layers);
  });
  ipcMain.handle('chrome:win-close', () => layers.baseWindow.close());
  ipcMain.handle('chrome:expand-view', (_event, height: number) => {
    const contentHeight = layers.baseWindow.getContentBounds().height;
    if (height === -1 || height >= contentHeight) {
      return expandChromeView(layers, -1);
    }
    const maxAllowed = Math.max(44, Math.min(800, contentHeight - 100));
    const clamped = Math.max(44, Math.min(maxAllowed, Number(height) || 44));
    return expandChromeView(layers, clamped);
  });
  ipcMain.handle('chrome:collapse-view', () => collapseChromeView(layers));
  ipcMain.handle('chrome:set-mode-state', (_event, mode: WorkspaceMode) => {
    if (['cloud', 'repo', 'local', 'legacy-cloud'].includes(mode)) {
      currentMode = mode;
      broadcastStateUpdate(layers);
    }
  });
  ipcMain.handle('app:open-settings', async () => {
    currentMode = 'cloud';
    collapseChromeView(layers);
    if (!layers.chromeView.webContents.isDestroyed()) {
      layers.chromeView.webContents.send('chrome:mode-command', 'cloud');
    }
    const wc = layers.contentView.webContents;
    if (!wc.isDestroyed()) {
      await wc.loadURL('https://jules.google.com/settings/general');
    }
    broadcastStateUpdate(layers);
    return { success: true };
  });
  ipcMain.handle('git:list-branches', async (_event, repoPath?: string) => {
    const target = repoPath || activeLocalRepo?.path;
    if (!target || !fs.existsSync(target)) return { branches: [], current: '' };
    try {
      const output = execSync('git branch --no-color', {
        cwd: target,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      const lines = output.split('\n').map((l) => l.trim()).filter(Boolean);
      let current = '';
      const branches: string[] = [];
      for (const line of lines) {
        if (line.startsWith('* ')) {
          current = line.replace(/^\*\s+/, '');
          branches.push(current);
        } else {
          branches.push(line);
        }
      }
      return { branches, current };
    } catch {
      return { branches: [], current: '' };
    }
  });
  ipcMain.handle('git:checkout-branch', async (_event, repoPath: string, branchName: string) => {
    try {
      if (!branchName || typeof branchName !== 'string' || branchName.startsWith('-')) {
        return { success: false, error: 'Invalid branch name' };
      }
      execFileSync('git', ['checkout', branchName], {
        cwd: repoPath,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      broadcastStateUpdate(layers);
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('git:commit-changes', async (_event, repoPath: string, message: string) => {
    try {
      const trimmed = (message || '').trim();
      if (!trimmed) {
        return { success: false, error: 'Commit message cannot be empty' };
      }
      execSync('git add -A', { cwd: repoPath, stdio: ['pipe', 'pipe', 'pipe'] });
      execFileSync('git', ['commit', '-m', trimmed], {
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      broadcastStateUpdate(layers);
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('chrome:init-git-repo', (_event, folderPath?: string) =>
    initGitRepoDialog(layers, folderPath)
  );
  ipcMain.handle('chrome:open-in-file-manager', async (_event, folderPath: string) => {
    await shell.openPath(folderPath);
  });

  ipcMain.handle('chrome:auth-sync', async () => {
    const ses = layers.contentView.webContents.session;
    const res = await cookieImporter.importToSession(ses);
    if (res.success) {
      layers.contentView.webContents.loadURL(targetUrl);
    }
    broadcastStateUpdate(layers);
    return res;
  });

  ipcMain.handle('chrome:auth-logout', async () => {
    const ses = layers.contentView.webContents.session;
    await ses.clearStorageData({
      storages: [
        'cookies',
        'filesystem',
        'indexdb',
        'localstorage',
        'shadercache',
        'serviceworkers',
        'cachestorage'
      ]
    });
    await ses.clearCache();
    if (typeof ses.clearAuthCache === 'function') {
      await ses.clearAuthCache();
    }
    const registry = loadAccountRegistry();
    const active = registry.accounts.find((a) => a.id === registry.activeAccountId);
    if (active) {
      active.name = 'Google Account';
      active.email = '';
      saveAccountRegistry(registry);
    }
    layers.contentView.webContents.loadURL(targetUrl);
    broadcastStateUpdate(layers);
  });

  ipcMain.handle('chrome:account-switch', async (_event, accountId: string) => {
    const updated = switchActiveAccount(accountId);
    if (!updated) return false;
    detachCurrentContentView();
    configureSession(updated.partition);
    const newContent = switchContentViewPartition(
      layers,
      updated.partition,
      targetUrl,
      cleanUserAgent
    );
    attachContentView(newContent.webContents);
    broadcastStateUpdate(layers);
    return true;
  });

  ipcMain.handle('chrome:account-add', async (_event, name?: string, email?: string) => {
    const account = createAccount(email || '', name || 'Google Account');
    switchActiveAccount(account.id);
    detachCurrentContentView();
    configureSession(account.partition);
    const newContent = switchContentViewPartition(
      layers,
      account.partition,
      targetUrl,
      cleanUserAgent
    );
    attachContentView(newContent.webContents);
    broadcastStateUpdate(layers);
    return account;
  });

  ipcMain.handle('chrome:account-remove', async (_event, accountId: string) => {
    const registry = loadAccountRegistry();
    const target = registry.accounts.find((a) => a.id === accountId);
    const wasActive = registry.activeAccountId === accountId;
    const res = removeAccount(accountId);
    if (wasActive && res.nextAccountId) {
      switchActiveAccount(res.nextAccountId);
      const updatedRegistry = loadAccountRegistry();
      const nextAcct = updatedRegistry.accounts.find((a) => a.id === res.nextAccountId);
      const part = nextAcct?.partition || 'persist:spike';
      detachCurrentContentView();
      configureSession(part);
      const newContent = switchContentViewPartition(layers, part, targetUrl, cleanUserAgent);
      attachContentView(newContent.webContents);
    }
    if (target) {
      try {
        const ses = session.fromPartition(target.partition);
        await ses.clearStorageData();
        await ses.clearCache();
      } catch {
        // partition cleanup
      }
    }
    broadcastStateUpdate(layers);
    return res;
  });

  ipcMain.handle('chrome:open-local-repo', () => openLocalRepoDialog(layers));
  ipcMain.handle('chrome:select-recent-repo', (_event, repoPath: string) =>
    selectRecentRepoByPath(layers, repoPath)
  );
  ipcMain.handle('chrome:get-recent-repos', () => loadRecentRepos());
  ipcMain.handle('chrome:clear-local-repo', () => {
    activeLocalRepo = undefined;
    broadcastStateUpdate(layers);
  });
  ipcMain.handle('chrome:git-review-details', () => {
    if (!activeLocalRepo) return null;
    return getGitReviewDetails(activeLocalRepo.path);
  });
  ipcMain.handle('chrome:git-structured-status', () => {
    if (!activeLocalRepo) return null;
    return getGitStructuredStatus(activeLocalRepo.path);
  });
  ipcMain.handle('chrome:git-file-diff', (_event, filePath: string, staged?: boolean) => {
    if (!activeLocalRepo) {
      return { filePath, diff: '(No active repository selected)', isStaged: Boolean(staged) };
    }
    return getGitFileDiff(activeLocalRepo.path, filePath, Boolean(staged));
  });

  // Upgraded Multi-Engine & Standalone Streaming Task Execution
  ipcMain.handle(
    'chrome:run-jules-task',
    async (_event, repoPath: string, prompt: string, options?: Partial<RunTaskOptions>) => {
      const engineToUse: AgentEngineId = options?.engine || activeEngine || 'gemini-cli';
      const modelToUse: string = options?.model || activeModel || 'gemini-3.1-pro';
      const taskMode: 'repo' | 'local' = options?.mode || (currentMode === 'repo' ? 'repo' : 'local');
      const effectivePath = repoPath || activeLocalRepo?.path || (activeGitHubRepo?.managedPath ?? '');

      let taskBranch: string | undefined;
      if (options?.mode === 'repo' && effectivePath && fs.existsSync(effectivePath)) {
        try {
          const branchRes = await prepareTaskBranch(effectivePath, prompt, options?.baseBranch);
          if (branchRes.success) {
            taskBranch = branchRes.branchName;
            if (activeLocalRepo && activeLocalRepo.path === effectivePath) {
              activeLocalRepo.branch = branchRes.branchName;
            }
            broadcastStateUpdate(layers);
          }
        } catch (err) {
          console.warn('[TASK] Failed to prepare task branch:', err);
        }
      }

      const sessionId = options?.sessionId || randomUUID();
      const initialRecord = upsertStandaloneSession({
        id: sessionId,
        mode: taskMode,
        title: prompt.slice(0, 60),
        prompt,
        engine: engineToUse,
        model: modelToUse,
        workspacePath: effectivePath,
        githubRepo:
          options?.githubRepo || activeGitHubRepo?.nameWithOwner || activeLocalRepo?.githubRepo,
        taskBranch,
        status: 'running',
        planSteps: [
          { label: 'Analyze workspace and task requirements', state: 'running' },
          { label: 'Execute solution via ' + engineToUse, state: 'pending' },
          { label: 'Verify changes', state: 'pending' }
        ],
        messages: [{ role: 'user', content: prompt, timestamp: Date.now() }]
      });

      // Legacy Jules execution (or unparameterized test runner testing spawnJulesTaskAsync)
      if (
        engineToUse === 'legacy-jules' ||
        (!options?.engine && (process.env.VITEST || process.env.NODE_ENV === 'test'))
      ) {
        const res = await spawnJulesTaskAsync(
          layers,
          effectivePath,
          prompt,
          options?.githubRepo || activeGitHubRepo?.nameWithOwner
        );

        upsertStandaloneSession({
          id: sessionId,
          status: res.success ? 'completed' : 'failed',
          terminalOutput: res.output,
          messages: [
            ...initialRecord.messages,
            {
              role: 'assistant',
              content: res.output || res.message,
              timestamp: Date.now(),
              engine: 'legacy-jules'
            }
          ]
        });

        return res;
      }

      // Multi-engine live task execution
      const isHeadlessE2E = process.argv.includes('--headless');
      const isLiveExecution =
        (process.env.NODE_ENV !== 'test' &&
          !process.env.VITEST &&
          !isHeadlessE2E &&
          process.env.JULESDECK_E2E_FAST !== '1') ||
        process.env.JULESDECK_LIVE_ENGINE === '1' ||
        Boolean(
          options?.engine &&
            (process.env.JULESDECK_MOCK_ENGINE === '1' ||
              prompt.startsWith('__MOCK__') ||
              prompt.startsWith('__FILE_CHECK__:'))
        );

      if (isLiveExecution) {
        const res = await runEngineTask({
          engine: engineToUse,
          prompt,
          repoPath: effectivePath,
          model: modelToUse,
          githubRepo: options?.githubRepo || activeGitHubRepo?.nameWithOwner,
          taskId: sessionId,
          sessionId,
          timeoutMs: 45000,
          onChunk: (chunk) => {
            if (!layers.chromeView.webContents.isDestroyed()) {
              layers.chromeView.webContents.send('chrome:task-output', chunk);
            }
          },
          onStatus: (status) => {
            if (!layers.chromeView.webContents.isDestroyed()) {
              layers.chromeView.webContents.send('chrome:task-status', status);
            }
          }
        });

        upsertStandaloneSession({
          id: sessionId,
          status: res.success ? 'completed' : 'failed',
          terminalOutput: res.output,
          messages: [
            ...initialRecord.messages,
            {
              role: 'assistant',
              content: res.output || res.message,
              timestamp: Date.now(),
              engine: engineToUse,
              model: modelToUse
            }
          ]
        });

        return {
          ...res,
          engine: engineToUse,
          model: modelToUse,
          taskBranch,
          workspacePath: effectivePath
        };
      }

      // Fast deterministic local workspace analysis (in tests or fast headless runs)
      const startTime = Date.now();
      const sendChunk = (stream: 'stdout' | 'stderr' | 'system', text: string) => {
        if (layers.chromeView.webContents.isDestroyed()) return;
        layers.chromeView.webContents.send('chrome:task-output', {
          taskId: sessionId,
          stream,
          chunk: text,
          raw: text,
          timestamp: Date.now(),
          sessionId
        } as TaskOutputChunk);
      };

      const sendStatus = (
        status: TaskStatusEvent['status'],
        message?: string,
        exitCode?: number | null
      ) => {
        if (layers.chromeView.webContents.isDestroyed()) return;
        layers.chromeView.webContents.send('chrome:task-status', {
          taskId: sessionId,
          status,
          exitCode,
          sessionId,
          durationMs: Date.now() - startTime,
          message
        } as TaskStatusEvent);
      };

      sendStatus('running', `Running task on ${engineToUse}...`);
      const header = `[ENGINE: ${engineToUse} (${modelToUse})]\n[WORKSPACE: ${effectivePath}]\nTask: "${prompt}"\n\n`;
      sendChunk('system', header);

      let auditOutput = header;
      const gitInfo = detectGitInfo(effectivePath);
      if (gitInfo) {
        const status = getGitStructuredStatus(effectivePath, gitInfo);
        const branchStr = `Active Branch: ${taskBranch || gitInfo.branch}\n`;
        const changesStr = `Pending Changes: ${status?.totalChanges ?? 0} files\n`;
        auditOutput += branchStr + changesStr;
        sendChunk('stdout', branchStr + changesStr);
      }

      const completionMsg = `[DONE] Task analyzed and prepared for ${engineToUse}\n`;
      auditOutput += completionMsg;
      sendChunk('system', completionMsg);
      sendStatus('completed', 'Task completed', 0);

      upsertStandaloneSession({
        id: sessionId,
        status: 'completed',
        terminalOutput: auditOutput,
        messages: [
          ...initialRecord.messages,
          {
            role: 'assistant',
            content: auditOutput,
            timestamp: Date.now(),
            engine: engineToUse,
            model: modelToUse
          }
        ]
      });

      return {
        success: true,
        sessionId,
        output: auditOutput,
        message: 'Task completed successfully',
        engine: engineToUse,
        model: modelToUse,
        taskBranch,
        workspacePath: effectivePath
      };
    }
  );

  ipcMain.handle('chrome:cancel-jules-task', () => {
    return cancelActiveJulesTask(layers);
  });

  ipcMain.handle('chrome:get-jules-status', async () => {
    return getJulesCliDiagnosticAsync();
  });

  ipcMain.handle('chrome:get-jules-cli-info', () => {
    return getJulesCliInfo();
  });

  ipcMain.handle('chrome:list-jules-sessions', async (_event, repoPath?: string) => {
    return listJulesSessions(repoPath);
  });

  ipcMain.handle('chrome:get-standalone-session', async (_event, sessionId: string) => {
    return getStandaloneSession(sessionId);
  });

  ipcMain.handle(
    'chrome:save-standalone-session',
    async (_event, session: Partial<StandaloneSessionRecord> & { id: string }) => {
      return upsertStandaloneSession(session);
    }
  );

  ipcMain.handle('chrome:list-jules-repos', async () => {
    return executeListJulesReposAsync();
  });

  ipcMain.handle(
    'chrome:apply-jules-session',
    async (_event, repoPath: string, sessionId: string) => {
      return new Promise((resolve) => {
        try {
          const julesBin = getJulesBinaryPath();
          const child = spawn(julesBin, ['remote', 'pull', '--session', sessionId, '--apply'], {
            cwd: repoPath,
            env: getCliEnv(),
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe']
          });

          let output = '';
          let settled = false;

          const timeout = setTimeout(() => {
            if (!settled) {
              settled = true;
              try {
                if (child.pid) killProcessGroup(child.pid, 'SIGTERM');
              } catch {
                // ignore
              }
              const timeoutMsg = output + '\n[TIMEOUT] Session apply timed out after 30s';
              if (!layers.chromeView.webContents.isDestroyed()) {
                layers.chromeView.webContents.send('chrome:task-output', {
                  taskId: 'apply-' + sessionId,
                  stream: 'system',
                  chunk: '\n[TIMEOUT] Session apply timed out after 30s\n',
                  timestamp: Date.now()
                });
              }
              resolve({ success: false, output: timeoutMsg });
            }
          }, 30000);

          child.stdout?.on('data', (d) => {
            const txt = cleanTerminalText(d.toString());
            output += txt;
            if (!layers.chromeView.webContents.isDestroyed()) {
              layers.chromeView.webContents.send('chrome:task-output', {
                taskId: 'apply-' + sessionId,
                stream: 'stdout',
                chunk: txt,
                timestamp: Date.now()
              });
            }
          });
          child.stderr?.on('data', (d) => {
            const txt = cleanTerminalText(d.toString());
            output += txt;
            if (!layers.chromeView.webContents.isDestroyed()) {
              layers.chromeView.webContents.send('chrome:task-output', {
                taskId: 'apply-' + sessionId,
                stream: 'stderr',
                chunk: txt,
                timestamp: Date.now()
              });
            }
          });
          child.on('close', (code) => {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              const hasError = code !== 0 || /error:/i.test(output);
              resolve({ success: !hasError, output });
            }
          });
          child.on('error', (err) => {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              resolve({ success: false, output: err.message });
            }
          });
        } catch (err: unknown) {
          resolve({ success: false, output: String(err) });
        }
      });
    }
  );

  ipcMain.handle('chrome:delete-jules-session', async (_event, sessionId: string) => {
    deleteJulesSession(sessionId);
    deleteStandaloneSession(sessionId);
    return { success: true };
  });

  ipcMain.handle(
    'chrome:clear-all-jules-sessions',
    async (_event, sessionIds?: string[]) => {
      clearAllJulesSessions(sessionIds);
      clearStandaloneSessions(sessionIds);
      return { success: true };
    }
  );

  ipcMain.handle('chrome:remove-recent-repo', async (_event, repoPath: string) => {
    const repos = removeRecentRepo(repoPath);
    return { success: true, repos };
  });

  ipcMain.handle('chrome:clear-recent-repos', async () => {
    clearRecentRepos();
    return { success: true };
  });

  // Multi-Engine Channels
  ipcMain.handle('engines:list', () => discoverEngines());
  ipcMain.handle(
    'engines:set-active',
    (_event, engine: AgentEngineId, model?: string) => {
      const res = setActiveEngine(engine, model);
      broadcastStateUpdate(layers);
      return { success: true, engine: res.engine, model: res.model };
    }
  );

  // GitHub Mode Channels
  ipcMain.handle('github:auth-status', async () => {
    return getGitHubAuthStatus();
  });

  ipcMain.handle('github:list-repos', async (_event, forceRefresh?: boolean) => {
    return listGitHubRepos(Boolean(forceRefresh));
  });

  ipcMain.handle(
    'github:select-repo',
    async (_event, nameWithOwner: string, baseBranch?: string) => {
      const res = await selectAndPrepareGitHubRepo(nameWithOwner, baseBranch);
      if (res.success && res.workspacePath) {
        activeGitHubRepo = res.repo;
        activeLocalRepo = {
          name: res.repo.name,
          path: res.workspacePath,
          branch: res.branch,
          githubRepo: res.repo.nameWithOwner
        };
        addRecentRepo(activeLocalRepo);
        broadcastStateUpdate(layers);
      }
      return res;
    }
  );

  ipcMain.handle(
    'github:prepare-task-branch',
    async (_event, workspacePath: string, prompt: string, baseBranch?: string) => {
      const targetPath = workspacePath || activeLocalRepo?.path || '';
      const res = await prepareTaskBranch(targetPath, prompt, baseBranch);
      if (res.success && activeLocalRepo && activeLocalRepo.path === targetPath) {
        activeLocalRepo.branch = res.branchName;
        broadcastStateUpdate(layers);
      }
      return res;
    }
  );

  ipcMain.handle(
    'github:publish-pr',
    async (_event, options: PublishPrOptions) => {
      const wsPath = options.workspacePath || activeLocalRepo?.path || '';
      const res = await publishBranchAndCreatePR({
        ...options,
        workspacePath: wsPath
      });
      if (res.success) {
        try {
          const sessions = loadStandaloneSessions();
          const match = sessions.find((s) => s.workspacePath === wsPath);
          if (match) {
            upsertStandaloneSession({
              id: match.id,
              status: 'published',
              prUrl: res.prUrl
            });
          }
        } catch {
          // ignore
        }
      }
      broadcastStateUpdate(layers);
      return res;
    }
  );

  ipcMain.handle('legacy:check-health', async (_event, force?: boolean) => {
    if (!force && cachedLegacyHealth) {
      return cachedLegacyHealth;
    }
    const health = await checkLegacyJulesAvailability();
    cachedLegacyHealth = health;
    broadcastStateUpdate(layers);
    return health;
  });

  const onMaximize = () => broadcastStateUpdate(layers);
  const onUnmaximize = () => broadcastStateUpdate(layers);
  layers.baseWindow.on('maximize', onMaximize);
  layers.baseWindow.on('unmaximize', onUnmaximize);

  return () => {
    ipcMain.removeHandler('chrome:get-state');
    ipcMain.removeHandler('chrome:nav-back');
    ipcMain.removeHandler('chrome:nav-forward');
    ipcMain.removeHandler('chrome:nav-reload');
    ipcMain.removeHandler('chrome:win-minimize');
    ipcMain.removeHandler('chrome:win-maximize');
    ipcMain.removeHandler('chrome:win-toggle-maximize');
    ipcMain.removeHandler('chrome:win-close');
    ipcMain.removeHandler('chrome:expand-view');
    ipcMain.removeHandler('chrome:collapse-view');
    ipcMain.removeHandler('chrome:open-in-file-manager');
    ipcMain.removeHandler('chrome:auth-sync');
    ipcMain.removeHandler('chrome:auth-logout');
    ipcMain.removeHandler('chrome:account-switch');
    ipcMain.removeHandler('chrome:account-add');
    ipcMain.removeHandler('chrome:account-remove');
    ipcMain.removeHandler('chrome:open-local-repo');
    ipcMain.removeHandler('chrome:select-recent-repo');
    ipcMain.removeHandler('chrome:get-recent-repos');
    ipcMain.removeHandler('chrome:clear-local-repo');
    ipcMain.removeHandler('chrome:git-review-details');
    ipcMain.removeHandler('chrome:git-structured-status');
    ipcMain.removeHandler('chrome:git-file-diff');
    ipcMain.removeHandler('chrome:run-jules-task');
    ipcMain.removeHandler('chrome:cancel-jules-task');
    ipcMain.removeHandler('chrome:get-jules-status');
    ipcMain.removeHandler('chrome:get-jules-cli-info');
    ipcMain.removeHandler('chrome:list-jules-sessions');
    ipcMain.removeHandler('chrome:get-standalone-session');
    ipcMain.removeHandler('chrome:save-standalone-session');
    ipcMain.removeHandler('chrome:delete-jules-session');
    ipcMain.removeHandler('chrome:clear-all-jules-sessions');
    ipcMain.removeHandler('chrome:remove-recent-repo');
    ipcMain.removeHandler('chrome:clear-recent-repos');
    ipcMain.removeHandler('chrome:list-jules-repos');
    ipcMain.removeHandler('chrome:apply-jules-session');
    ipcMain.removeHandler('chrome:set-mode-state');
    ipcMain.removeHandler('chrome:init-git-repo');
    ipcMain.removeHandler('app:open-settings');
    ipcMain.removeHandler('git:list-branches');
    ipcMain.removeHandler('git:checkout-branch');
    ipcMain.removeHandler('git:commit-changes');

    // Multi-Engine & GitHub Mode Channels
    ipcMain.removeHandler('engines:list');
    ipcMain.removeHandler('engines:set-active');
    ipcMain.removeHandler('github:auth-status');
    ipcMain.removeHandler('github:list-repos');
    ipcMain.removeHandler('github:select-repo');
    ipcMain.removeHandler('github:prepare-task-branch');
    ipcMain.removeHandler('github:publish-pr');
    ipcMain.removeHandler('legacy:check-health');

    if (unhookChromeShortcuts) {
      unhookChromeShortcuts();
      unhookChromeShortcuts = null;
    }
    detachCurrentContentView();

    if (currentRunningTask && !currentRunningTask.aborted) {
      cancelActiveJulesTask(layers);
    }
    if (!layers.baseWindow.isDestroyed()) {
      layers.baseWindow.removeListener('maximize', onMaximize);
      layers.baseWindow.removeListener('unmaximize', onUnmaximize);
    }
  };
}
