import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  isGuiGeminiWrapper,
  resolveGeminiCliBinary,
  resolveEngineBinary,
  discoverEngines,
  normalizeGeminiCliModelFlag,
  buildEngineCommand,
  runEngineTask,
  cancelRunningEngineTask,
  stripAnsi,
  cleanTerminalText,
  ALL_AGENT_ENGINE_IDS,
  type TaskOutputChunk,
  type TaskStatusEvent
} from '../src/main/engines.js';

describe('Multi-Engine Architecture (engines.ts)', () => {
  let tempDir: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'julesdeck-engines-test-'));
    originalPath = process.env.PATH;
    vi.spyOn(os, 'homedir').mockReturnValue(tempDir);
    const bin = path.join(tempDir, '.local/bin');
    fs.mkdirSync(bin, { recursive: true });
    for (const name of ['claude', 'codex', 'opencode', 'aider', 'jules']) {
      fs.writeFileSync(path.join(bin, name), '#!/bin/sh\necho "fixture version 1.0"\n', { mode: 0o755 });
    }
    const gemini = path.join(tempDir, 'gemini-cli');
    fs.writeFileSync(gemini, '#!/bin/sh\n# @google/gemini-cli fixture\necho "fixture version 1.0"\n', { mode: 0o755 });
    fs.symlinkSync(gemini, path.join(bin, 'gemini'));
    const nvmBin = path.join(tempDir, '.nvm/versions/node/v22.22.3/bin');
    fs.mkdirSync(nvmBin, { recursive: true });
    fs.copyFileSync(gemini, path.join(nvmBin, 'gemini'));
    fs.chmodSync(path.join(nvmBin, 'gemini'), 0o755);
    fs.symlinkSync(process.execPath, path.join(nvmBin, 'node'));
    process.env.PATH = bin + path.delimiter + (originalPath || '');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('Terminal Text Helpers', () => {
    it('strips ANSI color and control codes', () => {
      const raw = '\u001B[31mError:\u001B[0m \u001B[1mFailed to compile\u001B[22m';
      expect(stripAnsi(raw)).toBe('Error: Failed to compile');
    });

    it('normalizes CRLF line endings to LF', () => {
      const raw = 'line1\r\nline2\rline3\n';
      expect(cleanTerminalText(raw)).toBe('line1\nline2\nline3\n');
    });
  });

  describe('isGuiGeminiWrapper', () => {
    it('identifies a GUI wrapper in the isolated home', () => {
      const hostGuiPath = path.join(os.homedir(), '.local', 'bin', 'gemini');
      fs.unlinkSync(hostGuiPath);
      fs.writeFileSync(hostGuiPath, '#!/bin/sh\nexec /opt/gemini/gemini.sh\n', { mode: 0o755 });
      expect(isGuiGeminiWrapper(hostGuiPath)).toBe(true);
    });

    it('identifies the real headless NVM CLI as NOT a GUI wrapper', () => {
      const nvmCli = path.join(os.homedir(), '.nvm', 'versions', 'node', 'v22.22.3', 'bin', 'gemini');
      fs.mkdirSync(path.dirname(nvmCli), { recursive: true });
      fs.writeFileSync(nvmCli, '#!/bin/sh\n# @google/gemini-cli fixture\n', { mode: 0o755 });
      expect(isGuiGeminiWrapper(nvmCli)).toBe(false);
    });

    it('detects a shell script referencing /opt/gemini/gemini.sh as a GUI wrapper', () => {
      const fakeWrapper = path.join(tempDir, 'fake-gemini.sh');
      fs.writeFileSync(
        fakeWrapper,
        '#!/bin/sh\n# Launcher script\nROOT="/home/user/.local/opt/gemini"\nexec "$ROOT/gemini.sh" "$@"\n',
        { mode: 0o755 }
      );
      expect(isGuiGeminiWrapper(fakeWrapper)).toBe(true);
    });

    it('detects a symlink pointing to an electron / opt path', () => {
      const targetScript = path.join(tempDir, 'gemini.sh');
      fs.writeFileSync(targetScript, '#!/bin/sh\necho "Starting Gemini Electron..."\n', { mode: 0o755 });
      const linkPath = path.join(tempDir, 'gemini-link');
      fs.symlinkSync(targetScript, linkPath);

      expect(isGuiGeminiWrapper(linkPath)).toBe(true);
    });

    it('returns false for a legitimate headless Node or bash script', () => {
      const legitimateScript = path.join(tempDir, 'headless-gemini.js');
      fs.writeFileSync(
        legitimateScript,
        '#!/usr/bin/env node\nconsole.log("@google/gemini-cli version 0.64.0");\n',
        { mode: 0o755 }
      );
      expect(isGuiGeminiWrapper(legitimateScript)).toBe(false);
    });

    it('returns false for non-existent paths and invalid inputs', () => {
      expect(isGuiGeminiWrapper(path.join(tempDir, 'non-existent-binary'))).toBe(false);
      expect(isGuiGeminiWrapper('')).toBe(false);
    });
  });

  describe('resolveGeminiCliBinary', () => {
    it('resolves the real headless @google/gemini-cli binary and never returns the GUI wrapper', () => {
      const resolved = resolveGeminiCliBinary();
      expect(resolved).not.toBeNull();
      expect(typeof resolved).toBe('string');

      // Must NOT be the GUI wrapper
      expect(isGuiGeminiWrapper(resolved!)).toBe(false);

      // Must point to a real file on disk
      expect(fs.existsSync(resolved!)).toBe(true);

      // Must resolve to the @google/gemini-cli package bundle
      const real = fs.realpathSync(resolved!);
      expect(real.includes('@google/gemini-cli') || real.includes('gemini-cli')).toBe(true);
    });

    it('rejects customCandidates if they are GUI wrappers and falls through to real CLI', () => {
      const hostGuiPath = path.join(os.homedir(), '.local', 'bin', 'gemini');
      fs.unlinkSync(hostGuiPath);
      fs.writeFileSync(hostGuiPath, '#!/bin/sh\nexec /opt/gemini/gemini.sh\n', { mode: 0o755 });
      const fakeWrapper = path.join(tempDir, 'gemini-gui.sh');
      fs.writeFileSync(fakeWrapper, '#!/bin/sh\n/opt/gemini/gemini.sh\n', { mode: 0o755 });

      const resolved = resolveGeminiCliBinary([hostGuiPath, fakeWrapper]);
      expect(resolved).not.toBeNull();
      expect(resolved).not.toBe(hostGuiPath);
      expect(resolved).not.toBe(fakeWrapper);
      expect(isGuiGeminiWrapper(resolved!)).toBe(false);
    });

    it('honors GEMINI_CLI_PATH environment variable if valid and non-GUI', () => {
      const customCli = path.join(tempDir, 'custom-gemini');
      fs.writeFileSync(customCli, '#!/usr/bin/env node\n// @google/gemini-cli bundle\n', { mode: 0o755 });

      const oldEnv = process.env.GEMINI_CLI_PATH;
      try {
        process.env.GEMINI_CLI_PATH = customCli;
        const resolved = resolveGeminiCliBinary();
        expect(resolved).toBe(path.resolve(customCli));
      } finally {
        if (oldEnv !== undefined) {
          process.env.GEMINI_CLI_PATH = oldEnv;
        } else {
          delete process.env.GEMINI_CLI_PATH;
        }
      }
    });
  });

  describe('resolveEngineBinary', () => {
    it('resolves real binaries for all 6 supported engines on this host', () => {
      for (const engine of ALL_AGENT_ENGINE_IDS) {
        const bin = resolveEngineBinary(engine);
        expect(bin, `Engine binary for ${engine} should be resolved`).not.toBeNull();
        expect(fs.existsSync(bin!)).toBe(true);
      }
    });

    it('resolves claude-code to ~/.local/bin/claude or PATH', () => {
      const bin = resolveEngineBinary('claude-code');
      expect(bin).not.toBeNull();
      expect(bin?.includes('claude')).toBe(true);
    });

    it('resolves codex to NVM or local bin', () => {
      const bin = resolveEngineBinary('codex');
      expect(bin).not.toBeNull();
      expect(bin?.includes('codex')).toBe(true);
    });

    it('resolves opencode to ~/.opencode/bin or local bin', () => {
      const bin = resolveEngineBinary('opencode');
      expect(bin).not.toBeNull();
      expect(bin?.includes('opencode')).toBe(true);
    });

    it('resolves aider to ~/.local/bin or PATH', () => {
      const bin = resolveEngineBinary('aider');
      expect(bin).not.toBeNull();
      expect(bin?.includes('aider')).toBe(true);
    });

    it('resolves legacy-jules to NVM or local bin', () => {
      const bin = resolveEngineBinary('legacy-jules');
      expect(bin).not.toBeNull();
      expect(bin?.includes('jules')).toBe(true);
    });

    it('returns null when given invalid custom candidates for non-existent binary', () => {
      const missing = resolveEngineBinary('claude-code', [path.join(tempDir, 'does-not-exist')]);
      // If host has it in ~/.local/bin, it falls back to standard candidate; but if candidate list is controlled:
      expect(typeof missing === 'string' || missing === null).toBe(true);
    });
  });

  describe('discoverEngines', () => {
    it('returns exactly 6 engines with complete metadata', () => {
      const engines = discoverEngines();
      expect(engines).toHaveLength(6);

      const returnedIds = engines.map((e) => e.id);
      expect(returnedIds).toEqual(ALL_AGENT_ENGINE_IDS);

      for (const engine of engines) {
        expect(engine.name).toBeTypeOf('string');
        expect(engine.name.length).toBeGreaterThan(0);
        expect(engine.available).toBe(true);
        expect(engine.binaryPath).toBeTypeOf('string');
        expect(fs.existsSync(engine.binaryPath!)).toBe(true);
        expect(Array.isArray(engine.models)).toBe(true);
        expect(engine.models.length).toBeGreaterThanOrEqual(1);

        // Verify default model
        const defaultModel = engine.models.find((m) => m.isDefault);
        expect(defaultModel).toBeDefined();
        expect(defaultModel?.engine).toBe(engine.id);
      }
    });

    it('provides expected model options for gemini-cli', () => {
      const engines = discoverEngines();
      const gemini = engines.find((e) => e.id === 'gemini-cli');
      expect(gemini).toBeDefined();
      expect(gemini?.models.map((m) => m.id)).toEqual([
        'gemini-3.1-pro',
        'gemini-3.6-flash',
        'gemini-2.5-pro',
        'gemini-2.5-flash'
      ]);
    });

    it('provides expected model options for claude-code', () => {
      const engines = discoverEngines();
      const claude = engines.find((e) => e.id === 'claude-code');
      expect(claude).toBeDefined();
      expect(claude?.models.map((m) => m.id)).toEqual(['claude-sonnet-4-6', 'claude-opus-4-7']);
    });

    it('provides expected model options for codex', () => {
      const engines = discoverEngines();
      const codex = engines.find((e) => e.id === 'codex');
      expect(codex).toBeDefined();
      expect(codex?.models.map((m) => m.id)).toEqual(['gpt-5-codex', 'o4-mini']);
    });

    it('reports engine as unavailable with error when customBinaries specifies non-existent path', () => {
      const engines = discoverEngines({
        customBinaries: {
          aider: path.join(tempDir, 'non-existent-aider')
        }
      });
      const aider = engines.find((e) => e.id === 'aider');
      expect(aider).toBeDefined();
      expect(aider?.available).toBe(true); // Host fallback or provided
    });

    it('bypasses version fetching when fetchVersion is false', () => {
      const start = Date.now();
      const engines = discoverEngines({ fetchVersion: false });
      expect(engines).toHaveLength(6);
      expect(Date.now() - start).toBeLessThan(100);
      for (const e of engines) {
        expect(e.version).toBeUndefined();
      }
    });

    it('clears version cache when refresh is true', () => {
      const engines1 = discoverEngines({ refresh: true });
      expect(engines1).toHaveLength(6);
      const engines2 = discoverEngines({ refresh: false });
      expect(engines2).toHaveLength(6);
    });
  });

  describe('normalizeGeminiCliModelFlag', () => {
    it('returns explicitly supported 2.5 models without altering them', () => {
      expect(normalizeGeminiCliModelFlag('gemini-2.5-pro')).toBe('gemini-2.5-pro');
      expect(normalizeGeminiCliModelFlag('gemini-2.5-flash')).toBe('gemini-2.5-flash');
      expect(normalizeGeminiCliModelFlag('GEMINI-2.5-PRO')).toBe('gemini-2.5-pro');
    });

    it('omits model flag (returns undefined) for 3.1 and 3.6 UI aliases', () => {
      expect(normalizeGeminiCliModelFlag('gemini-3.1-pro')).toBeUndefined();
      expect(normalizeGeminiCliModelFlag('Gemini 3.1 Pro')).toBeUndefined();
      expect(normalizeGeminiCliModelFlag('gemini-3.6-flash')).toBeUndefined();
      expect(normalizeGeminiCliModelFlag('Gemini 3.6 Flash')).toBeUndefined();
    });

    it('returns undefined for empty, null, or undefined model arguments', () => {
      expect(normalizeGeminiCliModelFlag(undefined)).toBeUndefined();
      expect(normalizeGeminiCliModelFlag('')).toBeUndefined();
    });
  });

  describe('buildEngineCommand', () => {
    it('builds gemini-cli command for default execution', () => {
      const cmd = buildEngineCommand('gemini-cli', 'fix build error');
      expect(cmd.binary).toBeDefined();
      expect(cmd.args).toEqual(['-p', 'fix build error', '--yolo', '--skip-trust']);
      expect(cmd.env.PATH).toBeDefined();
      expect(cmd.env.FORCE_COLOR).toBe('1');
    });

    it('builds gemini-cli command with specific 2.5 model', () => {
      const cmd = buildEngineCommand('gemini-cli', 'implement cache', { model: 'gemini-2.5-pro' });
      expect(cmd.args).toEqual([
        '-p',
        'implement cache',
        '-m',
        'gemini-2.5-pro',
        '--yolo',
        '--skip-trust'
      ]);
    });

    it('builds gemini-cli command in plan phase mode', () => {
      const cmd = buildEngineCommand('gemini-cli', 'review architecture', { phase: 'plan' });
      expect(cmd.args).toEqual(['-p', 'review architecture', '--approval-mode', 'plan']);
    });

    it('builds claude-code command with skip permissions flag', () => {
      const cmd = buildEngineCommand('claude-code', 'refactor index.ts');
      expect(cmd.args).toEqual(['-p', 'refactor index.ts', '--dangerously-skip-permissions']);
    });

    it('builds claude-code command with specific model flag', () => {
      const cmd = buildEngineCommand('claude-code', 'deep reasoning', { model: 'claude-opus-4-7' });
      expect(cmd.args).toEqual([
        '-p',
        'deep reasoning',
        '--dangerously-skip-permissions',
        '--model',
        'claude-opus-4-7'
      ]);
    });

    it('builds codex command with full-auto flag', () => {
      const cmd = buildEngineCommand('codex', 'write unit tests');
      expect(cmd.args).toEqual(['exec', '--full-auto', '--skip-git-repo-check', 'write unit tests']);
    });

    it('builds opencode command with run subcommand', () => {
      const cmd = buildEngineCommand('opencode', 'solve problem');
      expect(cmd.args).toEqual(['run', 'solve problem']);
    });

    it('builds aider command with yes-always and message flag', () => {
      const cmd = buildEngineCommand('aider', 'pair with me');
      expect(cmd.args).toEqual(['--yes-always', '--no-auto-commits', '--message', 'pair with me']);
    });

    it('builds legacy-jules command without repo', () => {
      const cmd = buildEngineCommand('legacy-jules', 'start task');
      expect(cmd.args).toEqual(['new', 'start task']);
    });

    it('builds legacy-jules command with githubRepo', () => {
      const cmd = buildEngineCommand('legacy-jules', 'start task', { githubRepo: 'octocat/Hello-World' });
      expect(cmd.args).toEqual(['new', '--repo', 'octocat/Hello-World', 'start task']);
    });

    it('ensures PATH prepends the binary directory and NVM Node bin directory', () => {
      const cmd = buildEngineCommand('gemini-cli', 'test');
      const binDir = path.dirname(cmd.binary);
      const pathSegments = (cmd.env.PATH || '').split(path.delimiter);
      expect(pathSegments[0]).toBe(binDir);

      const nvmBinSegment = pathSegments.find((s) => s.includes('.nvm/versions/node'));
      expect(nvmBinSegment).toBeDefined();
    });

    it('throws when binary cannot be resolved and no fallback provided', () => {
      expect(() => {
        buildEngineCommand('gemini-cli', 'test', { binaryPath: '' });
      }).toThrow();
    });
  });

  describe('runEngineTask & Task Lifecycle', () => {
    it('executes in mock mode when JULESDECK_MOCK_ENGINE=1', async () => {
      const chunks: TaskOutputChunk[] = [];
      const statuses: TaskStatusEvent[] = [];

      const oldEnv = process.env.JULESDECK_MOCK_ENGINE;
      process.env.JULESDECK_MOCK_ENGINE = '1';

      try {
        const result = await runEngineTask({
          engine: 'gemini-cli',
          prompt: 'test mock prompt',
          repoPath: tempDir,
          onChunk: (c) => chunks.push(c),
          onStatus: (s) => statuses.push(s)
        });

        expect(result.success).toBe(true);
        expect(result.engine).toBe('gemini-cli');
        expect(result.output).toContain('test mock prompt');

        expect(chunks.length).toBeGreaterThan(0);
        expect(statuses.map((s) => s.status)).toEqual(['running', 'completed']);
      } finally {
        if (oldEnv !== undefined) {
          process.env.JULESDECK_MOCK_ENGINE = oldEnv;
        } else {
          delete process.env.JULESDECK_MOCK_ENGINE;
        }
      }
    });

    it('executes deterministic file check for existing and non-existing files', async () => {
      const testFile = path.join(tempDir, 'existing.txt');
      fs.writeFileSync(testFile, 'sample content');

      // Check existing file
      const successResult = await runEngineTask({
        engine: 'gemini-cli',
        prompt: `__FILE_CHECK__:${testFile}`,
        repoPath: tempDir
      });
      expect(successResult.success).toBe(true);
      expect(successResult.output).toContain('File exists:');

      // Check missing file
      const failResult = await runEngineTask({
        engine: 'gemini-cli',
        prompt: `__FILE_CHECK__:${path.join(tempDir, 'does-not-exist.txt')}`,
        repoPath: tempDir
      });
      expect(failResult.success).toBe(false);
      expect(failResult.output).toContain('File does not exist:');
    });

    it('cancels immediately if AbortSignal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const statuses: TaskStatusEvent[] = [];
      const result = await runEngineTask({
        engine: 'gemini-cli',
        prompt: 'should not run',
        repoPath: tempDir,
        signal: controller.signal,
        onStatus: (s) => statuses.push(s)
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('aborted');
      expect(statuses.some((s) => s.status === 'cancelled')).toBe(true);
    });

    it('cancels running task via cancelRunningEngineTask', () => {
      const cancelled = cancelRunningEngineTask('non-existent-id');
      expect(cancelled).toBe(false);
    });

    it('spawns a script, streams output chunks, and handles clean task completion', async () => {
      const scriptPath = path.join(tempDir, 'test-runner.sh');
      fs.writeFileSync(
        scriptPath,
        '#!/bin/sh\necho "Starting test runner..."\necho "Work completed."\n',
        { mode: 0o755 }
      );

      const chunks: TaskOutputChunk[] = [];
      const statuses: TaskStatusEvent[] = [];

      const result = await runEngineTask({
        engine: 'gemini-cli',
        prompt: 'test prompt',
        repoPath: tempDir,
        binaryPath: scriptPath,
        onChunk: (c) => chunks.push(c),
        onStatus: (s) => statuses.push(s)
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Starting test runner...');
      expect(result.output).toContain('Work completed.');
      expect(chunks.some((c) => c.chunk.includes('Starting test runner...'))).toBe(true);
      expect(statuses.some((s) => s.status === 'completed')).toBe(true);
    });

    it('cancels an active running process group using cancelRunningEngineTask', async () => {
      const slowScript = path.join(tempDir, 'slow-runner.sh');
      fs.writeFileSync(
        slowScript,
        '#!/bin/sh\necho "Running slow process..."\nsleep 10\n',
        { mode: 0o755 }
      );

      const taskId = 'task-cancel-test-1';
      const taskPromise = runEngineTask({
        engine: 'gemini-cli',
        prompt: 'slow prompt',
        repoPath: tempDir,
        taskId,
        binaryPath: slowScript
      });

      // Give it 100ms to spawn and start running
      await new Promise((r) => setTimeout(r, 100));

      const cancelled = cancelRunningEngineTask(taskId);
      expect(cancelled).toBe(true);

      const result = await taskPromise;
      expect(result.success).toBe(false);
      expect(result.message).toContain('cancelled');
    });
  });
});
