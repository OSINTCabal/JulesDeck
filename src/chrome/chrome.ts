import type {
  AgentEngineId,
  EngineStatusInfo,
  GitHubAuthStatus,
  GitHubRepoItem,
  GitReviewDetails,
  JulesCliStatus,
  JulesSessionItem,
  LegacyJulesHealth,
  NavigationState,
  PublishPrOptions,
  PublishPrResult,
  RecentRepoItem,
  RunTaskOptions,
  StandalonePlanStep,
  StandaloneSessionMessage,
  StandaloneSessionRecord,
  TaskOutputChunk,
  TaskStatusEvent,
  WorkspaceMode
} from '../shared/types.js';

document.addEventListener('DOMContentLoaded', async () => {
  const jules = window.julesChrome;

  // Navigation
  const btnBack = document.getElementById('btn-back') as HTMLButtonElement | null;
  const btnForward = document.getElementById('btn-forward') as HTMLButtonElement | null;
  const btnReload = document.getElementById('btn-reload') as HTMLButtonElement | null;

  // Segmented Mode Switcher (Cloud vs Local vs Standalone Repo)
  const tabRepoMode = document.getElementById('tab-repo-mode') as HTMLButtonElement | null;
  const tabRepoLabel = document.getElementById('tab-repo-label') as HTMLElement | null;
  const tabRepoBadge = document.getElementById('tab-repo-badge') as HTMLElement | null;
  const tabCloudMode = document.getElementById('tab-cloud-mode') as HTMLButtonElement | null;
  const tabCloudLabel = document.getElementById('tab-cloud-label') as HTMLElement | null;
  const tabCloudBadge = document.getElementById('tab-cloud-badge') as HTMLElement | null;
  const tabLocalMode = document.getElementById('tab-local-mode') as HTMLButtonElement | null;
  const tabLocalLabel = document.getElementById('tab-local-label') as HTMLElement | null;
  const tabLocalBadge = document.getElementById('tab-local-badge') as HTMLElement | null;
  const tabLegacyCloudMode = document.getElementById('tab-legacy-cloud-mode') as HTMLButtonElement | null;

  // Studio Workspace Mode Switcher (GitHub Repo vs Local Folder)
  const workspaceModeSwitcher = document.getElementById('workspace-mode-switcher') as HTMLElement | null;
  const btnWorkspaceModeRepo = document.getElementById('btn-workspace-mode-repo') as HTMLButtonElement | null;
  const btnWorkspaceModeLocal = document.getElementById('btn-workspace-mode-local') as HTMLButtonElement | null;
  const canvasBrandTitle = document.getElementById('canvas-brand-title') as HTMLElement | null;

  // Hero Section Dynamic Elements
  const heroTitleKicker = document.getElementById('hero-title-kicker') as HTMLElement | null;
  const heroModePill = document.getElementById('hero-mode-pill') as HTMLElement | null;
  const heroTitleSub = document.getElementById('hero-title-sub') as HTMLElement | null;
  const heroSubtitle = document.getElementById('hero-subtitle') as HTMLElement | null;

  // GitHub Repo Live Search & Section in Canvas Dropdown
  const githubRepoSearchInput = document.getElementById('github-repo-search-input') as HTMLInputElement | null;
  const btnGithubConnectClone = document.getElementById('btn-github-connect-clone') as HTMLButtonElement | null;
  const githubRepoSection = document.getElementById('github-repo-section') as HTMLElement | null;
  const btnRefreshGithubRepos = document.getElementById('btn-refresh-github-repos') as HTMLButtonElement | null;
  const githubReposList = document.getElementById('github-repos-list') as HTMLElement | null;

  // GitHub Branch & PR Publisher Panel
  const githubPrPublisherSection = document.getElementById('github-pr-publisher-section') as HTMLElement | null;
  const prStatusBadge = document.getElementById('pr-status-badge') as HTMLElement | null;
  const prTaskBranchBadge = document.getElementById('pr-task-branch-badge') as HTMLElement | null;
  const prBaseBranchBadge = document.getElementById('pr-base-branch-badge') as HTMLElement | null;
  const inputPrTitle = document.getElementById('input-pr-title') as HTMLInputElement | null;
  const inputPrBody = document.getElementById('input-pr-body') as HTMLTextAreaElement | null;
  const btnPublishBranch = document.getElementById('btn-publish-branch') as HTMLButtonElement | null;
  const btnPublishPr = document.getElementById('btn-publish-pr') as HTMLButtonElement | null;
  const prResultBanner = document.getElementById('pr-result-banner') as HTMLElement | null;
  const prResultMessage = document.getElementById('pr-result-message') as HTMLElement | null;
  const prResultLink = document.getElementById('pr-result-link') as HTMLAnchorElement | null;

  // Local Repo Bar & Drawer Containers
  const btnSelectRepo = document.getElementById('btn-select-repo') as HTMLButtonElement | null;
  const repoSelectLabel = document.getElementById('repo-select-label') as HTMLElement | null;
  const repoStatusBadge = document.getElementById('repo-status-badge') as HTMLElement | null;
  const btnClearRepo = document.getElementById('btn-clear-repo') as HTMLButtonElement | null;
  const localEmptyState = document.getElementById('local-empty-state') as HTMLElement | null;
  const btnEmptySelectRepo = document.getElementById('btn-empty-select-repo') as HTMLButtonElement | null;
  const btnEmptyInitRepo = document.getElementById('btn-empty-init-repo') as HTMLButtonElement | null;
  const drawerBodyGrid = document.getElementById('drawer-body-grid') as HTMLElement | null;
  const drawerFooter = document.getElementById('drawer-footer') as HTMLElement | null;

  // Window Controls
  const dragRegion = document.getElementById('drag-region') as HTMLElement | null;
  const btnMinimize = document.getElementById('btn-minimize') as HTMLButtonElement | null;
  const btnMaximize = document.getElementById('btn-maximize') as HTMLButtonElement | null;
  const btnClose = document.getElementById('btn-close') as HTMLButtonElement | null;
  const iconMaximize = document.getElementById('icon-maximize') as HTMLElement | null;
  const iconRestore = document.getElementById('icon-restore') as HTMLElement | null;
  const loadingBar = document.getElementById('loading-bar') as HTMLElement | null;

  // App & Session Menu
  const btnAppMenu = document.getElementById('btn-app-menu') as HTMLButtonElement | null;
  const appMenuDropdown = document.getElementById('app-menu-dropdown') as HTMLElement | null;
  const diagnosticDot = document.getElementById('diagnostic-dot') as HTMLElement | null;
  const diagnosticVersionBadge = document.getElementById('diagnostic-version-badge') as HTMLElement | null;
  const menuBtnSettings = document.getElementById('menu-btn-settings') as HTMLButtonElement | null;
  const menuBtnSyncSession = document.getElementById('menu-btn-sync-session') as HTMLButtonElement | null;
  const syncSessionText = document.getElementById('sync-session-text') as HTMLElement | null;
  const syncIconSvg = document.getElementById('sync-icon-svg') as HTMLElement | null;
  const menuAccountsList = document.getElementById('menu-accounts-list') as HTMLElement | null;
  const menuBtnAddAccount = document.getElementById('menu-btn-add-account') as HTMLButtonElement | null;
  const menuBtnOpenFolder = document.getElementById('menu-btn-open-folder') as HTMLButtonElement | null;
  const menuBtnReload = document.getElementById('menu-btn-reload') as HTMLButtonElement | null;
  const menuBtnLogout = document.getElementById('menu-btn-logout') as HTMLButtonElement | null;

  // Local Mode Studio & Sidebar
  const localModeDrawer = document.getElementById('local-mode-drawer') as HTMLElement | null;
  const drawerRepoTitle = document.getElementById('drawer-repo-title') as HTMLElement | null;
  const drawerRepoMeta = document.getElementById('drawer-repo-meta') as HTMLElement | null;
  const drawerModeIndicator = document.getElementById('drawer-mode-indicator') as HTMLElement | null;
  const drawerCliPill = document.getElementById('drawer-cli-pill') as HTMLElement | null;
  const btnRefreshGit = document.getElementById('btn-refresh-git') as HTMLButtonElement | null;
  const btnCloseDrawer = document.getElementById('btn-close-drawer') as HTMLButtonElement | null;
  const gitStatusSummary = document.getElementById('git-status-summary') as HTMLElement | null;
  const gitStatusContent = document.getElementById('git-status-content') as HTMLElement | null;
  const gitDiffViewer = document.getElementById('git-diff-viewer') as HTMLElement | null;
  const diffFileTitle = document.getElementById('diff-file-title') as HTMLElement | null;
  const diffContentBody = document.getElementById('diff-content-body') as HTMLElement | null;
  const btnCloseDiff = document.getElementById('btn-close-diff') as HTMLButtonElement | null;
  const gitCommitsContent = document.getElementById('git-commits-content') as HTMLElement | null;
  const btnCopySlug = document.getElementById('btn-copy-slug') as HTMLButtonElement | null;
  const copySlugLabel = document.getElementById('copy-slug-label') as HTMLElement | null;
  const btnOpenFolder = document.getElementById('btn-open-folder') as HTMLButtonElement | null;
  const btnChangeRepo = document.getElementById('btn-change-repo') as HTMLButtonElement | null;
  const recentChipsContainer = document.getElementById('recent-chips-container') as HTMLElement | null;

  // Studio Sidebar Elements
  const btnNewTask = document.getElementById('btn-new-task') as HTMLButtonElement | null;
  const btnSidebarDocs = document.getElementById('btn-sidebar-docs') as HTMLButtonElement | null;
  const btnSidebarSettings = document.getElementById('btn-sidebar-settings') as HTMLButtonElement | null;
  const btnSidebarFeedback = document.getElementById('btn-sidebar-feedback') as HTMLButtonElement | null;
  const sidebarActiveRepoCard = document.getElementById('sidebar-active-repo-card') as HTMLElement | null;
  const sidebarRepoName = document.getElementById('sidebar-repo-name') as HTMLElement | null;
  const sidebarBranchBadge = document.getElementById('sidebar-branch-badge') as HTMLElement | null;
  const sidebarStatusBadge = document.getElementById('sidebar-status-badge') as HTMLElement | null;
  const sidebarAvatarInitial = document.getElementById('sidebar-avatar-initial') as HTMLElement | null;

  // Dropdown Elements
  const repoPickerDropdown = document.getElementById('repo-picker-dropdown') as HTMLElement | null;
  const dropdownActiveRepo = document.getElementById('dropdown-active-repo') as HTMLElement | null;
  const dropdownRecentRepos = document.getElementById('dropdown-recent-repos') as HTMLElement | null;
  const dropdownBtnOpen = document.getElementById('dropdown-btn-open') as HTMLButtonElement | null;
  const dropdownBtnInit = document.getElementById('dropdown-btn-init') as HTMLButtonElement | null;
  const dropdownBtnDetach = document.getElementById('dropdown-btn-detach') as HTMLButtonElement | null;

  const btnCanvasRepoSelect = document.getElementById('btn-canvas-repo-select') as HTMLButtonElement | null;
  const canvasRepoLabel = document.getElementById('canvas-repo-label') as HTMLElement | null;
  const canvasRepoDropdown = document.getElementById('canvas-repo-dropdown') as HTMLElement | null;
  const canvasDropdownActiveRepo = document.getElementById('canvas-dropdown-active-repo') as HTMLElement | null;
  const canvasDropdownRecentRepos = document.getElementById('canvas-dropdown-recent-repos') as HTMLElement | null;
  const canvasDropdownBtnOpen = document.getElementById('canvas-dropdown-btn-open') as HTMLButtonElement | null;
  const canvasDropdownBtnInit = document.getElementById('canvas-dropdown-btn-init') as HTMLButtonElement | null;
  const btnCanvasBranchSelect = document.getElementById('btn-canvas-branch-select') as HTMLButtonElement | null;
  const canvasBranchLabel = document.getElementById('canvas-branch-label') as HTMLElement | null;
  const branchPickerDropdown = document.getElementById('branch-picker-dropdown') as HTMLElement | null;
  const branchListContainer = document.getElementById('branch-list-container') as HTMLElement | null;

  const btnCanvasModelSelect = document.getElementById('btn-canvas-model-select') as HTMLButtonElement | null;
  const canvasModelLabel = document.getElementById('canvas-model-label') as HTMLElement | null;
  const modelPickerDropdown = document.getElementById('model-picker-dropdown') as HTMLElement | null;

  const btnToggleInspector = document.getElementById('btn-toggle-inspector') as HTMLButtonElement | null;
  const workspaceInspector = document.getElementById('workspace-inspector') as HTMLElement | null;

  // Composer & Execution
  const composerRepoText = document.getElementById('composer-repo-text') as HTMLElement | null;
  const composerBranchText = document.getElementById('composer-branch-text') as HTMLElement | null;
  const localChatStream = document.getElementById('local-chat-stream') as HTMLElement | null;

  // Persistent Composer Placement (empty state ⇄ chat dock) & Composer Chips
  const localComposerBox = document.getElementById('local-composer-box') as HTMLElement | null;
  const localChatComposerDock = document.getElementById('local-chat-composer-dock') as HTMLElement | null;
  const composerRepoChip = document.getElementById('composer-repo-chip') as HTMLElement | null;
  const composerBranchChip = document.getElementById('composer-branch-chip') as HTMLElement | null;
  const diffFileStats = document.getElementById('diff-file-stats') as HTMLElement | null;

  const inputCommitMsg = document.getElementById('input-commit-msg') as HTMLInputElement | null;
  const btnGitCommit = document.getElementById('btn-git-commit') as HTMLButtonElement | null;

  // Jules Task Runner & Streaming Terminal
  const julesTaskPrompt = document.getElementById('jules-task-prompt') as HTMLTextAreaElement | null;
  const btnRunJules = document.getElementById('btn-run-jules') as HTMLButtonElement | null;
  const btnRefreshSessions = document.getElementById('btn-refresh-sessions') as HTMLButtonElement | null;
  const btnClearSessions = document.getElementById('btn-clear-sessions') as HTMLButtonElement | null;
  const julesTerminalOutput = document.getElementById('jules-terminal-output') as HTMLElement | null;
  const terminalContainer = document.getElementById('terminal-container') as HTMLElement | null;
  const terminalLiveStatus = document.getElementById('terminal-live-status') as HTMLElement | null;
  const btnToggleTerminalBody = document.getElementById('btn-toggle-terminal-body') as HTMLButtonElement | null;
  const iconTerminalToggle = document.getElementById('icon-terminal-toggle') as HTMLElement | null;
  const taskStatusBadge = document.getElementById('task-status-badge') as HTMLElement | null;
  const terminalSessionPill = document.getElementById('terminal-session-pill') as HTMLElement | null;
  const btnClearTerminal = document.getElementById('btn-clear-terminal') as HTMLButtonElement | null;
  const btnCancelTask = document.getElementById('btn-cancel-task') as HTMLButtonElement | null;
  const julesSessionsList = document.getElementById('jules-sessions-list') as HTMLElement | null;
  const sidebarAccountName = document.getElementById('sidebar-account-name') as HTMLElement | null;
  const sidebarAccountPill = document.getElementById('sidebar-account-pill') as HTMLElement | null;

  // Add Account Modal
  const addAccountModal = document.getElementById('add-account-modal') as HTMLElement | null;
  const btnCloseAccountModal = document.getElementById('btn-close-account-modal') as HTMLButtonElement | null;
  const btnCancelAccountModal = document.getElementById('btn-cancel-account-modal') as HTMLButtonElement | null;
  const btnConfirmAddAccount = document.getElementById('btn-confirm-add-account') as HTMLButtonElement | null;
  const inputAccountName = document.getElementById('input-account-name') as HTMLInputElement | null;

  // Google Jules Webchat UI Clone Elements (GitHub / Repo Mode)
  const swebotNavbar = document.getElementById('swebot-navbar') as HTMLElement | null;
  const swebotTaskView = document.getElementById('swebot-task-view') as HTMLElement | null;
  const btnToggleJulesSidebar = document.getElementById('btn-toggle-jules-sidebar') as HTMLButtonElement | null;
  const btnJulesHomeLogo = document.getElementById('btn-jules-home-logo') as HTMLButtonElement | null;
  const btnNavbarNewSession = document.getElementById('btn-navbar-new-session') as HTMLButtonElement | null;
  const btnSessionBackHome = document.getElementById('btn-session-back-home') as HTMLButtonElement | null;
  const julesActiveSessionTitle = document.getElementById('jules-active-session-title') as HTMLElement | null;
  const btnSessionPause = document.getElementById('btn-session-pause') as HTMLButtonElement | null;
  const btnSessionToggleCode = document.getElementById('btn-session-toggle-code') as HTMLButtonElement | null;

  // Repo Dropdown Combobox & Popover
  const btnJulesRepoDropdown = document.getElementById('btn-jules-repo-dropdown') as HTMLButtonElement | null;
  const julesRepoDropdownLabel = (document.getElementById('jules-repo-dropdown-label') || btnJulesRepoDropdown?.querySelector('.repo-name-text')) as HTMLElement | null;
  const julesRepoDropdownMenu = document.getElementById('jules-repo-dropdown-menu') as HTMLElement | null;
  const julesRepoFilterInput = document.getElementById('jules-repo-filter-input') as HTMLInputElement | null;
  const julesRepoDropdownList = document.getElementById('jules-repo-dropdown-list') as HTMLElement | null;
  const btnConfigureRepoAccess = document.getElementById('btn-configure-repo-access') as HTMLButtonElement | null;
  const btnConfigureRepoTop = document.getElementById('btn-configure-repo-top') as HTMLButtonElement | null;
  const btnDetachRepo = document.getElementById('btn-detach-repo') as HTMLButtonElement | null;
  const navbarSessionBreadcrumb = document.getElementById('navbar-session-breadcrumb') as HTMLElement | null;
  const breadcrumbRepoText = document.getElementById('breadcrumb-repo-text') as HTMLElement | null;

  // Left Sidebar Jules Elements
  const workspaceSidebar = document.getElementById('workspace-sidebar') as HTMLElement | null;
  const btnCollapseSidebarInner = document.getElementById('btn-collapse-sidebar-inner') as HTMLButtonElement | null;
  const julesSidebarSearch = document.getElementById('jules-sidebar-search') as HTMLInputElement | null;
  const sidebarSectionSessions = document.getElementById('sidebar-section-sessions') as HTMLElement | null;
  const sidebarSectionCodebases = document.getElementById('sidebar-section-codebases') as HTMLElement | null;
  const githubSessionsList = document.getElementById('github-sessions-list') as HTMLElement | null;
  const githubCodebasesList = document.getElementById('github-codebases-list') as HTMLElement | null;
  const btnSessionsViewMore = document.getElementById('btn-sessions-view-more') as HTMLButtonElement | null;
  const btnJulesDocs = document.getElementById('btn-jules-docs') as HTMLButtonElement | null;
  const btnJulesDiscord = document.getElementById('btn-jules-discord') as HTMLButtonElement | null;
  const btnJulesX = document.getElementById('btn-jules-x') as HTMLButtonElement | null;

  // Overview Tabs & Skill Agents Elements
  const julesHomeTabs = document.querySelectorAll<HTMLButtonElement>('.jules-home-tab');
  const julesTabOverview = document.getElementById('jules-tab-overview') as HTMLElement | null;
  const julesTabSuggested = document.getElementById('jules-tab-suggested') as HTMLElement | null;
  const julesTabScheduled = document.getElementById('jules-tab-scheduled') as HTMLElement | null;
  const toggleAutoFindIssues = document.getElementById('toggle-auto-find-issues') as HTMLInputElement | null;
  const julesOverviewSessionsCard = document.getElementById('jules-overview-sessions-card') as HTMLElement | null;
  const btnSkillPerf = document.getElementById('btn-skill-perf') as HTMLButtonElement | null;
  const btnSkillDesign = document.getElementById('btn-skill-design') as HTMLButtonElement | null;
  const btnSkillSec = document.getElementById('btn-skill-sec') as HTMLButtonElement | null;

  // Follow-up Chat & Bottom Talk Bar Elements
  const julesBottomTalkBar = document.getElementById('jules-bottom-talk-bar') as HTMLElement | null;
  const julesTalkForm = document.getElementById('jules-talk-form') as HTMLFormElement | null;
  const julesFollowupInput = document.getElementById('jules-followup-input') as HTMLTextAreaElement | null;
  const btnSendFollowup = document.getElementById('btn-send-followup') as HTMLButtonElement | null;

  let currentState: NavigationState | null = null;
  let isDrawerOpen = false;
  let isMenuOpen = false;
  let isRepoDropdownOpen = false;
  let isCanvasRepoDropdownOpen = false;
  let isBranchDropdownOpen = false;
  let isModelDropdownOpen = false;
  let isJulesRepoDropdownOpen = false;
  let isSessionActive = false;
  let isAutoScrollEnabled = true;

  // Typewriter placeholder animation state for repo mode
  const TYPEWRITER_PHRASES = [
    'Diagnose this memory leak ...',
    'Write a README for this project ...',
    'Add integration tests for the API ...',
    'Convert commonjs modules to esm ...',
    'Ask Jules to work on a session'
  ];
  let typewriterTimeout: ReturnType<typeof setTimeout> | null = null;
  let typewriterPhraseIndex = 0;
  let typewriterCharIndex = 0;
  let isTypewriterDeleting = false;
  let isPromptFocused = false;
  let currentMode: WorkspaceMode = 'cloud';
  let workspaceSubMode: 'repo' | 'local' = 'local';
  let selectedEngine: AgentEngineId = 'gemini-cli';
  let selectedModel: string = 'gemini-3.1-pro';
  let currentTaskBranch: string = 'jules/task-branch';
  let currentBaseBranch: string = 'main';
  let currentWorkspacePath: string = '';
  let activeStandaloneSessionId: string | null = null;
  let cachedGithubRepos: GitHubRepoItem[] = [];
  let currentGithubRepo: GitHubRepoItem | null = null;
  let logoutConfirm = false;
  let logoutTimer: ReturnType<typeof setTimeout> | null = null;
  let lastKnownRepoPath: string | undefined = undefined;
  let latestGitReviewDetails: GitReviewDetails | null = null;
  let hasAppendedCompletionCard = false;

  // ── Local Workspace Session History (Jules Local sidebar) ───────────────
  interface LocalWorkspaceSession {
    id: string;
    description: string;
    status: 'active' | 'completed' | 'failed';
    lastActive: string;
    repoPath?: string;
    chatHtml: string;
  }

  const localWorkspaceSessions: LocalWorkspaceSession[] = [];

  /** Compact clock stamp used as the "last active" label of a local session. */
  function localSessionTimestamp(): string {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /** Creates (or refreshes) the local workspace session entry for a prompt. */
  function upsertLocalWorkspaceSession(
    description: string,
    status: 'active' | 'completed' | 'failed'
  ): LocalWorkspaceSession {
    const repoPath = currentState?.localRepo?.path;
    const existing = localWorkspaceSessions.find(
      (session) =>
        session.description === description &&
        (session.repoPath || undefined) === (repoPath || undefined)
    );

    if (existing) {
      existing.status = status;
      existing.lastActive = localSessionTimestamp();
      existing.chatHtml = localChatStream?.innerHTML || '';
      return existing;
    }

    const session: LocalWorkspaceSession = {
      id: `local-${Date.now()}-${localWorkspaceSessions.length + 1}`,
      description,
      status,
      lastActive: localSessionTimestamp(),
      repoPath,
      chatHtml: localChatStream?.innerHTML || ''
    };
    localWorkspaceSessions.unshift(session);
    return session;
  }

  /** Marks the running local workspace session as finished and snapshots the chat. */
  function updateActiveLocalWorkspaceSession(status: 'completed' | 'failed'): void {
    const active = localWorkspaceSessions.find((session) => session.status === 'active');
    if (!active) return;
    active.status = status;
    active.chatHtml = localChatStream?.innerHTML || '';
    active.lastActive = localSessionTimestamp();
  }

  // ── Document Title & Mode Naming (Google Jules parity) ─────────────────
  const CLOUD_DOCUMENT_TITLE = 'JulesDeck — Cloud Jules';
  const LOCAL_DOCUMENT_TITLE = 'Jules Local';
  const LOCAL_MODE_LABEL = 'Jules Local';
  const LOCAL_MODE_TOOLTIP = 'Jules Local: Git Workspace & CLI Runner (Ctrl+2 or Alt+2)';
  const CLOUD_MODE_TOOLTIP = 'Cloud Jules: Google Jules Web Client (Ctrl+1 or Alt+1)';

  /** Keeps `document.title` in sync with the active mode + linked repository. */
  function updateDocumentTitle() {
    if (currentMode === 'local' || (currentMode as string) === 'repo') {
      const repoName = currentState?.localRepo?.name || currentGithubRepo?.name;
      const modePrefix = workspaceSubMode === 'repo' ? 'GitHub Jules' : LOCAL_DOCUMENT_TITLE;
      document.title = repoName
        ? `${modePrefix} — ${repoName}`
        : modePrefix;
    } else {
      document.title = CLOUD_DOCUMENT_TITLE;
    }
  }

  /** Applies the 'Jules Local' naming to the mode switcher labels/tooltips. */
  function applyModeLabels() {
    if (tabLocalLabel) tabLocalLabel.textContent = LOCAL_MODE_LABEL;
    if (tabCloudLabel) tabCloudLabel.textContent = 'Cloud Jules';
    if (tabRepoLabel) tabRepoLabel.textContent = 'GitHub Repo';
    tabLocalMode?.setAttribute('title', LOCAL_MODE_TOOLTIP);
    tabCloudMode?.setAttribute('title', CLOUD_MODE_TOOLTIP);
    tabRepoMode?.setAttribute('title', 'GitHub / Repo Mode: Standalone Google Jules Web App for GitHub Repositories (Ctrl+3)');
    tabLegacyCloudMode?.setAttribute('title', 'Optional Legacy jules.google.com Web View (auto-hidden when Google sunsets Jules)');
    if (tabLocalBadge) {
      tabLocalBadge.title = `${LOCAL_MODE_LABEL}: pending working tree changes`;
    }
    if (tabRepoBadge) {
      tabRepoBadge.title = 'GitHub Repo: Standalone Mode';
    }
    if (workspaceModeSwitcher) {
      workspaceModeSwitcher.setAttribute('aria-label', 'Workspace Mode Switcher');
    }
  }

  /**
   * Toggles between Home Task Creation View (data-session-active="false")
   * and Active Session View (data-session-active="true").
   */
  function setSessionActive(active: boolean, title?: string) {
    isSessionActive = active;
    const activeStr = active ? 'true' : 'false';
    localModeDrawer?.setAttribute('data-session-active', activeStr);
    drawerBodyGrid?.setAttribute('data-session-active', activeStr);
    swebotTaskView?.setAttribute('data-session-active', activeStr);
    swebotNavbar?.setAttribute('data-session-active', activeStr);
    julesBottomTalkBar?.setAttribute('data-session-active', activeStr);

    if (active) {
      stopTypewriter();
      if (title && julesActiveSessionTitle) {
        const cleanTitle = title.trim();
        julesActiveSessionTitle.textContent = cleanTitle.startsWith('Session:')
          ? cleanTitle
          : `Session: ${cleanTitle}`;
      }
      localEmptyState?.classList.add('hidden');
      localChatStream?.classList.remove('hidden');
    } else {
      localEmptyState?.classList.remove('hidden');
      if (workspaceSubMode === 'repo' && (!julesTaskPrompt || !julesTaskPrompt.value.trim())) {
        startTypewriter();
      }
    }
  }

  /** Starts smoothly cycling placeholder text among sample prompts in Repo mode. */
  function startTypewriter() {
    stopTypewriter();
    if (workspaceSubMode !== 'repo' || !julesTaskPrompt || isPromptFocused || julesTaskPrompt.value.trim().length > 0) {
      return;
    }

    function tick() {
      if (workspaceSubMode !== 'repo' || !julesTaskPrompt || isPromptFocused || julesTaskPrompt.value.trim().length > 0) {
        stopTypewriter();
        return;
      }
      const currentPhrase = TYPEWRITER_PHRASES[typewriterPhraseIndex % TYPEWRITER_PHRASES.length] || 'Ask Jules to work on a session';
      if (!isTypewriterDeleting) {
        typewriterCharIndex++;
        julesTaskPrompt.placeholder = currentPhrase.slice(0, typewriterCharIndex);
        if (typewriterCharIndex >= currentPhrase.length) {
          isTypewriterDeleting = true;
          typewriterTimeout = setTimeout(tick, 2200);
          return;
        }
        typewriterTimeout = setTimeout(tick, 60);
      } else {
        typewriterCharIndex--;
        julesTaskPrompt.placeholder = currentPhrase.slice(0, typewriterCharIndex);
        if (typewriterCharIndex <= 0) {
          isTypewriterDeleting = false;
          typewriterPhraseIndex = (typewriterPhraseIndex + 1) % TYPEWRITER_PHRASES.length;
          typewriterTimeout = setTimeout(tick, 400);
          return;
        }
        typewriterTimeout = setTimeout(tick, 30);
      }
    }

    typewriterTimeout = setTimeout(tick, 150);
  }

  /** Stops placeholder cycling animation. */
  function stopTypewriter() {
    if (typewriterTimeout) {
      clearTimeout(typewriterTimeout);
      typewriterTimeout = null;
    }
  }

  /** Switches between GitHub / Repo Mode and Local Folder Mode within the studio drawer. */
  function applyWorkspaceSubMode(mode: 'repo' | 'local') {
    workspaceSubMode = mode;
    localModeDrawer?.setAttribute('data-submode', mode);
    drawerBodyGrid?.setAttribute('data-submode', mode);

    btnWorkspaceModeRepo?.classList.toggle('active', mode === 'repo');
    btnWorkspaceModeLocal?.classList.toggle('active', mode === 'local');
    btnWorkspaceModeRepo?.setAttribute('aria-selected', String(mode === 'repo'));
    btnWorkspaceModeLocal?.setAttribute('aria-selected', String(mode === 'local'));

    const emptySelectLabel = btnEmptySelectRepo?.querySelector('span');
    if (mode === 'repo') {
      if (heroTitleKicker) heroTitleKicker.textContent = 'Jules';
      heroModePill?.classList.remove('hidden');
      if (heroTitleSub) heroTitleSub.textContent = 'Meet Jules, your asynchronous software engineer';
      if (heroSubtitle) heroSubtitle.textContent = 'Select a GitHub repository and describe a task. Jules will clone, create a branch, generate a plan, and open a Pull Request.';
      if (julesTaskPrompt && !julesTaskPrompt.value) {
        julesTaskPrompt.placeholder = 'Describe a task for Jules to implement on a new branch in your GitHub repository...';
      }
      if (canvasBrandTitle) canvasBrandTitle.textContent = 'GitHub Jules';
      if (emptySelectLabel) emptySelectLabel.textContent = 'Select GitHub Repository...';
      btnEmptyInitRepo?.classList.add('hidden');
      githubRepoSection?.classList.remove('hidden');
      githubPrPublisherSection?.classList.remove('hidden');
      workspaceInspector?.setAttribute('data-open', 'true');
      btnSessionToggleCode?.classList.add('active');
      btnToggleInspector?.classList.add('active');
      if (!isSessionActive) {
        setSessionActive(false);
        if (!julesTaskPrompt?.value.trim()) {
          startTypewriter();
        }
      }
    } else {
      stopTypewriter();
      if (heroTitleKicker) heroTitleKicker.textContent = 'Jules Local';
      heroModePill?.classList.add('hidden');
      if (heroTitleSub) heroTitleSub.textContent = 'Meet Jules, your local software engineer';
      if (heroSubtitle) heroSubtitle.textContent = 'What would you like Jules to work on?';
      if (julesTaskPrompt && !julesTaskPrompt.value) {
        julesTaskPrompt.placeholder = 'Describe a task for Jules to make changes to your local codebase or repository...';
      }
      if (canvasBrandTitle) canvasBrandTitle.textContent = 'Jules Local';
      if (emptySelectLabel) emptySelectLabel.textContent = 'Choose Local Repository...';
      btnEmptyInitRepo?.classList.remove('hidden');
      const hasRemote = Boolean(currentState?.localRepo?.githubRepo || currentGithubRepo);
      githubPrPublisherSection?.classList.toggle('hidden', !hasRemote);
    }
    updateDocumentTitle();
  }

  function openJulesRepoDropdown() {
    if (!julesRepoDropdownMenu) return;
    closeAllDropdowns();
    julesRepoDropdownMenu.classList.remove('hidden');
    btnJulesRepoDropdown?.setAttribute('aria-expanded', 'true');
    isJulesRepoDropdownOpen = true;
    renderJulesRepoDropdownList(cachedGithubRepos, julesRepoFilterInput?.value || '');
    julesRepoFilterInput?.focus();
  }

  function closeJulesRepoDropdown() {
    julesRepoDropdownMenu?.classList.add('hidden');
    btnJulesRepoDropdown?.setAttribute('aria-expanded', 'false');
    isJulesRepoDropdownOpen = false;
  }

  function toggleJulesRepoDropdown() {
    if (isJulesRepoDropdownOpen || (julesRepoDropdownMenu && !julesRepoDropdownMenu.classList.contains('hidden'))) {
      closeJulesRepoDropdown();
    } else {
      openJulesRepoDropdown();
    }
  }

  /**
   * Persistent Composer Placement — keeps a single composer instance alive:
   * docked at the bottom of the chat stream while a task/plan is in flight,
   * parked back inside the empty-state hero once the workspace is reset.
   */
  function syncComposerPlacement(docked: boolean) {
    if (docked && localComposerBox && localChatComposerDock) {
      localChatComposerDock.classList.remove('hidden');
      if (localComposerBox.parentElement !== localChatComposerDock) {
        localChatComposerDock.appendChild(localComposerBox);
      }
      localComposerBox.classList.add('composer-docked');
      return;
    }

    if (!docked && localComposerBox && localEmptyState) {
      localChatComposerDock?.classList.add('hidden');
      localComposerBox.classList.remove('composer-docked');
      // Place the composer back inside the empty state, right after the hero.
      const starterChips = localEmptyState.querySelector('.empty-starter-chips');
      if (starterChips && localComposerBox.parentElement !== localEmptyState) {
        localEmptyState.insertBefore(localComposerBox, starterChips);
      }
      const planLabel = document.querySelector('#btn-run-jules .btn-plan-label');
      if (planLabel) planLabel.textContent = 'Give me a plan';
    }
  }

  function syncViewExpansion() {
    if (isDrawerOpen) {
      jules?.expandView(-1);
    } else if (isMenuOpen || isRepoDropdownOpen) {
      jules?.expandView(320);
    } else {
      jules?.collapseView();
    }
  }

  function closeAllDropdowns() {
    closeMenu();
    closeRepoDropdown();
    closeCanvasRepoDropdown();
    closeBranchDropdown();
    closeModelDropdown();
    closeJulesRepoDropdown();
  }

  function applyMode(cmd: WorkspaceMode | 'toggle', forceRefresh = false) {
    closeAllDropdowns();
    let next: WorkspaceMode;
    if (cmd === 'toggle') {
      next = isDrawerOpen ? 'cloud' : 'local';
    } else {
      next = cmd;
    }

    // Google Jules Sunsetting fallback: if jules.google.com is offline,
    // cloud mode automatically opens standalone GitHub / Repo mode in #local-mode-drawer!
    if (next === 'cloud' && currentState?.legacyJulesHealth && currentState.legacyJulesHealth.online === false) {
      next = 'repo';
      if (tabCloudBadge) {
        tabCloudBadge.textContent = 'Standalone Mode Active';
        tabCloudBadge.classList.remove('hidden');
      }
      const standaloneFallbackBadge = document.getElementById('standalone-fallback-badge');
      if (standaloneFallbackBadge) {
        standaloneFallbackBadge.textContent = 'Standalone Mode Active';
        standaloneFallbackBadge.classList.remove('hidden');
      }
    }

    const modeChanged = next !== currentMode;
    currentMode = next;

    if (currentMode === 'repo') {
      applyWorkspaceSubMode('repo');
      isDrawerOpen = true;
    } else if (currentMode === 'local') {
      applyWorkspaceSubMode('local');
      isDrawerOpen = true;
    } else if (currentMode === 'cloud' || currentMode === 'legacy-cloud') {
      isDrawerOpen = false;
    }

    // Body mode classes drive the global local/cloud styling hooks.
    document.body.classList.toggle('mode-local', currentMode === 'local' || currentMode === 'repo');
    document.body.classList.toggle('mode-cloud', currentMode === 'cloud' || currentMode === 'legacy-cloud');

    if (!forceRefresh && !modeChanged && ((isDrawerOpen && localModeDrawer && !localModeDrawer.classList.contains('hidden')) || (!isDrawerOpen && localModeDrawer && localModeDrawer.classList.contains('hidden')))) {
      return;
    }

    jules?.setModeState(currentMode);

    tabCloudMode?.classList.toggle('active', currentMode === 'cloud');
    tabLocalMode?.classList.toggle('active', currentMode === 'local');
    tabRepoMode?.classList.toggle('active', currentMode === 'repo');
    tabLegacyCloudMode?.classList.toggle('active', currentMode === 'legacy-cloud');

    tabCloudMode?.setAttribute('aria-selected', String(currentMode === 'cloud'));
    tabLocalMode?.setAttribute('aria-selected', String(currentMode === 'local'));
    tabRepoMode?.setAttribute('aria-selected', String(currentMode === 'repo'));
    tabLegacyCloudMode?.setAttribute('aria-selected', String(currentMode === 'legacy-cloud'));

    // Mode naming + dynamic document title (Jules Local / Cloud Jules)
    applyModeLabels();
    updateDocumentTitle();

    if (isDrawerOpen) {
      localModeDrawer?.classList.remove('hidden');
      refreshCliDiagnostic();
      refreshGitReviewDetails();
      fetchJulesSessions();
      renderRecentRepoChips();
      void loadGitHubRepos();
      void checkEnginesStatus();
    } else {
      localModeDrawer?.classList.add('hidden');
      closeDiffViewer();
    }
    syncViewExpansion();
  }

  async function openDiffViewer(filePath: string, isStaged: boolean) {
    if (!gitDiffViewer || !diffFileTitle || !diffContentBody) return;
    gitStatusContent?.classList.add('hidden');
    diffFileTitle.textContent = `${filePath} (${isStaged ? 'staged' : 'working tree'})`;
    diffContentBody.innerHTML = '<span class="text-muted">Loading unified diff...</span>';
    diffFileStats?.classList.add('hidden');
    gitDiffViewer.classList.remove('hidden');

    try {
      const diffData = await jules?.getGitFileDiff(filePath, isStaged);
      if (!diffData || !diffData.diff) {
        diffContentBody.innerHTML = '<span class="text-muted">No textual diff available for this file (binary or unchanged).</span>';
        return;
      }

      diffContentBody.innerHTML = '';
      const lines = diffData.diff.split('\n');
      let addCount = 0;
      let delCount = 0;
      for (const line of lines) {
        const div = document.createElement('div');
        div.className = 'diff-line';
        if (line.startsWith('+') && !line.startsWith('+++')) {
          addCount++;
          div.classList.add('diff-add');
          div.classList.add('diff-line-add');
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          delCount++;
          div.classList.add('diff-del');
          div.classList.add('diff-line-del');
        } else if (line.startsWith('@@')) {
          div.classList.add('diff-hunk');
          div.classList.add('diff-line-hunk');
        }
        div.textContent = line;
        diffContentBody.appendChild(div);
      }

      // Per-file additions / deletions counter in the diff viewer header.
      if (diffFileStats) {
        diffFileStats.innerHTML = '<span class="diff-stat-add">+' + addCount + '</span> <span class="diff-stat-del">-' + delCount + '</span>';
        diffFileStats.classList.remove('hidden');
      }
    } catch {
      diffContentBody.innerHTML = '<span class="text-muted">Failed to retrieve diff.</span>';
    }
  }

  function closeDiffViewer() {
    if (!gitDiffViewer) return;
    gitDiffViewer.classList.add('hidden');
    gitStatusContent?.classList.remove('hidden');
  }

  // App & Session Menu Control
  function openMenu() {
    if (!appMenuDropdown) return;
    closeRepoDropdown();
    closeCanvasRepoDropdown();
    closeBranchDropdown();
    closeModelDropdown();
    isMenuOpen = true;
    appMenuDropdown.classList.remove('hidden');
    renderAccountsMenu();
    refreshCliDiagnostic();
    syncViewExpansion();
  }

  function closeMenu() {
    if (!appMenuDropdown) return;
    isMenuOpen = false;
    appMenuDropdown.classList.add('hidden');
    syncViewExpansion();
  }

  btnAppMenu?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isMenuOpen) closeMenu();
    else openMenu();
  });

  // Settings Handlers
  const openJulesSettings = async () => {
    closeAllDropdowns();
    applyMode('cloud', true);
    await jules?.openSettings();
  };

  menuBtnSettings?.addEventListener('click', openJulesSettings);
  btnSidebarSettings?.addEventListener('click', openJulesSettings);
  btnSidebarDocs?.addEventListener('click', () => {
    window.open('https://jules.google.com/docs', '_blank');
  });
  btnSidebarFeedback?.addEventListener('click', () => {
    window.open('https://github.com/OSINTCabal/JulesDeck/issues', '_blank');
  });

  // Local Repo Dropdown (Top Bar)
  function openRepoDropdown() {
    if (!repoPickerDropdown) return;
    closeMenu();
    closeCanvasRepoDropdown();
    closeBranchDropdown();
    closeModelDropdown();
    isRepoDropdownOpen = true;
    renderRepoPickerDropdown();
    repoPickerDropdown.classList.remove('hidden');
    syncViewExpansion();
  }

  function closeRepoDropdown() {
    if (!repoPickerDropdown) return;
    isRepoDropdownOpen = false;
    repoPickerDropdown.classList.add('hidden');
    syncViewExpansion();
  }

  btnSelectRepo?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isRepoDropdownOpen) closeRepoDropdown();
    else openRepoDropdown();
  });

  // Canvas Repo Dropdown (Local Chat Canvas)
  function openCanvasRepoDropdown() {
    if (!canvasRepoDropdown) return;
    closeMenu();
    closeRepoDropdown();
    closeBranchDropdown();
    closeModelDropdown();
    isCanvasRepoDropdownOpen = true;
    renderRepoPickerDropdown();
    void loadGitHubRepos();
    canvasRepoDropdown.classList.remove('hidden');
  }

  function closeCanvasRepoDropdown() {
    if (!canvasRepoDropdown) return;
    isCanvasRepoDropdownOpen = false;
    canvasRepoDropdown.classList.add('hidden');
  }

  btnCanvasRepoSelect?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isCanvasRepoDropdownOpen) closeCanvasRepoDropdown();
    else openCanvasRepoDropdown();
  });

  async function renderRepoPickerDropdown() {
    const repos: RecentRepoItem[] = (await jules?.getRecentRepos()) || currentState?.recentRepos || [];

    const populateRepoList = (
      container: HTMLElement | null,
      activeContainer: HTMLElement | null,
      closeFn: () => void
    ) => {
      if (activeContainer) {
        if (currentState?.localRepo) {
          activeContainer.classList.remove('hidden');
          activeContainer.innerHTML = `
            <div class="active-repo-badge-card">
              <span class="active-repo-indicator">ACTIVE</span>
              <span class="active-repo-name">${escapeHtml(currentState.localRepo.githubRepo || currentState.localRepo.name)}</span>
              <span class="active-repo-branch">${escapeHtml(currentState.localRepo.branch)}</span>
            </div>
          `;
          dropdownBtnDetach?.classList.remove('hidden');
        } else {
          activeContainer.classList.add('hidden');
          dropdownBtnDetach?.classList.add('hidden');
        }
      }

      if (!container) return;
      if (repos.length === 0) {
        container.innerHTML = '<span class="text-muted" style="padding: 4px 8px;">No recent repositories</span>';
        return;
      }

      container.innerHTML = '';
      for (const repo of repos) {
        const item = document.createElement('button');
        item.className = 'dropdown-item';
        item.type = 'button';
        const isCurrent = currentState?.localRepo?.path === repo.path;
        item.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <span style="flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(repo.githubRepo || repo.name)}</span>
          <span class="badge-branch">${escapeHtml(repo.branch)}</span>
          ${isCurrent ? '<span style="color: #a855f7; font-weight: bold;">✓</span>' : ''}
        `;
        item.addEventListener('click', async (e) => {
          e.stopPropagation();
          closeFn();
          await jules?.selectRecentRepo(repo.path);
          applyMode('local', true);
        });

        const removeBtn = document.createElement('span');
        removeBtn.className = 'dropdown-item-remove';
        removeBtn.title = 'Remove codebase from recent list';
        removeBtn.innerHTML = `
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        `;
        removeBtn.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          await jules?.removeRecentRepo(repo.path);
          renderRepoPickerDropdown();
          renderRecentRepoChips();
        });
        item.appendChild(removeBtn);

        container.appendChild(item);
      }
    };

    populateRepoList(dropdownRecentRepos, dropdownActiveRepo, closeRepoDropdown);
    populateRepoList(canvasDropdownRecentRepos, canvasDropdownActiveRepo, closeCanvasRepoDropdown);
  }

  dropdownBtnOpen?.addEventListener('click', async (e) => {
    e.stopPropagation();
    closeRepoDropdown();
    const res = await jules?.openLocalRepo();
    if (res?.success) applyMode('local', true);
  });

  dropdownBtnInit?.addEventListener('click', async (e) => {
    e.stopPropagation();
    closeRepoDropdown();
    const res = await jules?.initGitRepo();
    if (res?.success) applyMode('local', true);
  });

  dropdownBtnDetach?.addEventListener('click', async (e) => {
    e.stopPropagation();
    closeRepoDropdown();
    await jules?.clearLocalRepo();
    refreshGitReviewDetails();
  });

  canvasDropdownBtnOpen?.addEventListener('click', async (e) => {
    e.stopPropagation();
    closeCanvasRepoDropdown();
    const res = await jules?.openLocalRepo();
    if (res?.success) applyMode('local', true);
  });

  canvasDropdownBtnInit?.addEventListener('click', async (e) => {
    e.stopPropagation();
    closeCanvasRepoDropdown();
    const res = await jules?.initGitRepo();
    if (res?.success) applyMode('local', true);
  });

  // ── GitHub Repositories (Standalone Mode) ────────────────────────────────
  async function loadGitHubRepos(forceRefresh = false) {
    if (!githubReposList) return;
    try {
      githubReposList.innerHTML = '<span class="text-muted" style="padding: 6px 8px;">Loading GitHub repositories...</span>';
      const repos = (await jules?.listGitHubRepos(forceRefresh)) || [];
      cachedGithubRepos = repos;
      renderGitHubReposList(cachedGithubRepos);
      renderJulesRepoDropdownList(cachedGithubRepos);
      renderGitHubCodebasesList(cachedGithubRepos);
    } catch {
      githubReposList.innerHTML = '<span class="text-muted" style="padding: 6px 8px;">Could not load GitHub repositories.</span>';
    }
  }

  function renderGitHubReposList(repos: GitHubRepoItem[]) {
    if (!githubReposList) return;
    if (repos.length === 0) {
      githubReposList.innerHTML = '<span class="text-muted" style="padding: 6px 8px;">No GitHub repositories found.</span>';
      return;
    }
    githubReposList.innerHTML = '';
    for (const repo of repos) {
      const item = document.createElement('button');
      item.className = 'dropdown-item github-repo-item';
      item.type = 'button';
      const isCurrent = currentGithubRepo?.nameWithOwner === repo.nameWithOwner ||
        currentState?.localRepo?.githubRepo === repo.nameWithOwner;
      item.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
        </svg>
        <span class="github-repo-slug" style="flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(repo.nameWithOwner)}</span>
        <span class="badge-branch">${escapeHtml(repo.defaultBranch || 'main')}</span>
        <span class="badge ${repo.isPrivate ? 'badge-private' : 'badge-public'}">${repo.isPrivate ? 'Private' : 'Public'}</span>
        ${repo.isCloned ? '<span class="badge badge-cloned">Cloned</span>' : ''}
        ${isCurrent ? '<span style="color: #a855f7; font-weight: bold; margin-left: 4px;">✓</span>' : ''}
      `;
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        closeCanvasRepoDropdown();
        await selectGitHubRepo(repo.nameWithOwner, repo.defaultBranch);
      });
      githubReposList.appendChild(item);
    }
  }

  async function selectGitHubRepo(nameWithOwner: string, defaultBranch?: string) {
    if (!nameWithOwner.trim()) return;
    const cleanSlug = nameWithOwner.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '');
    if (canvasRepoLabel) canvasRepoLabel.textContent = `Connecting ${cleanSlug}...`;
    if (composerRepoText) composerRepoText.textContent = cleanSlug;
    if (julesRepoDropdownLabel) julesRepoDropdownLabel.textContent = cleanSlug;
    if (breadcrumbRepoText) breadcrumbRepoText.textContent = cleanSlug;
    if (navbarSessionBreadcrumb) navbarSessionBreadcrumb.classList.toggle('has-repo', Boolean(cleanSlug));

    try {
      const res = await jules?.selectGitHubRepo(cleanSlug, defaultBranch);
      if (res?.success) {
        if (res.repo) currentGithubRepo = res.repo;
        if (res.workspacePath) currentWorkspacePath = res.workspacePath;
        if (res.branch) currentBaseBranch = res.branch;
        else if (defaultBranch) currentBaseBranch = defaultBranch;

        if (canvasRepoLabel) canvasRepoLabel.textContent = cleanSlug;
        if (composerRepoText) composerRepoText.textContent = cleanSlug;
        if (julesRepoDropdownLabel) julesRepoDropdownLabel.textContent = cleanSlug;
        if (breadcrumbRepoText) breadcrumbRepoText.textContent = cleanSlug;
        if (canvasBranchLabel) canvasBranchLabel.textContent = currentBaseBranch;
        if (composerBranchText) composerBranchText.textContent = currentBaseBranch;
        updatePrPublisherUi();
        refreshGitReviewDetails();
        fetchJulesSessions();
        renderJulesRepoDropdownList(cachedGithubRepos);
        renderGitHubCodebasesList(cachedGithubRepos);
      } else {
        if (canvasRepoLabel) canvasRepoLabel.textContent = 'Connection failed';
      }
    } catch {
      if (canvasRepoLabel) canvasRepoLabel.textContent = 'Connection error';
    }
  }

  githubRepoSearchInput?.addEventListener('input', () => {
    const query = (githubRepoSearchInput.value || '').trim().toLowerCase();
    if (!query) {
      renderGitHubReposList(cachedGithubRepos);
      return;
    }
    const filtered = cachedGithubRepos.filter((r) =>
      r.nameWithOwner.toLowerCase().includes(query) ||
      (r.description && r.description.toLowerCase().includes(query))
    );
    renderGitHubReposList(filtered);
  });

  githubRepoSearchInput?.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = (githubRepoSearchInput.value || '').trim();
      if (val) {
        closeCanvasRepoDropdown();
        await selectGitHubRepo(val);
      }
    }
  });

  btnGithubConnectClone?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const val = (githubRepoSearchInput?.value || '').trim();
    if (val) {
      closeCanvasRepoDropdown();
      await selectGitHubRepo(val);
    }
  });

  btnRefreshGithubRepos?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await loadGitHubRepos(true);
  });

  // Branch Switcher Dropdown
  function openBranchDropdown() {
    if (!branchPickerDropdown) return;
    closeMenu();
    closeRepoDropdown();
    closeCanvasRepoDropdown();
    closeModelDropdown();
    isBranchDropdownOpen = true;
    renderBranchPickerDropdown();
    branchPickerDropdown.classList.remove('hidden');
  }

  function closeBranchDropdown() {
    if (!branchPickerDropdown) return;
    isBranchDropdownOpen = false;
    branchPickerDropdown.classList.add('hidden');
  }

  btnCanvasBranchSelect?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isBranchDropdownOpen) closeBranchDropdown();
    else openBranchDropdown();
  });

  // Interactive Composer Context Chips — mirror the canvas repo/branch switchers.
  composerRepoChip?.addEventListener('click', (e) => {
    e.stopPropagation();
    btnCanvasRepoSelect?.click();
  });

  composerBranchChip?.addEventListener('click', (e) => {
    e.stopPropagation();
    btnCanvasBranchSelect?.click();
  });

  async function renderBranchPickerDropdown() {
    if (!branchListContainer) return;
    branchListContainer.innerHTML = '<span class="text-muted">Loading branches...</span>';
    const repoPath = currentState?.localRepo?.path;
    if (!repoPath) {
      branchListContainer.innerHTML = '<span class="text-muted">No repository connected</span>';
      return;
    }

    try {
      const res = await jules?.listBranches(repoPath);
      const branches = res?.branches || [];
      const current = res?.current || currentState?.localRepo?.branch || 'main';

      if (branches.length === 0) {
        branchListContainer.innerHTML = `<span class="text-muted">${current}</span>`;
        return;
      }

      branchListContainer.innerHTML = '';
      for (const branch of branches) {
        const item = document.createElement('button');
        item.className = 'dropdown-item';
        item.type = 'button';
        const isCurrent = branch === current;
        item.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="6" y1="3" x2="6" y2="15"></line>
            <circle cx="18" cy="6" r="3"></circle>
            <circle cx="6" cy="18" r="3"></circle>
            <path d="M18 9a9 9 0 0 1-9 9"></path>
          </svg>
          <span style="flex: 1; text-align: left;">${escapeHtml(branch)}</span>
          ${isCurrent ? '<span style="color: #a855f7; font-weight: bold;">✓</span>' : ''}
        `;
        item.addEventListener('click', async (e) => {
          e.stopPropagation();
          closeBranchDropdown();
          if (!isCurrent) {
            await jules?.checkoutBranch(repoPath, branch);
            refreshGitReviewDetails();
          }
        });
        branchListContainer.appendChild(item);
      }
    } catch {
      branchListContainer.innerHTML = '<span class="text-muted">Failed to list branches</span>';
    }
  }

  // Multi-Engine & Model Picker
  async function checkEnginesStatus() {
    try {
      const engines: EngineStatusInfo[] = (await jules?.listEngines()) || [];
      for (const info of engines) {
        const badge = (document.getElementById(`badge-engine-${info.id}`) ||
          document.querySelector(`.engine-badge[data-engine="${info.id}"]`)) as HTMLElement | null;
        if (badge) {
          if (info.available) {
            badge.textContent = info.version ? `Ready (${info.version})` : 'Ready';
            badge.className = 'engine-badge engine-badge-ready';
          } else {
            badge.textContent = 'Not Installed';
            badge.className = 'engine-badge engine-badge-uninstalled';
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // Model Picker Dropdown
  function openModelDropdown() {
    if (!modelPickerDropdown) return;
    closeMenu();
    closeRepoDropdown();
    closeCanvasRepoDropdown();
    closeBranchDropdown();
    isModelDropdownOpen = true;
    void checkEnginesStatus();
    modelPickerDropdown.classList.remove('hidden');
  }

  function closeModelDropdown() {
    if (!modelPickerDropdown) return;
    isModelDropdownOpen = false;
    modelPickerDropdown.classList.add('hidden');
  }

  btnCanvasModelSelect?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isModelDropdownOpen) closeModelDropdown();
    else openModelDropdown();
  });

  const modelOptions = document.querySelectorAll('.model-option');
  modelOptions.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const el = btn as HTMLElement;
      const modelName = el.querySelector('.model-name')?.textContent || 'Gemini 3.1 Pro';
      const engine = (el.dataset.engine as AgentEngineId | undefined) || 'gemini-cli';
      const model = el.dataset.model || 'gemini-3.1-pro';

      selectedEngine = engine;
      selectedModel = model;

      if (canvasModelLabel) canvasModelLabel.textContent = modelName;
      modelOptions.forEach((o) => o.classList.remove('active'));
      el.classList.add('active');
      closeModelDropdown();
      void jules?.setActiveEngine(engine, model);
    });
  });

  // Quick Commit & Working Tree Inspector
  inputCommitMsg?.addEventListener('input', () => {
    if (btnGitCommit) {
      btnGitCommit.disabled = !inputCommitMsg.value.trim() || !currentState?.localRepo?.path;
    }
  });

  btnGitCommit?.addEventListener('click', async () => {
    const repoPath = currentState?.localRepo?.path;
    const msg = inputCommitMsg?.value.trim();
    if (!repoPath || !msg || !btnGitCommit) return;

    btnGitCommit.disabled = true;
    btnGitCommit.textContent = 'Committing...';
    const res = await jules?.commitChanges(repoPath, msg);
    if (res?.success) {
      btnGitCommit.textContent = 'Committed ✓';
      if (inputCommitMsg) inputCommitMsg.value = '';
      refreshGitReviewDetails();
      setTimeout(() => {
        if (btnGitCommit) {
          btnGitCommit.textContent = 'Stage & Commit';
          btnGitCommit.disabled = true;
        }
      }, 1500);
    } else {
      btnGitCommit.textContent = 'Failed';
      setTimeout(() => {
        if (btnGitCommit) {
          btnGitCommit.textContent = 'Stage & Commit';
          btnGitCommit.disabled = false;
        }
      }, 2000);
    }
  });

  // ── GitHub Branch & PR Publisher Panel ──────────────────────────────────
  function updatePrPublisherUi() {
    if (prTaskBranchBadge) prTaskBranchBadge.textContent = currentTaskBranch || 'jules/task-branch';
    if (prBaseBranchBadge) prBaseBranchBadge.textContent = currentBaseBranch || 'main';
  }

  async function publishCurrentBranch(createPr: boolean) {
    const workspacePath = currentWorkspacePath || currentState?.localRepo?.path;
    if (!workspacePath) {
      if (prResultMessage) prResultMessage.textContent = 'No repository workspace selected.';
      prResultBanner?.classList.remove('hidden');
      return;
    }

    const title = inputPrTitle?.value.trim() || 'feat: update from Jules';
    const body = inputPrBody?.value.trim() || '';

    if (btnPublishBranch) btnPublishBranch.disabled = true;
    if (btnPublishPr) btnPublishPr.disabled = true;

    if (createPr && btnPublishPr) {
      btnPublishPr.textContent = 'Creating PR...';
    } else if (!createPr && btnPublishBranch) {
      btnPublishBranch.textContent = 'Publishing...';
    }

    try {
      const options: PublishPrOptions = {
        workspacePath,
        githubRepo: currentGithubRepo?.nameWithOwner || currentState?.localRepo?.githubRepo,
        baseBranch: currentBaseBranch,
        taskBranch: currentTaskBranch,
        title,
        body,
        createPr
      };

      const res: PublishPrResult | undefined = await jules?.publishBranchAndCreatePR(options);
      if (res) {
        if (prResultMessage) prResultMessage.textContent = res.message;
        if (prStatusBadge) {
          prStatusBadge.textContent = res.success ? (createPr ? 'PR Created' : 'Published') : 'Failed';
          prStatusBadge.className = `pr-status-badge ${res.success ? 'status-published' : 'status-failed'}`;
        }
        if (res.prUrl && prResultLink) {
          prResultLink.href = res.prUrl;
          prResultLink.textContent = res.prUrl;
          prResultLink.classList.remove('hidden');
        } else if (prResultLink) {
          prResultLink.classList.add('hidden');
        }
        prResultBanner?.classList.remove('hidden');

        if (activeStandaloneSessionId && jules?.saveStandaloneSession) {
          void jules.saveStandaloneSession({
            id: activeStandaloneSessionId,
            prUrl: res.prUrl,
            status: res.success ? 'published' : 'completed'
          });
        }
      }
    } catch (err: unknown) {
      if (prResultMessage) {
        prResultMessage.textContent = err instanceof Error ? err.message : 'Publish failed';
      }
      prResultBanner?.classList.remove('hidden');
    } finally {
      if (btnPublishBranch) {
        btnPublishBranch.disabled = false;
        btnPublishBranch.textContent = 'Publish Branch';
      }
      if (btnPublishPr) {
        btnPublishPr.disabled = false;
        btnPublishPr.textContent = 'Create Pull Request';
      }
    }
  }

  btnPublishBranch?.addEventListener('click', () => void publishCurrentBranch(false));
  btnPublishPr?.addEventListener('click', () => void publishCurrentBranch(true));

  // Toggle Inspector Panel
  btnToggleInspector?.addEventListener('click', () => {
    const isCollapsed = workspaceInspector?.classList.toggle('collapsed');
    const isOpen = !isCollapsed;
    workspaceInspector?.setAttribute('data-open', isOpen ? 'true' : 'false');
    btnToggleInspector?.classList.toggle('active');
    btnSessionToggleCode?.classList.toggle('active', isOpen);
  });

  // Toggle Terminal Body
  let isTerminalCollapsed = false;
  btnToggleTerminalBody?.addEventListener('click', () => {
    isTerminalCollapsed = !isTerminalCollapsed;
    julesTerminalOutput?.classList.toggle('hidden', isTerminalCollapsed);
    if (iconTerminalToggle) {
      iconTerminalToggle.style.transform = isTerminalCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
    }
  });

  // Account Pill toggles application menu
  sidebarAccountPill?.addEventListener('click', () => {
    btnAppMenu?.click();
  });

  // Function to reset Jules Local workspace to New Task state
  function resetToNewTask() {
    drawerBodyGrid?.classList.remove('hidden');

    if (localChatStream) {
      localChatStream.innerHTML = '';
      localChatStream.classList.add('hidden');
    }
    localEmptyState?.classList.remove('hidden');
    terminalContainer?.classList.add('hidden');
    terminalLiveStatus?.classList.add('hidden');
    if (julesTaskPrompt) {
      julesTaskPrompt.value = '';
      julesTaskPrompt.placeholder = workspaceSubMode === 'repo'
        ? 'Describe a task for Jules to implement on a new branch in your GitHub repository...'
        : 'Ask Jules to make changes to your local codebase...';
    }
    if (julesTerminalOutput) julesTerminalOutput.innerHTML = '';
    if (terminalSessionPill) terminalSessionPill.classList.add('hidden');
    if (taskStatusBadge) {
      taskStatusBadge.className = 'task-status-pill status-idle';
      taskStatusBadge.textContent = 'Idle';
    }
    if (btnRunJules) btnRunJules.disabled = false;
    if (canvasModelLabel) {
      const activeOption = document.querySelector('.model-option.active .model-name');
      canvasModelLabel.textContent = activeOption?.textContent?.trim() || 'Gemini 3.1 Pro';
    }
    activePlan = null;
    activeStandaloneSessionId = null;
    hasAppendedCompletionCard = false;
    prResultBanner?.classList.add('hidden');
    if (prStatusBadge) prStatusBadge.textContent = 'Ready';
    // Park the composer back inside the empty state hero.
    syncComposerPlacement(false);
    setSessionActive(false);
  }

  // New Task Handler
  btnNewTask?.addEventListener('click', resetToNewTask);

  // Brand Icon Navigation Handler — clicking Jules logo in header resets to New Task in local mode; in Cloud Mode navigates to jules.google.com
  const brandIcon = document.getElementById('brand-icon') || (document.querySelector('.brand-icon') as HTMLElement | null);
  const canvasBrandPill = document.querySelector('.canvas-brand-pill') as HTMLElement | null;

  brandIcon?.addEventListener('click', () => {
    if (currentMode === 'local' || (currentMode as string) === 'repo') {
      if (btnNewTask) {
        btnNewTask.click();
      } else {
        resetToNewTask();
      }
    } else {
      window.location.href = 'https://jules.google.com';
    }
  });

  canvasBrandPill?.addEventListener('click', () => {
    if (currentMode === 'local' || (currentMode as string) === 'repo') {
      if (btnNewTask) {
        btnNewTask.click();
      } else {
        resetToNewTask();
      }
    } else {
      window.location.href = 'https://jules.google.com';
    }
  });

  // Starter Prompt Chips
  const starterChips = document.querySelectorAll('.starter-chip');
  starterChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const prompt = (chip as HTMLElement).dataset.prompt || '';
      if (julesTaskPrompt) {
        julesTaskPrompt.value = prompt;
        julesTaskPrompt.placeholder = 'Ask Jules to make changes to your local codebase...';
        julesTaskPrompt.focus();
        julesTaskPrompt.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  });

  // Refresh CLI Diagnostics
  async function refreshCliDiagnostic() {
    try {
      const status: JulesCliStatus | null = (await jules?.getJulesCliStatus()) || null;
      if (status?.installed) {
        if (diagnosticDot) diagnosticDot.className = 'status-dot dot-online';
        if (diagnosticVersionBadge) diagnosticVersionBadge.textContent = `Ready (${status.version})`;
        if (drawerCliPill) {
          drawerCliPill.textContent = `CLI: ${status.version}`;
          drawerCliPill.title = `Google Jules CLI ${status.version} verified`;
          drawerCliPill.style.color = '#34d399';
        }
      } else {
        if (diagnosticDot) diagnosticDot.className = 'status-dot dot-offline';
        if (diagnosticVersionBadge) diagnosticVersionBadge.textContent = 'Not Ready';
        if (drawerCliPill) {
          drawerCliPill.textContent = 'CLI: Not Ready';
          drawerCliPill.title = status?.error || 'CLI not found or unauthenticated';
          drawerCliPill.style.color = '#f87171';
        }
      }
    } catch {
      if (diagnosticDot) diagnosticDot.className = 'status-dot dot-error';
      if (diagnosticVersionBadge) diagnosticVersionBadge.textContent = 'Error';
      if (drawerCliPill) {
        drawerCliPill.textContent = 'CLI: Error';
        drawerCliPill.style.color = '#f87171';
      }
    }
  }

  // Render accounts in dropdown
  function renderAccountsMenu() {
    if (!menuAccountsList || !currentState) return;
    menuAccountsList.innerHTML = '';
    const accounts = currentState.accounts || [];

    for (const acc of accounts) {
      const row = document.createElement('div');
      row.className = 'account-row';
      const isActive = acc.id === currentState.activeAccountId;

      row.innerHTML = `
        <div class="account-name-group">
          <span class="account-row-name">${escapeHtml(acc.name || 'Account')}</span>
          <span class="account-row-email">${escapeHtml(acc.email || '')}</span>
        </div>
        ${isActive ? '<span class="account-check">✓</span>' : `
          <button class="account-remove-btn" title="Remove account" type="button">✕</button>
        `}
      `;

      const removeBtn = row.querySelector('.account-remove-btn') as HTMLButtonElement | null;
      if (removeBtn) {
        let confirmRemoval = false;
        let confirmTimer: ReturnType<typeof setTimeout> | null = null;
        removeBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirmRemoval) {
            confirmRemoval = true;
            removeBtn.textContent = 'Confirm?';
            removeBtn.classList.add('confirming');
            confirmTimer = setTimeout(() => {
              confirmRemoval = false;
              removeBtn.textContent = '✕';
              removeBtn.classList.remove('confirming');
            }, 3000);
          } else {
            if (confirmTimer) clearTimeout(confirmTimer);
            await jules?.removeAccount(acc.id);
            renderAccountsMenu();
          }
        });
      }

      row.addEventListener('click', async () => {
        if (!isActive) {
          closeMenu();
          await jules?.switchAccount(acc.id);
        }
      });
      menuAccountsList.appendChild(row);
    }
  }

  // Render Recent Repo Chips
  async function renderRecentRepoChips() {
    if (!recentChipsContainer) return;
    recentChipsContainer.innerHTML = '';
    const repos: RecentRepoItem[] = (await jules?.getRecentRepos()) || currentState?.recentRepos || [];

    // The active repository is already surfaced in the sidebar card — never
    // render it twice inside the "recent" chip row.
    const filtered = repos.filter((r) => r.path !== currentState?.localRepo?.path);
    const recentReposBar = recentChipsContainer.parentElement;

    if (filtered.length === 0) {
      if (currentState?.localRepo) {
        // Nothing else to show: hide the whole recent-repositories bar.
        recentReposBar?.classList.add('hidden');
      } else {
        recentReposBar?.classList.remove('hidden');
        recentChipsContainer.innerHTML = '<span class="text-muted">No recent repositories</span>';
      }
      return;
    }

    recentReposBar?.classList.remove('hidden');

    for (const repo of filtered) {
      const chipWrapper = document.createElement('div');
      chipWrapper.className = 'recent-chip-wrapper';

      const chip = document.createElement('button');
      chip.className = 'recent-chip';
      chip.title = `${repo.path} (${repo.branch})`;
      chip.innerHTML = `
        <span>${escapeHtml(repo.githubRepo || repo.name)}</span>
        <span class="chip-branch">${escapeHtml(repo.branch)}</span>
      `;
      chip.addEventListener('click', async () => {
        await jules?.selectRecentRepo(repo.path);
        refreshGitReviewDetails();
        fetchJulesSessions();
        renderRecentRepoChips();
      });

      const btnRemove = document.createElement('button');
      btnRemove.className = 'btn-remove-chip';
      btnRemove.type = 'button';
      btnRemove.title = `Remove ${repo.name} from recent list`;
      btnRemove.innerHTML = `
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      `;
      btnRemove.addEventListener('click', async (e) => {
        e.stopPropagation();
        await jules?.removeRecentRepo(repo.path);
        renderRecentRepoChips();
        renderRepoPickerDropdown();
      });

      chipWrapper.appendChild(chip);
      chipWrapper.appendChild(btnRemove);
      recentChipsContainer.appendChild(chipWrapper);
    }
  }

  // Streaming terminal auto-scroll tracking
  if (julesTerminalOutput) {
    julesTerminalOutput.addEventListener('scroll', () => {
      const { scrollTop, scrollHeight, clientHeight } = julesTerminalOutput;
      isAutoScrollEnabled = scrollHeight - scrollTop - clientHeight < 25;
    });
  }

  function appendTerminalChunk(chunk: TaskOutputChunk) {
    if (!julesTerminalOutput) return;
    const span = document.createElement('span');
    if (chunk.stream === 'stderr') {
      span.style.color = '#f87171';
    } else if (chunk.stream === 'system') {
      span.style.color = '#818cf8';
    }
    span.textContent = chunk.chunk;
    julesTerminalOutput.appendChild(span);

    // Advance the active plan's step checkmarks while the task output streams in.
    if (activePlan && chunk.stream !== 'stderr') {
      lastChunkOutputText = chunk.chunk;
      updatePlanProgressFromOutput(activePlan, chunk.chunk.length);
    }

    if (isAutoScrollEnabled) {
      julesTerminalOutput.scrollTop = julesTerminalOutput.scrollHeight;
    }

    // Auto-detect session ID
    if (chunk.sessionId && terminalSessionPill) {
      terminalSessionPill.classList.remove('hidden');
      terminalSessionPill.textContent = `Session: ${chunk.sessionId}`;
      terminalSessionPill.onclick = () => {
        fetchJulesSessions();
      };
    }
  }

  /** Triggers the Review Changes inspector and opens diff viewer on the first modified file. */
  async function triggerReviewChangesAndDiff() {
    workspaceInspector?.classList.remove('collapsed');
    btnToggleInspector?.classList.add('active');

    try {
      const details = latestGitReviewDetails || (await jules?.getGitReviewDetails()) || null;
      if (!details) return;

      const structured = details.structured;
      let firstPath: string | null = null;
      let isStaged = false;

      if (structured) {
        if (structured.conflicts && structured.conflicts.length > 0 && structured.conflicts[0]) {
          firstPath = structured.conflicts[0].path;
          isStaged = false;
        } else if (structured.staged && structured.staged.length > 0 && structured.staged[0]) {
          firstPath = structured.staged[0].path;
          isStaged = true;
        } else if (structured.unstaged && structured.unstaged.length > 0 && structured.unstaged[0]) {
          firstPath = structured.unstaged[0].path;
          isStaged = false;
        } else if (structured.untracked && structured.untracked.length > 0 && structured.untracked[0]) {
          firstPath = structured.untracked[0].path;
          isStaged = false;
        }
      } else if (details.statusText) {
        const lines = details.statusText.split('\n').map((l) => l.trim()).filter(Boolean);
        const firstLine = lines[0];
        if (firstLine) {
          const code = firstLine.slice(0, 2);
          let file = firstLine.slice(3).trim();
          if (file.startsWith('"') && file.endsWith('"')) {
            file = file.slice(1, -1).replace(/\\"/g, '"');
          }
          firstPath = file;
          isStaged = (code[0] ?? ' ') !== ' ' && (code[0] ?? ' ') !== '?' && (code[0] ?? ' ') !== 'U';
        }
      }

      if (firstPath) {
        await openDiffViewer(firstPath, isStaged);
      }
    } catch {
      // workspaceInspector opened
    }
  }

  /** Appends a Google Jules completion summary card to #local-chat-stream. */
  function appendCompletionSummaryCard() {
    if (!localChatStream) return;

    const hasRemote = Boolean(currentState?.localRepo?.githubRepo || currentGithubRepo);
    const showPrAction = workspaceSubMode === 'repo' || hasRemote;

    const message = document.createElement('div');
    message.className = 'chat-message chat-assistant jules-completion-message';
    message.innerHTML = `
      <div class="message-avatar assistant-avatar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L14.85 9.15L22 12L14.85 14.85L12 22L9.15 14.85L2 12L9.15 9.15L12 2Z" fill="url(#hero-gem-gradient)"/>
          <circle cx="12" cy="12" r="1.5" fill="#ffffff" fill-opacity="0.9"/>
        </svg>
      </div>
      <div class="message-bubble assistant-bubble jules-completion-card">
        <div class="completion-card-header">
          <span class="completion-header-title">✓ Task execution completed</span>
        </div>
        <div class="completion-card-subtitle">Changes have been applied to your working tree.</div>
        <div class="assistant-actions completion-actions">
          <button class="assistant-action-chip btn-action-review" type="button" title="Review Changes &amp; Diffs (◫)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="15" y1="3" x2="15" y2="21"></line>
            </svg>
            <span>Review Changes &amp; Diffs</span>
          </button>
          <button class="assistant-action-chip btn-action-commit" type="button" title="Commit Changes">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>Commit Changes</span>
          </button>
          <button class="assistant-action-chip btn-action-publish-pr ${showPrAction ? '' : 'hidden'}" type="button" title="Publish Branch &amp; Create PR">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="18" cy="18" r="3"></circle>
              <circle cx="6" cy="6" r="3"></circle>
              <path d="M13 6h3a2 2 0 0 1 2 2v7"></path>
              <line x1="6" y1="9" x2="6" y2="21"></line>
            </svg>
            <span>Publish Branch &amp; Create PR</span>
          </button>
          <button class="assistant-action-chip btn-action-new-task" type="button" title="New Task">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>New Task</span>
          </button>
        </div>
      </div>
    `;

    message.querySelector('.btn-action-review')?.addEventListener('click', () => {
      workspaceInspector?.classList.remove('collapsed');
      btnToggleInspector?.classList.add('active');
      void triggerReviewChangesAndDiff();
    });

    message.querySelector('.btn-action-commit')?.addEventListener('click', () => {
      workspaceInspector?.classList.remove('collapsed');
      btnToggleInspector?.classList.add('active');
      inputCommitMsg?.focus();
    });

    message.querySelector('.btn-action-publish-pr')?.addEventListener('click', () => {
      workspaceInspector?.classList.remove('collapsed');
      btnToggleInspector?.classList.add('active');
      githubPrPublisherSection?.classList.remove('hidden');
      githubPrPublisherSection?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      inputPrTitle?.focus();
    });

    message.querySelector('.btn-action-new-task')?.addEventListener('click', () => {
      btnNewTask?.click();
      resetToNewTask();
    });

    localChatStream.appendChild(message);
    localChatStream.scrollTop = localChatStream.scrollHeight;
  }

  // Task Status update handler
  if (jules?.onTaskStatus) {
    jules.onTaskStatus((event: TaskStatusEvent) => {
      if (!taskStatusBadge) return;
      taskStatusBadge.className = 'task-status-pill';

      switch (event.status) {
        case 'running':
          taskStatusBadge.classList.add('status-running');
          taskStatusBadge.textContent = 'Running';
          btnCancelTask?.classList.remove('hidden');
          terminalLiveStatus?.classList.remove('hidden');
          terminalContainer?.classList.remove('hidden');
          if (btnRunJules) btnRunJules.disabled = true;
          hasAppendedCompletionCard = false;
          if (activePlan?.approved) {
            const runningIndex = activePlan.states.findIndex((state) => state === 'running');
            if (runningIndex < 0) setPlanStepState(activePlan, 0, 'running');
          }
          break;
        case 'completed': {
          taskStatusBadge.classList.add('status-completed');
          taskStatusBadge.textContent = 'Completed ✓';
          btnCancelTask?.classList.add('hidden');
          terminalLiveStatus?.classList.add('hidden');
          if (btnRunJules) btnRunJules.disabled = false;
          refreshGitReviewDetails();
          updateActiveLocalWorkspaceSession('completed');
          fetchJulesSessions();
          if (activePlan) {
            completePlanSteps(activePlan);
            const approveBtn = activePlan.card.querySelector('.plan-action-approve') as HTMLButtonElement | null;
            if (approveBtn && approveBtn.disabled) {
              approveBtn.textContent = 'Plan Executed ✓';
            }
          }

          const liveStatus = document.getElementById('live-assistant-status');
          if (liveStatus) {
            liveStatus.textContent = 'Task completed successfully ✓';
            liveStatus.style.color = '#34d399';
          }

          if (!hasAppendedCompletionCard) {
            hasAppendedCompletionCard = true;
            appendCompletionSummaryCard();
          }

          if (activeStandaloneSessionId && jules?.saveStandaloneSession) {
            const finalSteps: StandalonePlanStep[] = PLAN_STEP_LABELS.map((label, idx) => ({
              label,
              state: activePlan?.states[idx] || 'completed'
            }));
            void jules.saveStandaloneSession({
              id: activeStandaloneSessionId,
              status: 'completed',
              planSteps: finalSteps,
              terminalOutput: julesTerminalOutput?.textContent || '',
              updatedAt: Date.now()
            });
          }
          break;
        }
        case 'failed': {
          taskStatusBadge.classList.add('status-failed');
          taskStatusBadge.textContent = 'Failed ✗';
          btnCancelTask?.classList.add('hidden');
          terminalLiveStatus?.classList.add('hidden');
          if (btnRunJules) btnRunJules.disabled = false;
          if (activePlan) failPlanSteps(activePlan);
          updateActiveLocalWorkspaceSession('failed');
          fetchJulesSessions();
          const liveStatus = document.getElementById('live-assistant-status');
          if (liveStatus) {
            liveStatus.textContent = event.message || 'Task failed with errors ✗';
            liveStatus.style.color = '#f87171';
          }
          const lastAssistant = document.querySelector('.chat-assistant:last-child .assistant-body');
          if (lastAssistant && /not connected to Google Jules/i.test(event.message || '')) {
            const card = document.createElement('div');
            card.className = 'assistant-guidance-card';
            card.innerHTML = `
              <div class="guidance-title">Repository Not Connected to Google Jules</div>
              <div class="guidance-body">
                Google Jules CLI requires a GitHub repository connected to your Jules account.
                <br>1. Connect and push your repository to GitHub.
                <br>2. Authorize it at <a href="#" class="open-jules-settings-link">jules.google.com/settings</a>.
                <br>3. Or choose a linked repository from the codebase dropdown above.
              </div>
            `;
            card.querySelector('.open-jules-settings-link')?.addEventListener('click', (ev) => {
              ev.preventDefault();
              openJulesSettings();
            });
            lastAssistant.appendChild(card);
          }
          if (activeStandaloneSessionId && jules?.saveStandaloneSession) {
            const finalSteps: StandalonePlanStep[] = PLAN_STEP_LABELS.map((label, idx) => ({
              label,
              state: activePlan?.states[idx] || 'failed'
            }));
            void jules.saveStandaloneSession({
              id: activeStandaloneSessionId,
              status: 'failed',
              planSteps: finalSteps,
              terminalOutput: julesTerminalOutput?.textContent || '',
              updatedAt: Date.now()
            });
          }
          break;
        }
        case 'cancelled': {
          taskStatusBadge.classList.add('status-failed');
          taskStatusBadge.textContent = 'Stopped';
          btnCancelTask?.classList.add('hidden');
          terminalLiveStatus?.classList.add('hidden');
          if (btnRunJules) btnRunJules.disabled = false;
          if (activePlan) failPlanSteps(activePlan);
          const liveStatus = document.getElementById('live-assistant-status');
          if (liveStatus) {
            liveStatus.textContent = 'Task stopped by user.';
            liveStatus.style.color = '#fbbf24';
          }
          if (activeStandaloneSessionId && jules?.saveStandaloneSession) {
            const finalSteps: StandalonePlanStep[] = PLAN_STEP_LABELS.map((label, idx) => ({
              label,
              state: activePlan?.states[idx] || 'failed'
            }));
            void jules.saveStandaloneSession({
              id: activeStandaloneSessionId,
              status: 'failed',
              planSteps: finalSteps,
              terminalOutput: julesTerminalOutput?.textContent || '',
              updatedAt: Date.now()
            });
          }
          break;
        }
        default:
          taskStatusBadge.classList.add('status-idle');
          taskStatusBadge.textContent = 'Idle';
          btnCancelTask?.classList.add('hidden');
          terminalLiveStatus?.classList.add('hidden');
          if (btnRunJules) btnRunJules.disabled = false;
          break;
      }
    });
  }

  // Listen for terminal output chunks
  if (jules?.onTaskOutput) {
    jules.onTaskOutput((chunk) => appendTerminalChunk(chunk));
  }

  btnClearTerminal?.addEventListener('click', () => {
    if (julesTerminalOutput) julesTerminalOutput.innerHTML = '';
    if (terminalSessionPill) terminalSessionPill.classList.add('hidden');
  });

  btnCancelTask?.addEventListener('click', async () => {
    await jules?.cancelJulesTask();
  });

  // Cookie sync button
  menuBtnSyncSession?.addEventListener('click', async () => {
    if (!syncSessionText || !syncIconSvg) return;
    const originalText = syncSessionText.textContent || 'Sync Session from Google Chrome';
    syncSessionText.textContent = 'Syncing Chrome cookies...';
    syncIconSvg.style.animation = 'spin 1s infinite linear';

    const res = await jules?.syncCookies();
    syncIconSvg.style.animation = '';

    if (res?.success) {
      syncSessionText.textContent = 'Session Synced ✓';
      syncSessionText.style.color = '#34d399';
      setTimeout(() => {
        syncSessionText.textContent = originalText;
        syncSessionText.style.color = '';
        closeMenu();
      }, 1500);
    } else {
      syncSessionText.textContent = 'Sync Failed';
      syncSessionText.style.color = '#f87171';
      setTimeout(() => {
        syncSessionText.textContent = originalText;
        syncSessionText.style.color = '';
      }, 2000);
    }
  });

  function openAddAccountModal() {
    if (!addAccountModal) return;
    if (inputAccountName) inputAccountName.value = '';
    addAccountModal.classList.remove('hidden');
    inputAccountName?.focus();
  }

  function closeAddAccountModal() {
    if (!addAccountModal) return;
    addAccountModal.classList.add('hidden');
  }

  menuBtnAddAccount?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeMenu();
    openAddAccountModal();
  });

  btnCloseAccountModal?.addEventListener('click', () => closeAddAccountModal());
  btnCancelAccountModal?.addEventListener('click', () => closeAddAccountModal());
  btnConfirmAddAccount?.addEventListener('click', async () => {
    const label = inputAccountName?.value.trim() || 'Google Account';
    closeAddAccountModal();
    await jules?.addAccount(label);
  });
  inputAccountName?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      btnConfirmAddAccount?.click();
    }
  });
  addAccountModal?.addEventListener('click', (e) => {
    if (e.target === addAccountModal) {
      closeAddAccountModal();
    }
  });

  menuBtnOpenFolder?.addEventListener('click', async () => {
    closeMenu();
    const res = await jules?.openLocalRepo();
    if (res?.success) applyMode('local', true);
  });

  menuBtnReload?.addEventListener('click', () => {
    closeMenu();
    jules?.reload();
  });

  menuBtnLogout?.addEventListener('click', async () => {
    if (!logoutConfirm) {
      logoutConfirm = true;
      const textSpan = menuBtnLogout.querySelector('span');
      if (textSpan) textSpan.textContent = 'Click again to confirm Sign Out';
      menuBtnLogout.classList.add('confirming');
      logoutTimer = setTimeout(() => {
        logoutConfirm = false;
        if (textSpan) textSpan.textContent = 'Sign Out & Clear Active Session';
        menuBtnLogout.classList.remove('confirming');
      }, 3000);
      return;
    }

    if (logoutTimer) clearTimeout(logoutTimer);
    logoutConfirm = false;
    const textSpan = menuBtnLogout.querySelector('span');
    if (textSpan) textSpan.textContent = 'Signed out ✓';
    setTimeout(() => {
      closeMenu();
      if (textSpan) textSpan.textContent = 'Sign Out & Clear Active Session';
      menuBtnLogout?.classList.remove('confirming');
    }, 800);
    await jules?.logout();
  });

  // Fetch Jules Sessions
  let sessionFetchSeq = 0;

  // ── Standalone Session Restore ──────────────────────────────────────────
  function restoreStandaloneSession(record: StandaloneSessionRecord) {
    activeStandaloneSessionId = record.id;
    if (record.mode) applyWorkspaceSubMode(record.mode);
    if (record.workspacePath) currentWorkspacePath = record.workspacePath;
    if (record.taskBranch) currentTaskBranch = record.taskBranch;
    if (record.baseBranch) currentBaseBranch = record.baseBranch;
    if (record.model) {
      selectedModel = record.model;
      const matchingOption = document.querySelector(`.model-option[data-model="${record.model}"] .model-name`);
      const friendlyLabel = matchingOption?.textContent?.trim() || record.model;
      if (canvasModelLabel) canvasModelLabel.textContent = friendlyLabel;
    }
    if (record.engine) {
      selectedEngine = record.engine;
    }
    if (record.githubRepo) {
      if (canvasRepoLabel) canvasRepoLabel.textContent = record.githubRepo;
      if (composerRepoText) composerRepoText.textContent = record.githubRepo;
    }
    updatePrPublisherUi();

    if (record.prUrl && prResultBanner && prResultLink && prResultMessage) {
      prResultMessage.textContent = 'Pull Request:';
      prResultLink.href = record.prUrl;
      prResultLink.textContent = record.prUrl;
      prResultLink.classList.remove('hidden');
      prResultBanner.classList.remove('hidden');
    }

    setSessionActive(true, record.prompt || record.title || record.id);

    if (localChatStream) {
      localChatStream.innerHTML = '';
      localEmptyState?.classList.add('hidden');
      localChatStream.classList.remove('hidden');
      syncComposerPlacement(true);

      for (const msg of record.messages || []) {
        if (msg.role === 'user') {
          appendUserTurn(msg.content);
        } else if (msg.role === 'assistant') {
          const assistantTurn = document.createElement('div');
          assistantTurn.className = 'chat-message chat-assistant';
          assistantTurn.innerHTML = `
            <div class="message-avatar assistant-avatar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L14.85 9.15L22 12L14.85 14.85L12 22L9.15 14.85L2 12L9.15 9.15L12 2Z" fill="url(#hero-gem-gradient)"/>
                <circle cx="12" cy="12" r="1.5" fill="#ffffff" fill-opacity="0.9"/>
              </svg>
            </div>
            <div class="message-bubble assistant-bubble">
              <div class="assistant-header">
                <span class="assistant-name">Jules</span>
                <span class="assistant-model-pill">${escapeHtml(record.model || 'Gemini 3.1 Pro')}</span>
              </div>
              <div class="assistant-body">
                <div class="message-text">${escapeHtml(msg.content)}</div>
              </div>
            </div>
          `;
          localChatStream.appendChild(assistantTurn);
        }
      }

      if (record.planSteps && record.planSteps.length > 0) {
        const plan = createPlanCard(record.prompt || record.title);
        activePlan = plan;
        record.planSteps.forEach((st, idx) => {
          if (idx < plan.steps.length) {
            setPlanStepState(plan, idx, st.state);
          }
        });
        if (record.status === 'completed' || record.status === 'published') {
          completePlanSteps(plan);
          appendCompletionSummaryCard();
        } else if (record.status === 'failed') {
          failPlanSteps(plan);
        }
      } else if (record.status === 'completed' || record.status === 'published') {
        appendCompletionSummaryCard();
      }

      if (record.terminalOutput && julesTerminalOutput) {
        julesTerminalOutput.innerHTML = '';
        appendTerminalChunk({ taskId: record.id, stream: 'stdout', chunk: record.terminalOutput, timestamp: Date.now() });
        terminalContainer?.classList.remove('hidden');
      }

      localChatStream.scrollTop = localChatStream.scrollHeight;
    }
  }

  /** Renders a local workspace session entry inside the sidebar session list. */
  function renderLocalSessionItem(session: LocalWorkspaceSession): HTMLElement {
    const item = document.createElement('div');
    item.className = 'session-item local-session-item';
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.title = `${session.description} (${session.lastActive || 'recently'}) [${session.status}]`;

    const iconDiv = document.createElement('div');
    iconDiv.className = 'session-icon';
    iconDiv.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
    `;

    const meta = document.createElement('div');
    meta.className = 'session-meta-box';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'session-title';
    titleSpan.textContent = session.description || 'Untitled task';
    titleSpan.title = `${session.description} (${session.lastActive || 'recently'}) [${session.status}]`;

    const subDiv = document.createElement('div');
    subDiv.className = 'session-sub';

    const statusDot = document.createElement('span');
    const isDone = session.status === 'completed';
    statusDot.className = `session-status-dot ${isDone ? 'dot-completed' : 'dot-active'}`;
    statusDot.title = `Status: ${session.status}`;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'session-time';
    timeSpan.textContent = session.lastActive || 'Recent';

    subDiv.appendChild(statusDot);
    subDiv.appendChild(timeSpan);

    meta.appendChild(titleSpan);
    meta.appendChild(subDiv);

    item.appendChild(iconDiv);
    item.appendChild(meta);

    // Clicking a local session restores its conversation into the chat stream.
    item.addEventListener('click', () => {
      if (!localChatStream) return;
      localChatStream.innerHTML = session.chatHtml;
      localEmptyState?.classList.add('hidden');
      localChatStream.classList.remove('hidden');
      syncComposerPlacement(true);
    });

    return item;
  }

  async function fetchJulesSessions() {
    if (!julesSessionsList) return;
    const currentSeq = ++sessionFetchSeq;

    // Local workspace sessions of the current repository (plus unlinked ones).
    const currentRepoPath = currentState?.localRepo?.path;
    const localSessions = localWorkspaceSessions.filter(
      (session) => !session.repoPath || !currentRepoPath || session.repoPath === currentRepoPath
    );

    try {
      julesSessionsList.innerHTML = '<span class="text-muted">Querying Jules CLI sessions...</span>';
      const sessions: JulesSessionItem[] = (await jules?.listJulesSessions(currentState?.localRepo?.path)) || [];

      if (currentSeq !== sessionFetchSeq) return;

      if ((!sessions || sessions.length === 0) && localSessions.length === 0) {
        julesSessionsList.innerHTML = '<span class="text-muted">No recent sessions yet — ask Jules for a plan to start.</span>';
        return;
      }

      julesSessionsList.innerHTML = '';

      for (const local of localSessions) {
        julesSessionsList.appendChild(renderLocalSessionItem(local));
      }

      for (const s of sessions) {
        const item = document.createElement('div');
        item.className = 'session-item';
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '0');

        const iconDiv = document.createElement('div');
        iconDiv.className = 'session-icon';
        iconDiv.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        `;

        const meta = document.createElement('div');
        meta.className = 'session-meta-box';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'session-title';
        const displayTitle = s.description && s.description.trim() ? s.description.trim() : `Task ${s.id.slice(0, 8)}`;
        titleSpan.textContent = displayTitle;
        titleSpan.title = `${s.description || s.id} (${s.lastActive || 'recently'}) [${s.status}]`;

        const subDiv = document.createElement('div');
        subDiv.className = 'session-sub';

        const statusDot = document.createElement('span');
        const isDone = s.status === 'completed' || s.status === 'succeeded';
        statusDot.className = `session-status-dot ${isDone ? 'dot-completed' : 'dot-active'}`;
        statusDot.title = `Status: ${s.status}`;

        const timeSpan = document.createElement('span');
        timeSpan.className = 'session-time';
        timeSpan.textContent = s.lastActive || 'Recent';

        subDiv.appendChild(statusDot);
        subDiv.appendChild(timeSpan);

        meta.appendChild(titleSpan);
        meta.appendChild(subDiv);

        item.appendChild(iconDiv);
        item.appendChild(meta);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'session-actions';

        const btnApply = document.createElement('button');
        btnApply.className = 'btn-apply-session';
        btnApply.title = `Apply patch from session ${s.id.slice(0, 8)} to working tree`;
        btnApply.innerHTML = `
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>Apply</span>
        `;
        btnApply.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!currentState?.localRepo?.path) return;
          btnApply.innerHTML = '<span>Applying...</span>';
          btnApply.disabled = true;
          const res = await jules?.applyJulesSession(currentState.localRepo.path, s.id);
          btnApply.innerHTML = res?.success ? '<span>Applied ✓</span>' : '<span>Failed</span>';
          refreshGitReviewDetails();
          setTimeout(() => {
            btnApply.innerHTML = `
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>Apply</span>
            `;
            btnApply.disabled = false;
          }, 3500);
        });

        const btnDelete = document.createElement('button');
        btnDelete.className = 'btn-session-delete';
        btnDelete.type = 'button';
        btnDelete.title = `Delete session ${s.id.slice(0, 8)}`;
        btnDelete.innerHTML = `
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        `;
        btnDelete.addEventListener('click', async (e) => {
          e.stopPropagation();
          btnDelete.disabled = true;
          await jules?.deleteJulesSession(s.id);
          item.style.opacity = '0';
          item.style.transform = 'translateX(-10px)';
          item.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
          setTimeout(() => {
            item.remove();
            if (julesSessionsList && julesSessionsList.children.length === 0) {
              julesSessionsList.innerHTML = '<span class="text-muted">No active sessions found for this repository.</span>';
            }
          }, 200);
        });

        actionsDiv.appendChild(btnApply);
        actionsDiv.appendChild(btnDelete);
        item.appendChild(actionsDiv);

        // Clicking item restores standalone session or populates composer prompt
        item.addEventListener('click', async () => {
          const record = await jules?.getStandaloneSession(s.id);
          if (record) {
            restoreStandaloneSession(record);
            return;
          }
          if (julesTaskPrompt && s.description) {
            julesTaskPrompt.value = s.description;
            julesTaskPrompt.focus();
          }
        });

        julesSessionsList.appendChild(item);
      }
      renderGitHubSessionsList(sessions);
      renderOverviewSessionsList(sessions);
    } catch {
      if (localSessions.length > 0) {
        julesSessionsList.innerHTML = '';
        for (const local of localSessions) {
          julesSessionsList.appendChild(renderLocalSessionItem(local));
        }
      } else {
        julesSessionsList.innerHTML = '<span class="text-muted">Jules CLI not reachable or no active sessions.</span>';
      }
    }
  }

  // Git review details
  async function refreshGitReviewDetails() {
    if (!gitStatusContent || !gitCommitsContent) return;

    const hasRepo = Boolean(currentState?.localRepo?.path);
    const hasChatContent = Boolean(localChatStream && localChatStream.querySelectorAll('.chat-message').length > 0);
    localEmptyState?.classList.toggle('hidden', hasChatContent);
    localChatStream?.classList.toggle('hidden', !hasChatContent);
    drawerBodyGrid?.classList.remove('hidden');
    drawerFooter?.classList.toggle('hidden', !hasRepo);
    syncComposerPlacement(hasChatContent);

    if (!currentState?.localRepo) {
      gitStatusContent.innerHTML = '<span class="text-muted">No repository connected. Pick a folder to start.</span>';
      gitCommitsContent.innerHTML = '<span class="text-muted">No commits.</span>';
      if (gitStatusSummary) gitStatusSummary.textContent = 'No repository';
      tabLocalBadge?.classList.add('hidden');
      if (drawerRepoTitle) drawerRepoTitle.textContent = 'Jules Local Workspace';
      if (drawerRepoMeta) drawerRepoMeta.textContent = 'Select a local directory or git repository to run Jules';
      if (drawerModeIndicator) drawerModeIndicator.textContent = 'No Repo Linked';
      if (canvasRepoLabel) canvasRepoLabel.textContent = 'No Repo Linked';
      if (composerRepoText) composerRepoText.textContent = 'No Repo';
      if (sidebarActiveRepoCard) sidebarActiveRepoCard.classList.add('hidden');
      if (sidebarStatusBadge) {
        sidebarStatusBadge.textContent = 'idle';
        sidebarStatusBadge.title = 'Jules Local working tree status';
      }
      return;
    }

    const repo = currentState.localRepo;
    const displayName = repo.githubRepo || repo.name;
    if (drawerRepoTitle) drawerRepoTitle.textContent = displayName;
    if (drawerRepoMeta) drawerRepoMeta.textContent = `Branch: ${repo.branch} • Path: ${repo.path}`;
    if (drawerModeIndicator) drawerModeIndicator.textContent = `Active: ${repo.branch}`;
    if (canvasRepoLabel) canvasRepoLabel.textContent = displayName;
    if (canvasBranchLabel) canvasBranchLabel.textContent = repo.branch;
    if (composerRepoText) composerRepoText.textContent = displayName;
    if (composerBranchText) composerBranchText.textContent = repo.branch;

    if (sidebarActiveRepoCard) {
      sidebarActiveRepoCard.classList.remove('hidden');
      if (sidebarRepoName) sidebarRepoName.textContent = displayName;
      if (sidebarBranchBadge) sidebarBranchBadge.textContent = repo.branch;
    }

    gitStatusContent.innerHTML = '<span class="text-muted">Analyzing working tree...</span>';
    gitCommitsContent.innerHTML = '<span class="text-muted">Loading commits...</span>';

    try {
      const details: GitReviewDetails | null = (await jules?.getGitReviewDetails()) || null;
      latestGitReviewDetails = details;
      if (!details) {
        gitStatusContent.innerHTML = '<span class="text-muted">Unable to inspect Git status</span>';
        gitCommitsContent.innerHTML = '<span class="text-muted">No commit history</span>';
        if (gitStatusSummary) gitStatusSummary.textContent = 'Status error';
        if (sidebarStatusBadge) sidebarStatusBadge.textContent = 'error';
        return;
      }

      const structured = details.structured;
      if (structured) {
        const total = structured.totalChanges;
        if (tabLocalBadge) {
          if (total > 0) {
            tabLocalBadge.textContent = String(total);
            tabLocalBadge.classList.remove('hidden');
          } else {
            tabLocalBadge.classList.add('hidden');
          }
        }

        if (gitStatusSummary) {
          if (total === 0) {
            if (structured.aheadBehind && structured.aheadBehind.ahead > 0) {
              gitStatusSummary.textContent = `Clean working tree (↑${structured.aheadBehind.ahead} unpushed)`;
            } else if (structured.aheadBehind && structured.aheadBehind.behind > 0) {
              gitStatusSummary.textContent = `Clean working tree (↓${structured.aheadBehind.behind} behind)`;
            } else {
              gitStatusSummary.textContent = 'Clean working tree';
            }
            if (sidebarStatusBadge) sidebarStatusBadge.textContent = 'clean';
          } else {
            let summaryText = `${total} change${total === 1 ? '' : 's'}`;
            if (structured.aheadBehind) {
              const { ahead, behind } = structured.aheadBehind;
              if (ahead > 0 || behind > 0) {
                summaryText += ` (↑${ahead} ↓${behind})`;
              }
            }
            gitStatusSummary.textContent = summaryText;
            if (sidebarStatusBadge) sidebarStatusBadge.textContent = `${total} changed`;
          }
        }

        if (total === 0) {
          gitStatusContent.innerHTML = '<div class="status-row text-success">✓ Clean working tree (no uncommitted changes)</div>';
        } else {
          gitStatusContent.innerHTML = '';

          // 1. Conflicts
          if (structured.conflicts.length > 0) {
            const group = document.createElement('div');
            group.className = 'status-group';
            group.innerHTML = `<div class="status-group-title" style="color: #f87171;">Merge Conflicts (${structured.conflicts.length})</div>`;
            for (const item of structured.conflicts) {
              const row = document.createElement('div');
              row.className = 'status-row';
              row.title = `Click to view diff for ${item.path}`;
              row.innerHTML = `<span class="badge badge-conflict">CONFLICT</span> <span class="status-file-name">${escapeHtml(item.path)}</span>`;
              row.addEventListener('click', () => openDiffViewer(item.path, false));
              group.appendChild(row);
            }
            gitStatusContent.appendChild(group);
          }

          // 2. Staged
          if (structured.staged.length > 0) {
            const group = document.createElement('div');
            group.className = 'status-group';
            group.innerHTML = `<div class="status-group-title" style="color: #34d399;">Staged for Commit (${structured.staged.length})</div>`;
            for (const item of structured.staged) {
              const row = document.createElement('div');
              row.className = 'status-row';
              row.title = `Click to view staged diff for ${item.path}`;
              row.innerHTML = `<span class="badge badge-staged">STAGED</span> <span class="status-file-name">${escapeHtml(item.path)}</span>`;
              row.addEventListener('click', () => openDiffViewer(item.path, true));
              group.appendChild(row);
            }
            gitStatusContent.appendChild(group);
          }

          // 3. Unstaged / Modified
          if (structured.unstaged.length > 0) {
            const group = document.createElement('div');
            group.className = 'status-group';
            group.innerHTML = `<div class="status-group-title" style="color: #fbbf24;">Modified in Working Tree (${structured.unstaged.length})</div>`;
            for (const item of structured.unstaged) {
              const row = document.createElement('div');
              row.className = 'status-row';
              row.title = `Click to view diff for ${item.path}`;
              row.innerHTML = `<span class="badge badge-modified">MODIFIED</span> <span class="status-file-name">${escapeHtml(item.path)}</span>`;
              row.addEventListener('click', () => openDiffViewer(item.path, false));
              group.appendChild(row);
            }
            gitStatusContent.appendChild(group);
          }

          // 4. Untracked
          if (structured.untracked.length > 0) {
            const group = document.createElement('div');
            group.className = 'status-group';
            group.innerHTML = `<div class="status-group-title" style="color: #a1a1aa;">Untracked Files (${structured.untracked.length})</div>`;
            for (const item of structured.untracked) {
              const row = document.createElement('div');
              row.className = 'status-row';
              row.title = `Click to inspect untracked file ${item.path}`;
              row.innerHTML = `<span class="badge badge-untracked">UNTRACKED</span> <span class="status-file-name">${escapeHtml(item.path)}</span>`;
              row.addEventListener('click', () => openDiffViewer(item.path, false));
              group.appendChild(row);
            }
            gitStatusContent.appendChild(group);
          }
        }
      } else if (!details.hasChanges || !details.statusText) {
        if (gitStatusSummary) gitStatusSummary.textContent = 'Clean working tree';
        tabLocalBadge?.classList.add('hidden');
        gitStatusContent.innerHTML = '<div class="status-row text-success">✓ Clean working tree (no uncommitted changes)</div>';
        if (sidebarStatusBadge) sidebarStatusBadge.textContent = 'clean';
      } else {
        const lines = details.statusText.split('\n').filter(Boolean);
        if (gitStatusSummary) gitStatusSummary.textContent = `${lines.length} changed`;
        if (sidebarStatusBadge) sidebarStatusBadge.textContent = `${lines.length} changed`;
        if (tabLocalBadge) {
          tabLocalBadge.textContent = String(lines.length);
          tabLocalBadge.classList.remove('hidden');
        }
        gitStatusContent.innerHTML = '';
        for (const line of lines) {
          const code = line.slice(0, 2).trim();
          let file = line.slice(3).trim();
          if (file.startsWith('"') && file.endsWith('"')) {
            file = file.slice(1, -1).replace(/\\"/g, '"');
          }
          const row = document.createElement('div');
          row.className = 'status-row';
          row.title = `Click to view diff for ${file}`;
          let badgeClass = 'badge-u';
          if (code.includes('M')) badgeClass = 'badge-m';
          else if (code.includes('A')) badgeClass = 'badge-a';
          else if (code.includes('D')) badgeClass = 'badge-d';
          row.innerHTML = `<span class="badge ${badgeClass}">${code || '??'}</span> <span class="status-file-name">${escapeHtml(file)}</span>`;
          row.addEventListener('click', () => openDiffViewer(file, false));
          gitStatusContent.appendChild(row);
        }
      }

      if (!details.recentCommits || details.recentCommits.length === 0) {
        gitCommitsContent.innerHTML = '<span class="text-muted">No recent commits</span>';
      } else {
        gitCommitsContent.innerHTML = '';
        for (const commit of details.recentCommits) {
          const row = document.createElement('div');
          row.className = 'commit-row';

          const head = document.createElement('div');
          head.className = 'commit-head';

          const hashSpan = document.createElement('span');
          hashSpan.className = 'commit-hash';
          hashSpan.textContent = commit.hash;
          hashSpan.title = 'Click to copy commit hash';
          hashSpan.addEventListener('click', async (e) => {
            e.stopPropagation();
            await navigator.clipboard.writeText(commit.hash);
            const orig = hashSpan.textContent;
            hashSpan.textContent = '✓ Copied!';
            setTimeout(() => {
              hashSpan.textContent = orig;
            }, 1200);
          });

          const dateSpan = document.createElement('span');
          dateSpan.className = 'commit-date';
          dateSpan.textContent = commit.date;

          const authorSpan = document.createElement('span');
          authorSpan.className = 'text-muted';
          authorSpan.textContent = `by ${commit.author}`;

          head.appendChild(hashSpan);
          head.appendChild(dateSpan);
          head.appendChild(authorSpan);

          const msgDiv = document.createElement('div');
          msgDiv.className = 'commit-msg';
          msgDiv.textContent = commit.message;

          row.appendChild(head);
          row.appendChild(msgDiv);
          gitCommitsContent.appendChild(row);
        }
      }

      if (btnCopySlug && copySlugLabel) {
        if (details.githubRepo) {
          copySlugLabel.textContent = `Copy ${details.githubRepo}`;
          btnCopySlug.title = `Copy GitHub repository "${details.githubRepo}" to clipboard`;
        } else {
          copySlugLabel.textContent = 'Copy Local Path';
          btnCopySlug.title = `Copy local path "${repo.path}" to clipboard`;
        }
      }
    } catch {
      gitStatusContent.innerHTML = '<span class="text-muted">Failed to query git</span>';
      gitCommitsContent.innerHTML = '<span class="text-muted">Failed to query git</span>';
    }
  }

  function escapeHtml(str: unknown): string {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function updateUi(state: NavigationState) {
    currentState = state;
    if (btnBack) btnBack.disabled = !state.canGoBack;
    if (btnForward) btnForward.disabled = !state.canGoForward;
    if (loadingBar) loadingBar.classList.toggle('active', state.isLoading);

    const activeAcc = state.accounts?.find((a) => a.id === state.activeAccountId);
    if (sidebarAvatarInitial && activeAcc?.name) {
      sidebarAvatarInitial.textContent = activeAcc.name.charAt(0).toUpperCase();
    }
    if (sidebarAccountName) {
      sidebarAccountName.textContent = activeAcc?.name || 'Google User';
    }

    if (btnMaximize && iconMaximize && iconRestore) {
      if (state.isMaximized) {
        iconMaximize.classList.add('hidden');
        iconRestore.classList.remove('hidden');
        btnMaximize.title = 'Restore';
      } else {
        iconMaximize.classList.remove('hidden');
        iconRestore.classList.add('hidden');
        btnMaximize.title = 'Maximize';
      }
    }

    if (repoSelectLabel && btnSelectRepo) {
      if (state.localRepo) {
        const displayName = state.localRepo.githubRepo || state.localRepo.name;
        repoSelectLabel.textContent = displayName;
        repoStatusBadge?.classList.remove('hidden');
        if (repoStatusBadge) {
          repoStatusBadge.textContent = state.localRepo.branch;
          repoStatusBadge.title = `Jules Local — ${displayName} (${state.localRepo.branch})`;
        }
        btnClearRepo?.classList.remove('hidden');
        if (canvasRepoLabel) canvasRepoLabel.textContent = displayName;
        if (canvasBranchLabel) canvasBranchLabel.textContent = state.localRepo.branch;
        if (composerRepoText) composerRepoText.textContent = displayName;
        if (composerBranchText) composerBranchText.textContent = state.localRepo.branch;
        if (julesRepoDropdownLabel) julesRepoDropdownLabel.textContent = displayName;
        if (breadcrumbRepoText) breadcrumbRepoText.textContent = displayName;
      } else {
        repoSelectLabel.textContent = 'Select Local Directory / Repository...';
        repoStatusBadge?.classList.add('hidden');
        btnClearRepo?.classList.add('hidden');
        if (canvasRepoLabel) canvasRepoLabel.textContent = 'No Repo Linked';
        if (canvasBranchLabel) canvasBranchLabel.textContent = 'main';
        if (composerRepoText) composerRepoText.textContent = 'No Repo';
        if (composerBranchText) composerBranchText.textContent = 'main';
        if (julesRepoDropdownLabel) julesRepoDropdownLabel.textContent = 'Choose repository';
        if (breadcrumbRepoText) breadcrumbRepoText.textContent = 'No Repo';
      }
    }

    const hasRepo = Boolean(state.localRepo?.path);
    const hasChatContent = Boolean(localChatStream && localChatStream.querySelectorAll('.chat-message').length > 0);
    localEmptyState?.classList.toggle('hidden', hasChatContent);
    localChatStream?.classList.toggle('hidden', !hasChatContent);
    drawerBodyGrid?.classList.remove('hidden');
    drawerFooter?.classList.toggle('hidden', !hasRepo);
    syncComposerPlacement(hasChatContent);

    const repoChanged = state.localRepo?.path !== lastKnownRepoPath;
    lastKnownRepoPath = state.localRepo?.path;

    // Keep the dynamic document title in sync with the linked repository.
    updateDocumentTitle();

    if (isDrawerOpen && repoChanged) {
      refreshGitReviewDetails();
      fetchJulesSessions();
      renderRecentRepoChips();
    }

    const legacyHealth: LegacyJulesHealth | undefined = state.legacyJulesHealth;
    if (legacyHealth) {
      if (legacyHealth.online === false) {
        tabLegacyCloudMode?.classList.add('hidden');
        if (tabCloudBadge) {
          tabCloudBadge.textContent = 'Standalone Mode Active';
          tabCloudBadge.classList.remove('hidden');
        }
        const standaloneFallbackBadge = document.getElementById('standalone-fallback-badge');
        if (standaloneFallbackBadge) {
          standaloneFallbackBadge.textContent = 'Standalone Mode Active';
          standaloneFallbackBadge.classList.remove('hidden');
        }
      } else {
        tabLegacyCloudMode?.classList.remove('hidden');
      }
    }

    const ghAuth: GitHubAuthStatus | undefined = state.githubAuth;
    if (ghAuth && !ghAuth.authenticated && ghAuth.error) {
      if (prStatusBadge) {
        prStatusBadge.title = `GitHub Auth: ${ghAuth.error}`;
      }
    }

    if (state.activeEngine) {
      selectedEngine = state.activeEngine;
    }
    if (state.activeModel) {
      selectedModel = state.activeModel;
      const matchingOption = document.querySelector(`.model-option[data-model="${selectedModel}"] .model-name`);
      const friendlyLabel = matchingOption?.textContent?.trim() || selectedModel;
      if (canvasModelLabel) canvasModelLabel.textContent = friendlyLabel;
    }
    if (state.activeGitHubRepo) {
      currentGithubRepo = state.activeGitHubRepo;
      if (canvasRepoLabel) canvasRepoLabel.textContent = currentGithubRepo.nameWithOwner;
      if (composerRepoText) composerRepoText.textContent = currentGithubRepo.nameWithOwner;
    }
    if (state.githubRepos && state.githubRepos.length > 0 && cachedGithubRepos.length === 0) {
      cachedGithubRepos = state.githubRepos;
      renderGitHubReposList(cachedGithubRepos);
    }
    if (state.engines && state.engines.length > 0) {
      for (const info of state.engines) {
        const badge = (document.getElementById(`badge-engine-${info.id}`) ||
          document.querySelector(`.engine-badge[data-engine="${info.id}"]`)) as HTMLElement | null;
        if (badge) {
          if (info.available) {
            badge.textContent = info.version ? `Ready (${info.version})` : 'Ready';
            badge.className = 'engine-badge engine-badge-ready';
          } else {
            badge.textContent = 'Not Installed';
            badge.className = 'engine-badge engine-badge-uninstalled';
          }
        }
      }
    }

    renderAccountsMenu();
  }

  // Segmented Mode Switcher handlers
  tabCloudMode?.addEventListener('click', () => applyMode('cloud'));
  tabLocalMode?.addEventListener('click', () => applyMode('toggle'));
  tabRepoMode?.addEventListener('click', () => applyMode('repo'));
  tabLegacyCloudMode?.addEventListener('click', () => applyMode('legacy-cloud'));

  btnWorkspaceModeRepo?.addEventListener('click', () => applyWorkspaceSubMode('repo'));
  btnWorkspaceModeLocal?.addEventListener('click', () => applyWorkspaceSubMode('local'));

  // Refresh Git working tree button
  btnRefreshGit?.addEventListener('click', () => {
    refreshGitReviewDetails();
    fetchJulesSessions();
    renderRecentRepoChips();
  });

  // Inline Diff Inspector Close
  btnCloseDiff?.addEventListener('click', () => closeDiffViewer());

  // Navigation handlers
  btnBack?.addEventListener('click', () => jules?.navigateBack());
  btnForward?.addEventListener('click', () => jules?.navigateForward());
  btnReload?.addEventListener('click', () => jules?.reload());

  btnEmptySelectRepo?.addEventListener('click', async (e) => {
    if (workspaceSubMode === 'repo') {
      e.stopPropagation();
      btnCanvasRepoSelect?.click();
      setTimeout(() => githubRepoSearchInput?.focus(), 50);
      return;
    }
    const res = await jules?.openLocalRepo();
    if (res?.success) applyMode('local', true);
  });

  btnEmptyInitRepo?.addEventListener('click', async () => {
    const res = await jules?.initGitRepo();
    if (res?.success) applyMode('local', true);
  });

  btnClearRepo?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await jules?.clearLocalRepo();
    refreshGitReviewDetails();
  });

  // ── Jules Plan Generation ('Give me a plan') ────────────────────────────
  const PLAN_STEP_LABELS = [
    'Analyze codebase structure and dependencies',
    'Plan code modifications and edge case validation',
    'Execute changes in local repository',
    'Run test suite and verify working tree'
  ];
  const PLAN_EXPECTED_OUTPUT_CHARS = 1200;
  const DEFAULT_PLAN_LABEL = 'Give me a plan';

  type PlanStepState = 'pending' | 'running' | 'completed' | 'failed';

  interface ActivePlan {
    prompt: string;
    card: HTMLElement;
    steps: HTMLElement[];
    states: PlanStepState[];
    outputChars: number;
    approved: boolean;
  }

  let activePlan: ActivePlan | null = null;

  function planStepIcon(state: PlanStepState, index?: number): string {
    switch (state) {
      case 'completed':
        return '✓';
      case 'running':
        return '◐';
      case 'failed':
        return '✗';
      default:
        return typeof index === 'number' ? String(index + 1) : '○';
    }
  }

  function setPlanStepState(plan: ActivePlan, index: number, state: PlanStepState) {
    const step = plan.steps[index];
    if (!step) return;
    plan.states[index] = state;
    step.className = `plan-step plan-step-${state}`;
    const marker = step.querySelector('.plan-step-marker');
    if (marker) marker.textContent = planStepIcon(state, index);

    if (plan.approved && state === 'running') {
      const statusLabel = plan.card.querySelector('.assistant-status-label');
      if (statusLabel) {
        statusLabel.textContent = `Executing: ${PLAN_STEP_LABELS[index]}...`;
      }
    }
  }

  /** Derives a compact plan title from the raw user prompt. */
  function buildPlanTitle(prompt: string): string {
    const firstLine = (prompt.split('\n').find((line) => line.trim().length > 0) || prompt).trim();
    return firstLine.length > 68 ? `${firstLine.slice(0, 65)}…` : firstLine;
  }

  /** Appends the user's prompt as a chat turn. */
  function appendUserTurn(prompt: string) {
    if (!localChatStream) return;
    if (!localChatStream.querySelector('.chat-timestamp-divider')) {
      const divider = document.createElement('div');
      divider.className = 'chat-timestamp-divider';
      divider.innerHTML = '<span class="chat-timestamp-pill">Today</span>';
      localChatStream.appendChild(divider);
    }
    const userMsg = document.createElement('div');
    userMsg.className = 'chat-message chat-user chat-turn-user';
    userMsg.innerHTML = `
      <div class="message-bubble user-bubble">
        <div class="message-sender-row">
          <span class="message-sender">${escapeHtml(sidebarAccountName?.textContent || 'You')}</span>
          <span class="message-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div class="message-text user-bubble-content">${escapeHtml(prompt)}</div>
      </div>
      <div class="message-avatar user-avatar">${escapeHtml(sidebarAvatarInitial?.textContent || 'O')}</div>
    `;
    localChatStream.appendChild(userMsg);
  }

  /** Builds the Jules Plan Card (title, steps, approve / ask-for-changes actions). */
  function createPlanCard(prompt: string): ActivePlan {
    const planTitle = buildPlanTitle(prompt);
    const message = document.createElement('div');
    message.className = 'chat-message chat-assistant chat-turn-assistant';
    message.innerHTML = `
      <div class="message-avatar assistant-avatar assistant-avatar-wrap">
        <svg class="jules-octopus-avatar-white" width="22" height="25" viewBox="0 0 84 95" fill="none">
          <path d="M41.824 4.80334C55.2044 4.80334 66.0631 15.6622 66.0632 29.0426C66.0632 29.7486 66.0299 30.4552 65.9626 31.1276C65.9963 31.4636 66.0632 31.7999 66.0632 32.1696V51.6354C66.0632 52.7782 65.7946 53.8539 65.324 54.8287V74.4957C65.324 76.6137 67.0722 78.3619 69.1902 78.3619C71.2421 78.3619 72.9471 76.7212 73.0515 74.693L73.0613 74.2985C73.1659 72.2704 74.8708 70.6295 76.9226 70.6295C79.0405 70.6296 80.7886 72.3443 80.7888 74.4957C80.7888 80.6143 76.0149 85.5898 69.9636 86.027C69.7283 86.0606 69.4591 86.0944 69.1902 86.0944C68.9212 86.0944 68.6857 86.0942 68.4167 86.027C62.399 85.6235 57.5916 80.648 57.5916 74.4957V59.0309H52.4138V74.3619C52.4136 76.4798 50.6991 78.2281 48.5476 78.2281C46.4298 78.228 44.6816 76.5133 44.6814 74.3619V59.0309H39.5046V74.3619C39.5044 76.4797 37.7898 78.228 35.6384 78.2281C33.5205 78.2281 31.7724 76.5134 31.7722 74.3619V59.0309H26.5945V74.4957C26.5945 80.6143 21.787 85.6234 15.7693 86.027C15.534 86.0606 15.2648 86.0944 14.9958 86.0944C14.7269 86.0944 14.4913 86.0942 14.2224 86.027C8.20468 85.6234 3.39722 80.648 3.39722 74.4957C3.3974 72.3779 5.14552 70.6295 7.26343 70.6295C9.38133 70.6295 11.1295 72.3443 11.1296 74.4957C11.1296 76.6137 12.8779 78.3619 14.9958 78.3619C17.1139 78.3619 18.8621 76.6137 18.8621 74.4957V55.8033C18.0554 54.6268 17.5848 53.1816 17.5847 51.6354V32.1696C17.5847 31.7999 17.6517 31.4636 17.6853 31.1276C17.6181 30.4216 17.5847 29.7486 17.5847 29.0426C17.5848 15.6623 28.4436 4.80336 41.824 4.80334ZM29.1833 38.9938C27.0481 38.9938 25.3171 41.1619 25.3171 43.8356C25.3173 46.5091 27.0482 48.6764 29.1833 48.6764C31.3184 48.6763 33.0494 46.509 33.0496 43.8356C33.0496 41.1619 31.3185 38.9939 29.1833 38.9938ZM55.0027 38.9938C52.8675 38.9938 51.1365 41.1619 51.1365 43.8356C51.1366 46.5091 52.8676 48.6763 55.0027 48.6764C57.1378 48.6764 58.8687 46.5091 58.8689 43.8356C58.8689 41.1619 57.1379 38.9938 55.0027 38.9938Z" fill="#ffffff"/>
        </svg>
      </div>
      <div class="message-bubble assistant-bubble">
        <div class="assistant-header">
          <span class="assistant-name">Jules</span>
          <span class="assistant-model-pill">${escapeHtml(canvasModelLabel?.textContent || 'Gemini 3.1 Pro')}</span>
        </div>
        <div class="assistant-body">
          <div class="assistant-status-box">
            <span class="terminal-pulse-dot"></span>
            <span class="assistant-status-label" id="live-assistant-status">Plan ready — review the steps, then approve to execute.</span>
          </div>
          <div class="jules-plan-card">
            <div class="plan-card-header">
              <span class="plan-card-kicker">Jules Plan</span>
              <span class="plan-card-title">Plan for: ${escapeHtml(planTitle)}</span>
            </div>
            <ol class="plan-steps">
              ${PLAN_STEP_LABELS.map(
                (label, index) => `
                <li class="plan-step plan-step-pending" data-step-index="${index}">
                  <span class="plan-step-marker">${planStepIcon('pending', index)}</span>
                  <span class="plan-step-label">${escapeHtml(label)}</span>
                </li>`
              ).join('')}
            </ol>
            <div class="plan-actions">
              <button class="plan-action-btn plan-action-approve" type="button">Approve &amp; Execute Plan</button>
              <button class="plan-action-btn plan-action-changes" type="button">Ask for Changes</button>
            </div>
          </div>
        </div>
      </div>
    `;

    const card = message.querySelector('.jules-plan-card') as HTMLElement;
    const steps = Array.from(message.querySelectorAll('.plan-step')) as HTMLElement[];
    const plan: ActivePlan = {
      prompt,
      card,
      steps,
      states: PLAN_STEP_LABELS.map(() => 'pending' as PlanStepState),
      outputChars: 0,
      approved: false
    };

    const approveBtn = message.querySelector('.plan-action-approve') as HTMLButtonElement | null;
    const changesBtn = message.querySelector('.plan-action-changes') as HTMLButtonElement | null;

    approveBtn?.addEventListener('click', () => {
      void executeApprovedPlan(plan);
    });

    changesBtn?.addEventListener('click', () => {
      if (changesBtn) changesBtn.disabled = true;
      card.classList.add('plan-superseded');
      const status = message.querySelector('.assistant-status-label');
      if (status) status.textContent = 'Describe the changes you would like — the next plan will replace this one.';
      // The next composer submission revises the plan instead of creating one.
      const planLabel = document.querySelector('#btn-run-jules .btn-plan-label');
      if (planLabel) planLabel.textContent = 'Update plan';
      if (julesTaskPrompt) {
        julesTaskPrompt.placeholder = 'Describe the changes you want to the plan...';
        julesTaskPrompt.focus();
        julesTaskPrompt.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });

    localChatStream?.appendChild(message);
    return plan;
  }

  /** Invokes the existing Jules task IPC (`chrome:run-jules-task`). */
  async function invokeJulesRunTask(prompt: string, options: RunTaskOptions): Promise<void> {
    // The model is surfaced in the UI; the CLI runner executes against the local repo path.
    if (typeof jules?.runTask === 'function') {
      await jules.runTask(prompt, options);
      return;
    }
    await jules?.runJulesTask(options.repoPath, prompt, options);
  }

  let lastChunkOutputText = '';

  /** Advances the plan step checkmarks as task output streams in. */
  function updatePlanProgressFromOutput(plan: ActivePlan, addedChars: number) {
    if (!plan.approved) return;
    plan.outputChars += Math.max(0, addedChars);
    const text = lastChunkOutputText;

    // Detect execution milestones from text keywords if present
    let keywordStep = -1;
    if (text) {
      if (/summary|summariz|task completed|changes applied|all changes verified|review bundle/i.test(text)) {
        keywordStep = 3;
      } else if (/run.*test|running tests|npm test|vitest|pytest|verif/i.test(text)) {
        keywordStep = 3;
      } else if (/execut|modifi|patch|appl|writ|creat|delet|updat/i.test(text)) {
        keywordStep = 2;
      } else if (/plan|analyz|inspect|gather|search|read/i.test(text)) {
        keywordStep = 1;
      }
    }

    const fraction = Math.min(1, plan.outputChars / PLAN_EXPECTED_OUTPUT_CHARS);
    const charStep = Math.min(PLAN_STEP_LABELS.length - 1, Math.floor(fraction * PLAN_STEP_LABELS.length));
    const targetStep = Math.max(charStep, keywordStep);

    // Advance monotonically: never drop steps backwards
    const currentRunning = plan.states.findIndex((s) => s === 'running');
    const activeIndex = Math.max(0, currentRunning >= 0 ? Math.max(currentRunning, targetStep) : targetStep);

    for (let i = 0; i < PLAN_STEP_LABELS.length; i++) {
      if (i < activeIndex) {
        if (plan.states[i] !== 'completed') {
          setPlanStepState(plan, i, 'completed');
        }
      } else if (i === activeIndex) {
        if (plan.states[i] !== 'completed' && plan.states[i] !== 'running') {
          setPlanStepState(plan, i, 'running');
        }
      }
    }
  }

  /** Marks every plan step as completed. */
  function completePlanSteps(plan: ActivePlan) {
    for (let i = 0; i < PLAN_STEP_LABELS.length; i++) {
      if (plan.states[i] !== 'completed') setPlanStepState(plan, i, 'completed');
    }
    const statusLabel = plan.card.querySelector('.assistant-status-label');
    if (statusLabel) {
      statusLabel.textContent = 'Plan execution completed ✓';
    }
  }

  /** Marks the currently running plan step as failed. */
  function failPlanSteps(plan: ActivePlan) {
    const runningIndex = plan.states.findIndex((state) => state === 'running');
    if (runningIndex >= 0) {
      setPlanStepState(plan, runningIndex, 'failed');
    } else {
      const pendingIndex = plan.states.findIndex((state) => state === 'pending');
      if (pendingIndex >= 0) setPlanStepState(plan, pendingIndex, 'failed');
    }
  }

  /** Executes an approved plan through the existing Jules task IPC. */
  async function executeApprovedPlan(plan: ActivePlan) {
    if (plan.approved) return;
    plan.approved = true;
    plan.outputChars = 0;
    hasAppendedCompletionCard = false;

    const approveBtn = plan.card.querySelector('.plan-action-approve') as HTMLButtonElement | null;
    const changesBtn = plan.card.querySelector('.plan-action-changes') as HTMLButtonElement | null;
    if (approveBtn) {
      approveBtn.disabled = true;
      approveBtn.textContent = 'Executing...';
    }
    if (changesBtn) changesBtn.disabled = true;

    let repoPath = currentWorkspacePath || currentState?.localRepo?.path;
    if (!repoPath) {
      const res = await jules?.openLocalRepo();
      if (!res?.success || !res.path) {
        if (approveBtn) {
          approveBtn.disabled = false;
          approveBtn.textContent = 'Approve & Execute Plan';
        }
        if (changesBtn) changesBtn.disabled = false;
        plan.approved = false;
        return;
      }
      repoPath = res.path;
      currentWorkspacePath = repoPath;
      applyMode('local', true);
    }

    setPlanStepState(plan, 0, 'running');

    // Prepare task branch only in standalone GitHub / Repo mode
    const githubRepo = currentState?.localRepo?.githubRepo || currentGithubRepo?.nameWithOwner;
    if (workspaceSubMode === 'repo' && jules?.prepareTaskBranch) {
      try {
        const branchRes = await jules.prepareTaskBranch(repoPath, plan.prompt, currentBaseBranch);
        if (branchRes?.success && branchRes.branchName) {
          currentTaskBranch = branchRes.branchName;
          updatePrPublisherUi();
        }
      } catch {
        // continue
      }
    }

    const sessionId = `session-${Date.now()}`;
    activeStandaloneSessionId = sessionId;

    if (jules?.saveStandaloneSession) {
      try {
        const initialSteps: StandalonePlanStep[] = PLAN_STEP_LABELS.map((label, idx) => ({
          label,
          state: plan.states[idx] || 'pending'
        }));
        const initialMessages: StandaloneSessionMessage[] = [
          { role: 'user', content: plan.prompt, timestamp: Date.now() }
        ];
        await jules.saveStandaloneSession({
          id: sessionId,
          mode: workspaceSubMode,
          title: buildPlanTitle(plan.prompt),
          prompt: plan.prompt,
          engine: selectedEngine,
          model: selectedModel,
          githubRepo,
          baseBranch: currentBaseBranch,
          taskBranch: currentTaskBranch,
          workspacePath: repoPath,
          status: 'running',
          planSteps: initialSteps,
          messages: initialMessages,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      } catch {
        // ignore
      }
    }

    const options: RunTaskOptions = {
      model: selectedModel,
      engine: selectedEngine,
      repoPath,
      mode: workspaceSubMode,
      githubRepo,
      baseBranch: currentBaseBranch,
      sessionId
    };

    await invokeJulesRunTask(plan.prompt, options);
  }

  /** Briefly surfaces a hint inside the composer (used for empty prompts). */
  let composerHintTimer: ReturnType<typeof setTimeout> | null = null;
  function flashComposerHint(message: string) {
    const label = document.querySelector('#btn-run-jules .btn-plan-label') as HTMLElement | null;
    if (!label) return;
    if (composerHintTimer) clearTimeout(composerHintTimer);
    const original = label.textContent || DEFAULT_PLAN_LABEL;
    label.textContent = message;
    julesTaskPrompt?.classList.add('composer-hint');
    composerHintTimer = setTimeout(() => {
      label.textContent = original;
      julesTaskPrompt?.classList.remove('composer-hint');
      composerHintTimer = null;
    }, 1800);
  }

  // Run Jules Task Async — 'Give me a plan'
  btnRunJules?.addEventListener('click', async () => {
    const prompt = (julesTaskPrompt?.value || '').trim();

    // Empty composer: prompt the user instead of dispatching a task.
    if (!prompt) {
      flashComposerHint('Describe your task first');
      julesTaskPrompt?.focus();
      julesTaskPrompt?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    // Switch view to chat stream
    if (localChatStream) {
      localChatStream.innerHTML = '';
    }
    setSessionActive(true, prompt);
    localEmptyState?.classList.add('hidden');
    localChatStream?.classList.remove('hidden');
    // Keep the composer docked at the bottom of the active conversation.
    syncComposerPlacement(true);

    // (b) User turn
    appendUserTurn(prompt);

    // (c) Jules Plan Card
    const plan = createPlanCard(prompt);
    activePlan = plan;
    hasAppendedCompletionCard = false;

    // A new plan starts from the default composer action.
    const planLabel = document.querySelector('#btn-run-jules .btn-plan-label');
    if (planLabel) planLabel.textContent = DEFAULT_PLAN_LABEL;

    // Track the task in the local workspace session history (sidebar).
    upsertLocalWorkspaceSession(prompt, 'active');
    void fetchJulesSessions();

    if (julesTaskPrompt) {
      julesTaskPrompt.value = '';
      julesTaskPrompt.placeholder = 'Ask Jules to make changes to your local codebase...';
    }

    if (localChatStream) {
      localChatStream.scrollTop = localChatStream.scrollHeight;
    }
  });

  julesTaskPrompt?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
      e.preventDefault();
      btnRunJules?.click();
    }
  });

  btnRefreshSessions?.addEventListener('click', () => fetchJulesSessions());
  btnClearSessions?.addEventListener('click', async () => {
    sessionFetchSeq++;
    localWorkspaceSessions.length = 0;
    if (julesSessionsList) {
      julesSessionsList.innerHTML = '<span class="text-muted">Sessions cleared. Click refresh (↻) to query again.</span>';
    }
    await jules?.clearAllJulesSessions();
  });
  btnCloseDrawer?.addEventListener('click', () => applyMode('cloud'));

  btnCopySlug?.addEventListener('click', async () => {
    const textToCopy = currentState?.localRepo?.githubRepo || currentState?.localRepo?.path || '';
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      if (copySlugLabel) {
        const prev = copySlugLabel.textContent;
        copySlugLabel.textContent = '✓ Copied!';
        setTimeout(() => {
          if (copySlugLabel) copySlugLabel.textContent = prev;
        }, 1500);
      }
    } catch {
      if (copySlugLabel) {
        const prev = copySlugLabel.textContent;
        copySlugLabel.textContent = 'Failed to copy';
        setTimeout(() => {
          if (copySlugLabel) copySlugLabel.textContent = prev;
        }, 1500);
      }
    }
  });

  btnOpenFolder?.addEventListener('click', async () => {
    if (currentState?.localRepo?.path) {
      await jules?.openInFileManager(currentState.localRepo.path);
    }
  });

  btnChangeRepo?.addEventListener('click', async () => {
    const res = await jules?.openLocalRepo();
    if (res?.success) {
      refreshGitReviewDetails();
      fetchJulesSessions();
      renderRecentRepoChips();
    }
  });

  // Typewriter placeholder focus & input listeners on #jules-task-prompt
  julesTaskPrompt?.addEventListener('focus', () => {
    isPromptFocused = true;
    stopTypewriter();
  });

  julesTaskPrompt?.addEventListener('blur', () => {
    isPromptFocused = false;
    if (workspaceSubMode === 'repo' && (!julesTaskPrompt || !julesTaskPrompt.value.trim())) {
      startTypewriter();
    }
  });

  julesTaskPrompt?.addEventListener('input', () => {
    if (julesTaskPrompt.value.trim().length > 0) {
      stopTypewriter();
    } else if (workspaceSubMode === 'repo' && !isPromptFocused) {
      startTypewriter();
    }
  });

  // ── 1:1 Google Jules Webchat UI Clone Interaction & State Machine ──────────

  function renderJulesRepoDropdownList(repos: GitHubRepoItem[], filterQuery = '') {
    if (!julesRepoDropdownList) return;
    const q = filterQuery.trim().toLowerCase();
    const filtered = q
      ? repos.filter((r) => r.nameWithOwner.toLowerCase().includes(q) || (r.description && r.description.toLowerCase().includes(q)))
      : repos;

    if (filtered.length === 0) {
      if (repos.length === 0) return;
      julesRepoDropdownList.innerHTML = '<div style="padding: 8px 12px; font-size: 12px; color: #888;">No repositories match</div>';
      return;
    }

    julesRepoDropdownList.innerHTML = '';
    const currentSlug = currentGithubRepo?.nameWithOwner || currentState?.localRepo?.githubRepo || 'OSINTCabal/DeepSearch';

    for (const repo of filtered) {
      const item = document.createElement('div');
      const isCurrent = repo.nameWithOwner.toLowerCase() === currentSlug.toLowerCase();
      item.className = `repo-list-item ${isCurrent ? 'active' : ''}`;
      item.setAttribute('data-repo', repo.nameWithOwner);
      item.innerHTML = `
        <span class="repo-title">${escapeHtml(repo.nameWithOwner)}</span>
        ${isCurrent ? '<span class="check-mark">✓</span>' : ''}
      `;
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        closeJulesRepoDropdown();
        await selectGitHubRepo(repo.nameWithOwner, repo.defaultBranch);
      });
      julesRepoDropdownList.appendChild(item);
    }
  }

  function renderGitHubCodebasesList(repos: GitHubRepoItem[], filterQuery = '') {
    if (!githubCodebasesList) return;
    const q = filterQuery.trim().toLowerCase();
    const filtered = q ? repos.filter((r) => r.nameWithOwner.toLowerCase().includes(q)) : repos;
    if (filtered.length === 0 && repos.length > 0) {
      githubCodebasesList.innerHTML = '<div style="padding: 6px 8px; color: #888; font-size: 11px;">No codebases match</div>';
      return;
    }
    if (repos.length === 0) return;
    githubCodebasesList.innerHTML = '';
    const currentSlug = currentGithubRepo?.nameWithOwner || currentState?.localRepo?.githubRepo || 'OSINTCabal/DeepSearch';

    for (const repo of filtered) {
      const isCurrent = repo.nameWithOwner.toLowerCase() === currentSlug.toLowerCase();
      const row = document.createElement('div');
      row.className = `codebase-item-row ${isCurrent ? 'active' : ''}`;
      row.setAttribute('data-repo', repo.nameWithOwner);
      row.innerHTML = `
        <svg class="octocat-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
        </svg>
        <span class="codebase-repo-name">${escapeHtml(repo.nameWithOwner)}</span>
        <span class="codebase-badge-count">1</span>
      `;
      row.addEventListener('click', () => {
        void selectGitHubRepo(repo.nameWithOwner, repo.defaultBranch);
      });
      githubCodebasesList.appendChild(row);
    }
  }

  function renderGitHubSessionsList(sessions: JulesSessionItem[]) {
    if (!githubSessionsList) return;
    if (sessions.length === 0) return;
    githubSessionsList.innerHTML = '';
    for (const s of sessions) {
      const row = document.createElement('div');
      row.className = 'session-item-row';
      row.setAttribute('data-session-id', s.id);
      const isCompleted = s.status === 'completed' || s.status === 'succeeded';
      row.innerHTML = `
        <span class="session-status-dot ${isCompleted ? 'status-completed' : 'status-active'}" title="${escapeHtml(s.status || 'Active')}"></span>
        <span class="session-item-title">${escapeHtml(s.description || `Session ${s.id.slice(0, 8)}`)}</span>
        <button class="session-menu-trigger" type="button" title="Session options">···</button>
      `;
      githubSessionsList.appendChild(row);
    }
  }

  function renderOverviewSessionsList(sessions: JulesSessionItem[]) {
    const container = document.querySelector('.overview-sessions-list');
    if (!container || sessions.length === 0) return;
    container.innerHTML = '';
    for (const s of sessions.slice(0, 5)) {
      const item = document.createElement('div');
      item.className = 'overview-session-item';
      item.setAttribute('data-session-id', s.id);
      item.innerHTML = `
        <span class="session-check">✓</span>
        <span class="session-title">${escapeHtml(s.description || `Session ${s.id.slice(0, 8)}`)}</span>
        <span class="session-time">${escapeHtml(s.lastActive || 'Recent')}</span>
      `;
      container.appendChild(item);
    }
  }

  // Repo Combobox Wiring
  btnJulesRepoDropdown?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleJulesRepoDropdown();
  });

  julesRepoFilterInput?.addEventListener('input', () => {
    renderJulesRepoDropdownList(cachedGithubRepos, julesRepoFilterInput.value || '');
  });
  julesRepoFilterInput?.addEventListener('click', (e) => e.stopPropagation());

  btnConfigureRepoAccess?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeJulesRepoDropdown();
    const slug = currentGithubRepo?.nameWithOwner || currentState?.localRepo?.githubRepo || 'OSINTCabal/DeepSearch';
    window.open(`https://github.com/${slug}/settings`, '_blank');
  });

  btnConfigureRepoTop?.addEventListener('click', (e) => {
    e.stopPropagation();
    const slug = currentGithubRepo?.nameWithOwner || currentState?.localRepo?.githubRepo || 'OSINTCabal/DeepSearch';
    window.open(`https://github.com/${slug}/settings`, '_blank');
  });

  btnDetachRepo?.addEventListener('click', async (e) => {
    e.stopPropagation();
    closeJulesRepoDropdown();
    currentGithubRepo = null;
    currentWorkspacePath = '';
    currentBaseBranch = 'main';
    await jules?.clearLocalRepo();
    if (canvasRepoLabel) canvasRepoLabel.textContent = 'No Repo Linked';
    if (composerRepoText) composerRepoText.textContent = 'No Repo';
    if (julesRepoDropdownLabel) julesRepoDropdownLabel.textContent = 'Choose repository';
    if (breadcrumbRepoText) breadcrumbRepoText.textContent = 'No Repo';
    if (navbarSessionBreadcrumb) navbarSessionBreadcrumb.classList.remove('has-repo');
    refreshGitReviewDetails();
    renderJulesRepoDropdownList(cachedGithubRepos);
    renderGitHubCodebasesList(cachedGithubRepos);
  });

  // Left Sidebar Collapse & Real-time Search
  function toggleSidebarCollapsed() {
    const isCurrentlyCollapsed = workspaceSidebar?.getAttribute('data-collapsed') === 'true' || workspaceSidebar?.classList.contains('collapsed');
    const nextState = !isCurrentlyCollapsed;
    workspaceSidebar?.setAttribute('data-collapsed', nextState ? 'true' : 'false');
    workspaceSidebar?.classList.toggle('collapsed', nextState);
  }

  btnToggleJulesSidebar?.addEventListener('click', (e) => {
    e.preventDefault();
    toggleSidebarCollapsed();
  });

  btnCollapseSidebarInner?.addEventListener('click', (e) => {
    e.preventDefault();
    toggleSidebarCollapsed();
  });

  julesSidebarSearch?.addEventListener('input', () => {
    const query = (julesSidebarSearch.value || '').trim().toLowerCase();

    // Filter session titles in #github-sessions-list
    if (githubSessionsList) {
      const sessionRows = githubSessionsList.querySelectorAll<HTMLElement>('.session-item-row, .session-item');
      sessionRows.forEach((row) => {
        const title = row.querySelector('.session-item-title, .session-title')?.textContent?.toLowerCase() || '';
        row.style.display = (!query || title.includes(query)) ? '' : 'none';
      });
    }

    // Filter repo names in #github-codebases-list
    if (githubCodebasesList) {
      const codebaseRows = githubCodebasesList.querySelectorAll<HTMLElement>('.codebase-item-row');
      codebaseRows.forEach((row) => {
        const name = row.querySelector('.codebase-repo-name')?.textContent?.toLowerCase() ||
          row.getAttribute('data-repo')?.toLowerCase() || '';
        row.style.display = (!query || name.includes(query)) ? '' : 'none';
      });
    }
  });

  // Chevrons on sidebar sections
  const sessionsTitleWrap = sidebarSectionSessions?.querySelector('.section-title-wrap');
  const codebasesTitleWrap = sidebarSectionCodebases?.querySelector('.section-title-wrap');

  sessionsTitleWrap?.addEventListener('click', () => {
    const isCollapsed = sidebarSectionSessions?.classList.toggle('section-collapsed');
    const chevron = sidebarSectionSessions?.querySelector('.section-toggle-chevron') as HTMLElement | null;
    if (chevron) {
      chevron.style.transform = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
    }
    if (githubSessionsList) githubSessionsList.style.display = isCollapsed ? 'none' : '';
    if (btnSessionsViewMore) btnSessionsViewMore.style.display = isCollapsed ? 'none' : '';
    if (julesSessionsList) julesSessionsList.style.display = isCollapsed ? 'none' : '';
  });

  codebasesTitleWrap?.addEventListener('click', () => {
    const isCollapsed = sidebarSectionCodebases?.classList.toggle('section-collapsed');
    const chevron = sidebarSectionCodebases?.querySelector('.section-toggle-chevron') as HTMLElement | null;
    if (chevron) {
      chevron.style.transform = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
    }
    if (githubCodebasesList) githubCodebasesList.style.display = isCollapsed ? 'none' : '';
    if (sidebarActiveRepoCard) sidebarActiveRepoCard.style.display = isCollapsed ? 'none' : '';
    if (recentChipsContainer) recentChipsContainer.style.display = isCollapsed ? 'none' : '';
  });

  btnSessionsViewMore?.addEventListener('click', async () => {
    if (julesSessionsList) {
      julesSessionsList.classList.remove('hidden');
      julesSessionsList.style.display = '';
    }
    await fetchJulesSessions();
  });

  btnJulesDocs?.addEventListener('click', () => {
    window.open('https://jules.google.com/docs', '_blank');
  });

  btnJulesDiscord?.addEventListener('click', () => {
    window.open('https://discord.gg/google-jules', '_blank');
  });

  btnJulesX?.addEventListener('click', () => {
    window.open('https://x.com/GoogleJules', '_blank');
  });

  // Overview Tabs & Skill Agents Wiring
  julesHomeTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const tabName = tab.getAttribute('data-tab');
      julesHomeTabs.forEach((t) => {
        const isActive = t === tab;
        t.classList.toggle('active', isActive);
        t.setAttribute('aria-selected', String(isActive));
      });
      julesTabOverview?.classList.toggle('hidden', tabName !== 'overview');
      julesTabSuggested?.classList.toggle('hidden', tabName !== 'suggested');
      julesTabScheduled?.classList.toggle('hidden', tabName !== 'scheduled');
    });
  });

  toggleAutoFindIssues?.addEventListener('change', () => {
    // Proactive auto-find issues toggled
  });

  btnSkillPerf?.addEventListener('click', () => {
    stopTypewriter();
    if (julesTaskPrompt) {
      julesTaskPrompt.value = 'Profile performance and benchmark critical execution paths in this codebase';
      julesTaskPrompt.focus();
    }
  });

  btnSkillDesign?.addEventListener('click', () => {
    stopTypewriter();
    if (julesTaskPrompt) {
      julesTaskPrompt.value = 'Audit UI components, accessibility, and design system tokens in this repository';
      julesTaskPrompt.focus();
    }
  });

  btnSkillSec?.addEventListener('click', () => {
    stopTypewriter();
    if (julesTaskPrompt) {
      julesTaskPrompt.value = 'Perform security audit, sanitize inputs, and check dependency vulnerabilities';
      julesTaskPrompt.focus();
    }
  });

  // Session & Codebase Clicks
  githubSessionsList?.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest('.session-item-row, .session-item') as HTMLElement | null;
    if (row) {
      const title = row.querySelector('.session-item-title, .session-title')?.textContent?.trim() || 'Session';
      setSessionActive(true, title);
      const sessionId = row.getAttribute('data-session-id');
      if (sessionId && jules?.getStandaloneSession) {
        void jules.getStandaloneSession(sessionId).then((record) => {
          if (record) restoreStandaloneSession(record);
        });
      }
    }
  });

  julesOverviewSessionsCard?.addEventListener('click', (e) => {
    const viewMore = (e.target as HTMLElement).closest('.btn-overview-view-more');
    if (viewMore) {
      btnSessionsViewMore?.click();
      return;
    }
    const item = (e.target as HTMLElement).closest('.overview-session-item') as HTMLElement | null;
    if (item) {
      const title = item.querySelector('.session-title')?.textContent?.trim() || 'Session';
      setSessionActive(true, title);
      const sessionId = item.getAttribute('data-session-id');
      if (sessionId && jules?.getStandaloneSession) {
        void jules.getStandaloneSession(sessionId).then((record) => {
          if (record) restoreStandaloneSession(record);
        });
      }
    }
  });

  githubCodebasesList?.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest('.codebase-item-row') as HTMLElement | null;
    if (row) {
      const repoName = row.getAttribute('data-repo') || row.querySelector('.codebase-repo-name')?.textContent?.trim();
      if (repoName) {
        void selectGitHubRepo(repoName);
      }
    }
  });

  // Follow-up Chat & Code Drawer Toggle in Session View
  async function submitFollowup() {
    const text = (julesFollowupInput?.value || '').trim();
    if (!text) return;
    if (julesFollowupInput) julesFollowupInput.value = '';

    setSessionActive(true, text);

    appendUserTurn(text);

    let repoPath = currentWorkspacePath || currentState?.localRepo?.path;
    if (!repoPath) {
      const res = await jules?.openLocalRepo();
      if (res?.success && res.path) {
        repoPath = res.path;
        currentWorkspacePath = repoPath;
      }
    }

    const plan = createPlanCard(text);
    activePlan = plan;
    hasAppendedCompletionCard = false;
    upsertLocalWorkspaceSession(text, 'active');
    void fetchJulesSessions();

    if (repoPath) {
      const githubRepo = currentState?.localRepo?.githubRepo || currentGithubRepo?.nameWithOwner;
      const options: RunTaskOptions = {
        model: selectedModel,
        engine: selectedEngine,
        repoPath,
        mode: workspaceSubMode,
        githubRepo,
        baseBranch: currentBaseBranch,
        sessionId: activeStandaloneSessionId || `session-${Date.now()}`
      };
      await invokeJulesRunTask(text, options);
    }
  }

  julesTalkForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    void submitFollowup();
  });

  btnSendFollowup?.addEventListener('click', (e) => {
    e.preventDefault();
    void submitFollowup();
  });

  julesFollowupInput?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submitFollowup();
    }
  });

  btnSessionToggleCode?.addEventListener('click', (e) => {
    e.preventDefault();
    const isCurrentlyOpen = workspaceInspector?.getAttribute('data-open') === 'true';
    const nextOpen = !isCurrentlyOpen;
    workspaceInspector?.setAttribute('data-open', nextOpen ? 'true' : 'false');
    workspaceInspector?.classList.toggle('collapsed', !nextOpen);
    btnSessionToggleCode.classList.toggle('active', nextOpen);
    btnToggleInspector?.classList.toggle('active', nextOpen);
  });

  btnSessionPause?.addEventListener('click', async (e) => {
    e.preventDefault();
    await jules?.cancelJulesTask();
    if (taskStatusBadge) {
      taskStatusBadge.className = 'task-status-pill status-idle';
      taskStatusBadge.textContent = 'Paused';
    }
  });

  // Navigation Home Logo & New Session Buttons
  btnJulesHomeLogo?.addEventListener('click', () => {
    setSessionActive(false);
  });

  btnNavbarNewSession?.addEventListener('click', () => {
    resetToNewTask();
    setSessionActive(false);
  });

  btnSessionBackHome?.addEventListener('click', () => {
    setSessionActive(false);
  });

  // Window control actions
  btnMinimize?.addEventListener('click', () => jules?.minimizeWindow());
  btnMaximize?.addEventListener('click', () => jules?.toggleMaximizeWindow());
  btnClose?.addEventListener('click', () => jules?.closeWindow());

  dragRegion?.addEventListener('dblclick', (e) => {
    if (e.target === dragRegion) jules?.toggleMaximizeWindow();
  });

  // Dismiss dropdown menus on outside click
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    if (!target.closest('#app-menu-wrapper') && isMenuOpen) {
      closeMenu();
    }
    if (!target.closest('.repo-picker-wrapper') && isRepoDropdownOpen) {
      closeRepoDropdown();
    }
    if (!target.closest('.canvas-repo-picker-wrapper') && isCanvasRepoDropdownOpen) {
      closeCanvasRepoDropdown();
    }
    if (!target.closest('.branch-picker-wrapper') && isBranchDropdownOpen) {
      closeBranchDropdown();
    }
    if (!target.closest('.model-picker-wrapper') && isModelDropdownOpen) {
      closeModelDropdown();
    }
    if (!target.closest('.repo-combobox-wrapper') && isJulesRepoDropdownOpen) {
      closeJulesRepoDropdown();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (document.activeElement === julesTaskPrompt) {
        julesTaskPrompt?.blur();
        return;
      }
      if (addAccountModal && !addAccountModal.classList.contains('hidden')) {
        closeAddAccountModal();
      } else if (isMenuOpen || isRepoDropdownOpen || isCanvasRepoDropdownOpen || isBranchDropdownOpen || isModelDropdownOpen || isJulesRepoDropdownOpen) {
        closeAllDropdowns();
      } else if (gitDiffViewer && !gitDiffViewer.classList.contains('hidden')) {
        closeDiffViewer();
      } else if (isDrawerOpen) {
        applyMode('cloud');
      }
    } else {
      const isCtrl = e.ctrlKey || e.metaKey;
      const isAlt = e.altKey;
      if (isCtrl && (e.key === ',' || e.code === 'Comma')) {
        e.preventDefault();
        openJulesSettings();
      } else if ((isCtrl || isAlt) && (e.key === '1' || e.code === 'Digit1')) {
        e.preventDefault();
        applyMode('cloud');
      } else if ((isCtrl || isAlt) && (e.key === '2' || e.code === 'Digit2')) {
        e.preventDefault();
        applyMode('local');
      } else if ((isCtrl || isAlt) && (e.key === '3' || e.code === 'Digit3')) {
        e.preventDefault();
        applyMode('repo');
      } else if ((isCtrl || isAlt) && (e.key === 'l' || e.key === 'L' || e.code === 'KeyL')) {
        e.preventDefault();
        applyMode('toggle');
      } else if (isCtrl && (e.key === 'o' || e.key === 'O' || e.code === 'KeyO')) {
        e.preventDefault();
        btnSelectRepo?.click();
      }
    }
  });

  // Initial State Retrieval & Mode Synchronization
  applyModeLabels();
  updateDocumentTitle();
  if (jules) {
    try {
      const initial = await jules.getInitialState();
      updateUi(initial);
      if (initial.mode && !isMenuOpen && !isDrawerOpen && initial.mode !== currentMode) {
        applyMode(initial.mode, true);
      }
      applyModeLabels();
      updateDocumentTitle();
    } catch {
      // ignore
    }
    jules.onStateUpdate((state) => updateUi(state));
    jules.onModeCommand((cmd) => applyMode(cmd));
  }
});
