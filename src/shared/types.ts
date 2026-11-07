/**
 * Shared types for JulesDeck IPC, Window State, and Accounts.
 */

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

export interface LocalRepoInfo {
  name: string;
  path: string;
  branch: string;
  githubRepo?: string;
  lastCommit?: string;
}

export interface GitCommitItem {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface GitFileChange {
  path: string;
  status: 'staged' | 'modified' | 'untracked' | 'conflict';
  code: string;
  stagedCode: string;
  worktreeCode: string;
}

export interface GitStructuredStatus {
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  untracked: GitFileChange[];
  conflicts: GitFileChange[];
  totalChanges: number;
  aheadBehind?: { ahead: number; behind: number };
  isDetached: boolean;
  branch: string;
  githubRepo?: string;
}

export interface GitFileDiff {
  filePath: string;
  diff: string;
  isStaged: boolean;
}

export interface GitReviewDetails {
  statusText: string;
  recentCommits: GitCommitItem[];
  hasChanges: boolean;
  branch: string;
  githubRepo?: string;
  structured?: GitStructuredStatus;
}

export interface AccountRecord {
  id: string; // uuid
  email: string;
  name: string;
  avatarUrl?: string;
  partition: string; // e.g. 'persist:acct-<uuid>' or 'persist:spike'
  createdAt: number;
  lastUsedAt: number;
}

export interface AccountRegistry {
  activeAccountId: string;
  accounts: AccountRecord[];
}

export interface TaskOutputChunk {
  taskId: string;
  stream: 'stdout' | 'stderr' | 'system';
  chunk: string;
  raw?: string;
  timestamp: number;
  sessionId?: string;
}

export interface TaskStatusEvent {
  taskId: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
  exitCode?: number | null;
  sessionId?: string;
  durationMs?: number;
  message?: string;
}

export interface JulesCliStatus {
  installed: boolean;
  path: string;
  version?: string;
  commit?: string;
  ready: boolean;
  error?: string;
}

export interface RecentRepoItem {
  name: string;
  path: string;
  branch: string;
  githubRepo?: string;
  lastAccessedAt: number;
}

export type AgentEngineId =
  | 'gemini-cli'
  | 'claude-code'
  | 'codex'
  | 'opencode'
  | 'aider'
  | 'legacy-jules';

export interface EngineModelOption {
  id: string;
  label: string;
  description: string;
  engine: AgentEngineId;
  isDefault?: boolean;
}

export interface EngineStatusInfo {
  id: AgentEngineId;
  name: string;
  available: boolean;
  binaryPath?: string;
  version?: string;
  models: EngineModelOption[];
  error?: string;
}

export interface GitHubRepoItem {
  nameWithOwner: string;
  name: string;
  owner: string;
  defaultBranch: string;
  description?: string;
  isPrivate: boolean;
  updatedAt?: string;
  url?: string;
  managedPath?: string;
  isCloned?: boolean;
}

export interface GitHubAuthStatus {
  authenticated: boolean;
  username?: string;
  scopes?: string[];
  error?: string;
}

export interface PublishPrOptions {
  workspacePath: string;
  githubRepo?: string;
  baseBranch?: string;
  taskBranch?: string;
  title: string;
  body?: string;
  createPr?: boolean;
}

export interface PublishPrResult {
  success: boolean;
  branchName: string;
  pushed: boolean;
  prUrl?: string;
  prNumber?: number;
  message: string;
}

export interface StandaloneSessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  engine?: AgentEngineId;
  model?: string;
}

export interface StandalonePlanStep {
  label: string;
  state: 'pending' | 'running' | 'completed' | 'failed';
}

export interface StandaloneSessionRecord {
  id: string;
  mode: 'repo' | 'local';
  title: string;
  prompt: string;
  engine: AgentEngineId;
  model: string;
  githubRepo?: string;
  baseBranch?: string;
  taskBranch?: string;
  workspacePath: string;
  status: 'planning' | 'running' | 'completed' | 'failed' | 'published';
  planSteps: StandalonePlanStep[];
  messages: StandaloneSessionMessage[];
  terminalOutput?: string;
  prUrl?: string;
  createdAt: number;
  updatedAt: number;
}

export interface LegacyJulesHealth {
  online: boolean;
  cliInstalled: boolean;
  webReachable: boolean;
  checkedAt: number;
  reason?: string;
}

export type WorkspaceMode = 'cloud' | 'repo' | 'local' | 'legacy-cloud';

export interface NavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  currentUrl: string;
  title: string;
  accountEmail?: string;
  accountName?: string;
  activeAccountId?: string;
  accounts?: AccountRecord[];
  localRepo?: LocalRepoInfo;
  recentRepos?: RecentRepoItem[];
  julesStatus?: JulesCliStatus;
  isMaximized: boolean;
  mode?: WorkspaceMode;
  engines?: EngineStatusInfo[];
  activeEngine?: AgentEngineId;
  activeModel?: string;
  githubAuth?: GitHubAuthStatus;
  githubRepos?: GitHubRepoItem[];
  activeGitHubRepo?: GitHubRepoItem;
  legacyJulesHealth?: LegacyJulesHealth;
}

export interface JulesSessionItem {
  id: string;
  description: string;
  repo: string;
  lastActive: string;
  status: string;
  mode?: 'repo' | 'local';
  engine?: AgentEngineId;
  model?: string;
  branch?: string;
  prUrl?: string;
  workspacePath?: string;
}

export interface JulesCliInfo {
  available: boolean;
  version?: string;
  path?: string;
  oauthClientId?: string;
}

export interface JulesRunResult {
  success: boolean;
  sessionId?: string;
  output: string;
  message: string;
  engine?: AgentEngineId;
  model?: string;
  taskBranch?: string;
  workspacePath?: string;
}

export interface RunTaskOptions {
  model?: string;
  engine?: AgentEngineId;
  repoPath: string;
  mode?: 'repo' | 'local';
  githubRepo?: string;
  baseBranch?: string;
  sessionId?: string;
}

export interface ChromeApi {
  navigateBack: () => Promise<void>;
  navigateForward: () => Promise<void>;
  reload: () => Promise<void>;
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  expandView: (height: number) => Promise<void>;
  collapseView: () => Promise<void>;
  openInFileManager: (folderPath: string) => Promise<void>;
  syncCookies: () => Promise<{ success: boolean; message: string }>;
  logout: () => Promise<void>;
  switchAccount: (accountId: string) => Promise<boolean>;
  addAccount: (name?: string, email?: string) => Promise<AccountRecord>;
  removeAccount: (accountId: string) => Promise<{ success: boolean; nextAccountId?: string }>;
  openLocalRepo: () => Promise<{ success: boolean; repo?: string; path?: string; message: string }>;
  selectRecentRepo: (repoPath: string) => Promise<{ success: boolean; repo?: string; path?: string; message: string }>;
  getRecentRepos: () => Promise<RecentRepoItem[]>;
  clearLocalRepo: () => Promise<void>;
  getGitReviewDetails: () => Promise<GitReviewDetails | null>;
  getGitStructuredStatus: () => Promise<GitStructuredStatus | null>;
  getGitFileDiff: (filePath: string, staged?: boolean) => Promise<GitFileDiff>;
  runJulesTask: (repoPath: string, prompt: string, options?: Partial<RunTaskOptions>) => Promise<JulesRunResult>;
  /**
   * Action-style alias (Google Jules Web parity): run a prompt against a local
   * or managed GitHub repository. Delegates to `chrome:run-jules-task`.
   */
  runTask: (prompt: string, options: RunTaskOptions) => Promise<JulesRunResult>;
  cancelJulesTask: () => Promise<{ success: boolean; message: string }>;
  getJulesCliStatus: () => Promise<JulesCliStatus>;
  getJulesCliInfo: () => Promise<JulesCliInfo>;
  listJulesSessions: (repoPath?: string) => Promise<JulesSessionItem[]>;
  getStandaloneSession: (sessionId: string) => Promise<StandaloneSessionRecord | null>;
  saveStandaloneSession: (session: Partial<StandaloneSessionRecord> & { id: string }) => Promise<StandaloneSessionRecord>;
  deleteJulesSession: (sessionId: string) => Promise<{ success: boolean }>;
  clearAllJulesSessions: (sessionIds?: string[]) => Promise<{ success: boolean }>;
  removeRecentRepo: (repoPath: string) => Promise<{ success: boolean; repos: RecentRepoItem[] }>;
  clearRecentRepos: () => Promise<{ success: boolean }>;
  listJulesRepos: () => Promise<string[]>;
  listJulesRemoteRepos: () => Promise<string[]>;
  applyJulesSession: (repoPath: string, sessionId: string) => Promise<{ success: boolean; output: string }>;
  getInitialState: () => Promise<NavigationState>;
  onStateUpdate: (callback: (state: NavigationState) => void) => () => void;
  onTaskOutput: (callback: (chunk: TaskOutputChunk) => void) => () => void;
  onTaskStatus: (callback: (status: TaskStatusEvent) => void) => () => void;
  onModeCommand: (callback: (cmd: 'cloud' | 'repo' | 'local' | 'legacy-cloud' | 'toggle') => void) => () => void;
  setModeState: (mode: WorkspaceMode) => Promise<void>;
  initGitRepo: (folderPath?: string) => Promise<{ success: boolean; repo?: string; path?: string; message: string }>;
  openSettings: () => Promise<{ success: boolean }>;
  listBranches: (repoPath?: string) => Promise<{ branches: string[]; current: string }>;
  checkoutBranch: (repoPath: string, branchName: string) => Promise<{ success: boolean; error?: string }>;
  commitChanges: (repoPath: string, message: string) => Promise<{ success: boolean; error?: string }>;
  // Multi-Engine & Standalone GitHub Mode APIs
  listEngines: () => Promise<EngineStatusInfo[]>;
  setActiveEngine: (engine: AgentEngineId, model?: string) => Promise<{ success: boolean; engine: AgentEngineId; model: string }>;
  getGitHubAuthStatus: () => Promise<GitHubAuthStatus>;
  listGitHubRepos: (forceRefresh?: boolean) => Promise<GitHubRepoItem[]>;
  selectGitHubRepo: (nameWithOwner: string, baseBranch?: string) => Promise<{ success: boolean; repo?: GitHubRepoItem; workspacePath?: string; branch?: string; message: string }>;
  prepareTaskBranch: (workspacePath: string, prompt: string, baseBranch?: string) => Promise<{ success: boolean; branchName: string; message: string }>;
  publishBranchAndCreatePR: (options: PublishPrOptions) => Promise<PublishPrResult>;
  checkLegacyJulesHealth: (force?: boolean) => Promise<LegacyJulesHealth>;
}

declare global {
  interface Window {
    julesChrome?: ChromeApi;
  }
}
