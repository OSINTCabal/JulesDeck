import { describe, it, expect, vi } from 'vitest';
import type { BaseWindow, WebContentsView } from 'electron';
import {
  CHROME_STRIP_HEIGHT,
  DEFAULT_WINDOW_STATE,
  updateViewBounds,
  expandChromeView,
  collapseChromeView,
  getAppIconPath,
  AppWindowLayers
} from '../src/main/window.js';

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

describe('Window Architecture & Bounds', () => {
  it('enforces a fixed 44px chrome strip height', () => {
    expect(CHROME_STRIP_HEIGHT).toBe(44);
  });

  it('provides safe default window geometry', () => {
    expect(DEFAULT_WINDOW_STATE.width).toBeGreaterThanOrEqual(800);
    expect(DEFAULT_WINDOW_STATE.height).toBeGreaterThanOrEqual(500);
    expect(DEFAULT_WINDOW_STATE.isMaximized).toBe(false);
  });

  it('computes correct bounds on window resize', () => {
    const mockWin = {
      getContentBounds: (): Bounds => ({ x: 0, y: 0, width: 1400, height: 900 })
    } as unknown as BaseWindow;

    let chromeBounds: Bounds | null = null;
    const mockChromeView = {
      setBounds: (b: Bounds) => {
        chromeBounds = b;
      }
    } as unknown as WebContentsView;

    let contentBounds: Bounds | null = null;
    const mockContentView = {
      setBounds: (b: Bounds) => {
        contentBounds = b;
      }
    } as unknown as WebContentsView;

    updateViewBounds(mockWin, mockChromeView, mockContentView);

    expect(chromeBounds).toEqual({
      x: 0,
      y: 0,
      width: 1400,
      height: 44
    });

    expect(contentBounds).toEqual({
      x: 0,
      y: 44,
      width: 1400,
      height: 856 // 900 - 44
    });
  });

  it('protects against negative content height on extreme small heights', () => {
    const mockWin = {
      getContentBounds: (): Bounds => ({ x: 0, y: 0, width: 500, height: 30 })
    } as unknown as BaseWindow;

    let contentBounds: Bounds | null = null;
    const mockContentView = {
      setBounds: (b: Bounds) => {
        contentBounds = b;
      }
    } as unknown as WebContentsView;
    const mockChromeView = {
      setBounds: vi.fn()
    } as unknown as WebContentsView;

    updateViewBounds(mockWin, mockChromeView, mockContentView);

    expect(contentBounds?.height).toBe(0);
  });

  it('clamps custom chrome drawer height to avoid exceeding window height minus 50px', () => {
    const mockWin = {
      getContentBounds: (): Bounds => ({ x: 0, y: 0, width: 1000, height: 400 })
    } as unknown as BaseWindow;

    let chromeBounds: Bounds | null = null;
    const mockChromeView = {
      setBounds: (b: Bounds) => {
        chromeBounds = b;
      }
    } as unknown as WebContentsView;

    const mockContentView = {
      setBounds: vi.fn()
    } as unknown as WebContentsView;

    // Requested drawer height 500px on a 400px window should clamp to Math.max(44, 400 - 50) = 350px
    updateViewBounds(mockWin, mockChromeView, mockContentView, 500);

    expect(chromeBounds?.height).toBe(350);
  });

  it('clamps drawer height correctly across diverse window geometries', () => {
    let lastChromeBounds: Bounds | null = null;
    let lastContentBounds: Bounds | null = null;

    const mockChrome = {
      setBounds: (b: Bounds) => { lastChromeBounds = b; }
    } as unknown as WebContentsView;
    const mockContent = {
      setBounds: (b: Bounds) => { lastContentBounds = b; }
    } as unknown as WebContentsView;

    // 1. Min standard window (800x500), drawer requested at 460px
    // 500 - 50 = 450px. Clamped to 450px
    const win500 = { getContentBounds: () => ({ x: 0, y: 0, width: 800, height: 500 }) } as unknown as BaseWindow;
    updateViewBounds(win500, mockChrome, mockContent, 460);
    expect(lastChromeBounds?.height).toBe(450);
    expect(lastChromeBounds?.width).toBe(800);
    expect(lastContentBounds?.height).toBe(456); // 500 - 44

    // 2. Extremely constrained window (800x80), drawer requested at 460px
    // 80 - 50 = 30px, but minimum is CHROME_STRIP_HEIGHT (44px)
    const win80 = { getContentBounds: () => ({ x: 0, y: 0, width: 800, height: 80 }) } as unknown as BaseWindow;
    updateViewBounds(win80, mockChrome, mockContent, 460);
    expect(lastChromeBounds?.height).toBe(44);
    expect(lastContentBounds?.height).toBe(36); // 80 - 44

    // 3. Exact strip height boundary (height = 44px)
    const win44 = { getContentBounds: () => ({ x: 0, y: 0, width: 800, height: 44 }) } as unknown as BaseWindow;
    updateViewBounds(win44, mockChrome, mockContent);
    expect(lastChromeBounds?.height).toBe(44);
    expect(lastContentBounds?.height).toBe(0);

    // 4. Large 4K display (3840x2160) with 460px drawer
    const win4k = { getContentBounds: () => ({ x: 0, y: 0, width: 3840, height: 2160 }) } as unknown as BaseWindow;
    updateViewBounds(win4k, mockChrome, mockContent, 460);
    expect(lastChromeBounds?.height).toBe(460);
    expect(lastChromeBounds?.width).toBe(3840);
    expect(lastContentBounds?.width).toBe(3840);
    expect(lastContentBounds?.height).toBe(2116); // 2160 - 44
  });

  it('synchronizes expandChromeView and collapseChromeView on AppWindowLayers', () => {
    let chromeBounds: Bounds | null = null;
    let contentBounds: Bounds | null = null;

    const mockWin = {
      getContentBounds: (): Bounds => ({ x: 0, y: 0, width: 1280, height: 800 })
    } as unknown as BaseWindow;
    const mockChrome = {
      setBounds: (b: Bounds) => { chromeBounds = b; }
    } as unknown as WebContentsView;
    const mockContent = {
      setBounds: (b: Bounds) => { contentBounds = b; }
    } as unknown as WebContentsView;

    const layers: AppWindowLayers = {
      baseWindow: mockWin,
      chromeView: mockChrome,
      contentView: mockContent,
      activeChromeHeight: CHROME_STRIP_HEIGHT
    };

    // Expand to 460px (Local Drawer)
    expandChromeView(layers, 460);
    expect(layers.activeChromeHeight).toBe(460);
    expect(chromeBounds?.height).toBe(460);
    expect(contentBounds?.y).toBe(44);
    expect(contentBounds?.height).toBe(756); // 800 - 44

    // Expand to 320px (App Menu)
    expandChromeView(layers, 320);
    expect(layers.activeChromeHeight).toBe(320);
    expect(chromeBounds?.height).toBe(320);

    // Collapse
    collapseChromeView(layers);
    expect(layers.activeChromeHeight).toBe(44);
    expect(chromeBounds?.height).toBe(44);
    expect(contentBounds?.height).toBe(756);
  });

  it('locates the app icon from build/icons/icon.png', () => {
    const iconPath = getAppIconPath();
    expect(iconPath).toBeDefined();
    expect(iconPath).toContain('build/icons/icon.png');
  });
});
