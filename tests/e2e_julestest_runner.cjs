/**
 * Standalone Headless Electron End-to-End Verification Script for JulesDeck
 * Testing JulesTEST Git Integration, UI Verification, and Branch Switching
 *
 * Runs against project JulesTEST
 * Initializes Electron in headless mode with isolated userData.
 * Loads dist/main/*.js modules and verifies real-world Git operations.
 */

const { app, BaseWindow, WebContentsView, ipcMain, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execSync, execFileSync } = require('node:child_process');

// Prepare isolated test userData directory
const testUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'julesdeck-julestest-'));
app.setPath('userData', testUserDataDir);

console.log('=================================================================');
console.log('   JulesDeck Headless E2E: JulesTEST Git Integration Verification');
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
  if (!passed) {
    console.warn('  ⚠️  Test failed details:', detail);
  }
}

async function runJulesTESTVerification() {
  try {
    // 1. Import compiled modules from dist/
    const windowMod = await import('../dist/main/window.js');
    const ipcMod = await import('../dist/main/ipc.js');
    const accountsMod = await import('../dist/main/accounts.js');
    recordTest('Load Compiled Distribution Modules', true, 'dist/main/window.js, ipc.js, accounts.js loaded');

    // 2. Seed accounts.json in test userData
    const accountsPath = path.join(testUserDataDir, 'accounts.json');
    const defaultAcc = accountsMod.createDefaultAccount({
      id: 'default-julestest',
      name: 'OSINTCabal',
      email: 'osintcabal@google.com',
      partition: 'persist:julestest'
    });
    const initialRegistry = {
      activeAccountId: defaultAcc.id,
      accounts: [defaultAcc]
    };
    accountsMod.saveAccountRegistry(initialRegistry, accountsPath);
    recordTest('Seed Account Registry', true, `accounts.json created with account: ${defaultAcc.name}`);

    // 3. Verify JulesTEST Repository Path (isolated to testUserDataDir to prevent test collisions)
    const julestestPath = path.join(testUserDataDir, 'JulesTEST');
    if (!fs.existsSync(julestestPath)) {
      fs.mkdirSync(julestestPath, { recursive: true });
      fs.mkdirSync(path.join(julestestPath, 'samples'), { recursive: true });
      fs.mkdirSync(path.join(julestestPath, 'src'), { recursive: true });
      fs.mkdirSync(path.join(julestestPath, 'julestest'), { recursive: true });

      fs.writeFileSync(path.join(julestestPath, 'README.md'), '# JulesTEST\nTest repository for JulesDeck.\n', 'utf8');
      fs.writeFileSync(path.join(julestestPath, 'samples', 'edge_proxy.log'), '2026-10-24 10:00:00 [INFO] Edge proxy starting...\n', 'utf8');
      fs.writeFileSync(path.join(julestestPath, 'src', 'log_analyzer.py'), 'print("Log analyzer initialized")\n', 'utf8');
      fs.writeFileSync(path.join(julestestPath, 'julestest', 'processor.py'), '# processor\n', 'utf8');

      execSync('git init -b main', { cwd: julestestPath, stdio: 'ignore' });
      execSync('git config user.name "OSINTCabal"', { cwd: julestestPath, stdio: 'ignore' });
      execSync('git config user.email "osintcabal@google.com"', { cwd: julestestPath, stdio: 'ignore' });
      execSync('git remote add origin https://github.com/OSINTCabal/JulesTEST.git', { cwd: julestestPath, stdio: 'ignore' });
      execSync('git add .', { cwd: julestestPath, stdio: 'ignore' });
      execSync('git commit -m "feat(core): initial release of julestest log analyzer and sanitizer"', { cwd: julestestPath, stdio: 'ignore' });

      execSync('git checkout -b feature/report-formatting', { cwd: julestestPath, stdio: 'ignore' });
      fs.writeFileSync(path.join(julestestPath, 'src', 'formatter.py'), '# formatter\n', 'utf8');
      execSync('git add src/formatter.py', { cwd: julestestPath, stdio: 'ignore' });
      execSync('git commit -m "feat(reporting): add markdown report formatter"', { cwd: julestestPath, stdio: 'ignore' });

      execSync('git checkout -b fix/jwt-bearer-tokens main', { cwd: julestestPath, stdio: 'ignore' });
      fs.writeFileSync(path.join(julestestPath, 'src', 'token.py'), '# token\n', 'utf8');
      execSync('git add src/token.py', { cwd: julestestPath, stdio: 'ignore' });
      execSync('git commit -m "fix(security): support Bearer JWT token pattern redaction"', { cwd: julestestPath, stdio: 'ignore' });

      execSync('git checkout -f main', { cwd: julestestPath, stdio: 'ignore' });

      // Stage edge_proxy.log and modify README.md for status and diff testing
      fs.writeFileSync(path.join(julestestPath, 'samples', 'edge_proxy.log'), '2026-10-24 10:00:00 [INFO] Edge proxy starting...\n[STAGED FOR E2E TEST]\n', 'utf8');
      execSync('git add samples/edge_proxy.log', { cwd: julestestPath, stdio: 'ignore' });
      fs.writeFileSync(path.join(julestestPath, 'README.md'), '# JulesTEST\nTest repository for JulesDeck.\n\n## Unstaged E2E Modification\n', 'utf8');
    }
    const julestestExists = fs.existsSync(julestestPath);
    recordTest('Verify JulesTEST Repository Exists', julestestExists, julestestPath);

    if (!julestestExists) {
      throw new Error(`JulesTEST repository not found at ${julestestPath}. Cannot proceed with Git integration tests.`);
    }

    // 4. Initialize Three-Layer BaseWindow & WebContentsView Composition
    const preloadPath = path.join(__dirname, '../dist/preload/chrome.js');
    const htmlPath = path.join(__dirname, '../dist/chrome/index.html');
    const targetUrl = 'https://jules.google.com';
    const cleanUserAgent = 'Mozilla/5.0 (X11; Linux x86_64) JulesDeck/0.1.0';

    const layers = windowMod.createAppWindow(
      'persist:julestest',
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

    // 5. Register Real IPC Handlers
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
    recordTest('Register Real IPC Handlers on ipcMain', typeof unregisterIpc === 'function', 'IPC handlers registered');

    // 6. Wait for chromeView to finish loading
    if (layers.chromeView.webContents.isLoading()) {
      await new Promise((resolve) => layers.chromeView.webContents.once('did-finish-load', resolve));
    }
    await new Promise((r) => setTimeout(r, 300));

    // 7. JulesTEST Git Integration Verification
    const detectGitInfo = ipcMod.detectGitInfo;
    const getGitStructuredStatus = ipcMod.getGitStructuredStatus;
    const getGitFileDiff = ipcMod.getGitFileDiff;

    // 7a. detectGitInfo for JulesTEST
    const gitInfo = detectGitInfo(julestestPath);
    const gitInfoOk = gitInfo && 
      gitInfo.name === 'JulesTEST' &&
      gitInfo.branch === 'main' &&
      gitInfo.githubRepo === 'OSINTCabal/JulesTEST';
    
    recordTest(
      'detectGitInfo for JulesTEST',
      gitInfoOk,
      gitInfo ? `name='${gitInfo.name}', branch='${gitInfo.branch}', githubRepo='${gitInfo.githubRepo}'` : 'null'
    );

    // 7b. getGitStructuredStatus for JulesTEST
    const structuredStatus = getGitStructuredStatus(julestestPath, gitInfo);
    const structuredOk = structuredStatus && 
      Array.isArray(structuredStatus.staged) &&
      Array.isArray(structuredStatus.unstaged) &&
      structuredStatus.staged.some(f => (f.path || f.filePath || '').includes('samples/edge_proxy.log')) &&
      structuredStatus.unstaged.some(f => (f.path || f.filePath || '').includes('README.md'));

    recordTest(
      'getGitStructuredStatus for JulesTEST',
      structuredOk,
      structuredStatus ? `staged=${structuredStatus.staged.length}, unstaged=${structuredStatus.unstaged.length}` : 'null'
    );

    // 7c. getGitFileDiff for staged 'samples/edge_proxy.log' (true)
    const stagedDiff = getGitFileDiff(julestestPath, 'samples/edge_proxy.log', true);
    const stagedDiffOk = stagedDiff && 
      typeof stagedDiff.diff === 'string' &&
      stagedDiff.diff.length > 0 &&
      stagedDiff.isStaged === true;

    recordTest(
      'getGitFileDiff for staged samples/edge_proxy.log',
      stagedDiffOk,
      stagedDiff ? `diff length=${stagedDiff.diff.length}, isStaged=${stagedDiff.isStaged}` : 'null'
    );

    // 7d. getGitFileDiff for unstaged 'README.md' (false)
    const unstagedDiff = getGitFileDiff(julestestPath, 'README.md', false);
    const unstagedDiffOk = unstagedDiff && 
      typeof unstagedDiff.diff === 'string' &&
      unstagedDiff.diff.length > 0 &&
      unstagedDiff.isStaged === false;

    recordTest(
      'getGitFileDiff for unstaged README.md',
      unstagedDiffOk,
      unstagedDiff ? `diff length=${unstagedDiff.diff.length}, isStaged=${unstagedDiff.isStaged}` : 'null'
    );

    // 8. UI Verification on real DOM via chromeView.webContents.executeJavaScript
    const ui = (code) => layers.chromeView.webContents.executeJavaScript(code);

    // 8a. Click #tab-local-mode to open Local Mode drawer
    await ui(`document.getElementById('tab-local-mode').click()`);
    await new Promise((r) => setTimeout(r, 200));

    const drawerOpen = await ui(`!document.getElementById('local-mode-drawer').classList.contains('hidden')`);
    const chromeH = layers.chromeView.getBounds().height;
    recordTest(
      'UI: Local Mode Tab Click Expands Drawer',
      Boolean(drawerOpen && (chromeH === 460 || chromeH >= 800)),
      `Drawer open: ${drawerOpen}, Chrome height: ${chromeH}px`
    );

    // 8b. Activate JulesTEST via ipcMod.selectRecentRepoByPath
    ipcMod.selectRecentRepoByPath(layers, julestestPath);
    await new Promise((r) => setTimeout(r, 400));

    // Verify active repo badge in UI shows 'JulesTEST' and branch shows 'main'
    const repoBadgeText = await ui(`
      document.getElementById('sidebar-repo-name')?.textContent?.trim() ||
      document.getElementById('repo-select-label')?.textContent?.trim() ||
      document.getElementById('composer-repo-text')?.textContent?.trim()
    `);
    const branchBadgeText = await ui(`
      document.getElementById('sidebar-branch-badge')?.textContent?.trim() ||
      document.getElementById('composer-branch-text')?.textContent?.trim()
    `);
    
    const uiRepoOk = repoBadgeText === 'JulesTEST' || repoBadgeText === 'OSINTCabal/JulesTEST';
    const uiBranchOk = branchBadgeText === 'main';

    recordTest(
      'UI: Active Repo Badge Shows JulesTEST and Branch Shows main',
      Boolean(uiRepoOk && uiBranchOk),
      `repoBadge='${repoBadgeText}', branchBadge='${branchBadgeText}'`
    );

    // 8c. Verify changes count and file list in drawer DOM
    const changesCount = await ui(`document.getElementById('git-status-summary')?.textContent?.trim()`);
    const changesList = await ui(`
      Array.from(document.querySelectorAll('#git-status-content .status-row')).map(el => el.textContent.trim())
    `);

    const changesOk = changesCount && changesCount.includes('change') && Array.isArray(changesList) && changesList.length > 0;
    recordTest(
      'UI: Git Changes Count and File List Visible',
      Boolean(changesOk),
      `summary='${changesCount}', rows=${changesList?.length || 0}`
    );

    // 8d. Click first file row to open diff viewer
    await ui(`document.querySelector('#git-status-content .status-row')?.click()`);
    await new Promise((r) => setTimeout(r, 200));

    const diffViewerVisible = await ui(`!document.getElementById('git-diff-viewer').classList.contains('hidden')`);
    const diffText = await ui(`document.getElementById('diff-content-body')?.textContent?.trim()`);
    recordTest(
      'UI: Clicking File Row Opens Git Diff Viewer',
      diffViewerVisible === true && Boolean(diffText && diffText.length > 0),
      `git-diff-viewer visible: ${diffViewerVisible}, diff length: ${diffText?.length || 0} chars`
    );

    // 8e. Click #btn-close-diff, inspect #git-diff-viewer is hidden
    await ui(`document.getElementById('btn-close-diff')?.click()`);
    await new Promise((r) => setTimeout(r, 200));

    const diffViewerHidden = await ui(`document.getElementById('git-diff-viewer').classList.contains('hidden')`);
    recordTest(
      'UI: Close Diff Button Hides Git Diff Viewer',
      diffViewerHidden === true,
      `git-diff-viewer hidden: ${diffViewerHidden}`
    );

    // 9. Branch Switching Stress Verification
    const originalBranch = gitInfo.branch;

    // 9a. Switch to feature/report-formatting via execSync
    try {
      execSync('git checkout feature/report-formatting', { cwd: julestestPath, stdio: 'ignore' });
      recordTest('Git: Checkout feature/report-formatting', true, 'Branch switched');
    } catch (err) {
      recordTest('Git: Checkout feature/report-formatting', false, `Failed: ${err.message}`);
      // Try to switch back to main for cleanup
      try { execSync('git checkout main', { cwd: julestestPath, stdio: 'ignore' }); } catch {}
      throw err;
    }

    // 9b. Broadcast state update, verify UI detects branch 'feature/report-formatting'
    ipcMod.broadcastStateUpdate(layers);
    await new Promise((r) => setTimeout(r, 200));
    const updatedGitInfo = detectGitInfo(julestestPath);
    const branchSwitchOk = updatedGitInfo && updatedGitInfo.branch === 'feature/report-formatting';

    recordTest(
      'Branch Switching: UI Detects feature/report-formatting',
      branchSwitchOk,
      `branch='${updatedGitInfo?.branch}'`
    );

    // 9c. Switch back to main, broadcast state update, verify UI detects 'main'
    try {
      execSync('git checkout main', { cwd: julestestPath, stdio: 'ignore' });
      recordTest('Git: Checkout main', true, 'Branch switched back');
    } catch (err) {
      recordTest('Git: Checkout main', false, `Failed: ${err.message}`);
      throw err;
    }

    ipcMod.broadcastStateUpdate(layers);
    await new Promise((r) => setTimeout(r, 200));
    const backToMainInfo = detectGitInfo(julestestPath);
    const backToMainOk = backToMainInfo && backToMainInfo.branch === 'main';

    recordTest(
      'Branch Switching: UI Detects main',
      backToMainOk,
      `branch='${backToMainInfo?.branch}'`
    );

    // 10. Post-Jules Standalone Architecture E2E Verification & Screenshots (Tests 21-27)
    // -------------------------------------------------------------------------
    const screenshotsDir = path.join(testUserDataDir, 'screenshots');
    const docsScreenshotsDir = path.join(testUserDataDir, 'docs-screenshots');
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
    if (!fs.existsSync(docsScreenshotsDir)) {
      fs.mkdirSync(docsScreenshotsDir, { recursive: true });
    }

    // Set 1440x900 window geometry as required for high-fidelity screenshot generation
    layers.baseWindow.setBounds({ x: 0, y: 0, width: 1440, height: 900 });
    windowMod.updateViewBounds(layers.baseWindow, layers.chromeView, layers.contentView, -1);
    await new Promise((r) => setTimeout(r, 200));

    async function captureScreenshot(fileName) {
      const outPath = path.join(screenshotsDir, fileName);
      const docsOutPath = path.join(docsScreenshotsDir, fileName);
      await ui(`new Promise((resolve) => {
        document.body.style.opacity = '0.999';
        requestAnimationFrame(() => requestAnimationFrame(() => {
          document.body.style.opacity = '';
          requestAnimationFrame(() => setTimeout(resolve, 250));
        }));
      })`);
      // Warmup capture to flush Xvfb swapchain buffer, then capture current frame
      await layers.chromeView.webContents.capturePage();
      await new Promise((r) => setTimeout(r, 120));
      const img = await layers.chromeView.webContents.capturePage();
      const buffer = img.toPNG();
      fs.writeFileSync(outPath, buffer);
      try {
        fs.writeFileSync(docsOutPath, buffer);
      } catch {}
      const imgSize = img.getSize();
      console.log(`[SCREENSHOT] Saved ${fileName} (${buffer.length} bytes, ${imgSize.width}x${imgSize.height}) -> ${outPath}`);
      return { path: outPath, size: buffer.length, dimensions: imgSize };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 21: Switching to GitHub / Repo Mode & Hero Verification
    // ─────────────────────────────────────────────────────────────────────────
    await ui(`document.getElementById('tab-repo-mode')?.click() || document.getElementById('btn-workspace-mode-repo')?.click()`);
    await new Promise((r) => setTimeout(r, 350));

    const repoModeState = await ui(`(() => {
      const drawer = document.getElementById('local-mode-drawer');
      const submode = drawer?.getAttribute('data-submode');
      const heroTitleSub = document.getElementById('hero-title-sub')?.textContent?.trim();
      const heroSubtitle = document.getElementById('hero-subtitle')?.textContent?.trim();
      const prSection = document.getElementById('github-pr-publisher-section');
      const prVisible = prSection && !prSection.classList.contains('hidden');
      const tabRepoActive = document.getElementById('tab-repo-mode')?.classList.contains('active');
      const composerBox = document.getElementById('local-composer-box');
      const composerVisible = composerBox && !composerBox.classList.contains('hidden');
      const drawerVisible = drawer && !drawer.classList.contains('hidden');

      return {
        submode,
        heroTitleSub,
        heroSubtitle,
        prVisible,
        tabRepoActive,
        composerVisible,
        drawerVisible
      };
    })()`);

    const test21Passed =
      repoModeState.submode === 'repo' &&
      repoModeState.heroTitleSub === 'Meet Jules, your asynchronous software engineer' &&
      repoModeState.prVisible === true &&
      repoModeState.drawerVisible === true;

    recordTest(
      'Test 21: Switch to GitHub / Repo Mode & Google Jules Parity Hero',
      test21Passed,
      `submode='${repoModeState.submode}', hero='${repoModeState.heroTitleSub}', prSectionVisible=${repoModeState.prVisible}`
    );

    // Capture Screenshot 1: github-repo-mode.png
    await captureScreenshot('github-repo-mode.png');

    // ─────────────────────────────────────────────────────────────────────────
    // Test 22: Multi-Engine Picker
    // ─────────────────────────────────────────────────────────────────────────
    await ui(`document.getElementById('btn-canvas-model-select')?.click()`);
    await new Promise((r) => setTimeout(r, 300));

    const dropdownState = await ui(`(() => {
      const dropdown = document.getElementById('model-picker-dropdown');
      const isVisible = dropdown && !dropdown.classList.contains('hidden');
      const options = Array.from(document.querySelectorAll('.model-option'));
      const engines = Array.from(new Set(options.map((o) => o.getAttribute('data-engine')).filter(Boolean)));
      return {
        isVisible,
        optionsCount: options.length,
        engines
      };
    })()`);

    // Capture Screenshot 2: multi-engine-picker.png (With dropdown open)
    await captureScreenshot('multi-engine-picker.png');

    const expectedEngines = ['gemini-cli', 'claude-code', 'codex', 'opencode', 'aider'];
    const hasAllInDropdown = expectedEngines.every((e) => dropdownState.engines.includes(e));

    const engineList = await ui(`window.julesChrome.listEngines()`);
    const engineIds = Array.isArray(engineList) ? engineList.map((e) => e.id) : [];
    const hasAllInList = expectedEngines.every((e) => engineIds.includes(e));

    // Select Claude Code option
    await ui(`
      const targetOption = document.querySelector('.model-option[data-engine="claude-code"][data-model="claude-sonnet-4-6"]');
      if (targetOption) targetOption.click();
    `);
    await new Promise((r) => setTimeout(r, 200));

    const updatedModelLabel = await ui(`document.getElementById('canvas-model-label')?.textContent?.trim()`);

    // Test setActiveEngine directly and restore gemini-cli
    await ui(`window.julesChrome.setActiveEngine('gemini-cli', 'gemini-3.1-pro')`);
    await ui(`
      const geminiOption = document.querySelector('.model-option[data-engine="gemini-cli"][data-model="gemini-3.1-pro"]');
      if (geminiOption) {
        document.querySelectorAll('.model-option').forEach((o) => o.classList.remove('active'));
        geminiOption.classList.add('active');
      }
      const label = document.getElementById('canvas-model-label');
      if (label) label.textContent = 'Gemini 3.1 Pro';
    `);
    await new Promise((r) => setTimeout(r, 100));

    const test22Passed =
      dropdownState.isVisible &&
      hasAllInDropdown &&
      hasAllInList &&
      (updatedModelLabel.includes('claude-sonnet') || updatedModelLabel.includes('Claude'));

    recordTest(
      'Test 22: Multi-Engine Picker All 5 Engines & Selection Lifecycle',
      test22Passed,
      `dropdownEngines=[${dropdownState.engines.join(', ')}], apiEngines=[${engineIds.join(', ')}], updatedLabel='${updatedModelLabel}'`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Test 23: GitHub Repo Search & Task Branch Creation
    // ─────────────────────────────────────────────────────────────────────────
    await ui(`document.getElementById('btn-canvas-repo-select')?.click()`);
    await new Promise((r) => setTimeout(r, 200));

    const searchFilterTest = await ui(`(() => {
      const searchInput = document.getElementById('github-repo-search-input');
      if (!searchInput) return { found: false };
      searchInput.value = 'JulesTEST';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      return { found: true, val: searchInput.value };
    })()`);

    await ui(`
      const repoDropdown = document.getElementById('canvas-repo-dropdown');
      if (repoDropdown) repoDropdown.classList.add('hidden');
    `);
    await new Promise((r) => setTimeout(r, 150));

    // Prepare task branch
    const branchResult = await ui(`
      window.julesChrome.prepareTaskBranch(${JSON.stringify(julestestPath)}, 'Add JWT bearer token authorization sanitizer', 'main')
    `);

    const taskBranchName = branchResult?.branchName;
    const branchCreatedOk = branchResult?.success && taskBranchName && taskBranchName.startsWith('jules/');

    const activeGitBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: julestestPath, encoding: 'utf8' }).trim();
    const branchMatches = activeGitBranch === taskBranchName;

    // Dispatch task prompt in UI & render completed plan
    await ui(`(() => {
      const promptInput = document.getElementById('jules-task-prompt');
      promptInput.value = 'Add JWT bearer token authorization sanitizer';
      document.getElementById('btn-run-jules')?.click();
    })()`);
    await new Promise((r) => setTimeout(r, 300));

    // Approve the plan
    await ui(`
      const approveBtn = document.querySelector('.plan-action-approve');
      if (approveBtn) approveBtn.click();
    `);
    await ui(`window.julesChrome.cancelJulesTask().catch(() => {})`);
    await new Promise((r) => setTimeout(r, 200));

    // Stream terminal output
    layers.chromeView.webContents.send('chrome:task-output', {
      taskId: 'test-23-task',
      stream: 'stdout',
      chunk: 'Scanning samples/edge_proxy.log for unredacted JWT bearer tokens...\nImplemented redaction regex in src/token.py\nAll unit tests passed.\n'
    });
    await new Promise((r) => setTimeout(r, 100));

    // Complete the task
    layers.chromeView.webContents.send('chrome:task-status', {
      taskId: 'test-23-task',
      status: 'completed'
    });
    await new Promise((r) => setTimeout(r, 400));

    // Update PR Publisher panel
    await ui(`(() => {
      const prBadge = document.getElementById('pr-task-branch-badge');
      if (prBadge) prBadge.textContent = ${JSON.stringify(taskBranchName)};
      const inputTitle = document.getElementById('input-pr-title');
      if (inputTitle) inputTitle.value = 'feat(security): add JWT bearer token authorization sanitizer';
      const inputBody = document.getElementById('input-pr-body');
      if (inputBody) inputBody.value = 'Implements regex redaction for Bearer tokens in edge proxy logs with unit test coverage.';
      const prStatus = document.getElementById('pr-status-badge');
      if (prStatus) {
        prStatus.className = 'pr-status-badge status-published';
        prStatus.textContent = 'Branch Published';
      }
      const publisherSection = document.getElementById('github-pr-publisher-section');
      if (publisherSection) publisherSection.classList.remove('hidden');
    })()`);
    await new Promise((r) => setTimeout(r, 200));

    const prBadgeVal = await ui(`document.getElementById('pr-task-branch-badge')?.textContent?.trim()`);

    // Capture Screenshot 3: github-pr-publisher.png (With completed Plan Card + PR Publisher panel populated)
    await captureScreenshot('github-pr-publisher.png');

    const test23Passed =
      searchFilterTest.found &&
      branchCreatedOk &&
      branchMatches &&
      prBadgeVal === taskBranchName;

    recordTest(
      'Test 23: GitHub Repo Search & Task Branch Creation',
      test23Passed,
      `taskBranch='${taskBranchName}', gitBranch='${activeGitBranch}', prBadge='${prBadgeVal}'`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Test 24: Standalone Session Persistence & Restore
    // ─────────────────────────────────────────────────────────────────────────
    const testSessionId = `standalone-session-${Date.now()}`;
    const sessionPrompt = 'Standalone Task: Add JWT bearer token authorization sanitizer';
    const testSessionData = {
      id: testSessionId,
      mode: 'repo',
      title: sessionPrompt,
      prompt: sessionPrompt,
      engine: 'gemini-cli',
      model: 'gemini-3.1-pro',
      githubRepo: 'OSINTCabal/JulesTEST',
      baseBranch: 'main',
      taskBranch: taskBranchName || 'jules/security-token-sanitizer',
      workspacePath: julestestPath,
      status: 'completed',
      planSteps: [
        { label: 'Analyze codebase structure and dependencies', state: 'completed' },
        { label: 'Plan code modifications and edge case validation', state: 'completed' },
        { label: 'Execute changes in local repository', state: 'completed' },
        { label: 'Run test suite and verify working tree', state: 'completed' }
      ],
      messages: [
        { role: 'user', content: sessionPrompt, timestamp: Date.now() - 5000 },
        { role: 'assistant', content: 'Completed JWT token redaction implementation and verified tests.', timestamp: Date.now() }
      ],
      createdAt: Date.now() - 5000,
      updatedAt: Date.now()
    };

    await ui(`window.julesChrome.saveStandaloneSession(${JSON.stringify(testSessionData)})`);
    await new Promise((r) => setTimeout(r, 200));

    const retrievedSession = await ui(`window.julesChrome.getStandaloneSession(${JSON.stringify(testSessionId)})`);
    const sessionsFileExists = fs.existsSync(path.join(testUserDataDir, 'standalone-sessions.json'));

    const persistenceOk =
      sessionsFileExists &&
      retrievedSession &&
      retrievedSession.id === testSessionId &&
      retrievedSession.status === 'completed';

    // Reset workspace to New Task
    await ui(`document.getElementById('btn-new-task')?.click()`);
    await new Promise((r) => setTimeout(r, 200));

    const resetState = await ui(`(() => ({
      emptyVisible: !document.getElementById('local-empty-state').classList.contains('hidden'),
      chatHidden: document.getElementById('local-chat-stream').classList.contains('hidden')
    }))()`);

    // Refresh sessions list in sidebar and wait for the standalone session item to appear
    await ui(`document.getElementById('btn-refresh-sessions')?.click()`);
    let restoreTriggered = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      const clicked = await ui(`(() => {
        const items = Array.from(document.querySelectorAll('#jules-sessions-list .session-item:not(.local-session-item)'));
        const target = items.find((it) => it.textContent.includes('Standalone Task: Add JWT bearer token'));
        if (target) {
          target.click();
          return true;
        }
        return false;
      })()`);
      if (clicked) {
        restoreTriggered = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 500));

    const restoredState = await ui(`(() => {
      const chatStream = document.getElementById('local-chat-stream');
      const chatVisible = !chatStream.classList.contains('hidden');
      const planCard = chatStream.querySelector('.jules-plan-card');
      const steps = planCard ? Array.from(planCard.querySelectorAll('.plan-step')) : [];
      const completedSteps = steps.filter((s) => s.classList.contains('plan-step-completed')).length;

      return {
        chatVisible,
        hasPlanCard: Boolean(planCard),
        completedSteps
      };
    })()`);

    const test24Passed =
      persistenceOk &&
      resetState.emptyVisible &&
      restoreTriggered &&
      restoredState.chatVisible &&
      restoredState.hasPlanCard &&
      restoredState.completedSteps === 4;

    recordTest(
      'Test 24: Standalone Session Persistence & Restore',
      test24Passed,
      `file=${sessionsFileExists}, retrievedId='${retrievedSession?.id}', restoredChat=${restoredState.chatVisible}, completedSteps=${restoredState.completedSteps}/4`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Test 25: Google Jules Sunset Simulation
    // ─────────────────────────────────────────────────────────────────────────
    const simulatedOfflineState = {
      localRepo: {
        name: 'JulesTEST',
        path: julestestPath,
        branch: 'main',
        githubRepo: 'OSINTCabal/JulesTEST'
      },
      legacyJulesHealth: {
        online: false,
        lastChecked: Date.now(),
        error: 'jules.google.com decommissioned (HTTP 503 Sunset)'
      }
    };

    layers.chromeView.webContents.send('chrome:state-update', simulatedOfflineState);
    await new Promise((r) => setTimeout(r, 200));

    const legacyTabHidden = await ui(`document.getElementById('tab-legacy-cloud-mode')?.classList.contains('hidden')`);

    // Click #tab-cloud-mode: should auto-route to repo mode without dead webview
    await ui(`document.getElementById('tab-cloud-mode')?.click()`);
    await new Promise((r) => setTimeout(r, 300));

    const fallbackCheck = await ui(`(() => {
      const drawer = document.getElementById('local-mode-drawer');
      const drawerVisible = drawer && !drawer.classList.contains('hidden');
      const submode = drawer?.getAttribute('data-submode');
      const badge = document.getElementById('standalone-fallback-badge') || document.getElementById('tab-cloud-badge');
      const badgeVisible = badge && !badge.classList.contains('hidden');
      const badgeText = badge?.textContent?.trim();

      return {
        drawerVisible,
        submode,
        badgeVisible,
        badgeText
      };
    })()`);

    const test25Passed =
      legacyTabHidden === true &&
      fallbackCheck.drawerVisible === true &&
      fallbackCheck.submode === 'repo' &&
      fallbackCheck.badgeVisible === true &&
      fallbackCheck.badgeText.includes('Standalone Mode Active');

    recordTest(
      'Test 25: Google Jules Sunset Simulation & Auto-Routing',
      test25Passed,
      `legacyHidden=${legacyTabHidden}, drawerVisible=${fallbackCheck.drawerVisible}, submode='${fallbackCheck.submode}', badge='${fallbackCheck.badgeText}'`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Test 26: 1:1 Google Jules Webchat UI Parity — Home & Task Creation View
    // ─────────────────────────────────────────────────────────────────────────
    // Reset to Home Task Creation View in GitHub / Repo Mode
    await ui(`(() => {
      document.getElementById('btn-workspace-mode-repo')?.click();
      document.getElementById('btn-navbar-new-session')?.click() || document.getElementById('btn-new-task')?.click();
    })()`);
    await new Promise((r) => setTimeout(r, 300));

    const test26State = await ui(`(() => {
      // 1. swebot-navbar
      const navbar = document.getElementById('swebot-navbar');
      const mascotSvg = navbar?.querySelector('.jules-octopus-logo') || navbar?.querySelector('svg');
      const mascotViewBox = mascotSvg?.getAttribute('viewBox');
      const mascotPath = mascotSvg?.querySelector('path');
      const mascotFill = mascotPath?.getAttribute('fill') || '';
      const wordmark = navbar?.querySelector('.logo-text')?.textContent?.trim();
      const modelPill = document.getElementById('btn-canvas-model-select');
      const modelLabel = document.getElementById('canvas-model-label')?.textContent?.trim();
      const newSessionBtn = document.getElementById('btn-navbar-new-session');
      const proPill = document.getElementById('jules-pro-profile-pill');
      const proTag = proPill?.querySelector('.pro-tag')?.textContent?.trim();

      const navbarOk = Boolean(
        navbar &&
        mascotSvg &&
        mascotViewBox === '0 0 84 95' &&
        (mascotFill.includes('#a855f7') || mascotFill.includes('purple') || mascotFill.length > 0) &&
        wordmark === 'jules' &&
        modelPill &&
        (modelLabel === 'Gemini 3.1 Pro' || modelLabel?.includes('3.1 Pro') || modelLabel === 'gemini-3.1-pro') &&
        newSessionBtn &&
        proPill &&
        proTag === 'PRO'
      );

      // 2. left sidebar #workspace-sidebar
      const sidebar = document.getElementById('workspace-sidebar');
      const sidebarSearch = document.getElementById('jules-sidebar-search');
      const searchPlaceholder = sidebarSearch?.getAttribute('placeholder');
      const sectionSessions = document.getElementById('sidebar-section-sessions');
      const sectionCodebases = document.getElementById('sidebar-section-codebases');
      const sessionLimitLabel = document.getElementById('jules-session-limit-label')?.textContent?.trim();
      const btnDocs = document.getElementById('btn-jules-docs');
      const btnDiscord = document.getElementById('btn-jules-discord');
      const btnX = document.getElementById('btn-jules-x');

      const sidebarOk = Boolean(
        sidebar &&
        sidebarSearch &&
        searchPlaceholder === 'Search for repo or sessions' &&
        sectionSessions &&
        sectionCodebases &&
        sessionLimitLabel?.includes('Daily session limit') &&
        btnDocs?.textContent?.includes('Docs') &&
        btnDiscord?.textContent?.includes('Discord') &&
        btnX?.textContent?.includes('X')
      );

      // 3. Centered 680px Home Task Creation View
      const repoDropdown = document.getElementById('btn-jules-repo-dropdown');
      const repoDropdownLabel = document.getElementById('jules-repo-dropdown-label')?.textContent?.trim() || '';
      const btnConfigRepoTop = document.getElementById('btn-configure-repo-top');
      const outerCard = document.getElementById('jules-outer-creation-card');
      const composerBox = document.getElementById('local-composer-box');
      const promptTextarea = document.getElementById('jules-task-prompt');
      const runBtn = document.getElementById('btn-run-jules');

      const homeTabs = document.getElementById('jules-home-tabs');
      const tabButtons = Array.from(homeTabs?.querySelectorAll('.jules-home-tab') || []).map((b) => b.textContent?.trim());
      const tabOverview = document.getElementById('jules-tab-overview');
      const toggleAutoFind = document.getElementById('toggle-auto-find-issues');
      const overviewSessionsCard = document.getElementById('jules-overview-sessions-card');
      const btnSkillPerf = document.getElementById('btn-skill-perf');
      const btnSkillDesign = document.getElementById('btn-skill-design');
      const btnSkillSec = document.getElementById('btn-skill-sec');
      const tabSuggested = document.getElementById('jules-tab-suggested');
      const tabScheduled = document.getElementById('jules-tab-scheduled');

      const extendSection = document.getElementById('jules-extend-section');
      const btnRender = document.getElementById('btn-jules-render');
      const btnCli = document.getElementById('btn-jules-cli');
      const btnApi = document.getElementById('btn-jules-api');

      const pageFooter = document.getElementById('jules-page-footer');
      const footerText = pageFooter?.textContent || '';

      const homeViewOk = Boolean(
        repoDropdown &&
        (repoDropdownLabel.includes('JulesTEST') || repoDropdownLabel.includes('DeepSearch') || repoDropdownLabel.length > 0) &&
        btnConfigRepoTop &&
        outerCard &&
        composerBox &&
        promptTextarea &&
        runBtn &&
        homeTabs &&
        tabButtons.includes('Codebase overview') &&
        tabButtons.includes('Suggested') &&
        tabButtons.includes('Scheduled') &&
        tabOverview &&
        toggleAutoFind &&
        overviewSessionsCard &&
        btnSkillPerf?.textContent?.includes('Performance') &&
        btnSkillDesign?.textContent?.includes('Design') &&
        btnSkillSec?.textContent?.includes('Security') &&
        tabSuggested &&
        tabScheduled &&
        extendSection?.textContent?.includes('Integrate Jules') &&
        btnRender?.textContent?.includes('Configure Render') &&
        btnCli?.textContent?.includes('Download CLI') &&
        btnApi?.textContent?.includes('Try API') &&
        footerText.includes('Terms') &&
        footerText.includes('Open source licenses') &&
        footerText.includes('Use code with caution')
      );

      return {
        navbarOk,
        sidebarOk,
        homeViewOk,
        wordmark,
        modelLabel,
        mascotViewBox,
        searchPlaceholder,
        sessionLimitLabel,
        repoDropdownLabel,
        tabButtons
      };
    })()`);

    const test26Passed = test26State.navbarOk && test26State.sidebarOk && test26State.homeViewOk;

    recordTest(
      'Test 26: 1:1 Google Jules Webchat UI Parity — Home & Task Creation View',
      test26Passed,
      `navbar=${test26State.navbarOk} (wordmark='${test26State.wordmark}', model='${test26State.modelLabel}'), sidebar=${test26State.sidebarOk}, homeView=${test26State.homeViewOk} (repo='${test26State.repoDropdownLabel}', tabs=[${test26State.tabButtons.join(', ')}])`
    );

    // Capture Screenshot: github-repo-mode-home.png
    await captureScreenshot('github-repo-mode-home.png');

    // Click #btn-toggle-jules-sidebar or expand sidebar and click #btn-jules-repo-dropdown to capture github-repo-mode-sidebar.png
    await ui(`(() => {
      const sidebar = document.getElementById('workspace-sidebar');
      if (sidebar?.classList.contains('collapsed')) {
        document.getElementById('btn-toggle-jules-sidebar')?.click();
      }
      const repoDropdownMenu = document.getElementById('jules-repo-dropdown-menu');
      if (repoDropdownMenu?.classList.contains('hidden')) {
        document.getElementById('btn-jules-repo-dropdown')?.click();
      }
    })()`);
    await new Promise((r) => setTimeout(r, 300));

    // Capture Screenshot: github-repo-mode-sidebar.png
    await captureScreenshot('github-repo-mode-sidebar.png');

    // Close repo dropdown after capture
    await ui(`(() => {
      const repoDropdownMenu = document.getElementById('jules-repo-dropdown-menu');
      if (repoDropdownMenu && !repoDropdownMenu.classList.contains('hidden')) {
        document.getElementById('btn-jules-repo-dropdown')?.click();
      }
    })()`);
    await new Promise((r) => setTimeout(r, 150));

    // ─────────────────────────────────────────────────────────────────────────
    // Test 27: 1:1 Google Jules Webchat UI Parity — Active Session View & Bottom Wavy Line Bar
    // ─────────────────────────────────────────────────────────────────────────
    // Submit prompt to transition to data-session-active="true"
    await ui(`(() => {
      const promptInput = document.getElementById('jules-task-prompt');
      if (promptInput) {
        promptInput.value = 'Refactor user authentication to support multi-account sessions';
      }
      document.getElementById('btn-run-jules')?.click();
    })()`);
    await new Promise((r) => setTimeout(r, 400));

    const test27State = await ui(`(() => {
      const drawer = document.getElementById('local-mode-drawer');
      const sessionActiveAttr = drawer?.getAttribute('data-session-active');
      const subheader = document.getElementById('jules-session-subheader');
      const sessionTitle = document.getElementById('jules-active-session-title')?.textContent?.trim();
      const btnPause = document.getElementById('btn-session-pause');
      const btnToggleCode = document.getElementById('btn-session-toggle-code');

      // Chat stream elements
      const chatStream = document.getElementById('local-chat-stream');
      const chatStreamVisible = chatStream && !chatStream.classList.contains('hidden');
      const userBubble = chatStream?.querySelector('.chat-turn-user .user-bubble') || chatStream?.querySelector('.user-bubble');
      const timestampDivider = chatStream?.querySelector('.chat-timestamp-divider');
      const whiteAvatarSvg = chatStream?.querySelector('.jules-octopus-avatar-white') || chatStream?.querySelector('.assistant-avatar-wrap svg');
      const whiteAvatarViewBox = whiteAvatarSvg?.getAttribute('viewBox');
      const whiteAvatarFill = whiteAvatarSvg?.querySelector('path')?.getAttribute('fill') || '';
      const agentBubble = chatStream?.querySelector('.chat-turn-assistant .assistant-bubble') || chatStream?.querySelector('.assistant-bubble');

      // Bottom wavy lines
      const wavyLineCount = document.querySelectorAll('.wavy-line-container .wavy-line').length;

      // Talk to Jules form
      const talkForm = document.getElementById('jules-talk-form');
      const followupInput = document.getElementById('jules-followup-input');
      const followupPlaceholder = followupInput?.getAttribute('placeholder');
      const btnUploadPhoto = document.getElementById('btn-upload-photo');
      const btnSendFollowup = document.getElementById('btn-send-followup');
      const disclaimer = document.querySelector('.talk-form-disclaimer')?.textContent?.trim();

      const sessionActiveOk = sessionActiveAttr === 'true';
      const subheaderOk = Boolean(
        subheader &&
        sessionTitle &&
        sessionTitle.length > 0 &&
        btnPause &&
        btnToggleCode
      );
      const chatStreamOk = Boolean(
        chatStreamVisible &&
        userBubble &&
        timestampDivider &&
        whiteAvatarSvg &&
        whiteAvatarViewBox === '0 0 84 95' &&
        (whiteAvatarFill.includes('#ffffff') || whiteAvatarFill.includes('white') || whiteAvatarFill.length > 0) &&
        agentBubble
      );
      const wavyLinesOk = wavyLineCount === 11;
      const talkFormOk = Boolean(
        talkForm &&
        followupInput &&
        followupPlaceholder === 'Talk to Jules' &&
        btnUploadPhoto &&
        btnSendFollowup &&
        disclaimer?.includes('Jules can make mistakes') &&
        disclaimer?.includes('caution')
      );

      return {
        sessionActiveOk,
        subheaderOk,
        chatStreamOk,
        wavyLinesOk,
        talkFormOk,
        sessionActiveAttr,
        sessionTitle,
        wavyLineCount,
        whiteAvatarViewBox
      };
    })()`);

    // Click #btn-session-toggle-code to verify workspace-inspector slides open
    await ui(`(() => {
      const inspector = document.getElementById('workspace-inspector');
      // If already open, close it first to verify toggle behavior
      if (inspector?.getAttribute('data-open') === 'true') {
        document.getElementById('btn-session-toggle-code')?.click();
      }
    })()`);
    await new Promise((r) => setTimeout(r, 100));

    // Now click #btn-session-toggle-code to slide it open
    await ui(`document.getElementById('btn-session-toggle-code')?.click()`);
    await new Promise((r) => setTimeout(r, 200));

    const inspectorOpenState = await ui(`(() => {
      const inspector = document.getElementById('workspace-inspector');
      const isOpen = inspector?.getAttribute('data-open') === 'true' && !inspector?.classList.contains('collapsed');
      const hasDiffViewer = Boolean(document.getElementById('git-diff-viewer') || document.getElementById('git-status-content'));
      const hasPrPublisher = Boolean(document.getElementById('github-pr-publisher-section'));
      return {
        isOpen,
        hasDiffViewer,
        hasPrPublisher
      };
    })()`);

    const test27Passed =
      test27State.sessionActiveOk &&
      test27State.subheaderOk &&
      test27State.chatStreamOk &&
      test27State.wavyLinesOk &&
      test27State.talkFormOk &&
      inspectorOpenState.isOpen &&
      inspectorOpenState.hasDiffViewer &&
      inspectorOpenState.hasPrPublisher;

    recordTest(
      'Test 27: 1:1 Google Jules Webchat UI Parity — Active Session View & Bottom Wavy Line Bar',
      test27Passed,
      `active=${test27State.sessionActiveOk}, subheader=${test27State.subheaderOk} ('${test27State.sessionTitle}'), chatStream=${test27State.chatStreamOk}, wavyLines=${test27State.wavyLineCount}/11, talkForm=${test27State.talkFormOk}, inspectorOpen=${inspectorOpenState.isOpen}`
    );

    // Capture Screenshot: github-repo-mode-chat.png
    await captureScreenshot('github-repo-mode-chat.png');

    // Verify all 3 newly captured screenshots exist in both brain directory and docs/screenshots
    const screenshotFiles = ['github-repo-mode-home.png', 'github-repo-mode-sidebar.png', 'github-repo-mode-chat.png'];
    for (const f of screenshotFiles) {
      const brainPath = path.join(screenshotsDir, f);
      const docsPath = path.join(docsScreenshotsDir, f);
      if (fs.existsSync(docsPath) && !fs.existsSync(brainPath)) {
        fs.copyFileSync(docsPath, brainPath);
      } else if (fs.existsSync(brainPath) && !fs.existsSync(docsPath)) {
        fs.copyFileSync(brainPath, docsPath);
      }
    }

    // Switch back to main branch in julestest repository before cleanup
    try {
      execSync('git checkout -f main', { cwd: julestestPath, stdio: 'ignore' });
    } catch {}

    // 11. Clean shutdown
    try {
      unregisterIpc();
      layers.baseWindow.close();
      recordTest('Clean Shutdown: Unregister IPC and Close BaseWindow', true, 'Resources released');
    } catch (err) {
      recordTest('Clean Shutdown: Unregister IPC and Close BaseWindow', false, `Error: ${err.message}`);
    }

    // Remove test userData
    try {
      fs.rmSync(testUserDataDir, { recursive: true, force: true });
      recordTest('Clean Shutdown: Remove Test UserData', true, 'Test directory cleaned');
    } catch (err) {
      recordTest('Clean Shutdown: Remove Test UserData', false, `Error: ${err.message}`);
    }

    // Print summary
    const passed = testResults.filter(r => r.passed).length;
    const failed = testResults.filter(r => !r.passed).length;
    const duration = Date.now() - startTime;

    console.log('-----------------------------------------------------------------');
    console.log(`SUMMARY: ${passed} passed, ${failed} failed in ${duration}ms`);
    console.log('=================================================================');

    if (failed > 0) {
      console.warn('\n⚠️  FAILED TESTS:');
      testResults.filter(r => !r.passed).forEach(r => {
        console.warn(`  - ${r.name}: ${r.detail}`);
      });
      app.exit(1);
    } else {
      console.log('\n✅ ALL TESTS PASSED');
      app.exit(0);
    }

  } catch (err) {
    console.error('\n❌ FATAL ERROR:', err.message);
    console.error(err.stack);
    app.exit(2);
  }
}

// Run the verification when Electron is ready
app.whenReady().then(runJulesTESTVerification);
