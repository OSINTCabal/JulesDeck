/**
 * GitHub Mode & Repository Management Engine for JulesDeck.
 *
 * Implements standalone GitHub repository management so GitHub / Repo Mode
 * works 100% independently of Google's jules.google.com servers using `gh` and `git`.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { app } from 'electron';
import type {
  GitHubRepoItem,
  GitHubAuthStatus,
  PublishPrOptions,
  PublishPrResult,
  LegacyJulesHealth
} from '../shared/types.js';

const execFileAsync = promisify(execFile);

// In-memory cache for GitHub repos
let inMemoryRepoCache: GitHubRepoItem[] | null = null;

/**
 * Normalizes a GitHub repository URL or slug into 'owner/repo'.
 * Handles HTTPS, SSH, .git suffixes, and query/path fragments.
 */
export function normalizeGitHubRepo(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();

  // Match full GitHub URLs (https, http, git@, ssh)
  const urlMatch = trimmed.match(
    /(?:https?:\/\/|git@|ssh:\/\/git@)github\.com[:/]([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git|\/.*)?$/i
  );
  if (urlMatch && urlMatch[1] && urlMatch[2]) {
    const owner = urlMatch[1];
    const repo = urlMatch[2].replace(/\.git$/i, '');
    return `${owner}/${repo}`;
  }

  // Already owner/repo or owner/repo.git format
  const parts = trimmed.split('/');
  if (parts.length === 2 && parts[0] && parts[1]) {
    const owner = parts[0].trim();
    const repo = parts[1].trim().replace(/\.git$/i, '');
    return `${owner}/${repo}`;
  }

  return trimmed.replace(/\.git$/i, '');
}

/**
 * Returns the managed workspaces root directory.
 * Priority:
 * 1. JULESDECK_WORKSPACES_DIR environment variable
 * 2. customUserDataDir/workspaces (if provided)
 * 3. Electron app.getPath('userData')/workspaces
 * 4. Fallback: ~/.config/JulesDeck/workspaces
 */
export function getManagedWorkspacesRoot(customUserDataDir?: string): string {
  if (process.env.JULESDECK_WORKSPACES_DIR && process.env.JULESDECK_WORKSPACES_DIR.trim()) {
    return process.env.JULESDECK_WORKSPACES_DIR.trim();
  }
  if (customUserDataDir && customUserDataDir.trim()) {
    const trimmed = customUserDataDir.trim();
    if (path.basename(trimmed) === 'workspaces') {
      return trimmed;
    }
    return path.join(trimmed, 'workspaces');
  }
  try {
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'workspaces');
    }
  } catch {
    // Electron app not ready or mocked
  }
  return path.join(os.homedir(), '.config', 'JulesDeck', 'workspaces');
}

/**
 * Computes the local workspace directory for a managed GitHub repository.
 * Converts 'owner/repo' into 'rootDir/owner__repo' (sanitizing unsafe path chars).
 */
export function getManagedRepoPath(nameWithOwner: string, rootDir?: string): string {
  const normalized = normalizeGitHubRepo(nameWithOwner);
  const root = rootDir || getManagedWorkspacesRoot();
  const folderName = normalized
    .replace(/\//g, '__')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(root, folderName);
}

/**
 * Resolves the path to github-repos-cache.json.
 */
export function getGitHubReposCachePath(customUserDataDir?: string): string {
  if (process.env.JULESDECK_GITHUB_CACHE_FILE && process.env.JULESDECK_GITHUB_CACHE_FILE.trim()) {
    return process.env.JULESDECK_GITHUB_CACHE_FILE.trim();
  }
  if (customUserDataDir && customUserDataDir.trim()) {
    return path.join(customUserDataDir.trim(), 'github-repos-cache.json');
  }
  try {
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'github-repos-cache.json');
    }
  } catch {
    // Electron app not ready or mocked
  }
  return path.join(os.homedir(), '.config', 'JulesDeck', 'github-repos-cache.json');
}

/**
 * Clears the in-memory and on-disk GitHub repos cache.
 */
export function clearGitHubReposCache(customUserDataDir?: string): void {
  inMemoryRepoCache = null;
  const cachePath = getGitHubReposCachePath(customUserDataDir);
  try {
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
    }
  } catch {
    // Ignore cleanup error
  }
}

/**
 * Loads cached repositories from disk.
 */
function loadDiskRepoCache(cachePath: string): GitHubRepoItem[] | null {
  if (!fs.existsSync(cachePath)) return null;
  try {
    const raw = fs.readFileSync(cachePath, 'utf8');
    if (!raw.trim()) return null;
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as GitHubRepoItem[];
    }
  } catch (err) {
    console.warn(`[GITHUB] Failed to read repos cache from ${cachePath}:`, err);
  }
  return null;
}

/**
 * Atomically saves cached repositories to disk.
 */
function saveDiskRepoCache(repos: GitHubRepoItem[], cachePath: string): void {
  try {
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmp = `${cachePath}.${randomUUID()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(repos, null, 2), 'utf8');
    fs.renameSync(tmp, cachePath);
  } catch (err) {
    console.warn(`[GITHUB] Failed to write repos cache to ${cachePath}:`, err);
  }
}

/**
 * Checks GitHub CLI (gh) authentication status.
 * Never throws; returns GitHubAuthStatus.
 */
export async function getGitHubAuthStatus(): Promise<GitHubAuthStatus> {
  return new Promise((resolve) => {
    try {
      execFile('gh', ['auth', 'status'], { timeout: 8000 }, (error, stdout, stderr) => {
        const output = `${stdout || ''}\n${stderr || ''}`;

        if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          return resolve({
            authenticated: false,
            error: 'GitHub CLI (gh) is not installed'
          });
        }

        // Parse username from output, e.g.:
        // "✓ Logged in to github.com account OSINTCabal"
        // "Logged in to github.com as OSINTCabal"
        const userMatch = output.match(/Logged in to [^\s]+ (?:account|as)\s+([a-zA-Z0-9_-]+)/i);
        const username = userMatch && userMatch[1] ? userMatch[1] : undefined;

        // Parse token scopes if available
        let scopes: string[] | undefined;
        const scopesMatch = output.match(/Token scopes:\s*([^\r\n]+)/i);
        if (scopesMatch && scopesMatch[1]) {
          scopes = scopesMatch[1]
            .split(/,\s*|\s+/)
            .map((s) => s.replace(/['"`]/g, '').trim())
            .filter((s) => s.length > 0);
        }

        const authenticated = !error || (Boolean(username) && output.includes('Logged in to'));

        if (!authenticated) {
          const errMsg = output.trim() || error?.message || 'Not authenticated with GitHub CLI';
          return resolve({
            authenticated: false,
            error: errMsg
          });
        }

        return resolve({
          authenticated: true,
          username,
          scopes
        });
      });
    } catch (err: unknown) {
      resolve({
        authenticated: false,
        error: (err as Error)?.message || 'Failed to check GitHub CLI auth'
      });
    }
  });
}

/**
 * Lists user's GitHub repositories via `gh repo list`.
 * Also scans local cloned directories inside the managed workspaces root
 * so previously cloned repositories remain available offline.
 * Caches results in memory and on disk unless forceRefresh is true.
 */
export async function listGitHubRepos(
  forceRefresh = false,
  options?: { workspacesRoot?: string; customRootDir?: string; customUserDataDir?: string }
): Promise<GitHubRepoItem[]> {
  const rootDir =
    options?.workspacesRoot ||
    options?.customRootDir ||
    getManagedWorkspacesRoot(options?.customUserDataDir);
  const cachePath = getGitHubReposCachePath(options?.customUserDataDir);

  // If cached and not forced refresh, refresh isCloned status and return
  if (!forceRefresh) {
    if (inMemoryRepoCache !== null) {
      for (const item of inMemoryRepoCache) {
        const managedPath = item.managedPath || getManagedRepoPath(item.nameWithOwner, rootDir);
        item.managedPath = managedPath;
        item.isCloned = fs.existsSync(path.join(managedPath, '.git'));
      }
      return inMemoryRepoCache;
    }

    const diskCached = loadDiskRepoCache(cachePath);
    if (diskCached) {
      for (const item of diskCached) {
        const managedPath = item.managedPath || getManagedRepoPath(item.nameWithOwner, rootDir);
        item.managedPath = managedPath;
        item.isCloned = fs.existsSync(path.join(managedPath, '.git'));
      }
      inMemoryRepoCache = diskCached;
      return diskCached;
    }
  }

  const itemsMap = new Map<string, GitHubRepoItem>();

  // Attempt to fetch from gh repo list
  try {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'repo',
        'list',
        '--limit',
        '100',
        '--json',
        'nameWithOwner,name,owner,defaultBranchRef,description,isPrivate,updatedAt,url'
      ],
      { timeout: 12000 }
    );

    const parsed = JSON.parse(stdout || '[]');
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as Record<string, unknown>;
        const nameWithOwner = typeof e.nameWithOwner === 'string' ? e.nameWithOwner : '';
        if (!nameWithOwner) continue;

        const ownerObj = e.owner as Record<string, unknown> | undefined;
        const ownerLogin =
          typeof ownerObj?.login === 'string'
            ? ownerObj.login
            : nameWithOwner.split('/')[0] || '';

        const defaultBranchObj = e.defaultBranchRef as Record<string, unknown> | undefined;
        const defaultBranch =
          typeof defaultBranchObj?.name === 'string' ? defaultBranchObj.name : 'main';

        const managedPath = getManagedRepoPath(nameWithOwner, rootDir);
        const item: GitHubRepoItem = {
          nameWithOwner,
          name: typeof e.name === 'string' ? e.name : nameWithOwner.split('/')[1] || nameWithOwner,
          owner: ownerLogin,
          defaultBranch,
          description: typeof e.description === 'string' ? e.description : undefined,
          isPrivate: Boolean(e.isPrivate),
          updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : undefined,
          url: typeof e.url === 'string' ? e.url : `https://github.com/${nameWithOwner}`,
          managedPath,
          isCloned: fs.existsSync(path.join(managedPath, '.git'))
        };
        itemsMap.set(nameWithOwner.toLowerCase(), item);
      }
    }
  } catch (err) {
    console.warn('[GITHUB] `gh repo list` failed (offline or unauthenticated):', err);
    // If gh failed, try to preload from disk cache
    const diskCached = loadDiskRepoCache(cachePath);
    if (diskCached) {
      for (const item of diskCached) {
        itemsMap.set(item.nameWithOwner.toLowerCase(), item);
      }
    }
  }

  // Scan managed workspaces directory for locally cloned repositories (offline discovery)
  if (fs.existsSync(rootDir)) {
    try {
      const dirEntries = fs.readdirSync(rootDir, { withFileTypes: true });
      for (const dirEntry of dirEntries) {
        if (!dirEntry.isDirectory()) continue;
        const workspaceDir = path.join(rootDir, dirEntry.name);
        const gitDir = path.join(workspaceDir, '.git');
        if (!fs.existsSync(gitDir)) continue;

        let remoteUrl = '';
        try {
          remoteUrl = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
            cwd: workspaceDir,
            encoding: 'utf8',
            timeout: 3000
          }).trim();
        } catch {
          // No remote origin configured
        }

        const normalized = normalizeGitHubRepo(remoteUrl);
        if (normalized && normalized.includes('/')) {
          const key = normalized.toLowerCase();
          const existing = itemsMap.get(key);
          if (existing) {
            existing.isCloned = true;
            existing.managedPath = workspaceDir;
          } else {
            let defaultBranch = 'main';
            try {
              const currentHead = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
                cwd: workspaceDir,
                encoding: 'utf8',
                timeout: 2000,
                stdio: ['pipe', 'pipe', 'ignore']
              }).trim();
              if (currentHead && currentHead !== 'HEAD') {
                defaultBranch = currentHead;
              }
            } catch {
              // Ignore
            }

            const parts = normalized.split('/');
            const discovered: GitHubRepoItem = {
              nameWithOwner: normalized,
              name: parts[1] || dirEntry.name,
              owner: parts[0] || '',
              defaultBranch,
              isPrivate: false,
              managedPath: workspaceDir,
              isCloned: true,
              url: `https://github.com/${normalized}`
            };
            itemsMap.set(key, discovered);
          }
        }
      }
    } catch (scanErr) {
      console.warn('[GITHUB] Error scanning workspaces root for local repos:', scanErr);
    }
  }

  const result = Array.from(itemsMap.values());
  inMemoryRepoCache = result;
  saveDiskRepoCache(result, cachePath);
  return result;
}

/**
 * Selects and prepares a managed GitHub repository workspace.
 * Clones repository if not present (via gh repo clone with git clone fallback),
 * or fetches updates if already cloned.
 */
export async function selectAndPrepareGitHubRepo(
  nameWithOwner: string,
  baseBranch?: string,
  options?: { workspacesRoot?: string; onProgress?: (msg: string) => void }
): Promise<{
  success: boolean;
  repo: GitHubRepoItem;
  workspacePath: string;
  branch: string;
  message: string;
}> {
  const normalized = normalizeGitHubRepo(nameWithOwner);
  if (!normalized || !normalized.includes('/')) {
    throw new Error(`Invalid GitHub repository name or URL: "${nameWithOwner}"`);
  }

  const managedPath = getManagedRepoPath(normalized, options?.workspacesRoot);
  const gitDir = path.join(managedPath, '.git');
  const isCloned = fs.existsSync(gitDir);

  if (!isCloned) {
    fs.mkdirSync(path.dirname(managedPath), { recursive: true });
    options?.onProgress?.(`Cloning ${normalized}...`);

    let cloneSuccess = false;
    let cloneError = '';

    try {
      await execFileAsync('gh', ['repo', 'clone', normalized, managedPath], {
        timeout: 120000
      });
      cloneSuccess = true;
    } catch (err) {
      cloneError = (err as Error)?.message || String(err);
      options?.onProgress?.(`gh clone failed, falling back to git clone for ${normalized}...`);
      try {
        await execFileAsync('git', ['clone', `https://github.com/${normalized}.git`, managedPath], {
          timeout: 120000
        });
        cloneSuccess = true;
      } catch (fallbackErr) {
        cloneError = (fallbackErr as Error)?.message || String(fallbackErr);
      }
    }

    if (!cloneSuccess) {
      const parts = normalized.split('/');
      const repoItem: GitHubRepoItem = {
        nameWithOwner: normalized,
        name: parts[1] || normalized,
        owner: parts[0] || '',
        defaultBranch: baseBranch || 'main',
        managedPath,
        isCloned: false,
        url: `https://github.com/${normalized}`,
        isPrivate: false
      };
      return {
        success: false,
        repo: repoItem,
        workspacePath: managedPath,
        branch: '',
        message: `Failed to clone repository ${normalized}: ${cloneError}`
      };
    }
  } else {
    options?.onProgress?.(`Fetching updates for ${normalized}...`);
    try {
      await execFileAsync('git', ['fetch', 'origin', '--prune'], {
        cwd: managedPath,
        timeout: 30000
      });
    } catch {
      // Ignore network errors when fetching updates offline
    }
  }

  // If baseBranch specified and working tree clean, checkout baseBranch and pull --ff-only
  if (baseBranch && baseBranch.trim()) {
    const targetBranch = baseBranch.trim();
    try {
      const status = execFileSync('git', ['status', '--porcelain'], {
        cwd: managedPath,
        encoding: 'utf8'
      }).trim();

      if (status.length === 0) {
        options?.onProgress?.(`Checking out base branch ${targetBranch}...`);
        try {
          execFileSync('git', ['checkout', targetBranch], {
            cwd: managedPath,
            encoding: 'utf8'
          });
        } catch {
          // If branch does not exist locally, checkout from origin
          try {
            execFileSync('git', ['checkout', '-b', targetBranch, `origin/${targetBranch}`], {
              cwd: managedPath,
              encoding: 'utf8'
            });
          } catch {
            // Ignore if remote branch does not exist
          }
        }

        // Pull ff-only if network is available
        try {
          execFileSync('git', ['pull', '--ff-only', 'origin', targetBranch], {
            cwd: managedPath,
            encoding: 'utf8',
            timeout: 15000
          });
        } catch {
          // Ignore offline / fast-forward failures
        }
      }
    } catch (branchErr) {
      console.warn(`[GITHUB] Failed to checkout base branch ${targetBranch}:`, branchErr);
    }
  }

  // Determine current active branch
  let currentBranch = 'main';
  try {
    currentBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: managedPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();
  } catch {
    // Fallback default
  }

  const parts = normalized.split('/');
  const repoItem: GitHubRepoItem = {
    nameWithOwner: normalized,
    name: parts[1] || normalized,
    owner: parts[0] || '',
    defaultBranch: baseBranch || currentBranch,
    managedPath,
    isCloned: true,
    url: `https://github.com/${normalized}`,
    isPrivate: false
  };

  return {
    success: true,
    repo: repoItem,
    workspacePath: managedPath,
    branch: currentBranch,
    message: `Repository ${normalized} ready on branch ${currentBranch}`
  };
}

/**
 * Builds a clean task branch slug from a user prompt.
 * Lowercase alphanumeric + hyphens, max 32 chars + 4-char hex suffix:
 * e.g. `jules/fix-auth-bug-4a9f`
 */
export function generateTaskBranchName(prompt: string): string {
  const clean = (prompt || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '');
  const slug = clean || 'task';
  const shortId = randomBytes(2).toString('hex');
  return `jules/${slug}-${shortId}`;
}

/**
 * Creates and checks out an isolated task branch replicating Google Jules's workflow.
 * If already on a jules/* branch with uncommitted changes, preserves it.
 */
export async function prepareTaskBranch(
  workspacePath: string,
  prompt: string,
  baseBranch?: string
): Promise<{ success: boolean; branchName: string; message: string }> {
  if (!fs.existsSync(workspacePath)) {
    throw new Error(`Workspace path does not exist: "${workspacePath}"`);
  }

  const currentBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: workspacePath,
    encoding: 'utf8'
  }).trim();

  const status = execFileSync('git', ['status', '--porcelain'], {
    cwd: workspacePath,
    encoding: 'utf8'
  }).trim();

  // If already on a jules/* branch and uncommitted changes exist, keep it
  if (currentBranch.startsWith('jules/') && status.length > 0) {
    return {
      success: true,
      branchName: currentBranch,
      message: `Preserving active task branch ${currentBranch} with uncommitted changes`
    };
  }

  // If baseBranch specified and different from current branch, checkout baseBranch first if clean
  if (baseBranch && baseBranch.trim() && baseBranch.trim() !== currentBranch && status.length === 0) {
    try {
      execFileSync('git', ['checkout', baseBranch.trim()], {
        cwd: workspacePath,
        encoding: 'utf8'
      });
    } catch {
      // Ignore checkout failure
    }
  }

  const branchName = generateTaskBranchName(prompt);
  execFileSync('git', ['checkout', '-b', branchName], {
    cwd: workspacePath,
    encoding: 'utf8'
  });

  return {
    success: true,
    branchName,
    message: `Created and checked out task branch ${branchName}`
  };
}

/**
 * Publishes a task branch to GitHub origin and creates or retrieves a Pull Request.
 * Automatically stages and commits uncommitted changes.
 * Ensures the branch is never pushed directly to main/master.
 */
export async function publishBranchAndCreatePR(
  options: PublishPrOptions
): Promise<PublishPrResult> {
  const { workspacePath, title, body, createPr = true } = options;
  const baseBranch = options.baseBranch || 'main';

  if (!fs.existsSync(workspacePath)) {
    return {
      success: false,
      branchName: '',
      pushed: false,
      message: `Workspace path does not exist: "${workspacePath}"`
    };
  }

  // 1. Check for uncommitted changes and commit them
  const status = execFileSync('git', ['status', '--porcelain'], {
    cwd: workspacePath,
    encoding: 'utf8'
  }).trim();

  if (status.length > 0) {
    execFileSync('git', ['add', '-A'], { cwd: workspacePath });
    execFileSync('git', ['commit', '-m', title || 'Update from JulesDeck task'], {
      cwd: workspacePath
    });
  }

  // 2. Determine current branch
  let currentBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: workspacePath,
    encoding: 'utf8'
  }).trim();

  // If user requested a specific task branch and we are not on it
  if (options.taskBranch && options.taskBranch !== currentBranch) {
    try {
      execFileSync('git', ['checkout', options.taskBranch], { cwd: workspacePath });
      currentBranch = options.taskBranch;
    } catch {
      execFileSync('git', ['checkout', '-b', options.taskBranch], { cwd: workspacePath });
      currentBranch = options.taskBranch;
    }
  }

  // Safety: Never push directly to main or master
  if (currentBranch === 'main' || currentBranch === 'master' || currentBranch === baseBranch) {
    const newBranch = generateTaskBranchName(title || 'publish');
    execFileSync('git', ['checkout', '-b', newBranch], { cwd: workspacePath });
    currentBranch = newBranch;
  }

  // 3. Push branch to origin
  try {
    execFileSync('git', ['push', '-u', 'origin', currentBranch], {
      cwd: workspacePath,
      encoding: 'utf8',
      timeout: 60000
    });
  } catch (pushErr) {
    return {
      success: false,
      branchName: currentBranch,
      pushed: false,
      message: `Failed to push branch ${currentBranch}: ${(pushErr as Error)?.message || String(pushErr)}`
    };
  }

  // 4. Create Pull Request if requested
  let prUrl: string | undefined;
  let prNumber: number | undefined;

  if (createPr) {
    try {
      const prCreateOutput = execFileSync(
        'gh',
        [
          'pr',
          'create',
          '--title',
          title || currentBranch,
          '--body',
          body || title || currentBranch,
          '--base',
          baseBranch,
          '--head',
          currentBranch
        ],
        { cwd: workspacePath, encoding: 'utf8', timeout: 30000 }
      ).trim();

      // Output usually contains the URL: https://github.com/owner/repo/pull/123
      const urlMatch = prCreateOutput.match(/https:\/\/github\.com\/[^\s]+\/pull\/([0-9]+)/i);
      if (urlMatch && urlMatch[0] && urlMatch[1]) {
        prUrl = urlMatch[0];
        prNumber = parseInt(urlMatch[1], 10);
      }
    } catch {
      // If PR creation failed (e.g. PR already exists), query existing PR via gh pr view
      try {
        const viewOutput = execFileSync(
          'gh',
          ['pr', 'view', currentBranch, '--json', 'url,number'],
          { cwd: workspacePath, encoding: 'utf8', timeout: 15000 }
        );
        const parsed: unknown = JSON.parse(viewOutput);
        if (parsed && typeof parsed === 'object') {
          const v = parsed as Record<string, unknown>;
          if (typeof v.url === 'string') prUrl = v.url;
          if (typeof v.number === 'number') prNumber = v.number;
        }
      } catch {
        // gh CLI PR creation or lookup failed, but push succeeded
      }
    }
  }

  return {
    success: true,
    branchName: currentBranch,
    pushed: true,
    prUrl,
    prNumber,
    message: prUrl
      ? `Successfully published branch and created PR: ${prUrl}`
      : `Pushed branch ${currentBranch} to origin`
  };
}

/**
 * Checks whether the legacy `jules` CLI is installed on this system.
 */
export function isLegacyJulesCliInstalled(): boolean {
  if (process.env.JULESDECK_JULES_BIN && fs.existsSync(process.env.JULESDECK_JULES_BIN.trim())) {
    return true;
  }

  const candidates: string[] = [
    path.join(os.homedir(), '.local/bin/jules'),
    '/usr/local/bin/jules',
    '/usr/bin/jules'
  ];

  const nvmNodeDir = path.join(os.homedir(), '.nvm/versions/node');
  if (fs.existsSync(nvmNodeDir)) {
    try {
      const versions = fs
        .readdirSync(nvmNodeDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
      for (const ver of versions) {
        candidates.push(path.join(nvmNodeDir, ver, 'bin/jules'));
      }
    } catch {
      // Ignore
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return true;
  }

  try {
    const whichOut = execFileSync('which', ['jules'], { stdio: 'pipe', encoding: 'utf8' }).trim();
    if (whichOut && fs.existsSync(whichOut)) return true;
  } catch {
    // Not found
  }

  return false;
}

/**
 * Checks Google Jules service availability and CLI status.
 * Returns LegacyJulesHealth.
 */
export async function checkLegacyJulesAvailability(): Promise<LegacyJulesHealth> {
  const cliInstalled = isLegacyJulesCliInstalled();
  const checkedAt = Date.now();

  if (process.env.JULESDECK_FORCE_LEGACY_OFFLINE === '1') {
    return {
      online: false,
      cliInstalled,
      webReachable: false,
      checkedAt,
      reason: 'Legacy Google Jules forced offline by environment configuration'
    };
  }

  let webReachable: boolean;
  try {
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), 3500);

    const res = await fetch('https://jules.google.com', {
      method: 'HEAD',
      signal: controller.signal
    }).catch(async () => {
      // Fallback to GET if HEAD method is blocked
      return await fetch('https://jules.google.com', {
        method: 'GET',
        signal: controller.signal
      });
    });

    clearTimeout(timeoutTimer);
    webReachable = res ? res.status < 400 : false;
  } catch {
    webReachable = false;
  }

  const online = cliInstalled && webReachable;
  let reason: string | undefined;

  if (!online) {
    if (!cliInstalled && !webReachable) {
      reason = 'Legacy Google Jules CLI is not installed and jules.google.com is unreachable';
    } else if (!cliInstalled) {
      reason = 'Legacy Google Jules CLI is not installed';
    } else if (!webReachable) {
      reason = 'Google Jules web service (jules.google.com) is unreachable';
    }
  }

  return {
    online,
    cliInstalled,
    webReachable,
    checkedAt,
    reason
  };
}
