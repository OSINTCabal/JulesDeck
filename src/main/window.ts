/**
 * Three-layer Window Composition & State Persistence for JulesDeck.
 *
 * BaseWindow (frameless)
 * ├── contentView (WebContentsView, remote Jules)   — fills the rest
 * └── chromeView  (WebContentsView, local app HTML) — 44px fixed height (expandable for drawers)
 */

import fs from 'node:fs';
import path from 'node:path';
import { app, BaseWindow, WebContentsView, screen } from 'electron';
import { WindowState } from '../shared/types.js';

export const CHROME_STRIP_HEIGHT = 44;

export const DEFAULT_WINDOW_STATE: WindowState = {
  width: 1280,
  height: 900,
  isMaximized: false
};

export function getWindowStateFilePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json');
}

export function loadWindowState(): WindowState {
  try {
    const filePath = getWindowStateFilePath();
    if (!fs.existsSync(filePath)) {
      return { ...DEFAULT_WINDOW_STATE };
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    const width = typeof data.width === 'number' && data.width >= 400 ? data.width : DEFAULT_WINDOW_STATE.width;
    const height = typeof data.height === 'number' && data.height >= 300 ? data.height : DEFAULT_WINDOW_STATE.height;
    const isMaximized = Boolean(data.isMaximized);

    // Verify bounds against current displays
    if (typeof data.x === 'number' && typeof data.y === 'number') {
      const displays = screen.getAllDisplays();
      const isVisibleOnAnyDisplay = displays.some((d) => {
        const b = d.bounds;
        return (
          data.x >= b.x &&
          data.x < b.x + b.width &&
          data.y >= b.y &&
          data.y < b.y + b.height
        );
      });

      if (isVisibleOnAnyDisplay) {
        return { x: data.x, y: data.y, width, height, isMaximized };
      }
    }

    return { width, height, isMaximized };
  } catch {
    return { ...DEFAULT_WINDOW_STATE };
  }
}

export function saveWindowState(win: BaseWindow): void {
  try {
    const isMaximized = win.isMaximized();
    const winWithNormal = win as unknown as {
      getNormalBounds?: () => Electron.Rectangle;
      _lastExplicitBounds?: Electron.Rectangle;
    };
    const bounds =
      isMaximized && typeof winWithNormal.getNormalBounds === 'function'
        ? winWithNormal.getNormalBounds()
        : winWithNormal._lastExplicitBounds ?? win.getBounds();
    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized
    };

    const filePath = getWindowStateFilePath();
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.warn('[WINDOW:STATE:WARN] Failed to persist window state:', err);
  }
}

export function updateViewBounds(
  win: BaseWindow,
  chromeView: WebContentsView,
  contentView: WebContentsView,
  chromeCustomHeight?: number
): void {
  const winExt = win as unknown as { _lastExplicitBounds?: Electron.Rectangle };
  const contentBounds = win.getContentBounds();
  const width = winExt._lastExplicitBounds?.width ?? contentBounds.width;
  const height = winExt._lastExplicitBounds?.height ?? contentBounds.height;
  const rawChromeHeight = chromeCustomHeight ?? CHROME_STRIP_HEIGHT;

  let chromeHeight: number;
  if (rawChromeHeight === CHROME_STRIP_HEIGHT) {
    chromeHeight = CHROME_STRIP_HEIGHT;
  } else if (rawChromeHeight === -1 || rawChromeHeight === height) {
    // Full viewport mode for complete Local Mode clone
    chromeHeight = height;
  } else {
    // Safety clamping: expanded chrome drawer cannot exceed window height minus 50px
    chromeHeight = Math.max(CHROME_STRIP_HEIGHT, Math.min(rawChromeHeight, Math.max(CHROME_STRIP_HEIGHT, height - 50)));
  }

  const contentHeight = Math.max(0, height - CHROME_STRIP_HEIGHT);

  chromeView.setBounds({ x: 0, y: 0, width, height: chromeHeight });
  contentView.setBounds({ x: 0, y: CHROME_STRIP_HEIGHT, width, height: contentHeight });
}

export function expandChromeView(layers: AppWindowLayers, height: number): void {
  layers.activeChromeHeight = height;
  updateViewBounds(layers.baseWindow, layers.chromeView, layers.contentView, height);
}

export function collapseChromeView(layers: AppWindowLayers): void {
  layers.activeChromeHeight = CHROME_STRIP_HEIGHT;
  updateViewBounds(layers.baseWindow, layers.chromeView, layers.contentView, CHROME_STRIP_HEIGHT);
}

export interface AppWindowLayers {
  baseWindow: BaseWindow;
  chromeView: WebContentsView;
  contentView: WebContentsView;
  activeChromeHeight?: number;
}

export function getAppIconPath(): string | undefined {
  const possiblePaths = [
    path.join(__dirname, '../../build/icons/icon.png'),
    path.join(__dirname, '../../build/icons/512x512.png'),
    path.join(process.cwd(), 'build/icons/icon.png')
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

export function createAppWindow(
  partition: string,
  preloadChromePath: string,
  chromeHtmlPath: string,
  targetUrl: string,
  cleanUserAgent: string
): AppWindowLayers {
  const state = loadWindowState();
  const iconPath = getAppIconPath();

  const baseWindow = new BaseWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#121212', // authentic dark surface matching Jules theme
    minWidth: 800,
    minHeight: 500,
    show: false,
    title: 'JulesDeck',
    icon: iconPath
  });

  const winExt = baseWindow as unknown as {
    _lastExplicitBounds?: Electron.Rectangle;
  };
  const origSetBounds = baseWindow.setBounds.bind(baseWindow);
  baseWindow.setBounds = (bounds: Partial<Electron.Rectangle>, animate?: boolean) => {
    const current = winExt._lastExplicitBounds ?? baseWindow.getBounds();
    winExt._lastExplicitBounds = {
      x: bounds.x ?? current.x,
      y: bounds.y ?? current.y,
      width: bounds.width ?? current.width,
      height: bounds.height ?? current.height
    };
    origSetBounds(bounds, animate);
  };
  const origSetSize = baseWindow.setSize.bind(baseWindow);
  baseWindow.setSize = (width: number, height: number, animate?: boolean) => {
    const current = winExt._lastExplicitBounds ?? baseWindow.getBounds();
    winExt._lastExplicitBounds = {
      ...current,
      width,
      height
    };
    origSetSize(width, height, animate);
  };

  const chromeView = new WebContentsView({
    webPreferences: {
      preload: preloadChromePath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const contentView = new WebContentsView({
    webPreferences: {
      partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Layering order: add contentView first, then chromeView on top
  baseWindow.contentView.addChildView(contentView);
  baseWindow.contentView.addChildView(chromeView);

  const layers: AppWindowLayers = {
    baseWindow,
    chromeView,
    contentView,
    activeChromeHeight: CHROME_STRIP_HEIGHT
  };

  updateViewBounds(baseWindow, chromeView, contentView);

  // Resize listeners
  const resizeHandler = () =>
    updateViewBounds(baseWindow, chromeView, layers.contentView, layers.activeChromeHeight);
  baseWindow.on('resize', resizeHandler);
  baseWindow.on('maximize', resizeHandler);
  baseWindow.on('unmaximize', resizeHandler);
  baseWindow.on('enter-full-screen', resizeHandler);
  baseWindow.on('leave-full-screen', resizeHandler);

  // Persistence listeners
  baseWindow.on('close', () => saveWindowState(baseWindow));

  // Configure views
  contentView.webContents.setUserAgent(cleanUserAgent);

  // Defense-in-depth: chromeView should never navigate away or open new windows
  chromeView.webContents.on('will-navigate', (e) => e.preventDefault());
  chromeView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  chromeView.webContents.loadFile(chromeHtmlPath);
  contentView.webContents.loadURL(targetUrl);

  if (state.isMaximized) {
    baseWindow.maximize();
  }
  baseWindow.show();

  return layers;
}

/**
 * Swaps contentView partition on account switch without destroying chromeView.
 */
export function switchContentViewPartition(
  layers: AppWindowLayers,
  newPartition: string,
  targetUrl: string,
  cleanUserAgent: string
): WebContentsView {
  const activeHeight = layers.activeChromeHeight ?? CHROME_STRIP_HEIGHT;

  // Remove old view
  layers.baseWindow.contentView.removeChildView(layers.contentView);

  if (!layers.contentView.webContents.isDestroyed()) {
    layers.contentView.webContents.close();
  }

  // Create new view
  const newContentView = new WebContentsView({
    webPreferences: {
      partition: newPartition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Keep contentView underneath chromeView
  layers.baseWindow.contentView.removeChildView(layers.chromeView);
  layers.baseWindow.contentView.addChildView(newContentView);
  layers.baseWindow.contentView.addChildView(layers.chromeView);

  layers.contentView = newContentView;

  updateViewBounds(layers.baseWindow, layers.chromeView, newContentView, activeHeight);

  newContentView.webContents.setUserAgent(cleanUserAgent);
  newContentView.webContents.loadURL(targetUrl);

  return newContentView;
}
