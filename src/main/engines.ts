/**
 * Multi-Engine Architecture for JulesDeck.
 *
 * Supports headlessly resolving, orchestrating, and executing tasks across:
 * - Google Gemini CLI (@google/gemini-cli)
 * - Anthropic Claude Code (claude)
 * - OpenAI Codex (codex)
 * - OpenCode (opencode)
 * - Aider (aider)
 * - Legacy Google Jules (jules)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync, execSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type {
  AgentEngineId,
  EngineModelOption,
  EngineStatusInfo,
  JulesRunResult,
  TaskOutputChunk,
  TaskStatusEvent
} from '../shared/types.js';

export type {
  AgentEngineId,
  EngineModelOption,
  EngineStatusInfo,
  JulesRunResult,
  TaskOutputChunk,
  TaskStatusEvent
};

const ANSI_PATTERN = new RegExp(
  [
    '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
    '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))'
  ].join('|'),
  'g'
);

export function stripAnsi(text: string): string {
  if (!text) return '';
  return text.replace(ANSI_PATTERN, '');
}

export function cleanTerminalText(text: string): string {
  return stripAnsi(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * All supported engine identifiers in preferred presentation order.
 */
export const ALL_AGENT_ENGINE_IDS: AgentEngineId[] = [
  'gemini-cli',
  'claude-code',
  'codex',
  'opencode',
  'aider',
  'legacy-jules'
];

/**
 * Canonical definitions and default model suites for each supported agent engine.
 */
export const ENGINE_DEFINITIONS: Record<
  AgentEngineId,
  {
    name: string;
    description: string;
    models: EngineModelOption[];
  }
> = {
  'gemini-cli': {
    name: 'Gemini CLI',
    description: 'Google Gemini Headless CLI Agent',
    models: [
      {
        id: 'gemini-3.1-pro',
        label: 'Gemini 3.1 Pro',
        description: 'Default • Best for complex tasks',
        engine: 'gemini-cli',
        isDefault: true
      },
      {
        id: 'gemini-3.6-flash',
        label: 'Gemini 3.6 Flash',
        description: 'Fast • Low latency iterations',
        engine: 'gemini-cli'
      },
      {
        id: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro',
        description: 'High fidelity code generation',
        engine: 'gemini-cli'
      },
      {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        description: 'Fast headless reasoning',
        engine: 'gemini-cli'
      }
    ]
  },
  'claude-code': {
    name: 'Claude Code',
    description: 'Anthropic Claude Code CLI',
    models: [
      {
        id: 'claude-sonnet-4-6',
        label: 'Claude Sonnet 4.6',
        description: 'Anthropic Claude Code CLI',
        engine: 'claude-code',
        isDefault: true
      },
      {
        id: 'claude-opus-4-7',
        label: 'Claude Opus 4.7',
        description: 'Deep architectural reasoning',
        engine: 'claude-code'
      }
    ]
  },
  'codex': {
    name: 'OpenAI Codex',
    description: 'OpenAI Codex Agent CLI',
    models: [
      {
        id: 'gpt-5-codex',
        label: 'GPT-5 Codex',
        description: 'OpenAI Codex Full-Auto Agent',
        engine: 'codex',
        isDefault: true
      },
      {
        id: 'o4-mini',
        label: 'o4-mini',
        description: 'Fast Codex reasoning',
        engine: 'codex'
      }
    ]
  },
  'opencode': {
    name: 'OpenCode',
    description: 'OpenCode Agent Runner',
    models: [
      {
        id: 'opencode-default',
        label: 'OpenCode Agent',
        description: 'OpenCode CLI Runner',
        engine: 'opencode',
        isDefault: true
      }
    ]
  },
  'aider': {
    name: 'Aider',
    description: 'Git-native AI pair programmer',
    models: [
      {
        id: 'aider-default',
        label: 'Aider Architect',
        description: 'Git-native pair programmer',
        engine: 'aider',
        isDefault: true
      }
    ]
  },
  'legacy-jules': {
    name: 'Legacy Google Jules',
    description: 'Google Jules Cloud CLI (Legacy)',
    models: [
      {
        id: 'jules-cloud',
        label: 'Google Jules Cloud (Legacy)',
        description: 'Optional legacy jules.google.com runner',
        engine: 'legacy-jules',
        isDefault: true
      }
    ]
  }
};

/**
 * Checks whether a candidate binary is an Electron GUI desktop wrapper
 * (such as ~/.local/opt/gemini/gemini.sh or ~/.local/bin/gemini pointing to it)
 * rather than the headless @google/gemini-cli package.
 */
export function isGuiGeminiWrapper(candidatePath: string): boolean {
  if (!candidatePath || typeof candidatePath !== 'string') {
    return false;
  }

  const normCandidate = candidatePath.toLowerCase();
  if (normCandidate.includes('/opt/gemini') || normCandidate.endsWith('gemini.sh')) {
    return true;
  }

  try {
    if (!fs.existsSync(candidatePath)) {
      return false;
    }
  } catch {
    return false;
  }

  // 1. Inspect realpath
  try {
    const real = fs.realpathSync(candidatePath).toLowerCase();
    if (
      real.includes('/opt/gemini') ||
      real.includes('gemini.sh') ||
      real.includes('appimage')
    ) {
      return true;
    }
  } catch {
    // If realpathSync fails, proceed to buffer read check
  }

  // 2. Read first 2KB of text
  try {
    const stat = fs.statSync(candidatePath);
    if (!stat.isFile()) {
      return false;
    }
    const fd = fs.openSync(candidatePath, 'r');
    const buffer = Buffer.alloc(2048);
    const bytesRead = fs.readSync(fd, buffer, 0, 2048, 0);
    fs.closeSync(fd);
    const head = buffer.toString('utf-8', 0, bytesRead).toLowerCase();
    if (
      head.includes('/opt/gemini') ||
      head.includes('gemini.sh') ||
      head.includes('starting gemini') ||
      head.includes('electron') ||
      head.includes('appimage')
    ) {
      return true;
    }
  } catch {
    // Ignore read errors
  }

  return false;
}

/**
 * Resolves the real headless @google/gemini-cli binary.
 * Scans NVM node versions (descending order), process.env.GEMINI_CLI_PATH, and PATH,
 * strictly rejecting any Electron GUI wrappers.
 */
export function resolveGeminiCliBinary(customCandidates?: string[]): string | null {
  // 1. Custom candidates passed explicitly take top priority if valid
  if (customCandidates && customCandidates.length > 0) {
    for (const c of customCandidates) {
      try {
        if (!fs.existsSync(c)) continue;
        const stat = fs.statSync(c);
        if (!stat.isFile()) continue;
        if (isGuiGeminiWrapper(c)) continue;
        const real = fs.realpathSync(c);
        if (isGuiGeminiWrapper(real)) continue;
        return path.resolve(c);
      } catch {
        continue;
      }
    }
  }

  // 2. Explicit environment override takes precedence if valid
  const envPath = process.env.GEMINI_CLI_PATH;
  if (envPath && envPath.trim().length > 0) {
    try {
      const candidate = path.resolve(envPath.trim());
      if (fs.existsSync(candidate)) {
        const stat = fs.statSync(candidate);
        if (stat.isFile() && !isGuiGeminiWrapper(candidate)) {
          const real = fs.realpathSync(candidate);
          if (!isGuiGeminiWrapper(real)) {
            return candidate;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  const candidates: string[] = [];

  // 3. Scan ~/.nvm/versions/node/*/bin/gemini sorted descending (v22+ first)
  const nvmBase = path.join(os.homedir(), '.nvm', 'versions', 'node');
  if (fs.existsSync(nvmBase)) {
    try {
      const versions = fs
        .readdirSync(nvmBase)
        .filter((d) => {
          try {
            return fs.statSync(path.join(nvmBase, d)).isDirectory();
          } catch {
            return false;
          }
        })
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

      for (const v of versions) {
        candidates.push(path.join(nvmBase, v, 'bin', 'gemini'));
      }
    } catch {
      // Ignore NVM traversal errors
    }
  }

  // 4. Other standard locations
  candidates.push(
    path.join(os.homedir(), '.local', 'bin', 'gemini'),
    '/usr/local/bin/gemini',
    '/usr/bin/gemini'
  );

  // 5. PATH directories
  if (process.env.PATH) {
    const pathDirs = process.env.PATH.split(path.delimiter);
    for (const dir of pathDirs) {
      if (dir && dir.trim().length > 0) {
        candidates.push(path.join(dir.trim(), 'gemini'));
      }
    }
  }

  // Deduplicate candidates preserving scan priority
  const seen = new Set<string>();
  const uniqueCandidates: string[] = [];
  for (const c of candidates) {
    const resolved = path.resolve(c);
    if (!seen.has(resolved)) {
      seen.add(resolved);
      uniqueCandidates.push(resolved);
    }
  }

  interface CandidateEvaluation {
    path: string;
    realpath: string;
    isGoogleGeminiCli: boolean;
  }

  const validCandidates: CandidateEvaluation[] = [];

  for (const candidate of uniqueCandidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) continue;

      // Reject GUI wrappers
      if (isGuiGeminiWrapper(candidate)) continue;

      const real = fs.realpathSync(candidate);
      if (isGuiGeminiWrapper(real)) continue;

      const normReal = real.toLowerCase();
      const isGoogleGeminiCli =
        normReal.includes('@google/gemini-cli') || normReal.includes('gemini-cli');

      validCandidates.push({
        path: candidate,
        realpath: real,
        isGoogleGeminiCli
      });
    } catch {
      continue;
    }
  }

  if (validCandidates.length === 0) {
    return null;
  }

  // Prefer candidate whose realpath contains @google/gemini-cli
  const preferred = validCandidates.find((c) => c.isGoogleGeminiCli);
  if (preferred) {
    return preferred.path;
  }

  // Fallback to first non-GUI executable candidate
  const fallback = validCandidates[0];
  return fallback ? fallback.path : null;
}

/**
 * Resolves the executable binary path for a given agent engine.
 */
export function resolveEngineBinary(
  engine: AgentEngineId,
  customCandidates?: string[]
): string | null {
  if (engine === 'gemini-cli') {
    return resolveGeminiCliBinary(customCandidates);
  }

  const candidates: string[] = [];
  if (customCandidates && customCandidates.length > 0) {
    candidates.push(...customCandidates);
  }

  const homedir = os.homedir();

  switch (engine) {
    case 'claude-code': {
      if (process.env.CLAUDE_CODE_PATH) candidates.push(process.env.CLAUDE_CODE_PATH);
      if (process.env.CLAUDE_PATH) candidates.push(process.env.CLAUDE_PATH);
      candidates.push(
        path.join(homedir, '.local', 'bin', 'claude'),
        '/usr/local/bin/claude',
        '/usr/bin/claude'
      );
      if (process.env.PATH) {
        for (const dir of process.env.PATH.split(path.delimiter)) {
          if (dir.trim()) candidates.push(path.join(dir.trim(), 'claude'));
        }
      }
      break;
    }
    case 'codex': {
      if (process.env.CODEX_PATH) candidates.push(process.env.CODEX_PATH);
      const nvmBase = path.join(homedir, '.nvm', 'versions', 'node');
      if (fs.existsSync(nvmBase)) {
        try {
          const versions = fs
            .readdirSync(nvmBase)
            .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
          for (const v of versions) {
            candidates.push(path.join(nvmBase, v, 'bin', 'codex'));
          }
        } catch {
          // ignore
        }
      }
      candidates.push(
        path.join(homedir, '.local', 'bin', 'codex'),
        '/usr/local/bin/codex',
        '/usr/bin/codex'
      );
      if (process.env.PATH) {
        for (const dir of process.env.PATH.split(path.delimiter)) {
          if (dir.trim()) candidates.push(path.join(dir.trim(), 'codex'));
        }
      }
      break;
    }
    case 'opencode': {
      if (process.env.OPENCODE_PATH) candidates.push(process.env.OPENCODE_PATH);
      candidates.push(
        path.join(homedir, '.opencode', 'bin', 'opencode'),
        path.join(homedir, '.local', 'bin', 'opencode'),
        '/usr/local/bin/opencode',
        '/usr/bin/opencode'
      );
      if (process.env.PATH) {
        for (const dir of process.env.PATH.split(path.delimiter)) {
          if (dir.trim()) candidates.push(path.join(dir.trim(), 'opencode'));
        }
      }
      break;
    }
    case 'aider': {
      if (process.env.AIDER_PATH) candidates.push(process.env.AIDER_PATH);
      candidates.push(
        path.join(homedir, '.local', 'bin', 'aider'),
        '/usr/local/bin/aider',
        '/usr/bin/aider'
      );
      if (process.env.PATH) {
        for (const dir of process.env.PATH.split(path.delimiter)) {
          if (dir.trim()) candidates.push(path.join(dir.trim(), 'aider'));
        }
      }
      break;
    }
    case 'legacy-jules': {
      if (process.env.JULES_CLI_PATH) candidates.push(process.env.JULES_CLI_PATH);
      if (process.env.JULES_PATH) candidates.push(process.env.JULES_PATH);
      const nvmBase = path.join(homedir, '.nvm', 'versions', 'node');
      if (fs.existsSync(nvmBase)) {
        try {
          const versions = fs
            .readdirSync(nvmBase)
            .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
          for (const v of versions) {
            candidates.push(path.join(nvmBase, v, 'bin', 'jules'));
          }
        } catch {
          // ignore
        }
      }
      candidates.push(
        path.join(homedir, '.local', 'bin', 'jules'),
        '/usr/local/bin/jules',
        '/usr/bin/jules'
      );
      if (process.env.PATH) {
        for (const dir of process.env.PATH.split(path.delimiter)) {
          if (dir.trim()) candidates.push(path.join(dir.trim(), 'jules'));
        }
      }
      break;
    }
  }

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        const stat = fs.statSync(c);
        if (stat.isFile()) {
          return path.resolve(c);
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

const engineVersionCache = new Map<string, string>();

/**
 * Extracts and caches the version string for an engine binary.
 */
export function getEngineVersion(engine: AgentEngineId, binaryPath: string): string | undefined {
  if (engineVersionCache.has(binaryPath)) {
    return engineVersionCache.get(binaryPath);
  }

  try {
    // For Node-packaged CLIs (gemini-cli, codex, jules), check package.json first for speed
    if (engine === 'gemini-cli' || engine === 'codex' || engine === 'legacy-jules') {
      try {
        const real = fs.realpathSync(binaryPath);
        const pkgPath = path.join(path.dirname(real), '..', 'package.json');
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string };
          if (pkg.version) {
            engineVersionCache.set(binaryPath, pkg.version);
            return pkg.version;
          }
        }
      } catch {
        // Fall back to CLI execution
      }
    }

    const args = engine === 'legacy-jules' ? ['version'] : ['--version'];
    const out = execFileSync(binaryPath, args, {
      encoding: 'utf-8',
      timeout: 2500,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const m = out.match(/([0-9]+\.[0-9]+(?:\.[0-9]+)?(?:-[a-zA-Z0-9.]+)?)/);
    const ver = m && m[1] ? m[1] : out.trim().split('\n')[0]?.trim();
    if (ver) {
      engineVersionCache.set(binaryPath, ver);
      return ver;
    }
  } catch {
    // Ignore version retrieval error
  }

  return undefined;
}

export interface DiscoverEnginesOptions {
  refresh?: boolean;
  fetchVersion?: boolean;
  customBinaries?: Partial<Record<AgentEngineId, string>>;
}

/**
 * Discovers and reports the status, binary path, version, and model options
 * for all 6 agent engines.
 */
export function discoverEngines(options?: DiscoverEnginesOptions): EngineStatusInfo[] {
  if (options?.refresh) {
    engineVersionCache.clear();
  }

  const results: EngineStatusInfo[] = [];

  for (const id of ALL_AGENT_ENGINE_IDS) {
    const meta = ENGINE_DEFINITIONS[id];
    const customBin = options?.customBinaries?.[id];
    const binaryPath = customBin || resolveEngineBinary(id);

    if (binaryPath) {
      let version: string | undefined;
      if (options?.fetchVersion !== false) {
        version = getEngineVersion(id, binaryPath);
      }

      results.push({
        id,
        name: meta.name,
        available: true,
        binaryPath,
        version,
        models: meta.models
      });
    } else {
      results.push({
        id,
        name: meta.name,
        available: false,
        models: meta.models,
        error: `${meta.name} CLI binary not found in PATH or standard locations`
      });
    }
  }

  return results;
}

/**
 * Normalizes model parameter for Gemini CLI:
 * - Passes explicitly requested 2.5 models ('gemini-2.5-pro', 'gemini-2.5-flash').
 * - Omits '-m' (returning undefined) for display aliases and 3.x models
 *   ('gemini-3.1-pro', 'gemini-3.6-flash', etc.) so Gemini CLI uses its configured default.
 */
export function normalizeGeminiCliModelFlag(model?: string): string | undefined {
  if (!model) return undefined;
  const normalized = model.toLowerCase().trim();

  if (normalized === 'gemini-2.5-pro' || normalized === 'gemini-2.5-flash') {
    return normalized;
  }

  if (
    normalized === 'gemini-3.1-pro' ||
    normalized === 'gemini 3.1 pro' ||
    normalized === 'gemini-3.6-flash' ||
    normalized === 'gemini 3.6 flash' ||
    normalized.includes('3.1') ||
    normalized.includes('3.6')
  ) {
    return undefined;
  }

  if (normalized.startsWith('gemini-2.')) {
    return normalized;
  }

  return undefined;
}

export interface BuildEngineCommandOptions {
  model?: string;
  repoPath?: string;
  githubRepo?: string;
  phase?: 'plan' | 'execute';
  binaryPath?: string;
}

/**
 * Builds the exact executable command, argument list, and environment variables
 * for invoking an agent engine headlessly.
 */
export function buildEngineCommand(
  engine: AgentEngineId,
  prompt: string,
  options?: BuildEngineCommandOptions
): { binary: string; args: string[]; env: NodeJS.ProcessEnv } {
  const binary =
    options?.binaryPath !== undefined ? options.binaryPath : resolveEngineBinary(engine);
  if (!binary || binary.trim().length === 0) {
    throw new Error(`No executable binary found for engine: ${engine}`);
  }

  const args: string[] = [];

  switch (engine) {
    case 'gemini-cli': {
      args.push('-p', prompt);
      const modelFlag = normalizeGeminiCliModelFlag(options?.model);
      if (modelFlag) {
        args.push('-m', modelFlag);
      }
      if (options?.phase === 'plan') {
        args.push('--approval-mode', 'plan');
      } else {
        args.push('--yolo', '--skip-trust');
      }
      break;
    }
    case 'claude-code': {
      args.push('-p', prompt, '--dangerously-skip-permissions');
      if (options?.model && options.model.startsWith('claude-')) {
        args.push('--model', options.model);
      }
      break;
    }
    case 'codex': {
      args.push('exec', '--full-auto', '--skip-git-repo-check', prompt);
      break;
    }
    case 'opencode': {
      args.push('run', prompt);
      break;
    }
    case 'aider': {
      args.push('--yes-always', '--no-auto-commits', '--message', prompt);
      break;
    }
    case 'legacy-jules': {
      if (options?.githubRepo) {
        args.push('new', '--repo', options.githubRepo, prompt);
      } else {
        args.push('new', prompt);
      }
      break;
    }
    default: {
      const _exhaustiveCheck: never = engine;
      throw new Error(`Unsupported engine: ${_exhaustiveCheck}`);
    }
  }

  // Prepend binary directory and NVM Node bin directory to PATH for reliable Node v22+ runtime
  const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: '1' };
  const pathParts: string[] = [];

  const binDir = path.dirname(binary);
  pathParts.push(binDir);

  const nvmBase = path.join(os.homedir(), '.nvm', 'versions', 'node');
  if (fs.existsSync(nvmBase)) {
    try {
      const versions = fs
        .readdirSync(nvmBase)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      const highestVersion = versions[0];
      if (highestVersion) {
        const nvmBin = path.join(nvmBase, highestVersion, 'bin');
        if (!pathParts.includes(nvmBin)) {
          pathParts.push(nvmBin);
        }
      }
    } catch {
      // ignore
    }
  }

  if (process.env.PATH) {
    pathParts.push(process.env.PATH);
  }
  env.PATH = pathParts.join(path.delimiter);

  return { binary, args, env };
}

/**
 * Cross-platform process group termination.
 */
export function killProcessGroup(pid: number, signal: NodeJS.Signals = 'SIGTERM'): boolean {
  if (!pid || pid <= 1) {
    return false;
  }
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
      return true;
    } else {
      process.kill(-pid, signal);
      return true;
    }
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

export interface RunEngineTaskOptions {
  engine: AgentEngineId;
  prompt: string;
  repoPath: string;
  model?: string;
  githubRepo?: string;
  phase?: 'plan' | 'execute';
  taskId?: string;
  sessionId?: string;
  signal?: AbortSignal;
  onChunk?: (chunk: TaskOutputChunk) => void;
  onStatus?: (status: TaskStatusEvent) => void;
  timeoutMs?: number;
  binaryPath?: string;
}

export interface ActiveEngineTaskRecord {
  taskId: string;
  engine: AgentEngineId;
  child?: ChildProcess;
  startTime: number;
  cancelled: boolean;
}

const activeEngineTasks = new Map<string, ActiveEngineTaskRecord>();

export function getActiveEngineTasks(): ActiveEngineTaskRecord[] {
  return Array.from(activeEngineTasks.values());
}

/**
 * Cancels a specific running engine task or all active tasks if no taskId is specified.
 */
export function cancelRunningEngineTask(taskId?: string): boolean {
  if (taskId) {
    const task = activeEngineTasks.get(taskId);
    if (!task) return false;
    task.cancelled = true;
    if (task.child && task.child.pid) {
      killProcessGroup(task.child.pid, 'SIGTERM');
      const pid = task.child.pid;
      setTimeout(() => {
        try {
          killProcessGroup(pid, 'SIGKILL');
        } catch {
          // ignore
        }
      }, 1500);
    }
    activeEngineTasks.delete(taskId);
    return true;
  }

  if (activeEngineTasks.size === 0) return false;
  let anyCancelled = false;
  for (const [id, task] of activeEngineTasks.entries()) {
    task.cancelled = true;
    if (task.child && task.child.pid) {
      killProcessGroup(task.child.pid, 'SIGTERM');
      const pid = task.child.pid;
      setTimeout(() => {
        try {
          killProcessGroup(pid, 'SIGKILL');
        } catch {
          // ignore
        }
      }, 1500);
      anyCancelled = true;
    }
    activeEngineTasks.delete(id);
  }
  return anyCancelled;
}

/**
 * Executes an agent engine task asynchronously with real-time stdout/stderr streaming,
 * status lifecycle broadcasts, timeout handling, and cancellation support.
 */
export async function runEngineTask(options: RunEngineTaskOptions): Promise<JulesRunResult> {
  const taskId = options.taskId || randomUUID();
  const startTime = Date.now();
  const sessionId = options.sessionId || taskId;

  // Emit initial running status
  options.onStatus?.({
    taskId,
    status: 'running',
    sessionId,
    message: `Running task on ${ENGINE_DEFINITIONS[options.engine].name}...`
  });

  // 1. Mock execution fallback (for tests or explicit mock testing)
  if (process.env.JULESDECK_MOCK_ENGINE === '1' || options.prompt.startsWith('__MOCK__')) {
    const output = `[MOCK ENGINE: ${options.engine}] Executed prompt: "${options.prompt}" in ${options.repoPath}\n`;
    options.onChunk?.({
      taskId,
      stream: 'stdout',
      chunk: output,
      raw: output,
      timestamp: Date.now(),
      sessionId
    });

    options.onStatus?.({
      taskId,
      status: 'completed',
      exitCode: 0,
      sessionId,
      durationMs: Date.now() - startTime,
      message: 'Task completed successfully (mock)'
    });

    return {
      success: true,
      sessionId,
      output,
      message: 'Completed successfully',
      engine: options.engine,
      model: options.model,
      workspacePath: options.repoPath
    };
  }

  // 2. Deterministic file check fallback
  if (options.prompt.startsWith('__FILE_CHECK__:')) {
    const targetFile = options.prompt.replace('__FILE_CHECK__:', '').trim();
    const resolvedTarget = path.isAbsolute(targetFile)
      ? targetFile
      : path.join(options.repoPath, targetFile);

    const exists = fs.existsSync(resolvedTarget);
    const output = exists
      ? `File exists: ${resolvedTarget}\n`
      : `File does not exist: ${resolvedTarget}\n`;

    options.onChunk?.({
      taskId,
      stream: exists ? 'stdout' : 'stderr',
      chunk: output,
      raw: output,
      timestamp: Date.now(),
      sessionId
    });

    options.onStatus?.({
      taskId,
      status: exists ? 'completed' : 'failed',
      exitCode: exists ? 0 : 1,
      sessionId,
      durationMs: Date.now() - startTime,
      message: exists ? 'File check passed' : 'File check failed'
    });

    return {
      success: exists,
      sessionId,
      output,
      message: exists ? 'File check passed' : 'File check failed',
      engine: options.engine,
      model: options.model,
      workspacePath: options.repoPath
    };
  }

  // 3. Pre-aborted signal check
  if (options.signal?.aborted) {
    options.onStatus?.({
      taskId,
      status: 'cancelled',
      exitCode: null,
      sessionId,
      durationMs: 0,
      message: 'Task aborted before execution'
    });
    return {
      success: false,
      sessionId,
      output: '[CANCELLED] Task aborted before execution',
      message: 'Task aborted before execution',
      engine: options.engine,
      model: options.model,
      workspacePath: options.repoPath
    };
  }

  let command: { binary: string; args: string[]; env: NodeJS.ProcessEnv };
  try {
    command = buildEngineCommand(options.engine, options.prompt, {
      model: options.model,
      repoPath: options.repoPath,
      githubRepo: options.githubRepo,
      phase: options.phase,
      binaryPath: options.binaryPath
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const errorOutput = `[ERROR] ${errMsg}\n`;
    options.onChunk?.({
      taskId,
      stream: 'system',
      chunk: errorOutput,
      raw: errorOutput,
      timestamp: Date.now(),
      sessionId
    });
    options.onStatus?.({
      taskId,
      status: 'failed',
      exitCode: 1,
      sessionId,
      durationMs: Date.now() - startTime,
      message: errMsg
    });
    return {
      success: false,
      sessionId,
      output: errorOutput,
      message: errMsg,
      engine: options.engine,
      model: options.model,
      workspacePath: options.repoPath
    };
  }

  return new Promise((resolve) => {
    let fullOutput = '';
    let settled = false;

    let child: ChildProcess;
    try {
      child = spawn(command.binary, command.args, {
        cwd: options.repoPath,
        env: command.env,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (spawnErr: unknown) {
      const errMsg = spawnErr instanceof Error ? spawnErr.message : String(spawnErr);
      options.onStatus?.({
        taskId,
        status: 'failed',
        exitCode: 1,
        sessionId,
        durationMs: Date.now() - startTime,
        message: `Failed to spawn: ${errMsg}`
      });
      return resolve({
        success: false,
        sessionId,
        output: `Failed to spawn: ${errMsg}`,
        message: errMsg,
        engine: options.engine,
        model: options.model,
        workspacePath: options.repoPath
      });
    }

    const taskRecord: ActiveEngineTaskRecord = {
      taskId,
      engine: options.engine,
      child,
      startTime,
      cancelled: false
    };
    activeEngineTasks.set(taskId, taskRecord);

    const abortHandler = (): void => {
      cancelRunningEngineTask(taskId);
    };

    if (options.signal) {
      options.signal.addEventListener('abort', abortHandler, { once: true });
    }

    const timeoutMs = options.timeoutMs || 600000;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        taskRecord.cancelled = true;
        if (child.pid) {
          killProcessGroup(child.pid, 'SIGTERM');
        }
        activeEngineTasks.delete(taskId);
        const timeoutMsg = '\n[TIMEOUT] Engine task timed out\n';
        fullOutput += timeoutMsg;
        options.onChunk?.({
          taskId,
          stream: 'system',
          chunk: timeoutMsg,
          raw: timeoutMsg,
          timestamp: Date.now(),
          sessionId
        });
        options.onStatus?.({
          taskId,
          status: 'failed',
          exitCode: null,
          sessionId,
          durationMs: Date.now() - startTime,
          message: 'Task timed out'
        });
        resolve({
          success: false,
          sessionId,
          output: fullOutput,
          message: 'Task timed out',
          engine: options.engine,
          model: options.model,
          workspacePath: options.repoPath
        });
      }
    }, timeoutMs);

    child.stdout?.on('data', (data: Buffer) => {
      const rawText = data.toString('utf-8');
      const cleanText = cleanTerminalText(rawText);
      fullOutput += cleanText;
      options.onChunk?.({
        taskId,
        stream: 'stdout',
        chunk: cleanText,
        raw: rawText,
        timestamp: Date.now(),
        sessionId
      });
    });

    child.stderr?.on('data', (data: Buffer) => {
      const rawText = data.toString('utf-8');
      const cleanText = cleanTerminalText(rawText);
      fullOutput += cleanText;
      options.onChunk?.({
        taskId,
        stream: 'stderr',
        chunk: cleanText,
        raw: rawText,
        timestamp: Date.now(),
        sessionId
      });
    });

    child.on('error', (err: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        activeEngineTasks.delete(taskId);
        if (options.signal) {
          options.signal.removeEventListener('abort', abortHandler);
        }
        options.onStatus?.({
          taskId,
          status: 'failed',
          exitCode: 1,
          sessionId,
          durationMs: Date.now() - startTime,
          message: err.message
        });
        resolve({
          success: false,
          sessionId,
          output: fullOutput + '\n' + err.message,
          message: err.message,
          engine: options.engine,
          model: options.model,
          workspacePath: options.repoPath
        });
      }
    });

    child.on('close', (code: number | null) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        activeEngineTasks.delete(taskId);
        if (options.signal) {
          options.signal.removeEventListener('abort', abortHandler);
        }

        const durationMs = Date.now() - startTime;
        if (taskRecord.cancelled) {
          options.onStatus?.({
            taskId,
            status: 'cancelled',
            exitCode: code,
            sessionId,
            durationMs,
            message: 'Task cancelled by user'
          });
          resolve({
            success: false,
            sessionId,
            output: fullOutput,
            message: 'Task cancelled',
            engine: options.engine,
            model: options.model,
            workspacePath: options.repoPath
          });
        } else if (code === 0) {
          options.onStatus?.({
            taskId,
            status: 'completed',
            exitCode: 0,
            sessionId,
            durationMs,
            message: 'Task completed successfully'
          });
          resolve({
            success: true,
            sessionId,
            output: fullOutput,
            message: 'Task completed successfully',
            engine: options.engine,
            model: options.model,
            workspacePath: options.repoPath
          });
        } else {
          options.onStatus?.({
            taskId,
            status: 'failed',
            exitCode: code,
            sessionId,
            durationMs,
            message: `Process exited with code ${code}`
          });
          resolve({
            success: false,
            sessionId,
            output: fullOutput,
            message: `Engine process exited with code ${code}`,
            engine: options.engine,
            model: options.model,
            workspacePath: options.repoPath
          });
        }
      }
    });
  });
}
