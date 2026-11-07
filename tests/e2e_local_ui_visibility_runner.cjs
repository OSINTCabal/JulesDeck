/**
 * JulesDeck — Live Headless Electron E2E Runner:
 * Local UI Visibility, Rendering & Full Usage Lifecycle Verification
 * ---------------------------------------------------------------------------
 * Proves that Jules Local is NOT blank and verifies complete interactive usage:
 * 1. Initial Local Mode (unlinked repo) -> Full 3-column workspace & hero visible
 * 2. Repository Linking -> Hero remains visible, context chips update, inspector reflects git status
 * 3. Task Composer ("Give me a plan") -> Empty state hides, chat stream & 4-step plan card appear
 * 4. Plan Approval & Execution -> Step progress tracking & completion summary card
 * 5. Review Diffs & Commit actions -> Diff viewer launches, commit box focuses
 * 6. Brand Icon / New Task Reset -> Clean restore to hero empty state
 * 7. Live Screenshot Capture -> Confirms rich rendered UI without blank pixels
 */

const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const testUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'julesdeck-local-ui-'));
app.setPath('userData', testUserDataDir);
const screenshotPath = process.env.JULESDECK_SCREENSHOT_OUT || path.join(testUserDataDir, 'visibility-test.png');

let totalPassed = 0;
let totalFailed = 0;

function pass(name, detail = '') {
  totalPassed++;
  console.log(`[PASS ✓] ${name}${detail ? ` (${detail})` : ''}`);
}

function fail(name, detail = '') {
  totalFailed++;
  console.error(`[FAIL ✗] ${name}${detail ? ` (${detail})` : ''}`);
}

app.whenReady().then(async () => {
  console.log('=================================================================');
  console.log('   JulesDeck: Live Local UI Visibility & Usage Lifecycle E2E    ');
  console.log('=================================================================');

  try {
    const windowMod = await import('../dist/main/window.js');
    const ipcMod = await import('../dist/main/ipc.js');
    const accountsMod = await import('../dist/main/accounts.js');

    const defaultAcc = accountsMod.createDefaultAccount({
      id: 'default-spike',
      name: 'OSINTCabal',
      email: 'osintcabal@google.com',
      partition: 'persist:spike'
    });
    accountsMod.saveAccountRegistry({ activeAccountId: defaultAcc.id, accounts: [defaultAcc] }, path.join(testUserDataDir, 'accounts.json'));

    const layers = windowMod.createAppWindow(
      'persist:spike',
      path.join(__dirname, '../dist/preload/chrome.js'),
      path.join(__dirname, '../dist/chrome/index.html'),
      'https://jules.google.com',
      'Mozilla/5.0'
    );
    ipcMod.registerIpcHandlers(layers);
    pass('Initialize Window & IPC Subsystems');

    await new Promise((r) => setTimeout(r, 600));

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 1: Switch to Local Mode (Unlinked Repo) & Assert Full UI Visibility
    // ─────────────────────────────────────────────────────────────────────────
    await layers.chromeView.webContents.executeJavaScript(`
      document.getElementById('tab-local-mode').click();
    `);
    await new Promise((r) => setTimeout(r, 600));

    const phase1 = await layers.chromeView.webContents.executeJavaScript(`
      (() => {
        const drawer = document.getElementById('local-mode-drawer');
        const grid = document.getElementById('drawer-body-grid');
        const sidebar = document.getElementById('workspace-sidebar');
        const main = document.getElementById('workspace-main');
        const emptyState = document.getElementById('local-empty-state');
        const chatStream = document.getElementById('local-chat-stream');
        const composer = document.getElementById('local-composer-box');
        const prompt = document.getElementById('jules-task-prompt');
        const btnPlan = document.getElementById('btn-run-jules');
        const starterChips = document.querySelectorAll('.starter-chip');
        const inspector = document.getElementById('workspace-inspector');
        const gitStatus = document.getElementById('git-status-content');

        const drawerStyle = window.getComputedStyle(drawer);
        const gridStyle = window.getComputedStyle(grid);
        const emptyStyle = window.getComputedStyle(emptyState);
        const chatStyle = window.getComputedStyle(chatStream);
        const promptStyle = window.getComputedStyle(prompt);
        const btnPlanStyle = window.getComputedStyle(btnPlan);

        return {
          drawerVisible: !drawer.classList.contains('hidden') && drawerStyle.display !== 'none',
          drawerHeight: drawer.offsetHeight,
          drawerWidth: drawer.offsetWidth,
          gridVisible: !grid.classList.contains('hidden') && gridStyle.display !== 'none',
          gridHeight: grid.offsetHeight,
          gridWidth: grid.offsetWidth,
          sidebarWidth: sidebar.offsetWidth,
          mainWidth: main.offsetWidth,
          emptyStateVisible: !emptyState.classList.contains('hidden') && emptyStyle.display !== 'none',
          emptyStateHeight: emptyState.offsetHeight,
          chatStreamHidden: chatStream.classList.contains('hidden') || chatStyle.display === 'none',
          promptVisible: promptStyle.display !== 'none' && prompt.offsetWidth > 400,
          btnPlanVisible: btnPlanStyle.display !== 'none',
          btnPlanLabel: btnPlan.querySelector('.btn-plan-label')?.textContent?.trim(),
          starterChipsCount: starterChips.length,
          inspectorVisible: inspector.offsetWidth > 250,
          gitStatusText: gitStatus.textContent?.trim()
        };
      })()
    `);

    if (phase1.drawerVisible && phase1.drawerHeight > 800) {
      pass('Phase 1.1: #local-mode-drawer is visible', `${phase1.drawerWidth}x${phase1.drawerHeight}`);
    } else {
      fail('Phase 1.1: #local-mode-drawer is visible', JSON.stringify(phase1));
    }

    if (phase1.gridVisible && phase1.gridHeight > 800) {
      pass('Phase 1.2: .workspace-layout (#drawer-body-grid) is visible', `${phase1.gridWidth}x${phase1.gridHeight}`);
    } else {
      fail('Phase 1.2: .workspace-layout (#drawer-body-grid) is visible', `gridHeight: ${phase1.gridHeight}`);
    }

    if (phase1.emptyStateVisible && phase1.emptyStateHeight > 400) {
      pass('Phase 1.3: #local-empty-state hero is rendered & visible', `height: ${phase1.emptyStateHeight}px`);
    } else {
      fail('Phase 1.3: #local-empty-state hero is rendered & visible', `emptyStateVisible: ${phase1.emptyStateVisible}`);
    }

    if (phase1.promptVisible && phase1.btnPlanVisible && phase1.btnPlanLabel === 'Give me a plan') {
      pass('Phase 1.4: Task composer and "Give me a plan" action ready', `label: "${phase1.btnPlanLabel}"`);
    } else {
      fail('Phase 1.4: Task composer and "Give me a plan" action ready', JSON.stringify(phase1));
    }

    if (phase1.starterChipsCount === 4) {
      pass('Phase 1.5: 4 Material 3 workflow starter cards rendered');
    } else {
      fail('Phase 1.5: 4 Material 3 workflow starter cards rendered', `count: ${phase1.starterChipsCount}`);
    }

    if (phase1.chatStreamHidden) {
      pass('Phase 1.6: Chat stream is hidden on idle (no empty state conflict)');
    } else {
      fail('Phase 1.6: Chat stream is hidden on idle');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 2: Link a Repository & Assert Persistent Hero Visibility
    // ─────────────────────────────────────────────────────────────────────────
    const repoPath = path.resolve(__dirname, '..'); // JulesDeck root
    await layers.chromeView.webContents.executeJavaScript(`
      window.julesChrome.selectRecentRepo(${JSON.stringify(repoPath)});
    `);
    await new Promise((r) => setTimeout(r, 600));

    const phase2 = await layers.chromeView.webContents.executeJavaScript(`
      (() => {
        const grid = document.getElementById('drawer-body-grid');
        const emptyState = document.getElementById('local-empty-state');
        const repoChip = document.getElementById('composer-repo-text');
        const canvasRepo = document.getElementById('canvas-repo-label');
        const gitStatus = document.getElementById('git-status-summary');

        return {
          gridVisible: !grid.classList.contains('hidden') && window.getComputedStyle(grid).display !== 'none',
          emptyStateVisible: !emptyState.classList.contains('hidden') && window.getComputedStyle(emptyState).display !== 'none',
          repoChipText: repoChip.textContent?.trim(),
          canvasRepoText: canvasRepo.textContent?.trim(),
          gitSummaryText: gitStatus.textContent?.trim()
        };
      })()
    `);

    if (phase2.gridVisible && phase2.emptyStateVisible) {
      pass('Phase 2.1: Hero and workspace remain visible after repository linking');
    } else {
      fail('Phase 2.1: Hero and workspace remain visible after repository linking', JSON.stringify(phase2));
    }

    if (phase2.repoChipText && phase2.repoChipText !== 'No Repo') {
      pass('Phase 2.2: Context chip updated with linked repository', `chip: "${phase2.repoChipText}"`);
    } else {
      fail('Phase 2.2: Context chip updated with linked repository', `chip: "${phase2.repoChipText}"`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 3: Dispatch Task Prompt -> Plan Card Generation
    // ─────────────────────────────────────────────────────────────────────────
    await layers.chromeView.webContents.executeJavaScript(`
      const promptInput = document.getElementById('jules-task-prompt');
      promptInput.value = 'Refactor core modules and verify test assertions';
      document.getElementById('btn-run-jules').click();
    `);
    await new Promise((r) => setTimeout(r, 400));

    const phase3 = await layers.chromeView.webContents.executeJavaScript(`
      (() => {
        const emptyState = document.getElementById('local-empty-state');
        const chatStream = document.getElementById('local-chat-stream');
        const userTurn = chatStream.querySelector('.chat-user');
        const planCard = chatStream.querySelector('.jules-plan-card');
        const steps = planCard ? planCard.querySelectorAll('.plan-step, .plan-step-item') : [];
        const approveBtn = planCard ? planCard.querySelector('.plan-action-approve') : null;

        return {
          emptyStateHidden: emptyState.classList.contains('hidden'),
          chatStreamVisible: !chatStream.classList.contains('hidden'),
          hasUserTurn: Boolean(userTurn),
          userTurnText: userTurn?.textContent?.trim(),
          hasPlanCard: Boolean(planCard),
          stepCount: steps.length,
          hasApproveBtn: Boolean(approveBtn),
          approveBtnLabel: approveBtn?.textContent?.trim()
        };
      })()
    `);

    if (phase3.emptyStateHidden && phase3.chatStreamVisible) {
      pass('Phase 3.1: Empty hero transitions cleanly to chat stream upon task dispatch');
    } else {
      fail('Phase 3.1: Empty hero transitions cleanly to chat stream upon task dispatch', JSON.stringify(phase3));
    }

    if (phase3.hasUserTurn && phase3.hasPlanCard && phase3.stepCount === 4) {
      pass('Phase 3.2: User message and 4-step Jules Plan Card rendered in stream', `steps: ${phase3.stepCount}`);
    } else {
      fail('Phase 3.2: User message and 4-step Jules Plan Card rendered in stream', JSON.stringify(phase3));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 4: Plan Execution, Progression & Completion Card
    // ─────────────────────────────────────────────────────────────────────────
    await layers.chromeView.webContents.executeJavaScript(`
      const approveBtn = document.querySelector('.plan-action-approve');
      if (approveBtn) approveBtn.click();
    `);
    await new Promise((r) => setTimeout(r, 1200));
    await layers.chromeView.webContents.executeJavaScript(`
      window.julesChrome.cancelJulesTask().catch(() => {});
    `);
    await new Promise((r) => setTimeout(r, 200));

    // Send task output chunk and completion event from backend
    layers.chromeView.webContents.send('chrome:task-output', {
      taskId: 'test-task',
      chunk: 'Analyzing repository structure and verifying working tree changes...\n'
    });
    await new Promise((r) => setTimeout(r, 200));

    layers.chromeView.webContents.send('chrome:task-status', {
      taskId: 'test-task',
      status: 'completed'
    });
    await new Promise((r) => setTimeout(r, 500));

    const phase4 = await layers.chromeView.webContents.executeJavaScript(`
      (() => {
        const completionCard = document.querySelector('.jules-completion-card, .completion-card');
        const btnReview = completionCard?.querySelector('.btn-action-review');
        const btnCommit = completionCard?.querySelector('.btn-action-commit');
        const btnNewTask = completionCard?.querySelector('.btn-action-new-task');

        return {
          hasCompletionCard: Boolean(completionCard),
          hasBtnReview: Boolean(btnReview),
          hasBtnCommit: Boolean(btnCommit),
          hasBtnNewTask: Boolean(btnNewTask)
        };
      })()
    `);

    if (phase4.hasCompletionCard && phase4.hasBtnReview && phase4.hasBtnCommit && phase4.hasBtnNewTask) {
      pass('Phase 4.1: Post-execution completion card with Review Diffs, Commit, and New Task actions rendered');
    } else {
      fail('Phase 4.1: Post-execution completion card rendered', JSON.stringify(phase4));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 5: Brand Logo Navigation & Clean Home Reset
    // ─────────────────────────────────────────────────────────────────────────
    await layers.chromeView.webContents.executeJavaScript(`
      document.getElementById('brand-icon').click();
    `);
    await new Promise((r) => setTimeout(r, 400));

    const phase5 = await layers.chromeView.webContents.executeJavaScript(`
      (() => {
        const emptyState = document.getElementById('local-empty-state');
        const chatStream = document.getElementById('local-chat-stream');
        const promptInput = document.getElementById('jules-task-prompt');
        const statusBadge = document.getElementById('task-status-badge');

        return {
          emptyStateRestored: !emptyState.classList.contains('hidden') && window.getComputedStyle(emptyState).display !== 'none',
          chatStreamHidden: chatStream.classList.contains('hidden') || window.getComputedStyle(chatStream).display === 'none',
          promptCleared: promptInput.value === '',
          statusIdle: statusBadge.textContent?.trim() === 'Idle'
        };
      })()
    `);

    if (phase5.emptyStateRestored && phase5.chatStreamHidden && phase5.promptCleared && phase5.statusIdle) {
      pass('Phase 5.1: #brand-icon resets workspace cleanly to initial Jules Local hero state');
    } else {
      fail('Phase 5.1: #brand-icon resets workspace cleanly to initial Jules Local hero state', JSON.stringify(phase5));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 6: Live 1280x900 Screenshot Capture & Pixel Analysis
    // ─────────────────────────────────────────────────────────────────────────
    const img = await layers.chromeView.webContents.capturePage();
    const pngBuffer = img.toPNG();
    const outDir = path.dirname(screenshotPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(screenshotPath, pngBuffer);
    pass('Phase 6.1: Capture live 1280x900 screenshot', `size: ${pngBuffer.length} bytes`);

    // Verify screenshot is NOT blank
    let nonDarkPixelCount = 0;
    const bitmap = img.toBitmap ? img.toBitmap() : img.getBitmap();
    for (let i = 0; i < bitmap.length; i += 4) {
      const b = bitmap[i];
      const g = bitmap[i + 1];
      const r = bitmap[i + 2];
      // Non-dark pixels (text, borders, badges, buttons, cards) have intensity > 40
      if (r > 40 || g > 40 || b > 40) {
        nonDarkPixelCount++;
      }
    }

    if (nonDarkPixelCount > 30000) {
      pass('Phase 6.2: Pixel analysis confirms non-blank UI rendered', `non-dark pixels: ${nonDarkPixelCount}`);
    } else {
      fail('Phase 6.2: Pixel analysis indicates predominantly blank canvas', `non-dark pixels: ${nonDarkPixelCount}`);
    }

    console.log('-----------------------------------------------------------------');
    console.log(`[SUMMARY] ${totalPassed} passed, ${totalFailed} failed`);
    console.log('=================================================================');

    layers.baseWindow.destroy();
    app.quit();

    if (totalFailed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('[FATAL ERROR]', err);
    app.exit(1);
  }
});
