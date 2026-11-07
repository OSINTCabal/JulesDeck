/**
 * Application Entry Point (Main Process).
 *
 * Implements Phase 1 app skeleton:
 * - Single-instance lock
 * - Three-layer BaseWindow + WebContentsView composition
 * - Geometry persistence
 * - Native application Menu & shortcuts
 * - Integrated Chrome strip with framed controls & session management
 */

import path from 'node:path';
import { app, session, Menu, nativeTheme } from 'electron';
import {
  buildUserAgent,
  sanitizeRequestHeaders,
  OAUTH_COMPAT_USER_AGENT
} from './identity.js';
import { createAppWindow, AppWindowLayers } from './window.js';
import { registerIpcHandlers, openLocalRepoDialog } from './ipc.js';
import { ChromeCookieImporter } from './cookieimport.js';
import { loadAccountRegistry } from './accounts.js';
import {
  configureSessionPermissionsAndDownloads
} from './navigation.js';

app.setName('JulesDeck');

const TARGET_URL = 'https://jules.google.com';
const PRIMARY_PARTITION = 'persist:spike';

// Request single-instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[LIFECYCLE] Another instance is already running. Quitting.');
  app.quit();
  process.exit(0);
}

const chromeVersion = process.versions.chrome;
if (!chromeVersion) {
  console.error('[FATAL] Missing process.versions.chrome');
  process.exit(1);
}

const cleanUserAgent = buildUserAgent(chromeVersion);
const cookieImporter = new ChromeCookieImporter();

// Ensure all new windows/popups default to OAuth-compatible identity
app.userAgentFallback = OAUTH_COMPAT_USER_AGENT;

let activeLayers: AppWindowLayers | null = null;
let unregisterIpc: (() => void) | null = null;

function configurePartitionSession(partitionName: string): Electron.Session {
  const ses = session.fromPartition(partitionName);
  ses.setUserAgent(cleanUserAgent);

  configureSessionPermissionsAndDownloads(ses);

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const sanitized = sanitizeRequestHeaders(
      details.requestHeaders,
      chromeVersion,
      cleanUserAgent,
      process.arch,
      details.url
    );
    callback({ requestHeaders: sanitized });
  });

  return ses;
}

function initializeApp(): void {
  const registry = loadAccountRegistry();
  const activeAccount = registry.accounts.find((a) => a.id === registry.activeAccountId) || registry.accounts[0];
  const initialPartition = activeAccount?.partition || PRIMARY_PARTITION;

  configurePartitionSession(initialPartition);

  const preloadChromePath = path.join(__dirname, '../preload/chrome.js');
  const chromeHtmlPath = path.join(__dirname, '../chrome/index.html');

  activeLayers = createAppWindow(
    initialPartition,
    preloadChromePath,
    chromeHtmlPath,
    TARGET_URL,
    cleanUserAgent
  );

  unregisterIpc = registerIpcHandlers(
    activeLayers,
    cookieImporter,
    TARGET_URL,
    cleanUserAgent,
    configurePartitionSession
  );

  // Setup application menu (enabling native shortcuts and clipboard)
  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Application',
      submenu: [
        {
          label: 'Open Local Git Repository...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            if (activeLayers) {
              const res = await openLocalRepoDialog(activeLayers);
              if (res.success) {
                activeLayers.chromeView.webContents.send('chrome:mode-command', 'local');
              }
            }
          }
        },
        {
          label: 'Switch to Cloud Jules',
          accelerator: 'CmdOrCtrl+1',
          click: () => {
            activeLayers?.chromeView.webContents.send('chrome:mode-command', 'cloud');
          }
        },
        {
          label: 'Switch to Local Mode',
          accelerator: 'CmdOrCtrl+2',
          click: () => {
            activeLayers?.chromeView.webContents.send('chrome:mode-command', 'local');
          }
        },
        {
          label: 'Switch to GitHub / Repo Mode',
          accelerator: 'CmdOrCtrl+3',
          click: () => {
            activeLayers?.chromeView.webContents.send('chrome:mode-command', 'repo');
          }
        },
        {
          label: 'Toggle Cloud / Local Mode',
          accelerator: 'CmdOrCtrl+L',
          click: () => {
            activeLayers?.chromeView.webContents.send('chrome:mode-command', 'toggle');
          }
        },
        {
          label: 'Sync Cookies from Google Chrome',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: async () => {
            if (activeLayers) {
              const ses = activeLayers.contentView.webContents.session;
              const res = await cookieImporter.importToSession(ses);
              if (res.success) {
                activeLayers.contentView.webContents.loadURL(TARGET_URL);
              }
            }
          }
        },
        {
          label: 'Jules Settings...',
          accelerator: 'CmdOrCtrl+,',
          click: async () => {
            if (activeLayers) {
              activeLayers.chromeView.webContents.send('chrome:mode-command', 'cloud');
              activeLayers.contentView.webContents.loadURL('https://jules.google.com/settings/general');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Toggle Chrome Strip DevTools',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => activeLayers?.chromeView.webContents.toggleDevTools()
        },
        { type: 'separator' },
        { role: 'quit', accelerator: 'CmdOrCtrl+Q' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Back',
          accelerator: 'Alt+Left',
          click: () => {
            const wc = activeLayers?.contentView.webContents;
            if (wc && (wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack())) {
              if (wc.navigationHistory) wc.navigationHistory.goBack();
              else wc.goBack();
            }
          }
        },
        {
          label: 'Forward',
          accelerator: 'Alt+Right',
          click: () => {
            const wc = activeLayers?.contentView.webContents;
            if (wc && (wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward())) {
              if (wc.navigationHistory) wc.navigationHistory.goForward();
              else wc.goForward();
            }
          }
        },
        {
          label: 'Reload Page',
          accelerator: 'CmdOrCtrl+R',
          click: () => activeLayers?.contentView.webContents.reload()
        },
        {
          label: 'Force Reload Page',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => activeLayers?.contentView.webContents.reloadIgnoringCache()
        },
        { type: 'separator' },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click: () => {
            const wc = activeLayers?.contentView.webContents;
            if (wc) wc.setZoomLevel(wc.getZoomLevel() + 0.5);
          }
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => {
            const wc = activeLayers?.contentView.webContents;
            if (wc) wc.setZoomLevel(wc.getZoomLevel() - 0.5);
          }
        },
        {
          label: 'Reset Zoom',
          accelerator: 'CmdOrCtrl+0',
          click: () => {
            const wc = activeLayers?.contentView.webContents;
            if (wc) wc.setZoomLevel(0);
          }
        },
        { type: 'separator' },
        {
          label: 'Toggle Content DevTools',
          accelerator: 'F12',
          click: () => activeLayers?.contentView.webContents.toggleDevTools()
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  // Handle second instance activation
  app.on('second-instance', (_event, commandLine) => {
    if (activeLayers?.baseWindow) {
      if (activeLayers.baseWindow.isMinimized()) {
        activeLayers.baseWindow.restore();
      }
      activeLayers.baseWindow.focus();
      if (Array.isArray(commandLine) && commandLine.includes('--local')) {
        activeLayers.chromeView.webContents.send('chrome:mode-command', 'local');
      }
    }
  });

  activeLayers.baseWindow.on('closed', () => {
    if (unregisterIpc) {
      unregisterIpc();
      unregisterIpc = null;
    }
    activeLayers = null;
  });
}

app.on('before-quit', () => {
  if (unregisterIpc) {
    unregisterIpc();
    unregisterIpc = null;
  }
});

app.whenReady().then(() => {
  // Sync native theme to dark by default for Linux desktop
  nativeTheme.themeSource = 'dark';
  initializeApp();

  app.on('activate', () => {
    if (!activeLayers) {
      initializeApp();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
