/**
 * End-to-End Usage & Automation Test Suite for JulesDeck.
 *
 * Simulates complete application lifecycle:
 * 1. Three-layer window initialization & layout bounds management.
 * 2. Full IPC bus lifecycle (registration, dispatch, event streaming, cleanup).
 * 3. Local git repository selection (JulesDeck), branch badges, and git commit history inspection.
 * 4. Non-git directory rejection, warning dialogs, and error recovery.
 * 5. Streaming task runner lifecycle (spawn -> stream chunks -> session auto-detection -> cancel -> cancelled status).
 * 6. Remote Jules sessions listing and patch application with real-time terminal output streaming.
 * 7. App menu toggle, multi-account lifecycle (create -> switch -> partition swap -> remove), and Chrome cookie sync IPC.
 * 8. Window geometry persistence, recovery from corrupt state, display bounds clamping, and restoration.
 * 9. Performance benchmarks and exit code verification.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { execSync } from 'node:child_process';
import type * as cpTypes from 'node:child_process';
import type { BaseWindow, WebContentsView } from 'electron';
import type {
  NavigationState,
  GitReviewDetails,
  GitFileDiff,
  GitStructuredStatus,
  JulesRunResult,
  JulesSessionItem,
  JulesCliStatus,
  RecentRepoItem,
  TaskOutputChunk,
  TaskStatusEvent,
  ChromeApi,
  AccountRecord
} from '../src/shared/types.js';

// --- Hoisted Mock State & Classes ---
const {
  harnessState,
  mockIpcMain,
  MockWebContentsView,
  MockBaseWindow
} = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require('node:events') as typeof import('node:events');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsSync = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pathSync = require('node:path') as typeof import('node:path');

  const defaultGitDir = fsSync.existsSync(pathSync.join(process.cwd(), '.git'))
    ? process.cwd()
    : (fsSync.existsSync(pathSync.resolve(process.cwd(), '../JulesDeck/.git'))
        ? pathSync.resolve(process.cwd(), '../JulesDeck')
        : process.cwd());

  const harnessState = {
    testUserDataDir: '/tmp/julesdeck-e2e-initial',
    targetGitDir: defaultGitDir,
    mockDialogSelectedDir: defaultGitDir,
    mockDialogCanceled: false,
    mockMessageBoxResponse: 0,
    lastMessageBoxOpts: null as unknown,
    mockSpawnHandler: null as ((cmd: string, args: string[], options: unknown) => unknown) | null
  };

  class MockWebContentsInner extends EventEmitter {
    _url = 'https://jules.google.com';
    _title = 'JulesDeck — AI Coding Agent';
    _isLoading = false;
    _destroyed = false;
    _sentEvents: Array<{ channel: string; args: unknown[] }> = [];

    session = {
      cookies: {
        set: vi.fn(async () => {}),
        get: vi.fn(async () => [])
      },
      webRequest: {
        onBeforeSendHeaders: vi.fn()
      },
      setUserAgent: vi.fn(),
      clearStorageData: vi.fn(async () => {}),
      clearCache: vi.fn(async () => {})
    };

    navigationHistory = {
      _canBack: false,
      _canForward: false,
      canGoBack: () => this.navigationHistory._canBack,
      canGoForward: () => this.navigationHistory._canForward,
      goBack: vi.fn(),
      goForward: vi.fn()
    };

    canGoBack() {
      return this.navigationHistory.canGoBack();
    }
    canGoForward() {
      return this.navigationHistory.canGoForward();
    }
    goBack() {
      this.navigationHistory.goBack();
    }
    goForward() {
      this.navigationHistory.goForward();
    }
    isLoading() {
      return this._isLoading;
    }
    getURL() {
      return this._url;
    }
    getTitle() {
      return this._title;
    }
    setUserAgent = vi.fn();
    loadFile = vi.fn();
    loadURL = vi.fn((url: string) => {
      this._url = url;
      this.emit('did-navigate', {}, url);
    });
    reload = vi.fn();
    reloadIgnoringCache = vi.fn();
    setZoomLevel = vi.fn();
    getZoomLevel = vi.fn(() => 0);
    toggleDevTools = vi.fn();
    setWindowOpenHandler = vi.fn();
    close() {
      this._destroyed = true;
    }
    isDestroyed() {
      return this._destroyed;
    }

    send(channel: string, ...args: unknown[]) {
      this._sentEvents.push({ channel, args });
      this.emit(channel, {}, ...args);
    }
  }

  class MockWebContentsViewInner {
    webContents: MockWebContentsInner;
    bounds = { x: 0, y: 0, width: 0, height: 0 };

    constructor(public options?: { webPreferences?: { partition?: string } }) {
      this.webContents = new MockWebContentsInner();
    }

    setBounds(b: { x: number; y: number; width: number; height: number }) {
      this.bounds = { ...b };
    }
  }

  class MockBaseWindowInner extends EventEmitter {
    _bounds = { x: 100, y: 100, width: 1280, height: 900 };
    _maximized = false;
    _minimized = false;
    _destroyed = false;

    contentView = {
      views: [] as MockWebContentsViewInner[],
      addChildView: vi.fn((v: MockWebContentsViewInner) => {
        this.contentView.views.push(v);
      }),
      removeChildView: vi.fn((v: MockWebContentsViewInner) => {
        const idx = this.contentView.views.indexOf(v);
        if (idx !== -1) this.contentView.views.splice(idx, 1);
      })
    };

    constructor(public options?: { x?: number; y?: number; width?: number; height?: number }) {
      super();
      if (options?.x !== undefined) this._bounds.x = options.x;
      if (options?.y !== undefined) this._bounds.y = options.y;
      if (options?.width !== undefined) this._bounds.width = options.width;
      if (options?.height !== undefined) this._bounds.height = options.height;
    }

    getBounds() {
      return { ...this._bounds };
    }
    getContentBounds() {
      return { ...this._bounds };
    }
    setBounds(b: Partial<{ x: number; y: number; width: number; height: number }>) {
      this._bounds = { ...this._bounds, ...b };
    }
    isMaximized() {
      return this._maximized;
    }
    isMinimized() {
      return this._minimized;
    }
    maximize() {
      this._maximized = true;
      this.emit('maximize');
    }
    unmaximize() {
      this._maximized = false;
      this.emit('unmaximize');
    }
    minimize() {
      this._minimized = true;
      this.emit('minimize');
    }
    restore() {
      this._minimized = false;
    }
    show() {}
    close() {
      this.emit('close');
      this._destroyed = true;
      this.emit('closed');
    }
    isDestroyed() {
      return this._destroyed;
    }
    focus() {}
  }

  const ipcHandlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const mockIpcMain = {
    _handlers: ipcHandlers,
    handle: vi.fn((channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => {
      ipcHandlers.delete(channel);
    }),
    _invoke: async (channel: string, ...args: unknown[]) => {
      const handler = ipcHandlers.get(channel);
      if (!handler) {
        throw new Error(`[IPC-ERROR] No handler registered on ipcMain for channel: "${channel}"`);
      }
      return handler({ sender: null }, ...args);
    }
  };

  return {
    harnessState,
    mockIpcMain,
    MockWebContentsView: MockWebContentsViewInner,
    MockBaseWindow: MockBaseWindowInner
  };
});

// Mock Electron Module
vi.mock('electron', () => {
  return {
    app: {
      getPath: vi.fn((name: string) => {
        if (name === 'userData') return harnessState.testUserDataDir;
        return os.tmpdir();
      }),
      getName: vi.fn(() => 'JulesDeck'),
      setName: vi.fn(),
      quit: vi.fn(),
      requestSingleInstanceLock: vi.fn(() => true),
      userAgentFallback: '',
      whenReady: vi.fn(async () => {})
    },
    BaseWindow: MockBaseWindow,
    WebContentsView: MockWebContentsView,
    ipcMain: mockIpcMain,
    dialog: {
      showOpenDialog: vi.fn(async () => {
        if (harnessState.mockDialogCanceled) {
          return { canceled: true, filePaths: [] };
        }
        return { canceled: false, filePaths: [harnessState.mockDialogSelectedDir] };
      }),
      showMessageBox: vi.fn(async (_win: unknown, opts: unknown) => {
        harnessState.lastMessageBoxOpts = opts;
        return { response: harnessState.mockMessageBoxResponse };
      })
    },
    session: {
      fromPartition: vi.fn(() => ({
        cookies: {
          set: vi.fn(async () => {}),
          get: vi.fn(async () => [])
        },
        webRequest: {
          onBeforeSendHeaders: vi.fn()
        },
        setUserAgent: vi.fn(),
        clearStorageData: vi.fn(async () => {}),
        clearCache: vi.fn(async () => {})
      }))
    },
    shell: {
      openPath: vi.fn(async () => ''),
      openExternal: vi.fn(async () => {})
    },
    screen: {
      getAllDisplays: vi.fn(() => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }])
    }
  };
});

// Mock child_process for controlled streaming task testing
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof cpTypes>();
  return {
    ...actual,
    spawn: (command: string, args: string[], options: unknown) => {
      if (harnessState.mockSpawnHandler) {
        return harnessState.mockSpawnHandler(command, args, options);
      }
      return actual.spawn(command, args, options as cpTypes.SpawnOptions);
    }
  };
});

// Import system under test after electron mocks are wired
import {
  CHROME_STRIP_HEIGHT,
  DEFAULT_WINDOW_STATE,
  updateViewBounds,
  loadWindowState,
  saveWindowState,
  getWindowStateFilePath,
  AppWindowLayers
} from '../src/main/window.js';

import {
  registerIpcHandlers,
  cleanTerminalText,
  extractSessionId
} from '../src/main/ipc.js';

import {
  saveAccountRegistry,
  createDefaultAccount
} from '../src/main/accounts.js';

import { ChromeCookieImporter, CookieImportResult } from '../src/main/cookieimport.js';

// Type definitions for mock view inspection
interface InspectableView {
  bounds: { x: number; y: number; width: number; height: number };
}

// Interface for simulated mock child process
interface MockChildProcessEmitter extends EventEmitter {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

function createMockChildProcess(pid: number): MockChildProcessEmitter {
  const child = new EventEmitter() as MockChildProcessEmitter;
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

// Helper: Factory for Renderer Client API (matches src/preload/chrome.ts)
function createRendererClient(chromeView: InstanceType<typeof MockWebContentsView>): ChromeApi {
  return {
    navigateBack: () => mockIpcMain._invoke('chrome:nav-back') as Promise<void>,
    navigateForward: () => mockIpcMain._invoke('chrome:nav-forward') as Promise<void>,
    reload: () => mockIpcMain._invoke('chrome:nav-reload') as Promise<void>,
    minimizeWindow: () => mockIpcMain._invoke('chrome:win-minimize') as Promise<void>,
    maximizeWindow: () => mockIpcMain._invoke('chrome:win-maximize') as Promise<void>,
    toggleMaximizeWindow: () => mockIpcMain._invoke('chrome:win-toggle-maximize') as Promise<void>,
    closeWindow: () => mockIpcMain._invoke('chrome:win-close') as Promise<void>,
    expandView: (height: number) => mockIpcMain._invoke('chrome:expand-view', height) as Promise<void>,
    collapseView: () => mockIpcMain._invoke('chrome:collapse-view') as Promise<void>,
    openInFileManager: (folderPath: string) =>
      mockIpcMain._invoke('chrome:open-in-file-manager', folderPath) as Promise<void>,
    syncCookies: () => mockIpcMain._invoke('chrome:auth-sync') as Promise<CookieImportResult>,
    logout: () => mockIpcMain._invoke('chrome:auth-logout') as Promise<void>,
    switchAccount: (accountId: string) => mockIpcMain._invoke('chrome:account-switch', accountId) as Promise<boolean>,
    addAccount: (name?: string, email?: string) =>
      mockIpcMain._invoke('chrome:account-add', name, email) as Promise<AccountRecord>,
    removeAccount: (accountId: string) =>
      mockIpcMain._invoke('chrome:account-remove', accountId) as Promise<{ success: boolean; nextAccountId?: string }>,
    openLocalRepo: () =>
      mockIpcMain._invoke('chrome:open-local-repo') as Promise<{
        success: boolean;
        repo?: string;
        path?: string;
        message: string;
      }>,
    selectRecentRepo: (repoPath: string) =>
      mockIpcMain._invoke('chrome:select-recent-repo', repoPath) as Promise<{
        success: boolean;
        repo?: string;
        path?: string;
        message: string;
      }>,
    getRecentRepos: () => mockIpcMain._invoke('chrome:get-recent-repos') as Promise<RecentRepoItem[]>,
    clearLocalRepo: () => mockIpcMain._invoke('chrome:clear-local-repo') as Promise<void>,
    getGitReviewDetails: () => mockIpcMain._invoke('chrome:git-review-details') as Promise<GitReviewDetails | null>,
    runJulesTask: (repoPath: string, prompt: string) =>
      mockIpcMain._invoke('chrome:run-jules-task', repoPath, prompt) as Promise<JulesRunResult>,
    cancelJulesTask: () =>
      mockIpcMain._invoke('chrome:cancel-jules-task') as Promise<{ success: boolean; message: string }>,
    getJulesCliStatus: () => mockIpcMain._invoke('chrome:get-jules-status') as Promise<JulesCliStatus>,
    getJulesCliInfo: () => mockIpcMain._invoke('chrome:get-jules-cli-info') as Promise<unknown>,
    listJulesSessions: (repoPath?: string) =>
      mockIpcMain._invoke('chrome:list-jules-sessions', repoPath) as Promise<JulesSessionItem[]>,
    listJulesRepos: () => mockIpcMain._invoke('chrome:list-jules-repos') as Promise<string[]>,
    listJulesRemoteRepos: () => mockIpcMain._invoke('chrome:list-jules-repos') as Promise<string[]>,
    applyJulesSession: (repoPath: string, sessionId: string) =>
      mockIpcMain._invoke('chrome:apply-jules-session', repoPath, sessionId) as Promise<{
        success: boolean;
        output: string;
      }>,
    getGitFileDiff: (filePath: string, staged?: boolean) =>
      mockIpcMain._invoke('chrome:git-file-diff', filePath, staged) as Promise<GitFileDiff>,
    getGitStructuredStatus: () =>
      mockIpcMain._invoke('chrome:git-structured-status') as Promise<GitStructuredStatus | null>,
    initGitRepo: (folderPath?: string) =>
      mockIpcMain._invoke('chrome:init-git-repo', folderPath) as Promise<{ success: boolean; repo?: string; path?: string; message: string }>,
    setModeState: (mode: 'cloud' | 'local') =>
      mockIpcMain._invoke('chrome:set-mode', mode) as Promise<void>,
    getInitialState: () => mockIpcMain._invoke('chrome:get-state') as Promise<NavigationState>,
    onStateUpdate: (cb: (state: NavigationState) => void) => {
      const listener = (_evt: unknown, s: NavigationState) => cb(s);
      chromeView.webContents.on('chrome:state-update', listener);
      return () => chromeView.webContents.removeListener('chrome:state-update', listener);
    },
    onTaskOutput: (cb: (chunk: TaskOutputChunk) => void) => {
      const listener = (_evt: unknown, chunk: TaskOutputChunk) => cb(chunk);
      chromeView.webContents.on('chrome:task-output', listener);
      return () => chromeView.webContents.removeListener('chrome:task-output', listener);
    },
    onTaskStatus: (cb: (status: TaskStatusEvent) => void) => {
      const listener = (_evt: unknown, status: TaskStatusEvent) => cb(status);
      chromeView.webContents.on('chrome:task-status', listener);
      return () => chromeView.webContents.removeListener('chrome:task-status', listener);
    }
  };
}

describe('JulesDeck End-to-End Usage & Automation Test Suite', () => {
  let layers: AppWindowLayers;
  let unregisterIpc: () => void;
  let client: ChromeApi;
  let mockCookieImporter: ChromeCookieImporter;

  beforeEach(() => {
    harnessState.testUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'julesdeck-e2e-userdata-'));
    harnessState.targetGitDir = path.join(harnessState.testUserDataDir, 'fixture-repo');
    fs.mkdirSync(harnessState.targetGitDir);
    execSync('git init -b main', { cwd: harnessState.targetGitDir });
    execSync('git config user.name Fixture', { cwd: harnessState.targetGitDir });
    execSync('git config user.email fixture@example.com', { cwd: harnessState.targetGitDir });
    fs.writeFileSync(path.join(harnessState.targetGitDir, 'README.md'), '# Fixture\n');
    execSync('git add README.md && git commit -m fixture', { cwd: harnessState.targetGitDir });
    harnessState.mockDialogSelectedDir = harnessState.targetGitDir;
    harnessState.mockDialogCanceled = false;
    harnessState.mockMessageBoxResponse = 0;
    harnessState.lastMessageBoxOpts = null;
    harnessState.mockSpawnHandler = null;

    // Seed default account registry in test userData dir
    const defaultAccount = createDefaultAccount({
      id: 'default-spike',
      name: 'OSINTCabal',
      email: 'osintcabal@google.com',
      partition: 'persist:spike'
    });
    saveAccountRegistry(
      {
        activeAccountId: defaultAccount.id,
        accounts: [defaultAccount]
      },
      path.join(harnessState.testUserDataDir, 'accounts.json')
    );

    // Instantiate Mock Layers
    const baseWin = new MockBaseWindow({ width: 1280, height: 900 });
    const chromeView = new MockWebContentsView();
    const contentView = new MockWebContentsView();

    baseWin.contentView.addChildView(contentView);
    baseWin.contentView.addChildView(chromeView);
    updateViewBounds(
      baseWin as unknown as BaseWindow,
      chromeView as unknown as WebContentsView,
      contentView as unknown as WebContentsView
    );

    layers = {
      baseWindow: baseWin as unknown as BaseWindow,
      chromeView: chromeView as unknown as WebContentsView,
      contentView: contentView as unknown as WebContentsView
    };

    client = createRendererClient(chromeView);

    // Mock Cookie Importer
    mockCookieImporter = {
      openInSystemBrowser: vi.fn(async () => {}),
      findChromeCookieDb: vi.fn(() => '/mock/chrome/Default/Cookies'),
      getEncryptionKey: vi.fn(() => Buffer.alloc(16, 0x01)),
      extractAndDecryptCookies: vi.fn(() => []),
      importToSession: vi.fn(async () => ({
        success: true,
        importedCount: 6,
        message: 'Successfully imported 6 session cookies from system Google Chrome.'
      }))
    } as unknown as ChromeCookieImporter;

    // Register IPC handlers
    unregisterIpc = registerIpcHandlers(
      layers,
      mockCookieImporter,
      'https://jules.google.com',
      'Mozilla/5.0 JulesDeck/Test',
      () => {}
    );
  });

  afterEach(() => {
    if (unregisterIpc) {
      unregisterIpc();
    }
    // Clean local repo state
    mockIpcMain._invoke('chrome:clear-local-repo').catch(() => {});

    try {
      if (fs.existsSync(harnessState.testUserDataDir)) {
        fs.rmSync(harnessState.testUserDataDir, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup errors
    }
  });

  // =========================================================================
  // 1. App Window Layers & Full IPC Life-Cycle Harness
  // =========================================================================
  describe('1. App Window Layers & Full IPC Life-Cycle Harness', () => {
    it('initializes window layers with authentic 44px chrome strip height and remaining content area', () => {
      const chromeBounds = (layers.chromeView as unknown as InspectableView).bounds;
      const contentBounds = (layers.contentView as unknown as InspectableView).bounds;

      expect(CHROME_STRIP_HEIGHT).toBe(44);
      expect(chromeBounds).toEqual({ x: 0, y: 0, width: 1280, height: 44 });
      expect(contentBounds).toEqual({ x: 0, y: 44, width: 1280, height: 856 }); // 900 - 44
    });

    it('expands chrome view for drawers and menus, and collapses back to 44px', async () => {
      // Expand for Local Mode drawer (360px)
      await client.expandView(360);
      expect((layers.chromeView as unknown as InspectableView).bounds.height).toBe(360);

      // Expand for App Menu dropdown (320px)
      await client.expandView(320);
      expect((layers.chromeView as unknown as InspectableView).bounds.height).toBe(320);

      // Collapse back
      await client.collapseView();
      expect((layers.chromeView as unknown as InspectableView).bounds.height).toBe(44);
    });

    it('prevents negative content view height on extremely small window heights', () => {
      layers.baseWindow.setBounds({ width: 600, height: 30 });
      updateViewBounds(layers.baseWindow, layers.chromeView, layers.contentView);

      expect((layers.contentView as unknown as InspectableView).bounds.height).toBe(0);
      expect((layers.chromeView as unknown as InspectableView).bounds.height).toBe(44);
    });

    it('registers all required IPC channels and delivers responses to renderer client', async () => {
      const state = await client.getInitialState();
      expect(state).toBeDefined();
      expect(state.title).toContain('JulesDeck');
      expect(state.accountName).toBe('OSINTCabal');
      expect(state.isLoading).toBe(false);
      expect(state.isMaximized).toBe(false);
    });

    it('broadcasts state updates across IPC when window maximize state toggles', async () => {
      let latestBroadcast: NavigationState | null = null;
      const unsubscribe = client.onStateUpdate((s) => {
        latestBroadcast = s;
      });

      // Toggle Maximize
      await client.toggleMaximizeWindow();
      expect(layers.baseWindow.isMaximized()).toBe(true);
      expect(latestBroadcast).not.toBeNull();
      expect(latestBroadcast?.isMaximized).toBe(true);

      // Toggle Restore
      await client.toggleMaximizeWindow();
      expect(layers.baseWindow.isMaximized()).toBe(false);
      expect(latestBroadcast?.isMaximized).toBe(false);

      unsubscribe();
    });

    it('unregisters all IPC handlers cleanly upon shutdown without dangling listeners', () => {
      expect(mockIpcMain._handlers.size).toBeGreaterThan(15);
      unregisterIpc();
      // Verifying critical channels removed
      expect(mockIpcMain._handlers.has('chrome:get-state')).toBe(false);
      expect(mockIpcMain._handlers.has('chrome:open-local-repo')).toBe(false);
      expect(mockIpcMain._handlers.has('chrome:run-jules-task')).toBe(false);
      expect(mockIpcMain._handlers.has('chrome:cancel-jules-task')).toBe(false);
    });
  });

  // =========================================================================
  // 2. Local Repository Selection & Git Details
  // =========================================================================
  describe('2. Local Git Repository Selection & Git Inspection (Dynamic Workspace)', () => {
    it('selects repository, extracts branch badge, commit log, and pushes to recent repos', async () => {
      harnessState.mockDialogSelectedDir = harnessState.targetGitDir;
      harnessState.mockDialogCanceled = false;

      const targetRepoName = path.basename(harnessState.targetGitDir);
      const targetBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: harnessState.targetGitDir,
        encoding: 'utf-8',
      }).trim();

      let stateUpdateReceived: NavigationState | null = null;
      client.onStateUpdate((s) => {
        stateUpdateReceived = s;
      });

      const res = await client.openLocalRepo();
      expect(res.success).toBe(true);
      expect(res.path).toBe(harnessState.targetGitDir);
      expect(res.message).toContain(`Active repository set to ${targetRepoName}`);

      // Verify navigation state update
      const state = await client.getInitialState();
      expect(state.localRepo).toBeDefined();
      expect(state.localRepo?.name).toBe(targetRepoName);
      expect(state.localRepo?.branch).toBe(targetBranch);
      expect(state.localRepo?.path).toBe(harnessState.targetGitDir);
      expect(state.localRepo?.lastCommit).toBeDefined();

      expect(stateUpdateReceived).not.toBeNull();
      expect(stateUpdateReceived?.localRepo?.name).toBe(targetRepoName);

      // Verify recent repos list has the selected repo at index 0
      const recents = await client.getRecentRepos();
      expect(recents.length).toBeGreaterThan(0);
      expect(recents[0]?.path).toBe(harnessState.targetGitDir);
      expect(recents[0]?.branch).toBe(targetBranch);
    });

    it('retrieves detailed Git review state including recent commit history and working tree status', async () => {
      harnessState.mockDialogSelectedDir = harnessState.targetGitDir;
      await client.openLocalRepo();

      const targetBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: harnessState.targetGitDir,
        encoding: 'utf-8',
      }).trim();

      const details: GitReviewDetails | null = await client.getGitReviewDetails();
      expect(details).not.toBeNull();
      expect(details?.branch).toBe(targetBranch);
      expect(typeof details?.statusText).toBe('string');
      expect(Array.isArray(details?.recentCommits)).toBe(true);
      expect(details!.recentCommits.length).toBeGreaterThanOrEqual(1);

      const firstCommit = details!.recentCommits[0]!;
      expect(firstCommit.hash).toMatch(/^[0-9a-f]{7,}/i);
      expect(firstCommit.author.length).toBeGreaterThan(0);
      expect(firstCommit.message.length).toBeGreaterThan(0);
      expect(firstCommit.date.length).toBeGreaterThan(0);
    });

    it('switches between repositories via selectRecentRepo IPC channel', async () => {
      harnessState.mockDialogSelectedDir = harnessState.targetGitDir;
      await client.openLocalRepo();

      const targetRepoName = path.basename(harnessState.targetGitDir);
      const targetBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: harnessState.targetGitDir,
        encoding: 'utf-8',
      }).trim();

      // Clear local repo
      await client.clearLocalRepo();
      let state = await client.getInitialState();
      expect(state.localRepo).toBeUndefined();

      // Select again via recent repo path
      const switchRes = await client.selectRecentRepo(harnessState.targetGitDir);
      expect(switchRes.success).toBe(true);
      expect(switchRes.message).toContain(`Switched to ${targetRepoName} (${targetBranch})`);

      state = await client.getInitialState();
      expect(state.localRepo?.name).toBe(targetRepoName);
      expect(state.localRepo?.branch).toBe(targetBranch);
    }, 20000);
  });

  // =========================================================================
  // 3. Non-Git Directory & Invalid Path Handling
  // =========================================================================
  describe('3. Non-Git Directory Handling & Error Recovery', () => {
    it('rejects a non-git directory, displays warning dialog, and preserves active state', async () => {
      const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jules-nongit-'));
      harnessState.mockDialogSelectedDir = nonGitDir;
      harnessState.mockDialogCanceled = false;

      const res = await client.openLocalRepo();
      expect(res.success).toBe(false);
      expect(res.message).toBe('Not a Git repository');

      // Verify warning message box was presented
      expect(harnessState.lastMessageBoxOpts).toEqual({
        type: 'warning',
        title: 'Not a Git Repository',
        message: 'The selected folder does not appear to be a Git repository.'
      });

      fs.rmSync(nonGitDir, { recursive: true, force: true });
    });

    it('gracefully handles user cancellation during directory selection dialog', async () => {
      harnessState.mockDialogCanceled = true;

      const res = await client.openLocalRepo();
      expect(res.success).toBe(false);
      expect(res.message).toBe('Selection canceled');
    });

    it('returns structured error when selecting a non-existent recent repository path', async () => {
      const fakePath = '/tmp/nonexistent-jules-repo-' + Date.now();
      const res = await client.selectRecentRepo(fakePath);

      expect(res.success).toBe(false);
      expect(res.message).toBe('Directory does not exist');
    });

    it('returns structured error when selecting a directory that is not a git repo via recent list', async () => {
      const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jules-nongit-recent-'));
      const res = await client.selectRecentRepo(nonGitDir);

      expect(res.success).toBe(false);
      expect(res.message).toBe('Path is not a Git repository');

      fs.rmSync(nonGitDir, { recursive: true, force: true });
    });
  });

  // =========================================================================
  // 4. Streaming Task Runner Lifecycle
  // =========================================================================
  describe('4. Streaming Jules Task Runner Lifecycle (Start -> Stream -> Cancel -> Status)', () => {
    it('executes task, streams output chunks, auto-detects session ID, and handles cancellation', async () => {
      const chunksReceived: TaskOutputChunk[] = [];
      const statusEventsReceived: TaskStatusEvent[] = [];

      client.onTaskOutput((chunk) => chunksReceived.push(chunk));
      client.onTaskStatus((status) => statusEventsReceived.push(status));

      // Create a mock child process
      const mockChild = createMockChildProcess(44556);

      // Spy on process.kill so killProcessGroup returns true in test environment
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

      harnessState.mockSpawnHandler = vi.fn(() => mockChild);

      // Start the task asynchronously
      const taskPromise = client.runJulesTask(harnessState.targetGitDir, 'Investigate code quality');

      // Verify task started status
      expect(statusEventsReceived.length).toBeGreaterThanOrEqual(1);
      expect(statusEventsReceived[0]?.status).toBe('running');

      // Emit stdout chunks from child
      mockChild.stdout.emit('data', Buffer.from('[INFO] Analyzing project dependencies...\n'));
      mockChild.stdout.emit(
        'data',
        Buffer.from('Created remote session at https://jules.google.com/session/771122334455\n')
      );

      // Verify chunk streaming and session auto-detection
      const sessionChunk = chunksReceived.find((c) => c.sessionId === '771122334455');
      expect(sessionChunk).toBeDefined();
      expect(sessionChunk?.chunk).toContain('Created remote session');

      // Now Cancel the active task
      const cancelRes = await client.cancelJulesTask();
      expect(cancelRes.success).toBe(true);
      expect(cancelRes.message).toContain('cancelled');

      // Close child process as aborted
      mockChild.emit('close', null);

      const runResult: JulesRunResult = await taskPromise;
      expect(runResult.success).toBe(false);
      expect(runResult.message).toBe('Task cancelled by user');
      expect(runResult.sessionId).toBe('771122334455');

      // Verify cancelled status event
      const cancelledEvent = statusEventsReceived.find((s) => s.status === 'cancelled');
      expect(cancelledEvent).toBeDefined();
      expect(cancelledEvent?.message).toBe('Task aborted by user');

      killSpy.mockRestore();
    });

    it('streams task completion cleanly when process exits with code 0', async () => {
      const statusEvents: TaskStatusEvent[] = [];
      client.onTaskStatus((s) => statusEvents.push(s));

      const mockChild = createMockChildProcess(11223);
      harnessState.mockSpawnHandler = vi.fn(() => mockChild);

      const taskPromise = client.runJulesTask(harnessState.targetGitDir, 'Review changes');

      mockChild.stdout.emit('data', Buffer.from('Session 889900112233 is ready.\nAll checks passed.\n'));
      mockChild.emit('close', 0);

      const res = await taskPromise;
      expect(res.success).toBe(true);
      expect(res.message).toBe('Task completed successfully');
      expect(res.sessionId).toBe('889900112233');

      const doneEvent = statusEvents.find((s) => s.status === 'completed');
      expect(doneEvent).toBeDefined();
    });

    it('reports failure event when task process exits with a non-zero exit code', async () => {
      const statusEvents: TaskStatusEvent[] = [];
      client.onTaskStatus((s) => statusEvents.push(s));

      const mockChild = createMockChildProcess(99887);
      harnessState.mockSpawnHandler = vi.fn(() => mockChild);

      const taskPromise = client.runJulesTask(harnessState.targetGitDir, 'Failing task');

      mockChild.stderr.emit('data', Buffer.from('Fatal: command failed with error\n'));
      mockChild.emit('close', 1);

      const res = await taskPromise;
      expect(res.success).toBe(false);
      expect(res.message).toContain('Task failed');
      expect(res.message).toContain('exit code 1');

      const failEvent = statusEvents.find((s) => s.status === 'failed');
      expect(failEvent).toBeDefined();
      expect(failEvent?.exitCode).toBe(1);
      expect(failEvent?.message).toContain('exited with code 1');
    });

    it('reports failure and error chunk when process spawn emits an error event', async () => {
      const statusEvents: TaskStatusEvent[] = [];
      client.onTaskStatus((s) => statusEvents.push(s));

      const mockChild = createMockChildProcess(0);
      harnessState.mockSpawnHandler = vi.fn(() => mockChild);

      const taskPromise = client.runJulesTask(harnessState.targetGitDir, 'Missing bin test');

      mockChild.emit('error', new Error('spawn ENOENT'));

      const res = await taskPromise;
      expect(res.success).toBe(false);
      expect(res.message).toContain('spawn ENOENT');

      const failEvent = statusEvents.find((s) => s.status === 'failed');
      expect(failEvent).toBeDefined();
      expect(failEvent?.message).toContain('spawn ENOENT');
    });

    it('returns false message when cancelJulesTask is called without an active task', async () => {
      const res = await client.cancelJulesTask();
      expect(res.success).toBe(false);
      expect(res.message).toBe('No active task running');
    });
  });

  // =========================================================================
  // 5. Remote Jules Sessions & Applying Patches
  // =========================================================================
  describe('5. Remote Jules Sessions & Patch Application', () => {
    it('lists remote Jules sessions and structures tabular output into items', async () => {
      const mockChild = createMockChildProcess(33221);

      harnessState.mockSpawnHandler = vi.fn((cmd, args) => {
        if (args.includes('remote') && args.includes('--session')) {
          setTimeout(() => {
            mockChild.stdout.emit(
              'data',
              Buffer.from(
                '      ID                 Description                 Repo      Last active     Status    \n' +
                ' 21492375058…  e2e verification test             OSINTCabal/…  1m ago        Completed \n' +
                ' 98615155049…  Review this repository            OSINTCabal/…  3 days ago    Active    \n'
              )
            );
            mockChild.emit('close', 0);
          }, 10);
          return mockChild;
        }
        return new EventEmitter();
      });

      const sessions: JulesSessionItem[] = await client.listJulesSessions();
      expect(sessions.length).toBe(2);
      expect(sessions[0]?.id).toBe('21492375058…');
      expect(sessions[0]?.description).toContain('e2e verification');
      expect(sessions[0]?.status).toBe('Completed');

      expect(sessions[1]?.id).toBe('98615155049…');
      expect(sessions[1]?.status).toBe('Active');
    });

    it('lists remote Jules repositories cleanly', async () => {
      const mockChild = createMockChildProcess(33222);

      harnessState.mockSpawnHandler = vi.fn((cmd, args) => {
        if (args.includes('remote') && args.includes('--repo')) {
          setTimeout(() => {
            mockChild.stdout.emit(
              'data',
              Buffer.from('OSINTCabal/JulesDeck\nOSINTCabal/VibeDeck\nOSINTCabal/ClineCode\n')
            );
            mockChild.emit('close', 0);
          }, 10);
          return mockChild;
        }
        return new EventEmitter();
      });

      const repos = await client.listJulesRepos();
      expect(repos).toEqual(['OSINTCabal/JulesDeck', 'OSINTCabal/VibeDeck', 'OSINTCabal/ClineCode']);
    });

    it('applies a remote session patch and streams terminal output chunks', async () => {
      const chunks: TaskOutputChunk[] = [];
      client.onTaskOutput((c) => chunks.push(c));

      const mockChild = createMockChildProcess(33223);

      harnessState.mockSpawnHandler = vi.fn((cmd, args) => {
        if (args.includes('--apply')) {
          setTimeout(() => {
            mockChild.stdout.emit('data', Buffer.from('Fetching patch from session 21492375058...\n'));
            mockChild.stdout.emit('data', Buffer.from('Patch applied successfully: 3 files changed.\n'));
            mockChild.emit('close', 0);
          }, 10);
          return mockChild;
        }
        return new EventEmitter();
      });

      const applyRes = await client.applyJulesSession(harnessState.targetGitDir, '21492375058');
      expect(applyRes.success).toBe(true);
      expect(applyRes.output).toContain('Patch applied successfully');

      // Verify streaming chunks sent to renderer
      const applyChunks = chunks.filter((c) => c.taskId === 'apply-21492375058');
      expect(applyChunks.length).toBeGreaterThanOrEqual(1);
    });

    it('handles patch application errors gracefully without throwing', async () => {
      const mockChild = createMockChildProcess(33224);

      harnessState.mockSpawnHandler = vi.fn((cmd, args) => {
        if (args.includes('--apply')) {
          setTimeout(() => {
            mockChild.stderr.emit('data', Buffer.from('error: patch does not apply\n'));
            mockChild.emit('close', 1);
          }, 10);
          return mockChild;
        }
        return new EventEmitter();
      });

      const applyRes = await client.applyJulesSession(harnessState.targetGitDir, 'invalid-session-999');
      expect(applyRes.success).toBe(false);
      expect(applyRes.output).toContain('patch does not apply');
    });

    it('retrieves diagnostic status of the Jules CLI', async () => {
      const mockChild = createMockChildProcess(33225);

      harnessState.mockSpawnHandler = vi.fn((cmd, args) => {
        if (args.includes('version')) {
          setTimeout(() => {
            mockChild.stdout.emit(
              'data',
              Buffer.from('Version: v0.1.42\nCommit: 4bd6b25084aa1af52d6d3979cda31f3a3d99fc04\n')
            );
            mockChild.emit('close', 0);
          }, 10);
          return mockChild;
        }
        return new EventEmitter();
      });

      const status: JulesCliStatus = await client.getJulesCliStatus();
      expect(status.installed).toBe(true);
      expect(status.ready).toBe(true);
      expect(status.version).toBe('v0.1.42');
      expect(status.commit).toBe('4bd6b25084aa1af52d6d3979cda31f3a3d99fc04');
    });
  });

  // =========================================================================
  // 6. App Menu Toggle, Account Switching, and Chrome Cookie Sync IPC
  // =========================================================================
  describe('6. App Menu, Account Switching, and Chrome Cookie Sync IPC', () => {
    it('manages multi-account lifecycle: add account -> switch account -> remove account', async () => {
      // 1. Initial State has default account
      let state = await client.getInitialState();
      expect(state.accounts.length).toBe(1);
      expect(state.activeAccountId).toBe('default-spike');

      // 2. Add New Account
      const newAccount: AccountRecord = await client.addAccount('Work Profile', 'work@company.com');
      expect(newAccount.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(newAccount.email).toBe('work@company.com');
      expect(newAccount.name).toBe('Work Profile');
      expect(newAccount.partition).toContain('persist:acct-');
      expect(layers.contentView.webContents.setWindowOpenHandler).toHaveBeenCalled();

      state = await client.getInitialState();
      expect(state.accounts.length).toBe(2);
      expect(state.activeAccountId).toBe(newAccount.id);
      expect(state.accountName).toBe('Work Profile');

      // 3. Switch to New Account
      const switchToNewSuccess = await client.switchAccount(newAccount.id);
      expect(switchToNewSuccess).toBe(true);
      expect(layers.contentView.webContents.setWindowOpenHandler).toHaveBeenCalled();

      state = await client.getInitialState();
      expect(state.activeAccountId).toBe(newAccount.id);
      expect(state.accountName).toBe('Work Profile');

      // 4. Switch back to Default Account
      const switchSuccess = await client.switchAccount('default-spike');
      expect(switchSuccess).toBe(true);
      expect(layers.contentView.webContents.setWindowOpenHandler).toHaveBeenCalled();

      state = await client.getInitialState();
      expect(state.activeAccountId).toBe('default-spike');
      expect(state.accountName).toBe('OSINTCabal');

      // 5. Remove the secondary account
      const removeRes = await client.removeAccount(newAccount.id);
      expect(removeRes.success).toBe(true);
      expect(layers.contentView.webContents.setWindowOpenHandler).toHaveBeenCalled();

      state = await client.getInitialState();
      expect(state.accounts.length).toBe(1);
      expect(state.accounts[0]?.id).toBe('default-spike');
    });

    it('triggers Chrome cookie sync and reloads target URL on success', async () => {
      const syncRes = await client.syncCookies();
      expect(syncRes.success).toBe(true);
      expect(syncRes.importedCount).toBe(6);

      // Verify contentView reloaded target URL
      expect(layers.contentView.webContents.loadURL).toHaveBeenCalledWith('https://jules.google.com');
    });

    it('handles Chrome cookie sync failures gracefully without crashing', async () => {
      vi.spyOn(mockCookieImporter, 'importToSession').mockResolvedValueOnce({
        success: false,
        importedCount: 0,
        message: 'No Chrome or Chromium cookie database was found on this system.'
      });

      const syncRes = await client.syncCookies();
      expect(syncRes.success).toBe(false);
      expect(syncRes.importedCount).toBe(0);
      expect(syncRes.message).toContain('No Chrome or Chromium cookie database');
    });

    it('handles logout by clearing partition storage and cache then reloading', async () => {
      await client.logout();

      const ses = layers.contentView.webContents.session;
      expect(ses.clearStorageData).toHaveBeenCalled();
      expect(ses.clearCache).toHaveBeenCalled();
      expect(layers.contentView.webContents.loadURL).toHaveBeenCalledWith('https://jules.google.com');
    });

    it('opens local folder in system file manager via shell IPC', async () => {
      const testDir = process.cwd();
      await client.openInFileManager(testDir);
      // Verify shell.openPath was called
      const electron = await import('electron');
      expect(electron.shell.openPath).toHaveBeenCalledWith(testDir);
    });
  });

  // =========================================================================
  // 7. Window Geometry Persistence and Restoration
  // =========================================================================
  describe('7. Window Geometry Persistence & Display Boundary Restoration', () => {
    it('persists window coordinates and bounds to window-state.json and restores them accurately', () => {
      layers.baseWindow.setBounds({ x: 220, y: 140, width: 1440, height: 960 });
      saveWindowState(layers.baseWindow);

      const filePath = getWindowStateFilePath();
      expect(fs.existsSync(filePath)).toBe(true);

      const loaded = loadWindowState();
      expect(loaded.x).toBe(220);
      expect(loaded.y).toBe(140);
      expect(loaded.width).toBe(1440);
      expect(loaded.height).toBe(960);
      expect(loaded.isMaximized).toBe(false);
    });

    it('recovers gracefully from corrupt JSON in window-state.json by returning default state', () => {
      const filePath = getWindowStateFilePath();
      fs.writeFileSync(filePath, '{ "corrupted": [unclosed-json...', 'utf8');

      const loaded = loadWindowState();
      expect(loaded.width).toBe(DEFAULT_WINDOW_STATE.width);
      expect(loaded.height).toBe(DEFAULT_WINDOW_STATE.height);
      expect(loaded.isMaximized).toBe(false);
    });

    it('discards off-screen coordinates outside of any monitor display bounds', () => {
      const filePath = getWindowStateFilePath();
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          x: 99999, // Way off screen
          y: 99999,
          width: 1200,
          height: 800,
          isMaximized: false
        }),
        'utf8'
      );

      const loaded = loadWindowState();
      expect(loaded.x).toBeUndefined(); // discarded
      expect(loaded.y).toBeUndefined();
      expect(loaded.width).toBe(1200);
      expect(loaded.height).toBe(800);
    });

    it('persists and restores maximized window state flag', () => {
      layers.baseWindow.maximize();
      saveWindowState(layers.baseWindow);

      const loaded = loadWindowState();
      expect(loaded.isMaximized).toBe(true);
    });
  });

  // =========================================================================
  // 8. Runtime Performance & Error Recovery Verification
  // =========================================================================
  describe('8. Runtime Performance, Exit Codes & Error Recovery Verification', () => {
    it('executes IPC state queries under strict sub-50ms performance threshold', async () => {
      const start = performance.now();
      const iterations = 50;
      for (let i = 0; i < iterations; i++) {
        await client.getInitialState();
      }
      const duration = performance.now() - start;
      const avgDuration = duration / iterations;

      expect(avgDuration).toBeLessThan(50); // average IPC roundtrip under 50ms
    });

    it('cleans ANSI control codes and normalizes carriage return line endings', () => {
      const messy = '\u001b[32m[SUCCESS]\u001b[0m Task completed.\r\nLine 2.\r';
      const clean = cleanTerminalText(messy);
      expect(clean).toBe('[SUCCESS] Task completed.\nLine 2.\n');
    });

    it('extracts session IDs from multiple formats (URLs, text slugs, numeric IDs)', () => {
      expect(extractSessionId('View task: https://jules.google.com/session/abc-123_xyz')).toBe('abc-123_xyz');
      expect(extractSessionId('Task created. session ID: 99887766554433')).toBe('99887766554433');
      expect(extractSessionId('Running session: sess_abcdef123456')).toBe('sess_abcdef123456');
      expect(extractSessionId('Just some plain text without ID')).toBeUndefined();
    });
  });

  // =========================================================================
  // 9. Unborn Git Repositories, Diff Viewing, Shortcuts & Partition Isolation
  // =========================================================================
  describe('9. Unborn Git Repositories, Diff Viewing, Shortcuts & Partition Isolation', () => {
    it('initializes and activates an empty git repository with unborn branch and 0 commits', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { execSync } = require('node:child_process') as typeof import('node:child_process');
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'julesdeck-unborn-usage-'));

      try {
        execSync('git init -b feature/initial-clean-branch', { cwd: emptyDir });

        harnessState.mockDialogSelectedDir = emptyDir;
        const openResult = await client.openLocalRepo();
        expect(openResult.success).toBe(true);
        expect(openResult.path).toBe(emptyDir);

        const state = await client.getInitialState();
        expect(state.localRepo).toBeDefined();
        expect(state.localRepo?.branch).toBe('feature/initial-clean-branch');
        expect(state.localRepo?.lastCommit).toBeUndefined();

        const review = await client.getGitReviewDetails();
        expect(review).not.toBeNull();
        expect(review?.branch).toBe('feature/initial-clean-branch');
        expect(review?.recentCommits).toEqual([]);
        expect(review?.hasChanges).toBe(false);

        const structured = await client.getGitStructuredStatus();
        expect(structured?.totalChanges).toBe(0);
        expect(structured?.isDetached).toBe(false);
      } finally {
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
    }, 20000);

    it('generates unified diff for newly created untracked files and staged files on unborn branch', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { execSync } = require('node:child_process') as typeof import('node:child_process');
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'julesdeck-diff-usage-'));

      try {
        execSync('git init -b main', { cwd: emptyDir });
        harnessState.mockDialogSelectedDir = emptyDir;
        await client.openLocalRepo();

        // 1. Untracked file
        const notePath = path.join(emptyDir, 'notes.txt');
        fs.writeFileSync(notePath, 'line 1\nline 2\n');

        const untrackedDiff = await client.getGitFileDiff('notes.txt', false);
        expect(untrackedDiff.filePath).toBe('notes.txt');
        expect(untrackedDiff.isStaged).toBe(false);
        expect(untrackedDiff.diff).toContain('--- /dev/null');
        expect(untrackedDiff.diff).toContain('+++ b/notes.txt');
        expect(untrackedDiff.diff).toContain('+line 1');

        // 2. Staged file on unborn branch
        execSync('git add notes.txt', { cwd: emptyDir });
        const stagedDiff = await client.getGitFileDiff('notes.txt', true);
        expect(stagedDiff.filePath).toBe('notes.txt');
        expect(stagedDiff.isStaged).toBe(true);
        expect(stagedDiff.diff).toContain('diff --git');
        expect(stagedDiff.diff).toContain('+line 2');

        // 3. Path traversal protection
        const outsideDiff = await client.getGitFileDiff('../../../../etc/passwd', false);
        expect(outsideDiff.diff).toBe('(File path outside repository boundary)');
      } finally {
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
    }, 20000);

    it('processes focus-independent shortcut events for Ctrl+1/Alt+1, Ctrl+2/Alt+2, and Ctrl+L', async () => {
      let lastModeCommand: string | null = null;
      layers.chromeView.webContents.on('chrome:mode-command', (_evt, cmd) => {
        lastModeCommand = cmd as string;
      });

      // Ctrl+2 -> Local Mode
      layers.contentView.webContents.emit(
        'before-input-event',
        { preventDefault: () => {} },
        { type: 'keyDown', control: true, key: '2', code: 'Digit2' }
      );
      expect(lastModeCommand).toBe('local');

      // Alt+1 -> Cloud Mode
      layers.contentView.webContents.emit(
        'before-input-event',
        { preventDefault: () => {} },
        { type: 'keyDown', alt: true, key: '1', code: 'Digit1' }
      );
      expect(lastModeCommand).toBe('cloud');

      // Alt+2 -> Local Mode
      layers.contentView.webContents.emit(
        'before-input-event',
        { preventDefault: () => {} },
        { type: 'keyDown', alt: true, key: '2', code: 'Digit2' }
      );
      expect(lastModeCommand).toBe('local');

      // Ctrl+1 -> Cloud Mode
      layers.contentView.webContents.emit(
        'before-input-event',
        { preventDefault: () => {} },
        { type: 'keyDown', control: true, key: '1', code: 'Digit1' }
      );
      expect(lastModeCommand).toBe('cloud');

      // Ctrl+L -> Toggles to local
      layers.contentView.webContents.emit(
        'before-input-event',
        { preventDefault: () => {} },
        { type: 'keyDown', control: true, key: 'l', code: 'KeyL' }
      );
      expect(lastModeCommand).toBe('local');

      // Ctrl+L -> Toggles to cloud
      layers.contentView.webContents.emit(
        'before-input-event',
        { preventDefault: () => {} },
        { type: 'keyDown', control: true, key: 'l', code: 'KeyL' }
      );
      expect(lastModeCommand).toBe('cloud');
    });

    it('enforces partition isolation on account switch and clears session data on sign out', async () => {
      // Create Account 2
      const acct2 = await client.addAccount('Researcher', 'researcher@gmail.com');
      expect(acct2.partition).toBe(`persist:acct-${acct2.id}`);

      // Switch to Account 2
      const switched = await client.switchAccount(acct2.id);
      expect(switched).toBe(true);

      let state = await client.getInitialState();
      expect(state.activeAccountId).toBe(acct2.id);
      expect(state.accountName).toBe('Researcher');

      // Sign out and clear active session
      await client.logout();

      state = await client.getInitialState();
      expect(state.accountName).toBe('Google Account');
      expect(state.accountEmail).toBe('');

      // Cleanup
      await client.removeAccount(acct2.id);
    });

    it('clamps layout bounds during window resize and synchronizes view geometry', () => {
      const inspectChrome = layers.chromeView as unknown as InspectableView;
      const inspectContent = layers.contentView as unknown as InspectableView;

      // Expand to 460px
      layers.activeChromeHeight = 460;
      updateViewBounds(layers.baseWindow, layers.chromeView, layers.contentView, 460);

      // Normal bounds (1280x900)
      expect(inspectChrome.bounds.height).toBe(460);
      expect(inspectContent.bounds.height).toBe(856); // 900 - 44

      // Small window height: 500px -> Clamped to 500 - 50 = 450px
      const smallWin = {
        getContentBounds: () => ({ x: 0, y: 0, width: 800, height: 500 })
      } as unknown as BaseWindow;
      updateViewBounds(smallWin, layers.chromeView, layers.contentView, 460);

      expect(inspectChrome.bounds.height).toBe(450);
      expect(inspectContent.bounds.height).toBe(456); // 500 - 44

      // Collapse back to 44px
      layers.activeChromeHeight = CHROME_STRIP_HEIGHT;
      updateViewBounds(smallWin, layers.chromeView, layers.contentView, CHROME_STRIP_HEIGHT);
      expect(inspectChrome.bounds.height).toBe(44);
    });

    it('verifies Local Mode DOM structure contains all Google Jules Web Clone elements and zero-overflow classes', () => {
      const htmlPath = path.join(__dirname, '../src/chrome/index.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

      // 1. Jules Gem Icon & Hero Header
      expect(htmlContent).toContain('class="jules-gem-icon"');
      expect(htmlContent).toContain('Meet Jules, your local software engineer');
      expect(htmlContent).toContain('id="hero-gem-gradient"');

      // 2. Context Badge & Starter Chips
      expect(htmlContent).toContain('class="hero-context-badge"');
      expect(htmlContent).toContain('data-prompt="Run test suite and fix any failing tests"');
      expect(htmlContent).toContain('data-prompt="Inspect git status and explain working tree changes"');

      // 3. Terminal Drawer Hidden by Default on Idle
      expect(htmlContent).toContain('class="terminal-container hidden" id="terminal-container"');
      expect(htmlContent).toContain('id="btn-toggle-terminal-body"');
      expect(htmlContent).toContain('id="terminal-live-status"');

      // 4. Sidebar Clear & Refresh Actions
      expect(htmlContent).toContain('id="btn-clear-sessions"');
      expect(htmlContent).toContain('id="btn-refresh-sessions"');
      expect(htmlContent).toContain('id="sidebar-account-pill"');
      expect(htmlContent).toContain('class="account-pill-left"');
      expect(htmlContent).toContain('id="sidebar-account-name"');

      // 5. CSS Zero-Overflow Rules
      const cssPath = path.join(__dirname, '../src/chrome/chrome.css');
      const cssContent = fs.readFileSync(cssPath, 'utf-8');
      expect(cssContent).toContain('.sidebar-footer {');
      expect(cssContent).toContain('box-sizing: border-box;');
      expect(cssContent).toContain('.sidebar-account-pill {');
      expect(cssContent).toContain('.terminal-container.hidden {');
      expect(cssContent).toContain('display: none !important;');
    });
  });
});
