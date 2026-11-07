import { contextBridge, ipcRenderer } from 'electron';
import type {
  AgentEngineId,
  ChromeApi,
  EngineStatusInfo,
  GitHubAuthStatus,
  GitHubRepoItem,
  NavigationState,
  GitReviewDetails,
  JulesRunResult,
  JulesSessionItem,
  JulesCliInfo,
  JulesCliStatus,
  LegacyJulesHealth,
  PublishPrOptions,
  PublishPrResult,
  RecentRepoItem,
  RunTaskOptions,
  StandaloneSessionRecord,
  TaskOutputChunk,
  TaskStatusEvent,
  WorkspaceMode
} from '../shared/types.js';

const api: ChromeApi = {
  navigateBack: () => ipcRenderer.invoke('chrome:nav-back'),
  navigateForward: () => ipcRenderer.invoke('chrome:nav-forward'),
  reload: () => ipcRenderer.invoke('chrome:nav-reload'),
  minimizeWindow: () => ipcRenderer.invoke('chrome:win-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('chrome:win-maximize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('chrome:win-toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('chrome:win-close'),
  expandView: (height: number) => ipcRenderer.invoke('chrome:expand-view', height),
  collapseView: () => ipcRenderer.invoke('chrome:collapse-view'),
  openInFileManager: (folderPath: string) => ipcRenderer.invoke('chrome:open-in-file-manager', folderPath),
  syncCookies: () => ipcRenderer.invoke('chrome:auth-sync'),
  logout: () => ipcRenderer.invoke('chrome:auth-logout'),
  switchAccount: (accountId: string) => ipcRenderer.invoke('chrome:account-switch', accountId),
  addAccount: (name?: string, email?: string) => ipcRenderer.invoke('chrome:account-add', name, email),
  removeAccount: (accountId: string) => ipcRenderer.invoke('chrome:account-remove', accountId),
  openLocalRepo: () => ipcRenderer.invoke('chrome:open-local-repo'),
  selectRecentRepo: (repoPath: string) => ipcRenderer.invoke('chrome:select-recent-repo', repoPath),
  getRecentRepos: (): Promise<RecentRepoItem[]> => ipcRenderer.invoke('chrome:get-recent-repos'),
  removeRecentRepo: (repoPath: string): Promise<{ success: boolean; repos: RecentRepoItem[] }> =>
    ipcRenderer.invoke('chrome:remove-recent-repo', repoPath),
  clearRecentRepos: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('chrome:clear-recent-repos'),
  clearLocalRepo: () => ipcRenderer.invoke('chrome:clear-local-repo'),
  getGitReviewDetails: (): Promise<GitReviewDetails | null> => ipcRenderer.invoke('chrome:git-review-details'),
  getGitStructuredStatus: () => ipcRenderer.invoke('chrome:git-structured-status'),
  getGitFileDiff: (filePath: string, staged?: boolean) => ipcRenderer.invoke('chrome:git-file-diff', filePath, staged),
  runJulesTask: (repoPath: string, prompt: string, options?: Partial<RunTaskOptions>): Promise<JulesRunResult> =>
    ipcRenderer.invoke('chrome:run-jules-task', repoPath, prompt, options),
  runTask: (prompt: string, options: RunTaskOptions): Promise<JulesRunResult> =>
    ipcRenderer.invoke('chrome:run-jules-task', options.repoPath, prompt, options),
  cancelJulesTask: (): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('chrome:cancel-jules-task'),
  getJulesCliStatus: (): Promise<JulesCliStatus> =>
    ipcRenderer.invoke('chrome:get-jules-status'),
  getJulesCliInfo: (): Promise<JulesCliInfo> =>
    ipcRenderer.invoke('chrome:get-jules-cli-info'),
  listJulesSessions: (repoPath?: string): Promise<JulesSessionItem[]> =>
    ipcRenderer.invoke('chrome:list-jules-sessions', repoPath),
  getStandaloneSession: (sessionId: string): Promise<StandaloneSessionRecord | null> =>
    ipcRenderer.invoke('chrome:get-standalone-session', sessionId),
  saveStandaloneSession: (session: Partial<StandaloneSessionRecord> & { id: string }): Promise<StandaloneSessionRecord> =>
    ipcRenderer.invoke('chrome:save-standalone-session', session),
  deleteJulesSession: (sessionId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('chrome:delete-jules-session', sessionId),
  clearAllJulesSessions: (sessionIds?: string[]): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('chrome:clear-all-jules-sessions', sessionIds),
  listJulesRepos: (): Promise<string[]> =>
    ipcRenderer.invoke('chrome:list-jules-repos'),
  listJulesRemoteRepos: (): Promise<string[]> =>
    ipcRenderer.invoke('chrome:list-jules-repos'),
  applyJulesSession: (repoPath: string, sessionId: string): Promise<{ success: boolean; output: string }> =>
    ipcRenderer.invoke('chrome:apply-jules-session', repoPath, sessionId),
  getInitialState: (): Promise<NavigationState> => ipcRenderer.invoke('chrome:get-state'),
  onStateUpdate: (callback: (state: NavigationState) => void) => {
    const listener = (_event: unknown, state: NavigationState) => callback(state);
    ipcRenderer.on('chrome:state-update', listener);
    return () => {
      ipcRenderer.removeListener('chrome:state-update', listener);
    };
  },
  onTaskOutput: (callback: (chunk: TaskOutputChunk) => void) => {
    const listener = (_event: unknown, chunk: TaskOutputChunk) => callback(chunk);
    ipcRenderer.on('chrome:task-output', listener);
    return () => {
      ipcRenderer.removeListener('chrome:task-output', listener);
    };
  },
  onTaskStatus: (callback: (status: TaskStatusEvent) => void) => {
    const listener = (_event: unknown, status: TaskStatusEvent) => callback(status);
    ipcRenderer.on('chrome:task-status', listener);
    return () => {
      ipcRenderer.removeListener('chrome:task-status', listener);
    };
  },
  onModeCommand: (callback: (cmd: 'cloud' | 'repo' | 'local' | 'legacy-cloud' | 'toggle') => void) => {
    const listener = (_event: unknown, cmd: 'cloud' | 'repo' | 'local' | 'legacy-cloud' | 'toggle') => callback(cmd);
    ipcRenderer.on('chrome:mode-command', listener);
    return () => {
      ipcRenderer.removeListener('chrome:mode-command', listener);
    };
  },
  setModeState: (mode: WorkspaceMode) => ipcRenderer.invoke('chrome:set-mode-state', mode),
  initGitRepo: (folderPath?: string) => ipcRenderer.invoke('chrome:init-git-repo', folderPath),
  openSettings: () => ipcRenderer.invoke('app:open-settings'),
  listBranches: (repoPath?: string) => ipcRenderer.invoke('git:list-branches', repoPath),
  checkoutBranch: (repoPath: string, branchName: string) => ipcRenderer.invoke('git:checkout-branch', repoPath, branchName),
  commitChanges: (repoPath: string, message: string) => ipcRenderer.invoke('git:commit-changes', repoPath, message),
  listEngines: (): Promise<EngineStatusInfo[]> => ipcRenderer.invoke('engines:list'),
  setActiveEngine: (engine: AgentEngineId, model?: string) => ipcRenderer.invoke('engines:set-active', engine, model),
  getGitHubAuthStatus: (): Promise<GitHubAuthStatus> => ipcRenderer.invoke('github:auth-status'),
  listGitHubRepos: (forceRefresh?: boolean): Promise<GitHubRepoItem[]> => ipcRenderer.invoke('github:list-repos', forceRefresh),
  selectGitHubRepo: (nameWithOwner: string, baseBranch?: string) => ipcRenderer.invoke('github:select-repo', nameWithOwner, baseBranch),
  prepareTaskBranch: (workspacePath: string, prompt: string, baseBranch?: string) =>
    ipcRenderer.invoke('github:prepare-task-branch', workspacePath, prompt, baseBranch),
  publishBranchAndCreatePR: (options: PublishPrOptions): Promise<PublishPrResult> =>
    ipcRenderer.invoke('github:publish-pr', options),
  checkLegacyJulesHealth: (force?: boolean): Promise<LegacyJulesHealth> =>
    ipcRenderer.invoke('legacy:check-health', force)
};

contextBridge.exposeInMainWorld('julesChrome', api);
