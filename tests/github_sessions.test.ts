/**
 * Unit and Integration Tests for Standalone GitHub Mode & Session Management.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  normalizeGitHubRepo,
  getManagedWorkspacesRoot,
  getManagedRepoPath,
  generateTaskBranchName,
  prepareTaskBranch,
  publishBranchAndCreatePR,
  selectAndPrepareGitHubRepo,
  getGitHubAuthStatus,
  listGitHubRepos,
  checkLegacyJulesAvailability,
  clearGitHubReposCache
} from '../src/main/github.js';
import {
  getStandaloneSessionsFilePath,
  loadStandaloneSessions,
  getStandaloneSession,
  upsertStandaloneSession,
  deleteStandaloneSession,
  clearStandaloneSessions,
  formatRelativeTime,
  toJulesSessionItems,
  isValidStandaloneSessionRecord,
  StandaloneSessionRecord
} from '../src/main/sessions.js';

describe('GitHub Mode & Normalization', () => {
  it('normalizes full HTTPS GitHub URLs with or without .git', () => {
    expect(normalizeGitHubRepo('https://github.com/OSINTCabal/JulesDeck.git')).toBe(
      'OSINTCabal/JulesDeck'
    );
    expect(normalizeGitHubRepo('https://github.com/OSINTCabal/JulesDeck')).toBe(
      'OSINTCabal/JulesDeck'
    );
    expect(normalizeGitHubRepo('http://github.com/OSINTCabal/JulesDeck.git')).toBe(
      'OSINTCabal/JulesDeck'
    );
  });

  it('normalizes SSH and protocol GitHub URLs', () => {
    expect(normalizeGitHubRepo('git@github.com:OSINTCabal/JulesDeck.git')).toBe(
      'OSINTCabal/JulesDeck'
    );
    expect(normalizeGitHubRepo('ssh://git@github.com/OSINTCabal/JulesDeck.git')).toBe(
      'OSINTCabal/JulesDeck'
    );
  });

  it('normalizes plain owner/repo strings and trims whitespace', () => {
    expect(normalizeGitHubRepo('  OSINTCabal/JulesDeck  ')).toBe('OSINTCabal/JulesDeck');
    expect(normalizeGitHubRepo('OSINTCabal/JulesDeck.git')).toBe('OSINTCabal/JulesDeck');
  });

  it('computes managed workspace root with environment override', () => {
    const customDir = '/tmp/custom-workspaces-override';
    const oldEnv = process.env.JULESDECK_WORKSPACES_DIR;
    try {
      process.env.JULESDECK_WORKSPACES_DIR = customDir;
      expect(getManagedWorkspacesRoot()).toBe(customDir);
    } finally {
      process.env.JULESDECK_WORKSPACES_DIR = oldEnv;
    }
  });

  it('converts owner/repo and URLs into sanitized managed paths', () => {
    const customRoot = '/tmp/workspaces';
    expect(getManagedRepoPath('OSINTCabal/JulesDeck', customRoot)).toBe(
      path.join(customRoot, 'OSINTCabal__JulesDeck')
    );
    expect(
      getManagedRepoPath('https://github.com/OSINTCabal/JulesDeck.git', customRoot)
    ).toBe(path.join(customRoot, 'OSINTCabal__JulesDeck'));
  });

  it('generates clean task branch names from prompts with length limit and hex suffix', () => {
    const branch1 = generateTaskBranchName('Fix authentication bug in login modal');
    expect(branch1).toMatch(/^jules\/fix-authentication-bug-in-login-[0-9a-f]{4}$/);

    const branch2 = generateTaskBranchName('!!! $$$ ---');
    expect(branch2).toMatch(/^jules\/task-[0-9a-f]{4}$/);
  });
});

describe('Standalone Sessions Store Engine', () => {
  let tempDir: string;
  let testSessionsPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jules-sessions-test-'));
    testSessionsPath = path.join(tempDir, 'standalone-sessions.json');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('returns empty array when file does not exist', () => {
    const sessions = loadStandaloneSessions(testSessionsPath);
    expect(sessions).toEqual([]);
    expect(fs.existsSync(testSessionsPath)).toBe(false);
  });

  it('upserts a new session record with sensible defaults', () => {
    const created = upsertStandaloneSession(
      {
        id: 'sess-1001',
        title: 'Refactor Auth Provider',
        prompt: 'Refactor Auth Provider',
        workspacePath: '/path/to/project'
      },
      testSessionsPath
    );

    expect(created.id).toBe('sess-1001');
    expect(created.mode).toBe('repo');
    expect(created.engine).toBe('gemini-cli');
    expect(created.status).toBe('planning');
    expect(Array.isArray(created.planSteps)).toBe(true);
    expect(Array.isArray(created.messages)).toBe(true);
    expect(typeof created.createdAt).toBe('number');
    expect(typeof created.updatedAt).toBe('number');

    const loaded = getStandaloneSession('sess-1001', testSessionsPath);
    expect(loaded).not.toBeNull();
    expect(loaded?.title).toBe('Refactor Auth Provider');
  });

  it('updates an existing session without losing existing properties', () => {
    upsertStandaloneSession(
      {
        id: 'sess-2001',
        title: 'Original Title',
        prompt: 'Do something',
        engine: 'codex',
        workspacePath: '/path/to/project'
      },
      testSessionsPath
    );

    const updated = upsertStandaloneSession(
      {
        id: 'sess-2001',
        status: 'completed',
        prUrl: 'https://github.com/owner/repo/pull/42'
      },
      testSessionsPath
    );

    expect(updated.status).toBe('completed');
    expect(updated.prUrl).toBe('https://github.com/owner/repo/pull/42');
    expect(updated.title).toBe('Original Title');
    expect(updated.engine).toBe('codex');

    const fetched = getStandaloneSession('sess-2001', testSessionsPath);
    expect(fetched?.status).toBe('completed');
    expect(fetched?.prUrl).toBe('https://github.com/owner/repo/pull/42');
  });

  it('deletes an existing session record and returns true', () => {
    upsertStandaloneSession(
      { id: 'sess-del-1', title: 'To Delete', workspacePath: '/tmp' },
      testSessionsPath
    );
    upsertStandaloneSession(
      { id: 'sess-keep-1', title: 'To Keep', workspacePath: '/tmp' },
      testSessionsPath
    );

    expect(deleteStandaloneSession('sess-del-1', testSessionsPath)).toBe(true);
    expect(getStandaloneSession('sess-del-1', testSessionsPath)).toBeNull();
    expect(getStandaloneSession('sess-keep-1', testSessionsPath)).not.toBeNull();
    expect(deleteStandaloneSession('non-existent', testSessionsPath)).toBe(false);
  });

  it('selectively clears sessions by IDs', () => {
    upsertStandaloneSession({ id: 's1', title: '1', workspacePath: '/tmp' }, testSessionsPath);
    upsertStandaloneSession({ id: 's2', title: '2', workspacePath: '/tmp' }, testSessionsPath);
    upsertStandaloneSession({ id: 's3', title: '3', workspacePath: '/tmp' }, testSessionsPath);

    clearStandaloneSessions(['s1', 's2'], testSessionsPath);
    const remaining = loadStandaloneSessions(testSessionsPath);
    expect(remaining.map((s) => s.id)).toEqual(['s3']);
  });

  it('clears all sessions when sessionIds is omitted or empty', () => {
    upsertStandaloneSession({ id: 's1', title: '1', workspacePath: '/tmp' }, testSessionsPath);
    upsertStandaloneSession({ id: 's2', title: '2', workspacePath: '/tmp' }, testSessionsPath);

    clearStandaloneSessions(undefined, testSessionsPath);
    expect(loadStandaloneSessions(testSessionsPath)).toEqual([]);
  });

  it('backs up corrupted JSON and returns empty array gracefully', () => {
    fs.writeFileSync(testSessionsPath, '{"broken": [bad-json...', 'utf8');
    const result = loadStandaloneSessions(testSessionsPath);
    expect(result).toEqual([]);

    // Check backup was created
    const files = fs.readdirSync(tempDir);
    const backupFile = files.find((f) => f.startsWith('standalone-sessions.json.corrupt.'));
    expect(backupFile).toBeDefined();
  });

  it('validates schema format using isValidStandaloneSessionRecord', () => {
    expect(isValidStandaloneSessionRecord(null)).toBe(false);
    expect(isValidStandaloneSessionRecord({})).toBe(false);
    expect(
      isValidStandaloneSessionRecord({
        id: 's-valid',
        title: 'Title',
        prompt: 'Prompt',
        engine: 'gemini-cli',
        model: 'default',
        workspacePath: '/dir',
        status: 'running',
        planSteps: [],
        messages: [],
        createdAt: 1000,
        updatedAt: 2000
      })
    ).toBe(true);
  });

  it('resolves session file path priority correctly', () => {
    expect(getStandaloneSessionsFilePath('/custom/my-sessions.json')).toBe('/custom/my-sessions.json');
    const oldEnv = process.env.JULESDECK_SESSIONS_FILE;
    try {
      process.env.JULESDECK_SESSIONS_FILE = '/tmp/env-sessions.json';
      expect(getStandaloneSessionsFilePath()).toBe('/tmp/env-sessions.json');
    } finally {
      process.env.JULESDECK_SESSIONS_FILE = oldEnv;
    }
  });

  it('formats relative durations accurately', () => {
    const now = 1000000;
    expect(formatRelativeTime(now - 30 * 1000, now)).toBe('Just now');
    expect(formatRelativeTime(now - 5 * 60 * 1000, now)).toBe('5m ago');
    expect(formatRelativeTime(now - 3 * 3600 * 1000, now)).toBe('3h ago');
    expect(formatRelativeTime(now - 4 * 86400 * 1000, now)).toBe('4d ago');
    expect(formatRelativeTime(now - 15 * 86400 * 1000, now)).toBe('2w ago');
  });

  it('maps StandaloneSessionRecord[] to JulesSessionItem[] correctly', () => {
    const records: StandaloneSessionRecord[] = [
      {
        id: 'session-xyz',
        mode: 'repo',
        title: 'Add dark mode toggle',
        prompt: 'Add dark mode toggle',
        engine: 'gemini-cli',
        model: 'gemini-2.5-pro',
        githubRepo: 'OSINTCabal/JulesDeck',
        taskBranch: 'jules/dark-mode-4f2a',
        workspacePath: '/home/user/workspaces/OSINTCabal__JulesDeck',
        status: 'published',
        planSteps: [],
        messages: [],
        prUrl: 'https://github.com/OSINTCabal/JulesDeck/pull/12',
        createdAt: Date.now() - 60000,
        updatedAt: Date.now() - 60000
      }
    ];

    const items = toJulesSessionItems(records);
    expect(items.length).toBe(1);
    const item = items[0]!;
    expect(item.id).toBe('session-xyz');
    expect(item.description).toBe('Add dark mode toggle');
    expect(item.repo).toBe('OSINTCabal/JulesDeck');
    expect(item.lastActive).toBe('1m ago');
    expect(item.status).toBe('published');
    expect(item.mode).toBe('repo');
    expect(item.engine).toBe('gemini-cli');
    expect(item.model).toBe('gemini-2.5-pro');
    expect(item.branch).toBe('jules/dark-mode-4f2a');
    expect(item.prUrl).toBe('https://github.com/OSINTCabal/JulesDeck/pull/12');
    expect(item.workspacePath).toBe('/home/user/workspaces/OSINTCabal__JulesDeck');
  });
});

describe('End-to-End Git Task Branching & PR Publishing', () => {
  let testRootDir: string;
  let bareRemotePath: string;
  let workspacePath: string;

  beforeEach(() => {
    testRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jules-git-e2e-'));
    bareRemotePath = path.join(testRootDir, 'remote.git');
    workspacePath = path.join(testRootDir, 'OSINTCabal__workspace');

    // 1. Initialize bare remote repository
    execFileSync('git', ['init', '--bare', '-b', 'main', bareRemotePath], { stdio: 'pipe' });

    // 2. Initialize working repository and push initial commit to bare remote
    execFileSync('git', ['init', '-b', 'main', workspacePath], { stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@julesdeck.local'], { cwd: workspacePath, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'JulesDeck Tester'], { cwd: workspacePath, stdio: 'pipe' });
    execFileSync('git', ['remote', 'add', 'origin', bareRemotePath], { cwd: workspacePath, stdio: 'pipe' });

    fs.writeFileSync(path.join(workspacePath, 'README.md'), '# Initial Project\n');
    execFileSync('git', ['add', 'README.md'], { cwd: workspacePath, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: workspacePath, stdio: 'pipe' });
    execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd: workspacePath, stdio: 'pipe' });
  });

  afterEach(() => {
    try {
      fs.rmSync(testRootDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('creates and checks out an isolated jules/* task branch', async () => {
    const result = await prepareTaskBranch(workspacePath, 'Implement Session Store');
    expect(result.success).toBe(true);
    expect(result.branchName).toMatch(/^jules\/implement-session-store-[0-9a-f]{4}$/);

    const activeBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: workspacePath,
      encoding: 'utf8'
    }).trim();
    expect(activeBranch).toBe(result.branchName);
  });

  it('preserves existing jules/* task branch if uncommitted changes exist', async () => {
    const firstResult = await prepareTaskBranch(workspacePath, 'Initial task step');
    expect(firstResult.success).toBe(true);

    // Create an uncommitted change in the working directory
    fs.writeFileSync(path.join(workspacePath, 'dirty.txt'), 'in-progress work');

    // Attempting to prepare another branch should preserve the current task branch
    const secondResult = await prepareTaskBranch(workspacePath, 'Second task step');
    expect(secondResult.success).toBe(true);
    expect(secondResult.branchName).toBe(firstResult.branchName);
    expect(secondResult.message).toContain('Preserving active task branch');
  });

  it('publishes task branch, auto-commits changes, and pushes to remote', async () => {
    await prepareTaskBranch(workspacePath, 'Feature work');
    const branchBeforePublish = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: workspacePath,
      encoding: 'utf8'
    }).trim();

    // Create uncommitted file changes
    fs.writeFileSync(path.join(workspacePath, 'feature.ts'), 'export const feature = true;\n');

    // Publish (with createPr: false so we test the git commit and push layer reliably without gh network calls)
    const publishResult = await publishBranchAndCreatePR({
      workspacePath,
      title: 'feat: add feature module',
      createPr: false
    });

    expect(publishResult.success).toBe(true);
    expect(publishResult.pushed).toBe(true);
    expect(publishResult.branchName).toBe(branchBeforePublish);

    // Verify uncommitted changes were committed
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: workspacePath,
      encoding: 'utf8'
    }).trim();
    expect(status).toBe('');

    // Verify the branch was pushed to bare remote
    const remoteBranches = execFileSync(
      'git',
      ['branch', '--list'],
      { cwd: bareRemotePath, encoding: 'utf8' }
    );
    expect(remoteBranches).toContain(branchBeforePublish);
  });

  it('selects and prepares an already cloned repository without errors', async () => {
    const prepResult = await selectAndPrepareGitHubRepo('OSINTCabal/workspace', 'main', {
      workspacesRoot: testRootDir
    });

    expect(prepResult.success).toBe(true);
    expect(prepResult.workspacePath).toBe(workspacePath);
    expect(prepResult.branch).toBe('main');
    expect(prepResult.repo.isCloned).toBe(true);
    expect(prepResult.repo.nameWithOwner).toBe('OSINTCabal/workspace');
  });

  it('never pushes directly to main when publishing from main branch', async () => {
    // Ensure we are on main
    execFileSync('git', ['checkout', 'main'], { cwd: workspacePath });

    // Make an uncommitted change on main
    fs.writeFileSync(path.join(workspacePath, 'main_change.txt'), 'change on main');

    const result = await publishBranchAndCreatePR({
      workspacePath,
      title: 'feat: change on main',
      baseBranch: 'main',
      createPr: false
    });

    expect(result.success).toBe(true);
    expect(result.pushed).toBe(true);
    expect(result.branchName).not.toBe('main');
    expect(result.branchName).toMatch(/^jules\//);
  });
});

describe('Offline Discovery & Legacy Jules Health Probing', () => {
  let tempWorkspacesDir: string;
  let tempCacheDir: string;

  beforeEach(() => {
    tempWorkspacesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jules-ws-disc-'));
    tempCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jules-cache-disc-'));
    clearGitHubReposCache(tempCacheDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempWorkspacesDir, { recursive: true, force: true });
      fs.rmSync(tempCacheDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('discovers cloned local repositories from managed workspaces directory offline', async () => {
    const repoWorkspace = path.join(tempWorkspacesDir, 'OSINTCabal__OfflineRepo');
    execFileSync('git', ['init', '-b', 'main', repoWorkspace], { stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@julesdeck.local'], { cwd: repoWorkspace, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'JulesDeck Tester'], { cwd: repoWorkspace, stdio: 'pipe' });
    fs.writeFileSync(path.join(repoWorkspace, 'README.md'), '# Offline\n');
    execFileSync('git', ['add', 'README.md'], { cwd: repoWorkspace, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: repoWorkspace, stdio: 'pipe' });
    execFileSync(
      'git',
      ['remote', 'add', 'origin', 'https://github.com/OSINTCabal/OfflineRepo.git'],
      { cwd: repoWorkspace, stdio: 'pipe' }
    );

    const repos = await listGitHubRepos(true, {
      customRootDir: tempWorkspacesDir,
      customUserDataDir: tempCacheDir
    });

    const found = repos.find((r) => r.nameWithOwner === 'OSINTCabal/OfflineRepo');
    expect(found).toBeDefined();
    expect(found?.isCloned).toBe(true);
    expect(found?.managedPath).toBe(repoWorkspace);
  });

  it('reports offline when JULESDECK_FORCE_LEGACY_OFFLINE is set to 1', async () => {
    const oldEnv = process.env.JULESDECK_FORCE_LEGACY_OFFLINE;
    try {
      process.env.JULESDECK_FORCE_LEGACY_OFFLINE = '1';
      const health = await checkLegacyJulesAvailability();
      expect(health.online).toBe(false);
      expect(health.webReachable).toBe(false);
      expect(health.reason).toContain('forced offline by environment configuration');
    } finally {
      process.env.JULESDECK_FORCE_LEGACY_OFFLINE = oldEnv;
    }
  });

  it('returns valid auth status structure from getGitHubAuthStatus without throwing', async () => {
    const status = await getGitHubAuthStatus();
    expect(typeof status.authenticated).toBe('boolean');
    if (status.authenticated) {
      expect(typeof status.username).toBe('string');
      expect(status.username!.length).toBeGreaterThan(0);
    }
  });
});
