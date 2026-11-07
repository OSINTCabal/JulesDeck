/**
 * Captures screenshot of Jules Local in Headless Electron.
 */
const { app, BaseWindow, WebContentsView } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const screenshotPath = process.env.JULESDECK_SCREENSHOT_OUT || path.join(__dirname, '..', 'docs', 'screenshots', 'local-home.png');
const testUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'julesdeck-screenshot-'));
app.setPath('userData', testUserDataDir);

app.whenReady().then(async () => {
  try {
    const windowMod = await import('../dist/main/window.js');
    const ipcMod = await import('../dist/main/ipc.js');
    const accountsMod = await import('../dist/main/accounts.js');

    const accountsPath = path.join(testUserDataDir, 'accounts.json');
    const defaultAcc = accountsMod.createDefaultAccount({
      id: 'default-spike',
      name: 'OSINTCabal',
      email: 'osintcabal@google.com',
      partition: 'persist:spike'
    });
    accountsMod.saveAccountRegistry({ activeAccountId: defaultAcc.id, accounts: [defaultAcc] }, accountsPath);

    const preloadPath = path.join(__dirname, '../dist/preload/chrome.js');
    const htmlPath = path.join(__dirname, '../dist/chrome/index.html');
    const targetUrl = 'https://jules.google.com';
    const cleanUserAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

    const layers = windowMod.createAppWindow(
      'persist:spike',
      preloadPath,
      htmlPath,
      targetUrl,
      cleanUserAgent
    );

    ipcMod.registerIpcHandlers(layers);

    await new Promise((r) => setTimeout(r, 600));

    // Click tab-local-mode to open Jules Local
    await layers.chromeView.webContents.executeJavaScript(`
      document.getElementById('tab-local-mode').click();
    `);

    // Wait for animation & rendering
    await new Promise((r) => setTimeout(r, 800));

    // Capture screenshot of chromeView
    const image = await layers.chromeView.webContents.capturePage();
    const outDir = path.dirname(screenshotPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(screenshotPath, image.toPNG());
    console.log(`[SCREENSHOT] Saved to: ${screenshotPath}`);

    layers.baseWindow.destroy();
    app.quit();
  } catch (err) {
    console.error('Failed to capture screenshot:', err);
    app.exit(1);
  }
});
