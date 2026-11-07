/**
 * Navigation, Window-Open, Downloads & Permission Handlers for JulesDeck.
 */

import { shell, WebContents, Session } from 'electron';

export const ALLOWED_NAVIGATION_HOSTS = [
  'jules.google.com',
  'accounts.google.com',
  'myaccount.google.com',
  'apis.google.com',
  'ogs.google.com',
  'one.google.com',
  'lh3.googleusercontent.com'
];

export function isAllowedHost(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    if (url.protocol !== 'https:') return false;
    return ALLOWED_NAVIGATION_HOSTS.some(
      (allowed) => url.hostname === allowed || url.hostname.endsWith(`.${allowed}`)
    );
  } catch {
    return false;
  }
}

export function openSafeExternal(urlStr: string): void {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      shell.openExternal(urlStr).catch((err) => {
        console.warn('[NAV:EXTERNAL:ERR] Failed to open external URL:', err);
      });
    } else {
      console.warn(`[NAV:BLOCKED] Blocked non-http(s) external URL protocol: ${parsed.protocol}`);
    }
  } catch {
    console.warn('[NAV:INVALID_URL] Cannot open malformed external URL');
  }
}

export function isOAuthUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    return (
      url.hostname === 'accounts.google.com' ||
      url.hostname === 'myaccount.google.com' ||
      url.hostname === 'ogs.google.com'
    );
  } catch {
    return false;
  }
}

export function configureNavigationHandlers(webContents: WebContents): () => void {
  const onWillNavigate = (event: Electron.Event, navigationUrl: string) => {
    if (!isAllowedHost(navigationUrl)) {
      event.preventDefault();
      openSafeExternal(navigationUrl);
    }
  };

  // Prevent arbitrary navigation away from Jules & OAuth
  webContents.on('will-navigate', onWillNavigate);

  // Handle window.open / target="_blank"
  webContents.setWindowOpenHandler((details) => {
    const targetUrl = details.url;

    // Allow Google sign-in popups within the same session
    if (isOAuthUrl(targetUrl)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 680,
          autoHideMenuBar: true
        }
      };
    }

    // Open external URLs (e.g. GitHub repos, issue trackers, docs) in system browser
    openSafeExternal(targetUrl);

    return { action: 'deny' };
  });

  return () => {
    if (!webContents.isDestroyed()) {
      webContents.removeListener('will-navigate', onWillNavigate);
      webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    }
  };
}

export function configureSessionPermissionsAndDownloads(session: Session): void {
  // Safe permission handling for desktop productivity
  session.setPermissionRequestHandler((_webContents, permission, callback) => {
    const safePermissions = [
      'clipboard-read',
      'clipboard-sanitized-write',
      'notifications'
    ];

    if (safePermissions.includes(permission)) {
      callback(true);
    } else {
      console.log(`[PERMISSIONS] Denied requested permission: ${permission}`);
      callback(false);
    }
  });

  // Handle downloads gracefully
  session.on('will-download', (_event, item) => {
    console.log(`[DOWNLOAD] Starting download: ${item.getFilename()} (${item.getTotalBytes()} bytes)`);

    item.on('updated', (_evt, state) => {
      if (state === 'interrupted') {
        console.warn(`[DOWNLOAD:INTERRUPTED] ${item.getFilename()}`);
      }
    });

    item.once('done', (_evt, state) => {
      if (state === 'completed') {
        console.log(`[DOWNLOAD:COMPLETED] Successfully saved: ${item.getSavePath()}`);
      } else {
        console.warn(`[DOWNLOAD:FAILED] Download failed with state: ${state}`);
      }
    });
  });
}
