import { afterAll, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BaseWindow, WebContentsView } from 'electron';
import {
  parseGitHubRepoFromUrl,
  detectGitInfo,
  getNavigationState,
  parseJulesSessionsOutput,
  parseJulesReposOutput,
  getJulesBinaryPath,
  stripAnsi,
  getJulesCliInfo,
  executeListJulesRepos,
  parseGitStatusPorcelain,
  getGitStructuredStatus,
  getGitFileDiff,
  getAppMode,
  setAppMode,
  unquoteGitPath,
  loadRecentRepos,
  saveRecentRepos,
  selectRecentRepoByPath,
  removeRecentRepo,
  clearRecentRepos,
  loadDeletedSessionIds,
  saveDeletedSessionIds,
  deleteJulesSession,
  clearAllJulesSessions
} from '../src/main/ipc.js';
import type { AppWindowLayers } from '../src/main/window.js';

// Headless persistence falls back to cwd; keep parallel test files separate.
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jules-ipc-storage-'));
const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(storageDir);
afterAll(() => {
  cwdSpy.mockRestore();
  fs.rmSync(storageDir, { recursive: true, force: true });
});

describe('Local Git Repository Detection', () => {
  it('parses owner/repo from HTTPS GitHub remote URLs', () => {
    expect(parseGitHubRepoFromUrl('https://github.com/OSINTCabal/VibeDeck.git')).toBe('OSINTCabal/VibeDeck');
    expect(parseGitHubRepoFromUrl('https://github.com/google/jules')).toBe('google/jules');
  });

  it('parses owner/repo from SSH GitHub remote URLs', () => {
    expect(parseGitHubRepoFromUrl('git@github.com:OSINTCabal/VibeDeck.git')).toBe('OSINTCabal/VibeDeck');
  });

  it('returns undefined for non-GitHub URLs or empty inputs', () => {
    expect(parseGitHubRepoFromUrl('')).toBeUndefined();
    expect(parseGitHubRepoFromUrl('https://gitlab.com/group/project.git')).toBeUndefined();
  });

  it('safely handles non-git directories without throwing', () => {
    const info = detectGitInfo('/tmp');
    if (info) {
      expect(info.name).toBe('tmp');
    } else {
      expect(info).toBeNull();
    }
  });

  it('extracts branch and commit info from a valid git directory', () => {
    const info = detectGitInfo(process.cwd());
    // Current folder is jules-desktop, parent directory might be in a repo or not
    if (info) {
      expect(info.branch).toBeDefined();
      expect(typeof info.branch).toBe('string');
    }
  });
});

describe('Navigation & Window State Extraction', () => {
  it('correctly constructs navigation state from layers and webContents', () => {
    const mockContentWebContents = {
      navigationHistory: {
        canGoBack: () => true,
        canGoForward: () => false
      },
      isLoading: () => false,
      getURL: () => 'https://jules.google.com/session',
      getTitle: () => 'Jules — Tasks'
    };

    const mockLayers: AppWindowLayers = {
      baseWindow: {
        isMaximized: () => true
      } as unknown as BaseWindow,
      chromeView: {
        webContents: { isDestroyed: () => false, send: vi.fn() }
      } as unknown as WebContentsView,
      contentView: {
        webContents: mockContentWebContents
      } as unknown as WebContentsView
    };

    const state = getNavigationState(mockLayers);
    expect(state.canGoBack).toBe(true);
    expect(state.canGoForward).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.currentUrl).toBe('https://jules.google.com/session');
    expect(state.title).toBe('Jules — Tasks');
    expect(state.accountName).toBe('OSINTCabal');
    expect(state.isMaximized).toBe(true);
  });

  it('detects google sign-in URL in navigation state', () => {
    const mockContentWebContents = {
      navigationHistory: null,
      canGoBack: () => false,
      canGoForward: () => false,
      isLoading: () => true,
      getURL: () => 'https://accounts.google.com/signin/v2/identifier',
      getTitle: () => 'Sign in - Google Accounts'
    };

    const mockLayers: AppWindowLayers = {
      baseWindow: {
        isMaximized: () => false
      } as unknown as BaseWindow,
      chromeView: {} as unknown as WebContentsView,
      contentView: {
        webContents: mockContentWebContents
      } as unknown as WebContentsView
    };

    const state = getNavigationState(mockLayers);
    expect(state.accountName).toBe('Sign In to Google');
    expect(state.isLoading).toBe(true);
    expect(state.isMaximized).toBe(false);
  });
});

describe('Jules CLI Integration & Output Parsing', () => {
  it('parses tabular session output into structured objects', () => {
    const raw = `      ID                 Description                 Repo      Last active     Status    
 98615155049…  Review this repo and make sure …  OSINTCabal/…  2 days ago       
 12345678901   Write full unit test coverage     torvalds/linux 1 hour ago      DONE`;

    const parsed = parseJulesSessionsOutput(raw);
    expect(parsed.length).toBe(2);
    expect(parsed[0]?.id).toBe('98615155049…');
    expect(parsed[0]?.description).toContain('Review this repo');
    expect(parsed[0]?.lastActive).toBe('2 days ago');

    expect(parsed[1]?.id).toBe('12345678901');
    expect(parsed[1]?.status).toBe('DONE');
  });

  it('handles empty or header-only output gracefully', () => {
    expect(parseJulesSessionsOutput('')).toEqual([]);
    expect(parseJulesSessionsOutput('   ID    Description   Repo   ')).toEqual([]);
  });

  it('locates or falls back to jules binary path', () => {
    const binPath = getJulesBinaryPath();
    expect(typeof binPath).toBe('string');
    expect(binPath.length).toBeGreaterThan(0);
  });

  it('strips ANSI formatting from CLI output strings', () => {
    expect(stripAnsi('\u001b[32mSUCCESS\u001b[39m')).toBe('SUCCESS');
    expect(stripAnsi('\u001b[1;4;31mCRITICAL\u001b[0m')).toBe('CRITICAL');
  });

  it('parses jules remote list --repo output cleanly', () => {
    const stdout = `
OSINTCabal/VibeDeck
OSINTCabal/JulesDeck
`;
    expect(parseJulesReposOutput(stdout)).toEqual(['OSINTCabal/VibeDeck', 'OSINTCabal/JulesDeck']);
  });

  it('retrieves Jules CLI info or reports unavailable status gracefully', () => {
    const info = getJulesCliInfo();
    expect(info).toBeDefined();
    expect(typeof info.available).toBe('boolean');
  });

  it('executes list repos query without unhandled exceptions', () => {
    const repos = executeListJulesRepos();
    expect(Array.isArray(repos)).toBe(true);
  }, 35000);
});

describe('Structured Git Status & Diff Inspection Engine', () => {
  it('parses porcelain status into categorized staged, unstaged, untracked, and conflicts', () => {
    const porcelain = `M  src/staged.ts
 M src/unstaged.ts
MM src/both.ts
?? tests/newfile.test.ts
UU merge/conflict.ts
R  old-name.ts -> new-name.ts`;

    const res = parseGitStatusPorcelain(porcelain, 'feature/test', 'OSINTCabal/JulesDeck');
    expect(res.branch).toBe('feature/test');
    expect(res.githubRepo).toBe('OSINTCabal/JulesDeck');
    expect(res.isDetached).toBe(false);

    // Staged: M  src/staged.ts, MM src/both.ts, R  old -> new
    expect(res.staged.length).toBe(3);
    expect(res.staged.some((f) => f.path === 'src/staged.ts' && f.status === 'staged')).toBe(true);
    expect(res.staged.some((f) => f.path === 'new-name.ts' && f.status === 'staged')).toBe(true);

    // Unstaged:  M src/unstaged.ts, MM src/both.ts
    expect(res.unstaged.length).toBe(2);
    expect(res.unstaged.some((f) => f.path === 'src/unstaged.ts' && f.status === 'modified')).toBe(true);
    expect(res.unstaged.some((f) => f.path === 'src/both.ts')).toBe(true);

    // Untracked: ?? tests/newfile.test.ts
    expect(res.untracked.length).toBe(1);
    expect(res.untracked[0]?.path).toBe('tests/newfile.test.ts');
    expect(res.untracked[0]?.status).toBe('untracked');

    // Conflicts: UU merge/conflict.ts
    expect(res.conflicts.length).toBe(1);
    expect(res.conflicts[0]?.path).toBe('merge/conflict.ts');
    expect(res.conflicts[0]?.status).toBe('conflict');

    expect(res.totalChanges).toBe(7);
  });

  it('handles empty porcelain status indicating clean working tree', () => {
    const res = parseGitStatusPorcelain('', 'main');
    expect(res.staged).toEqual([]);
    expect(res.unstaged).toEqual([]);
    expect(res.untracked).toEqual([]);
    expect(res.conflicts).toEqual([]);
    expect(res.totalChanges).toBe(0);
    expect(res.isDetached).toBe(false);
  });

  it('detects detached HEAD state from branch name', () => {
    const res = parseGitStatusPorcelain('', 'HEAD (detached at 80cd54c)');
    expect(res.isDetached).toBe(true);
  });

  it('returns structured git status or null for non-git folder', () => {
    const nonGit = getGitStructuredStatus('/tmp');
    if (nonGit) {
      expect(typeof nonGit.totalChanges).toBe('number');
    } else {
      expect(nonGit).toBeNull();
    }
  });

  it('generates file diff safely without unhandled crashes', () => {
    const diff = getGitFileDiff(process.cwd(), 'package.json', false);
    expect(diff.filePath).toBe('package.json');
    expect(typeof diff.diff).toBe('string');
    expect(diff.isStaged).toBe(false);
  });

  it('accurately identifies unborn branch in newly initialized empty git repo', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require('node:os') as typeof import('node:os');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execSync } = require('node:child_process') as typeof import('node:child_process');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jules-ipc-unborn-'));
    try {
      execSync('git init -b feature/ipc-unborn-test', { cwd: tempDir });
      const info = detectGitInfo(tempDir);
      expect(info).not.toBeNull();
      expect(info?.branch).toBe('feature/ipc-unborn-test');
      expect(info?.lastCommit).toBeUndefined();

      const status = getGitStructuredStatus(tempDir);
      expect(status?.totalChanges).toBe(0);
      expect(status?.isDetached).toBe(false);

      // Create an untracked file
      fs.writeFileSync(path.join(tempDir, 'demo.ts'), 'export const x = 1;');
      const statusAfterAdd = getGitStructuredStatus(tempDir);
      expect(statusAfterAdd?.totalChanges).toBe(1);
      expect(statusAfterAdd?.untracked[0]?.path).toBe('demo.ts');

      // Generate diff on untracked file in unborn repo
      const diff = getGitFileDiff(tempDir, 'demo.ts', false);
      expect(diff.filePath).toBe('demo.ts');
      expect(diff.diff).toContain('+export const x = 1;');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('manages app mode state transitions between cloud and local', () => {
    setAppMode('cloud');
    expect(getAppMode()).toBe('cloud');
    setAppMode('local');
    expect(getAppMode()).toBe('local');
    setAppMode('cloud');
    expect(getAppMode()).toBe('cloud');
  });

  it('unquotes C-style, spaces, and escaped characters in git paths', () => {
    expect(unquoteGitPath('plain-file.ts')).toBe('plain-file.ts');
    expect(unquoteGitPath('"path with spaces.txt"')).toBe('path with spaces.txt');
    expect(unquoteGitPath('"file\\"with\\"quotes.txt"')).toBe('file"with"quotes.txt');
    expect(unquoteGitPath('"path\\with\\slashes.txt"')).toBe('path\\with\\slashes.txt');
  });

  it('filters non-existent paths from recent repositories', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require('node:os') as typeof import('node:os');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jules-recent-test-'));
    try {
      const existingFolder = path.join(tempDir, 'existing-repo');
      fs.mkdirSync(existingFolder);
      const ghostFolder = path.join(tempDir, 'ghost-repo-that-was-deleted');

      saveRecentRepos([
        { name: 'existing-repo', path: existingFolder, lastAccessedAt: Date.now() },
        { name: 'ghost-repo', path: ghostFolder, lastAccessedAt: Date.now() - 1000 }
      ]);

      const loaded = loadRecentRepos();
      expect(loaded.some((r) => r.path === existingFolder)).toBe(true);
      expect(loaded.some((r) => r.path === ghostFolder)).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('purges non-existent repository from storage when selected', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require('node:os') as typeof import('node:os');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jules-purge-test-'));
    try {
      const ghostFolder = path.join(tempDir, 'ghost-repo-purged');
      saveRecentRepos([
        { name: 'ghost-repo', path: ghostFolder, lastAccessedAt: Date.now() }
      ]);

      const mockLayers = {
        baseWindow: { isDestroyed: () => false, isMaximized: () => false } as unknown as BaseWindow,
        chromeView: { webContents: { isDestroyed: () => true, send: vi.fn() } } as unknown as WebContentsView,
        contentView: { webContents: { isDestroyed: () => true, getURL: () => '', getTitle: () => '', isLoading: () => false, canGoBack: () => false, canGoForward: () => false } } as unknown as WebContentsView
      } as AppWindowLayers;

      const res = selectRecentRepoByPath(mockLayers, ghostFolder);
      expect(res.success).toBe(false);
      expect(res.message).toBe('Directory does not exist');

      const loadedAfter = loadRecentRepos();
      expect(loadedAfter.some((r) => r.path === ghostFolder)).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('removes and clears recent repositories on demand', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require('node:os') as typeof import('node:os');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jules-rem-test-'));
    try {
      const folderA = path.join(tempDir, 'repo-a');
      const folderB = path.join(tempDir, 'repo-b');
      fs.mkdirSync(folderA);
      fs.mkdirSync(folderB);

      saveRecentRepos([
        { name: 'repo-a', path: folderA, lastAccessedAt: Date.now() },
        { name: 'repo-b', path: folderB, lastAccessedAt: Date.now() }
      ]);
      const afterRemove = removeRecentRepo(folderA);
      expect(afterRemove.some((r) => r.path === folderA)).toBe(false);
      expect(afterRemove.some((r) => r.path === folderB)).toBe(true);

      clearRecentRepos();
      expect(loadRecentRepos()).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('manages deleted session IDs with persistence and deduplication', () => {
    saveDeletedSessionIds(['sess-100', 'sess-200']);
    expect(loadDeletedSessionIds()).toContain('sess-100');
    expect(loadDeletedSessionIds()).toContain('sess-200');

    deleteJulesSession('sess-300');
    const updated = loadDeletedSessionIds();
    expect(updated).toContain('sess-300');
    expect(new Set(updated).size).toBe(updated.length);

    clearAllJulesSessions(['sess-400', 'sess-500']);
    const all = loadDeletedSessionIds();
    expect(all).toContain('sess-400');
    expect(all).toContain('sess-500');
  });
});
