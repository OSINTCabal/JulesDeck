import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execSync, spawn } from 'node:child_process';
import {
  detectGitInfo,
  getGitReviewDetails,
  getGitStructuredStatus,
  getGitFileDiff,
  getJulesBinaryPath,
  executeListJulesSessions,
  executeApplyJulesSession
} from '../src/main/ipc.js';

describe('Local & Git Execution Specialist Verification Suite', () => {
  const runId = crypto.randomUUID().slice(0, 8);
  const nongitDir = path.join(os.tmpdir(), `test-local-nongit-${runId}`);
  const gitDir = path.join(os.tmpdir(), `test-local-git-repo-${runId}`);
  const emptyRepoDir = path.join(os.tmpdir(), `test-unborn-empty-git-repo-${runId}`);
  const julesBin = getJulesBinaryPath();

  beforeAll(() => {
    // 1. Setup local non-git directory
    fs.mkdirSync(nongitDir, { recursive: true });
    fs.writeFileSync(path.join(nongitDir, 'index.js'), 'console.log("hello");');
    fs.writeFileSync(path.join(nongitDir, 'utils.js'), 'module.exports = {};');
    fs.writeFileSync(path.join(nongitDir, 'README.md'), '# Test Nongit');

    // 2. Setup local git repository
    fs.rmSync(gitDir, { recursive: true, force: true });
    fs.mkdirSync(gitDir, { recursive: true });
    execSync('git init -b main', { cwd: gitDir });
    execSync('git config user.name "Test Dev"', { cwd: gitDir });
    execSync('git config user.email "testdev@example.com"', { cwd: gitDir });
    execSync('git remote add origin https://github.com/OSINTCabal/VibeDeck.git', { cwd: gitDir });
    fs.writeFileSync(path.join(gitDir, 'README.md'), '# VibeDeck Local Test Repo');
    fs.writeFileSync(path.join(gitDir, 'app.js'), 'console.log("app");');
    execSync('git add . && git commit -m "feat: initial commit"', { cwd: gitDir });

    execSync('git checkout -b feature/auth-refresh', { cwd: gitDir });
    fs.writeFileSync(path.join(gitDir, 'config.json'), '{"port": 8080}');
    execSync('git add . && git commit -m "chore: add config"', { cwd: gitDir });

    // Working directory modifications
    fs.appendFileSync(path.join(gitDir, 'app.js'), '\nconsole.log("modified");');
    fs.writeFileSync(path.join(gitDir, 'scratch.txt'), 'notes');
    fs.writeFileSync(path.join(gitDir, 'staged.js'), 'staged');
    execSync('git add staged.js', { cwd: gitDir });
  });

  afterAll(() => {
    // Clean up temporary files
    try {
      fs.rmSync(nongitDir, { recursive: true, force: true });
      fs.rmSync(gitDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('correctly reports null for non-git directories in detectGitInfo and getGitReviewDetails', () => {
    expect(detectGitInfo(nongitDir)).toBeNull();
    expect(getGitReviewDetails(nongitDir)).toBeNull();
  });

  it('accurately detects branch, remote repo, and commit in real local git repo', () => {
    const gitInfo = detectGitInfo(gitDir);
    expect(gitInfo).not.toBeNull();
    expect(gitInfo?.name).toBe(path.basename(gitDir));
    expect(gitInfo?.branch).toBe('feature/auth-refresh');
    expect(gitInfo?.githubRepo).toBe('OSINTCabal/VibeDeck');
    expect(gitInfo?.lastCommit).toBe('chore: add config');
  });

  it('accurately parses uncommitted status and recent commits in getGitReviewDetails', () => {
    const details = getGitReviewDetails(gitDir);
    expect(details).not.toBeNull();
    expect(details?.branch).toBe('feature/auth-refresh');
    expect(details?.githubRepo).toBe('OSINTCabal/VibeDeck');
    expect(details?.hasChanges).toBe(true);
    expect(details?.statusText).toContain('M app.js');
    expect(details?.statusText).toContain('A  staged.js');
    expect(details?.statusText).toContain('?? scratch.txt');
    expect(details?.recentCommits.length).toBeGreaterThanOrEqual(2);
    expect(details?.recentCommits[0]?.message).toBe('chore: add config');
  });

  it.skipIf(process.env.JULESDECK_LIVE_CLI_TESTS !== '1')('demonstrates Jules CLI behavior when --repo is omitted vs provided', async () => {
    // Run without --repo
    const withoutRepo = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
      const child = spawn(julesBin, ['new', 'unit test prompt'], {
        cwd: nongitDir,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('close', (code) => resolve({ code, stderr }));
    });

    // Jules CLI exits 0 even on error, writing to stderr
    expect(withoutRepo.code).toBe(0);
    expect(withoutRepo.stderr).toContain('No --repo flag provided and the current working directory is not a git repository');

    // Run with --repo flag on non-git directory
    const withRepo = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(julesBin, ['new', '--repo', 'nonexistent-test-owner/nonexistent-test-repo-123456', 'test prompt'], {
        cwd: nongitDir,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      const timer = setTimeout(() => {
        child.kill();
        resolve({ code: -1, stdout, stderr: 'timeout' });
      }, 15000);
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });

    expect(withRepo.stdout + withRepo.stderr).toMatch(/Error|not connected to Jules|failed/i);
  }, 35000);

  it.skipIf(process.env.JULESDECK_LIVE_CLI_TESTS !== '1')('executes list sessions and parses real remote sessions', () => {
    const sessions = executeListJulesSessions(gitDir, true);
    expect(Array.isArray(sessions)).toBe(true);
    if (sessions.length > 0) {
      expect(sessions[0]?.id).toBeDefined();
    }
  }, 30000);

  it.skipIf(process.env.JULESDECK_LIVE_CLI_TESTS !== '1')('handles apply session gracefully when remote VM has no diff or session is missing', () => {
    const result = executeApplyJulesSession(gitDir, '2149237505879567081');
    expect(result).toBeDefined();
    expect(typeof result.output).toBe('string');
  }, 35000);

  describe('Newly Initialized Empty Git Repositories (0 Commits, Unborn Branch)', () => {
    beforeAll(() => {
      fs.rmSync(emptyRepoDir, { recursive: true, force: true });
      fs.mkdirSync(emptyRepoDir, { recursive: true });
      execSync('git init -b feature/fresh-unborn-init', { cwd: emptyRepoDir });
    });

    afterAll(() => {
      try {
        fs.rmSync(emptyRepoDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    it('accurately identifies unborn branch name and handles absence of commits without errors', () => {
      const gitInfo = detectGitInfo(emptyRepoDir);
      expect(gitInfo).not.toBeNull();
      expect(gitInfo?.name).toBe(path.basename(emptyRepoDir));
      expect(gitInfo?.branch).toBe('feature/fresh-unborn-init');
      expect(gitInfo?.lastCommit).toBeUndefined();
      expect(gitInfo?.githubRepo).toBeUndefined();
    });

    it('returns empty recentCommits array and zero total changes for clean unborn repo', () => {
      const review = getGitReviewDetails(emptyRepoDir);
      expect(review).not.toBeNull();
      expect(review?.branch).toBe('feature/fresh-unborn-init');
      expect(review?.recentCommits).toEqual([]);
      expect(review?.hasChanges).toBe(false);
      expect(review?.statusText).toBe('');

      const structured = getGitStructuredStatus(emptyRepoDir);
      expect(structured).not.toBeNull();
      expect(structured?.branch).toBe('feature/fresh-unborn-init');
      expect(structured?.isDetached).toBe(false);
      expect(structured?.totalChanges).toBe(0);
      expect(structured?.staged).toEqual([]);
      expect(structured?.unstaged).toEqual([]);
      expect(structured?.untracked).toEqual([]);
      expect(structured?.conflicts).toEqual([]);
    });

    it('detects untracked file creation in unborn repo and generates diff against /dev/null', () => {
      const filePath = path.join(emptyRepoDir, 'initial.txt');
      fs.writeFileSync(filePath, 'first line in unborn repo\nsecond line\n');

      const structured = getGitStructuredStatus(emptyRepoDir);
      expect(structured?.totalChanges).toBe(1);
      expect(structured?.untracked.length).toBe(1);
      expect(structured?.untracked[0]?.path).toBe('initial.txt');
      expect(structured?.untracked[0]?.status).toBe('untracked');

      const review = getGitReviewDetails(emptyRepoDir);
      expect(review?.hasChanges).toBe(true);

      // Diff on untracked file in unborn repo
      const diffResult = getGitFileDiff(emptyRepoDir, 'initial.txt', false);
      expect(diffResult.filePath).toBe('initial.txt');
      expect(diffResult.isStaged).toBe(false);
      expect(diffResult.diff).toContain('--- /dev/null');
      expect(diffResult.diff).toContain('+++ b/initial.txt');
      expect(diffResult.diff).toContain('+first line in unborn repo');
    });

    it('detects staged file and generates diff on unborn branch without throwing', () => {
      execSync('git add initial.txt', { cwd: emptyRepoDir });

      const structured = getGitStructuredStatus(emptyRepoDir);
      expect(structured?.totalChanges).toBe(1);
      expect(structured?.staged.length).toBe(1);
      expect(structured?.staged[0]?.path).toBe('initial.txt');
      expect(structured?.staged[0]?.status).toBe('staged');

      // Staged diff on unborn branch
      const diffResult = getGitFileDiff(emptyRepoDir, 'initial.txt', true);
      expect(diffResult.filePath).toBe('initial.txt');
      expect(diffResult.isStaged).toBe(true);
      expect(diffResult.diff).toContain('diff --git');
      expect(diffResult.diff).toContain('initial.txt');
      expect(diffResult.diff).toContain('+first line in unborn repo');
    });
  });

  describe('Git Diff Viewing: Newly Added Untracked vs Modified vs Staged Files', () => {
    it('generates distinct diff structures for worktree modifications, staged changes, and untracked files', () => {
      // 1. Modified worktree file
      const modDiff = getGitFileDiff(gitDir, 'app.js', false);
      expect(modDiff.filePath).toBe('app.js');
      expect(modDiff.isStaged).toBe(false);
      expect(modDiff.diff).toContain('diff --git a/app.js b/app.js');
      expect(modDiff.diff).toContain('+console.log("modified");');

      // 2. Untracked file (via /dev/null diff)
      const untrackedDiff = getGitFileDiff(gitDir, 'scratch.txt', false);
      expect(untrackedDiff.filePath).toBe('scratch.txt');
      expect(untrackedDiff.isStaged).toBe(false);
      expect(untrackedDiff.diff).toContain('--- /dev/null');
      expect(untrackedDiff.diff).toContain('+++ b/scratch.txt');
      expect(untrackedDiff.diff).toContain('+notes');

      // 3. Staged file (via --cached)
      const stagedDiff = getGitFileDiff(gitDir, 'staged.js', true);
      expect(stagedDiff.filePath).toBe('staged.js');
      expect(stagedDiff.isStaged).toBe(true);
      expect(stagedDiff.diff).toContain('diff --git a/staged.js b/staged.js');
      expect(stagedDiff.diff).toContain('+staged');
    });

    it('rejects path traversal attempts outside repository root boundary', () => {
      const maliciousDiff = getGitFileDiff(gitDir, '../../../../etc/passwd', false);
      expect(maliciousDiff.diff).toBe('(File path outside repository boundary)');
    });

    it('reports no differences detected when clean file is diffed', () => {
      const cleanDiff = getGitFileDiff(gitDir, 'config.json', false);
      expect(cleanDiff.diff).toBe('(No differences detected)');
    });
  });
});
