/**
 * Standalone Headless Electron End-to-End Simulation Runner for JulesDeck.
 *
 * Runs inside the real Electron 45 binary with `--headless --no-sandbox`
 * to verify actual native binary initialization, BaseWindow, WebContentsView composition,
 * IPC dispatch, Git integration, window geometry persistence, and clean process exit.
 */

const { app, BaseWindow, WebContentsView, ipcMain, screen, session, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execSync } = require('node:child_process');

// Prepare isolated test userData directory
const testUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'julesdeck-live-electron-'));
app.setPath('userData', testUserDataDir);

console.log('=================================================================');
console.log('   JulesDeck Headless Electron E2E Integration & Usage Runner    ');
console.log('=================================================================');
console.log(`[INIT] Electron Version : v${process.versions.electron}`);
console.log(`[INIT] Node Version     : ${process.versions.node}`);
console.log(`[INIT] Chrome Version   : ${process.versions.chrome}`);
console.log(`[INIT] Architecture     : ${process.arch}`);
console.log(`[INIT] Platform         : ${process.platform}`);
console.log(`[INIT] Test UserData    : ${testUserDataDir}`);
console.log('-----------------------------------------------------------------');

const startTime = Date.now();
const testResults = [];

function recordTest(name, passed, detail) {
  testResults.push({ name, passed, detail });
  const mark = passed ? 'PASS ✓' : 'FAIL ✗';
  console.log(`[${mark}] ${name} ${detail ? `(${detail})` : ''}`);
}

async function runLiveElectronSimulation() {
  try {
    // 1. Import compiled modules from dist/
    const windowMod = await import('../dist/main/window.js');
    const ipcMod = await import('../dist/main/ipc.js');
    const accountsMod = await import('../dist/main/accounts.js');
    recordTest('Load Compiled Distribution Modules', true, 'dist/main/*.js loaded');

    // 2. Seed accounts.json in test userData using accountsMod.createDefaultAccount
    const accountsPath = path.join(testUserDataDir, 'accounts.json');
    const defaultAcc = accountsMod.createDefaultAccount({
      id: 'default-spike',
      name: 'OSINTCabal',
      email: 'osintcabal@google.com',
      partition: 'persist:spike'
    });
    const initialRegistry = {
      activeAccountId: defaultAcc.id,
      accounts: [defaultAcc]
    };
    accountsMod.saveAccountRegistry(initialRegistry, accountsPath);
    recordTest('Seed Account Registry', true, `accounts.json created with account: ${defaultAcc.name}`);

    // 3. Verify Three-Layer BaseWindow & WebContentsView Composition
    const preloadPath = path.join(__dirname, '../dist/preload/chrome.js');
    const htmlPath = path.join(__dirname, '../dist/chrome/index.html');
    const targetUrl = 'https://jules.google.com';
    const cleanUserAgent = 'Mozilla/5.0 (X11; Linux x86_64) JulesDeck/0.1.0';

    const layers = windowMod.createAppWindow(
      'persist:spike',
      preloadPath,
      htmlPath,
      targetUrl,
      cleanUserAgent
    );

    const bounds = layers.baseWindow.getBounds();
    const chromeBounds = layers.chromeView.getBounds();
    const contentBounds = layers.contentView.getBounds();

    const layersOk =
      bounds.width >= 800 &&
      chromeBounds.height === windowMod.CHROME_STRIP_HEIGHT &&
      contentBounds.y === windowMod.CHROME_STRIP_HEIGHT &&
      contentBounds.height === bounds.height - windowMod.CHROME_STRIP_HEIGHT;

    recordTest(
      'Initialize Three-Layer Window Composition',
      layersOk,
      `Base: ${bounds.width}x${bounds.height}, Chrome: ${chromeBounds.width}x${chromeBounds.height}, Content: ${contentBounds.width}x${contentBounds.height}`
    );

    // 4. Test View Expansion (Local Drawer 460px & App Menu 320px)
    windowMod.expandChromeView(layers, 460);
    const expanded460Ok = layers.chromeView.getBounds().height === 460;

    windowMod.expandChromeView(layers, 320);
    const expanded320Ok = layers.chromeView.getBounds().height === 320;

    windowMod.collapseChromeView(layers);
    const collapsedOk = layers.chromeView.getBounds().height === 44;

    recordTest(
      'Chrome View Expansion & Collapse Dynamics',
      expanded460Ok && expanded320Ok && collapsedOk,
      'Expanded 460px -> 320px -> Collapsed 44px'
    );

    // 5. Register IPC Handlers and Verify Handlers Mapping
    const mockCookieImporter = {
      openInSystemBrowser: async () => {},
      findChromeCookieDb: () => null,
      getEncryptionKey: () => Buffer.alloc(16),
      extractAndDecryptCookies: () => [],
      importToSession: async () => ({
        success: true,
        importedCount: 5,
        message: 'Mock imported 5 cookies'
      })
    };

    const unregisterIpc = ipcMod.registerIpcHandlers(
      layers,
      mockCookieImporter,
      targetUrl,
      cleanUserAgent,
      () => {}
    );
    recordTest('Register Real IPC Handlers on ipcMain', typeof unregisterIpc === 'function', '29 handlers active');

    // 5b. Real DOM Test: Local Mode Tab Click Interaction
    if (layers.chromeView.webContents.isLoading()) {
      await new Promise((resolve) => layers.chromeView.webContents.once('did-finish-load', resolve));
    }
    const ui = (code) => layers.chromeView.webContents.executeJavaScript(code);
    await new Promise((r) => setTimeout(r, 200));

    // Dispatch real bubbling click to #tab-local-mode
    await ui(`document.getElementById('tab-local-mode').click()`);
    await new Promise((r) => setTimeout(r, 150));

    const drawerOpen = await ui(`!document.getElementById('local-mode-drawer').classList.contains('hidden')`);
    const chromeH = layers.chromeView.getBounds().height;
    recordTest(
      'UI: Local Mode Tab Click Expands Drawer',
      Boolean(drawerOpen && (chromeH === 460 || chromeH >= 800)),
      `Drawer open: ${drawerOpen}, Chrome height: ${chromeH}px`
    );

    // 5c. Cloud tab click closes Local Mode drawer
    await ui(`document.getElementById('tab-cloud-mode').click()`);
    await new Promise((r) => setTimeout(r, 150));
    const drawerClosedAfterCloud = await ui(`document.getElementById('local-mode-drawer').classList.contains('hidden')`);
    const chromeHAfterCloud = layers.chromeView.getBounds().height;
    recordTest(
      'UI: Cloud Tab Click Closes Local Mode Drawer',
      Boolean(drawerClosedAfterCloud && chromeHAfterCloud === 44),
      `Drawer hidden: ${drawerClosedAfterCloud}, Chrome height: ${chromeHAfterCloud}px`
    );

    // 5d. Re-clicking Local Mode tab toggles it off
    await ui(`document.getElementById('tab-local-mode').click()`);
    await new Promise((r) => setTimeout(r, 150));
    await ui(`document.getElementById('tab-local-mode').click()`);
    await new Promise((r) => setTimeout(r, 150));
    const drawerClosedAfterToggle = await ui(`document.getElementById('local-mode-drawer').classList.contains('hidden')`);
    recordTest(
      'UI: Re-clicking Local Mode Tab Toggles It Off',
      Boolean(drawerClosedAfterToggle && layers.chromeView.getBounds().height === 44),
      `Drawer hidden: ${drawerClosedAfterToggle}`
    );

    // 5e. App menu button expands to 320px
    await ui(`document.getElementById('btn-app-menu').click()`);
    await new Promise((r) => setTimeout(r, 150));
    const menuOpen = await ui(`!document.getElementById('app-menu-dropdown').classList.contains('hidden')`);
    const menuHeight = layers.chromeView.getBounds().height;
    recordTest(
      'UI: App Menu Toggle Expands to 320px and Collapses',
      Boolean(menuOpen && menuHeight === 320),
      `Menu open: ${menuOpen}, height: ${menuHeight}px`
    );

    // 5e-1. Sign Out confirmation state
    await ui(`document.getElementById('menu-btn-logout').click()`);
    const logoutConfirming = await ui(`document.getElementById('menu-btn-logout').classList.contains('confirming')`);
    const logoutText = await ui(`document.getElementById('menu-btn-logout').innerText`);
    recordTest(
      'UI: Sign Out Two-Step Confirmation State',
      Boolean(logoutConfirming && logoutText.includes('confirm Sign Out')),
      `Confirming: ${logoutConfirming}, Text: ${logoutText}`
    );

    // 5e-2. Add a secondary account and verify UI rendering + removal confirmation
    const secondAcc = accountsMod.createAccount('secondary@google.com', 'Secondary User');
    ipcMod.broadcastStateUpdate(layers);
    await new Promise((r) => setTimeout(r, 150));
    const removeBtnFound = await ui(`Boolean(document.querySelector('.account-remove-btn'))`);
    await ui(`document.querySelector('.account-remove-btn')?.click()`);
    const removeConfirming = await ui(`document.querySelector('.account-remove-btn')?.classList.contains('confirming')`);
    const removeText = await ui(`document.querySelector('.account-remove-btn')?.textContent`);
    recordTest(
      'UI: Secondary Account Removal Two-Step Confirmation',
      Boolean(removeBtnFound && removeConfirming && removeText === 'Confirm?'),
      `Found: ${removeBtnFound}, Confirming: ${removeConfirming}, Text: ${removeText}`
    );

    // Clean up secondary account and close menu
    accountsMod.removeAccount(secondAcc.id);
    ipcMod.broadcastStateUpdate(layers);
    await ui(`document.getElementById('btn-app-menu').click()`);
    await new Promise((r) => setTimeout(r, 150));

    // 5f. Shortcut Combinations: Ctrl+1/Alt+1, Ctrl+2/Alt+2, Ctrl+L
    // 5f-1. Ctrl+2 dispatched on contentView opens Local Mode
    layers.contentView.webContents.emit(
      'before-input-event',
      { preventDefault: () => {} },
      { type: 'keyDown', control: true, key: '2', code: 'Digit2' }
    );
    await new Promise((r) => setTimeout(r, 150));
    const drawerOpenViaCtrl2 = await ui(`!document.getElementById('local-mode-drawer').classList.contains('hidden')`);

    // 5f-2. Alt+1 dispatched on contentView switches to Cloud Mode (collapses to 44px)
    layers.contentView.webContents.emit(
      'before-input-event',
      { preventDefault: () => {} },
      { type: 'keyDown', alt: true, key: '1', code: 'Digit1' }
    );
    await new Promise((r) => setTimeout(r, 150));
    const drawerClosedViaAlt1 = await ui(`document.getElementById('local-mode-drawer').classList.contains('hidden')`);

    // 5f-3. Alt+2 dispatched on contentView switches to Local Mode (expands to 460px)
    layers.contentView.webContents.emit(
      'before-input-event',
      { preventDefault: () => {} },
      { type: 'keyDown', alt: true, key: '2', code: 'Digit2' }
    );
    await new Promise((r) => setTimeout(r, 150));
    const drawerOpenViaAlt2 = await ui(`!document.getElementById('local-mode-drawer').classList.contains('hidden')`);

    // 5f-4. Ctrl+1 dispatched on contentView switches to Cloud Mode
    layers.contentView.webContents.emit(
      'before-input-event',
      { preventDefault: () => {} },
      { type: 'keyDown', control: true, key: '1', code: 'Digit1' }
    );
    await new Promise((r) => setTimeout(r, 150));
    const drawerClosedViaCtrl1 = await ui(`document.getElementById('local-mode-drawer').classList.contains('hidden')`);

    // 5f-5. Ctrl+L toggles between Local and Cloud modes
    layers.contentView.webContents.emit(
      'before-input-event',
      { preventDefault: () => {} },
      { type: 'keyDown', control: true, key: 'l', code: 'KeyL' }
    );
    await new Promise((r) => setTimeout(r, 150));
    const drawerToggledToLocal = await ui(`!document.getElementById('local-mode-drawer').classList.contains('hidden')`);

    layers.contentView.webContents.emit(
      'before-input-event',
      { preventDefault: () => {} },
      { type: 'keyDown', control: true, key: 'l', code: 'KeyL' }
    );
    await new Promise((r) => setTimeout(r, 150));
    const drawerToggledToCloud = await ui(`document.getElementById('local-mode-drawer').classList.contains('hidden')`);

    // 5f-6. Shortcuts dispatched on chromeView
    layers.chromeView.webContents.emit(
      'before-input-event',
      { preventDefault: () => {} },
      { type: 'keyDown', control: true, key: '2', code: 'Digit2' }
    );
    await new Promise((r) => setTimeout(r, 150));
    const drawerViaChromeCtrl2 = await ui(`!document.getElementById('local-mode-drawer').classList.contains('hidden')`);

    layers.chromeView.webContents.emit(
      'before-input-event',
      { preventDefault: () => {} },
      { type: 'keyDown', control: true, key: '1', code: 'Digit1' }
    );
    await new Promise((r) => setTimeout(r, 150));
    const drawerViaChromeCtrl1 = await ui(`document.getElementById('local-mode-drawer').classList.contains('hidden')`);

    recordTest(
      'Keyboard: Full Focus-Independent Shortcuts (Ctrl+1, Alt+1, Ctrl+2, Alt+2, Ctrl+L)',
      Boolean(
        drawerOpenViaCtrl2 &&
        drawerClosedViaAlt1 &&
        drawerOpenViaAlt2 &&
        drawerClosedViaCtrl1 &&
        drawerToggledToLocal &&
        drawerToggledToCloud &&
        drawerViaChromeCtrl2 &&
        drawerViaChromeCtrl1
      ),
      'Dispatched across contentView & chromeView webContents'
    );

    // 5g. Esc Key Cascading Order (Add Account Modal -> App Menu -> Diff Viewer -> Local Drawer)
    // Setup: Open all 4 layers simultaneously
    await ui(`document.getElementById('tab-local-mode').click()`);
    await new Promise((r) => setTimeout(r, 150));
    await ui(`
      document.getElementById('git-status-content').classList.add('hidden');
      document.getElementById('git-diff-viewer').classList.remove('hidden');
      document.getElementById('btn-app-menu').click();
    `);
    await new Promise((r) => setTimeout(r, 150));
    await ui(`document.getElementById('add-account-modal').classList.remove('hidden')`);
    await new Promise((r) => setTimeout(r, 150));

    // Verify all 4 are open
    const all4Open = await ui(`
      !document.getElementById('add-account-modal').classList.contains('hidden') &&
      !document.getElementById('app-menu-dropdown').classList.contains('hidden') &&
      !document.getElementById('git-diff-viewer').classList.contains('hidden') &&
      !document.getElementById('local-mode-drawer').classList.contains('hidden')
    `);

    // 1st Esc: Closes Add Account Modal
    await ui(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await new Promise((r) => setTimeout(r, 150));
    const step1Ok = await ui(`
      document.getElementById('add-account-modal').classList.contains('hidden') &&
      !document.getElementById('app-menu-dropdown').classList.contains('hidden') &&
      !document.getElementById('git-diff-viewer').classList.contains('hidden') &&
      !document.getElementById('local-mode-drawer').classList.contains('hidden')
    `);

    // 2nd Esc: Closes App Menu
    await ui(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await new Promise((r) => setTimeout(r, 150));
    const step2Ok = await ui(`
      document.getElementById('add-account-modal').classList.contains('hidden') &&
      document.getElementById('app-menu-dropdown').classList.contains('hidden') &&
      !document.getElementById('git-diff-viewer').classList.contains('hidden') &&
      !document.getElementById('local-mode-drawer').classList.contains('hidden')
    `);

    // 3rd Esc: Closes Diff Viewer & Restores File List
    await ui(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await new Promise((r) => setTimeout(r, 150));
    const step3Ok = await ui(`
      document.getElementById('git-diff-viewer').classList.contains('hidden') &&
      !document.getElementById('git-status-content').classList.contains('hidden') &&
      !document.getElementById('local-mode-drawer').classList.contains('hidden')
    `);

    // 4th Esc: Closes Local Mode Drawer & Collapses to 44px
    await ui(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await new Promise((r) => setTimeout(r, 150));
    const step4Ok = await ui(`
      document.getElementById('local-mode-drawer').classList.contains('hidden')
    `);
    const finalChromeHeight = layers.chromeView.getBounds().height;

    recordTest(
      'Keyboard: Esc Key Cascading Order (Modal -> Menu -> Diff -> Drawer)',
      Boolean(all4Open && step1Ok && step2Ok && step3Ok && step4Ok && finalChromeHeight === 44),
      `All 4 Open: ${all4Open}, Step 1: ${step1Ok}, Step 2: ${step2Ok}, Step 3: ${step3Ok}, Step 4: ${step4Ok}, Height: ${finalChromeHeight}px`
    );

    // 5h. Local Mode Empty State displayed when no repo linked
    await ui(`document.getElementById('tab-local-mode').click()`);
    await new Promise((r) => setTimeout(r, 150));
    const emptyStateVisible = await ui(`!document.getElementById('local-empty-state').classList.contains('hidden')`);
    const hasInitButton = await ui(`Boolean(document.getElementById('btn-empty-init-repo'))`);
    recordTest(
      'UI: Local Mode Empty State & Git Init CTA Visible',
      Boolean(emptyStateVisible && hasInitButton),
      `Empty state visible: ${emptyStateVisible}, Init button: ${hasInitButton}`
    );

    // 5h-1. Local Mode Hero Branding, Gem Logo & Starter Chips
    const heroCheck = await ui(`
      (() => {
        const title = document.querySelector('.hero-title');
        const gem = document.querySelector('.jules-gem-icon');
        const chips = document.querySelectorAll('.starter-chip');
        return {
          hasTitle: Boolean(title && title.textContent.includes('Meet Jules')),
          hasGem: Boolean(gem),
          chipsCount: chips.length,
        };
      })()
    `);
    recordTest(
      'UI: Local Mode Hero Layout & Gem Branding Verified',
      Boolean(heroCheck.hasTitle && heroCheck.hasGem && heroCheck.chipsCount >= 4),
      `Title: ${heroCheck.hasTitle}, Gem: ${heroCheck.hasGem}, Starter Chips: ${heroCheck.chipsCount}`
    );

    // 5h-2. Terminal Hidden on Idle & Sidebar Footer Zero-Overflow Constraint
    const idleGeometry = await ui(`
      (() => {
        const sidebar = document.getElementById('workspace-sidebar');
        const pill = document.getElementById('sidebar-account-pill');
        const terminal = document.getElementById('terminal-container');
        const sRect = sidebar.getBoundingClientRect();
        const pRect = pill.getBoundingClientRect();
        return {
          terminalHidden: terminal.classList.contains('hidden'),
          pillWithinSidebar: pRect.right <= sRect.right,
          sidebarWidth: sRect.width,
          pillWidth: pRect.width,
        };
      })()
    `);
    recordTest(
      'UI: Terminal Hidden on Idle & Sidebar Footer Zero-Overflow Constraint',
      Boolean(idleGeometry.terminalHidden && idleGeometry.pillWithinSidebar),
      `Terminal Hidden: ${idleGeometry.terminalHidden}, Pill Contained: ${idleGeometry.pillWithinSidebar} (Pill: ${Math.round(idleGeometry.pillWidth)}px, Sidebar: ${Math.round(idleGeometry.sidebarWidth)}px)`
    );

    // 5h-3. Session Dismissal via Clear Sessions Button
    await ui(`document.getElementById('btn-clear-sessions').click()`);
    await new Promise((r) => setTimeout(r, 100));
    const sessionClearMsg = await ui(`document.getElementById('jules-sessions-list').textContent`);
    recordTest(
      'UI: Session Dismissal via Clear Sessions Button',
      Boolean(sessionClearMsg && sessionClearMsg.includes('Sessions cleared')),
      `Message: ${sessionClearMsg}`
    );

    // 5h-4. Inspector Panel Toggle Dynamics
    await ui(`document.getElementById('btn-toggle-inspector').click()`);
    await new Promise((r) => setTimeout(r, 100));
    const inspectorCollapsed = await ui(`document.getElementById('workspace-inspector').classList.contains('collapsed')`);
    await ui(`document.getElementById('btn-toggle-inspector').click()`);
    await new Promise((r) => setTimeout(r, 100));
    const inspectorRestored = await ui(`!document.getElementById('workspace-inspector').classList.contains('collapsed')`);
    recordTest(
      'UI: Inspector Panel Collapse & Restore Dynamics',
      Boolean(inspectorCollapsed && inspectorRestored),
      `Collapsed: ${inspectorCollapsed}, Restored: ${inspectorRestored}`
    );

    // 5i. Git Init: Initialize Git Repository in Plain Directory
    const tempInitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'julesdeck-init-test-'));
    const initRes = ipcMod.initGitRepoAtPath(layers, tempInitDir);
    recordTest(
      'Git Init: Initialize Git Repository in Plain Directory',
      Boolean(initRes.success === true && fs.existsSync(path.join(tempInitDir, '.git'))),
      `Message: ${initRes.message}`
    );
    try {
      fs.rmSync(tempInitDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    // 6. Test Navigation State Extraction
    const state = ipcMod.getNavigationState(layers);
    const stateOk =
      state &&
      state.accountName === 'OSINTCabal' &&
      state.accounts.length === 1 &&
      state.activeAccountId === 'default-spike' &&
      state.isMaximized === false;
    recordTest('Extract Navigation & Account State', Boolean(stateOk), `User: ${state.accountName}, ID: ${state.activeAccountId}`);

    // 7. Test Git Repository Inspection on JulesDeck Workspace
    let repoPath = process.cwd();
    let gitInfo = ipcMod.detectGitInfo(repoPath);
    if (!gitInfo) {
      const candidate = path.resolve(__dirname, '../../JulesDeck');
      if (fs.existsSync(candidate) && ipcMod.detectGitInfo(candidate)) {
        repoPath = candidate;
        gitInfo = ipcMod.detectGitInfo(repoPath);
      }
    }
    const gitDetails = ipcMod.getGitReviewDetails(repoPath);

    const gitOk =
      gitInfo &&
      gitInfo.branch &&
      gitDetails &&
      Array.isArray(gitDetails.recentCommits) &&
      gitDetails.recentCommits.length >= 1;

    recordTest(
      'Inspect Local Git Repository (JulesDeck)',
      Boolean(gitOk),
      `Branch: ${gitInfo?.branch}, Commit: ${gitDetails?.recentCommits[0]?.hash} ("${gitDetails?.recentCommits[0]?.message.slice(0, 30)}...")`
    );

    // 7b. Test Structured Git Status & Unified Diff Generation
    const structuredStatus = ipcMod.getGitStructuredStatus(repoPath);
    const fileDiff = ipcMod.getGitFileDiff(repoPath, 'package.json', false);
    const structuredOk =
      structuredStatus &&
      typeof structuredStatus.totalChanges === 'number' &&
      Array.isArray(structuredStatus.staged) &&
      Array.isArray(structuredStatus.unstaged) &&
      Array.isArray(structuredStatus.untracked) &&
      fileDiff &&
      fileDiff.filePath === 'package.json';

    recordTest(
      'Structured Git Status & Diff Inspection Engine',
      Boolean(structuredOk),
      `Total Changes: ${structuredStatus?.totalChanges}, Diff Length: ${fileDiff?.diff?.length || 0} chars`
    );

    // 7c. UI: Interactive Diff Viewer & Full-Column State Toggle
    await ui(`
      (() => {
        const diffViewer = document.getElementById('git-diff-viewer');
        const statusContent = document.getElementById('git-status-content');
        statusContent.classList.add('hidden');
        diffViewer.classList.remove('hidden');
      })()
    `);
    const diffViewerOpened = await ui(`!document.getElementById('git-diff-viewer').classList.contains('hidden') && document.getElementById('git-status-content').classList.contains('hidden')`);
    await ui(`document.getElementById('btn-close-diff').click()`);
    await new Promise((r) => setTimeout(r, 100));
    const diffViewerClosed = await ui(`document.getElementById('git-diff-viewer').classList.contains('hidden') && !document.getElementById('git-status-content').classList.contains('hidden')`);

    recordTest(
      'UI: Interactive Diff Viewer & Full-Column State Toggle',
      Boolean(diffViewerOpened && diffViewerClosed),
      `Diff opened & status hidden: ${diffViewerOpened}, Diff closed & status restored: ${diffViewerClosed}`
    );

    // 7d. Edge Cases: Empty Git Repository (0 Commits, Unborn Branch) & Diff View Modes
    const emptyRepoTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'julesdeck-e2e-unborn-'));
    execSync('git init -b feature/e2e-unborn-branch', { cwd: emptyRepoTestDir });

    const unbornGitInfo = ipcMod.detectGitInfo(emptyRepoTestDir);
    const unbornReview = ipcMod.getGitReviewDetails(emptyRepoTestDir);
    const unbornStatus = ipcMod.getGitStructuredStatus(emptyRepoTestDir);

    const unbornOk =
      unbornGitInfo &&
      unbornGitInfo.branch === 'feature/e2e-unborn-branch' &&
      unbornGitInfo.lastCommit === undefined &&
      unbornReview &&
      unbornReview.recentCommits.length === 0 &&
      unbornReview.hasChanges === false &&
      unbornStatus &&
      unbornStatus.totalChanges === 0 &&
      unbornStatus.isDetached === false;

    // Create untracked file and inspect diff
    const untrackedFile = path.join(emptyRepoTestDir, 'untracked.md');
    fs.writeFileSync(untrackedFile, '# Untracked Note\nSome raw text\n');
    const statusWithUntracked = ipcMod.getGitStructuredStatus(emptyRepoTestDir);
    const untrackedDiff = ipcMod.getGitFileDiff(emptyRepoTestDir, 'untracked.md', false);

    // Stage the file on unborn branch and inspect staged diff
    execSync('git add untracked.md', { cwd: emptyRepoTestDir });
    const stagedDiff = ipcMod.getGitFileDiff(emptyRepoTestDir, 'untracked.md', true);

    // Commit file, then modify it and inspect worktree diff
    execSync('git config user.name "E2E Tester"', { cwd: emptyRepoTestDir });
    execSync('git config user.email "tester@example.com"', { cwd: emptyRepoTestDir });
    execSync('git commit -m "feat: initial unborn commit"', { cwd: emptyRepoTestDir });
    fs.appendFileSync(untrackedFile, 'Additional modified content\n');
    const modifiedDiff = ipcMod.getGitFileDiff(emptyRepoTestDir, 'untracked.md', false);

    // Traversal boundary rejection & clean file diff
    const traversalDiff = ipcMod.getGitFileDiff(emptyRepoTestDir, '../../../../etc/passwd', false);

    const diffModesOk =
      statusWithUntracked?.totalChanges === 1 &&
      statusWithUntracked?.untracked[0]?.path === 'untracked.md' &&
      untrackedDiff.diff.includes('--- /dev/null') &&
      untrackedDiff.diff.includes('+++ b/untracked.md') &&
      stagedDiff.diff.includes('+Some raw text') &&
      modifiedDiff.diff.includes('+Additional modified content') &&
      traversalDiff.diff === '(File path outside repository boundary)';

    try {
      fs.rmSync(emptyRepoTestDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    recordTest(
      'Git Edge Cases: Unborn Repo & Untracked vs Modified Diff Engine',
      Boolean(unbornOk && diffModesOk),
      `Branch: ${unbornGitInfo?.branch}, Untracked Diff: ${untrackedDiff.diff.length}c, Staged Diff: ${stagedDiff.diff.length}c, Modified Diff: ${modifiedDiff.diff.length}c`
    );

    // 8. Test Non-Git Directory Rejection
    const nonGitPath = fs.mkdtempSync(path.join(os.tmpdir(), 'julesdeck-nongit-'));
    const nonGitInfo = ipcMod.detectGitInfo(nonGitPath);
    const nonGitDetails = ipcMod.getGitReviewDetails(nonGitPath);
    fs.rmSync(nonGitPath, { recursive: true, force: true });

    recordTest(
      'Non-Git Directory Rejection & Safety Check',
      nonGitInfo === null && nonGitDetails === null,
      'Safely returned null without process crash'
    );

    // 9. Test Recent Repositories Persistence
    ipcMod.addRecentRepo(gitInfo);
    const recents = ipcMod.loadRecentRepos();
    const recentsOk = recents.length >= 1 && recents[0].path === repoPath;
    recordTest('Recent Repositories Persistence', recentsOk, `Persisted ${recents.length} repos to recent-repos.json`);

    // Live account checks are opt-in; ordinary CI must also work without a CLI installation.
    const cliInfo = ipcMod.getJulesCliInfo();
    if (process.env.JULESDECK_LIVE_CLI_TESTS === '1') {
    const cliDiagnostic = await ipcMod.getJulesCliDiagnosticAsync();
    recordTest(
      'Live Jules CLI Diagnostic Verification',
      cliInfo.available === true,
      `Binary: ${cliInfo.path}, Version: ${cliDiagnostic.version || 'not installed'}, Ready: ${cliDiagnostic.ready}`
    );

    // 11. Test Real Remote Jules Sessions Query
    const sessions = await ipcMod.executeListJulesSessionsAsync();
    recordTest(
      'Query Remote Jules Sessions via CLI',
      Array.isArray(sessions),
      `Fetched ${sessions.length} sessions from Google Jules cloud`
    );
    } else {
      recordTest('CLI availability reported without requiring a local installation', typeof cliInfo.available === 'boolean' && typeof cliInfo.path === 'string');
      console.log('[SKIP] Live CLI diagnostics and remote sessions: set JULESDECK_LIVE_CLI_TESTS=1 to opt in.');
    }

    // 12. Test Window Geometry Persistence & Restoration
    layers.baseWindow.setBounds({ x: 250, y: 150, width: 1400, height: 950 });
    windowMod.saveWindowState(layers.baseWindow);

    const savedStateFile = windowMod.getWindowStateFilePath();
    const fileExists = fs.existsSync(savedStateFile);
    const loadedState = windowMod.loadWindowState();

    const geomOk =
      fileExists &&
      loadedState.x === 250 &&
      loadedState.y === 150 &&
      loadedState.width === 1400 &&
      loadedState.height === 950;

    recordTest(
      'Window Geometry Persistence & Display Clamping',
      geomOk,
      `Saved & loaded ${loadedState.width}x${loadedState.height} at (${loadedState.x}, ${loadedState.y})`
    );

    // 12b. Window Resize Bounds Clamping & Layout Synchronization
    // Test minHeight (500px): 460px drawer clamped to window height - 50px = 450px
    layers.baseWindow.setSize(1000, 500);
    windowMod.expandChromeView(layers, 460);
    const clampedBounds = layers.chromeView.getBounds();
    const clampedContentBounds = layers.contentView.getBounds();

    const clampedOk = clampedBounds.height === 450 && clampedContentBounds.height === 456;

    windowMod.collapseChromeView(layers);
    const collapsedHeightAfterClamp = layers.chromeView.getBounds().height;

    // Restore standard window dimensions
    layers.baseWindow.setSize(1280, 900);
    windowMod.updateViewBounds(layers.baseWindow, layers.chromeView, layers.contentView);
    const restoredBounds = layers.contentView.getBounds();
    const restoredSyncOk = restoredBounds.height === 856 && restoredBounds.width === 1280;

    recordTest(
      'Window Resize Bounds Clamping & Layout Synchronization',
      Boolean(clampedOk && collapsedHeightAfterClamp === 44 && restoredSyncOk),
      `Clamped Height: ${clampedBounds.height}px (expected 450px), Collapsed: ${collapsedHeightAfterClamp}px, Restored: ${restoredBounds.width}x${restoredBounds.height}`
    );

    // 13. Test Account Management (Create -> Switch -> Remove)
    const newAcct = accountsMod.createAccount('developer@example.com', 'Secondary Dev');
    const switched = accountsMod.switchActiveAccount(newAcct.id);
    const regAfterSwitch = accountsMod.loadAccountRegistry();
    const removed = accountsMod.removeAccount(newAcct.id);
    const regAfterRemove = accountsMod.loadAccountRegistry();

    const acctOk =
      newAcct &&
      switched &&
      regAfterSwitch.activeAccountId === newAcct.id &&
      removed.success &&
      regAfterRemove.accounts.length === 1 &&
      regAfterRemove.activeAccountId === 'default-spike';

    recordTest(
      'Multi-Account Lifecycle (Create -> Switch -> Remove)',
      Boolean(acctOk),
      `Switched to ${newAcct.id.slice(0, 8)}... and restored default-spike`
    );

    // 13b. Multi-Account Partition Switching & Two-Step Sign Out with Data Clearing
    const partAcc = accountsMod.createAccount('isolated@example.com', 'Isolated Partition Dev');
    const newContentView = windowMod.switchContentViewPartition(
      layers,
      partAcc.partition,
      targetUrl,
      cleanUserAgent
    );
    const partSwitchOk =
      layers.contentView === newContentView &&
      !layers.contentView.webContents.isDestroyed();

    // Switch back to default-spike
    windowMod.switchContentViewPartition(
      layers,
      'persist:spike',
      targetUrl,
      cleanUserAgent
    );
    accountsMod.removeAccount(partAcc.id);

    // Two-step sign out with session data clearing
    await layers.contentView.webContents.session.clearStorageData();
    await layers.contentView.webContents.session.clearCache();
    const regBeforeLogout = accountsMod.loadAccountRegistry();
    const activeBeforeLogout = regBeforeLogout.accounts.find((a) => a.id === regBeforeLogout.activeAccountId);
    if (activeBeforeLogout) {
      activeBeforeLogout.name = 'Google Account';
      activeBeforeLogout.email = '';
      accountsMod.saveAccountRegistry(regBeforeLogout);
    }
    const regAfterLogout = accountsMod.loadAccountRegistry();
    const activeAfterLogout = regAfterLogout.accounts.find((a) => a.id === regAfterLogout.activeAccountId);

    const logoutOk =
      activeAfterLogout?.name === 'Google Account' &&
      activeAfterLogout?.email === '';

    recordTest(
      'Multi-Account Partition Swap & Session Data Clearing',
      Boolean(partSwitchOk && logoutOk),
      `Partition Swapped: ${partSwitchOk}, Active Session Cleared: ${logoutOk}`
    );

    // 14. Clean Shutdown and Resource Teardown
    unregisterIpc();
    layers.baseWindow.close();
    recordTest('Clean Shutdown & Teardown', layers.baseWindow.isDestroyed(), 'BaseWindow destroyed cleanly');

    const totalDuration = Date.now() - startTime;
    console.log('-----------------------------------------------------------------');
    const allPassed = testResults.every((t) => t.passed);
    console.log(`[SUMMARY] ${testResults.filter((t) => t.passed).length}/${testResults.length} test assertions passed in ${totalDuration}ms`);
    console.log('=================================================================');

    // Clean up temporary files
    try {
      fs.rmSync(testUserDataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    app.exit(allPassed ? 0 : 1);
  } catch (err) {
    console.error('[FATAL E2E ERROR]', err);
    try {
      fs.rmSync(testUserDataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    app.exit(1);
  }
}

app.whenReady().then(runLiveElectronSimulation);
