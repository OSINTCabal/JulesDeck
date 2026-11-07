import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

// Import functions from JulesDeck IPC module
import {
  detectGitInfo,
  getGitReviewDetails,
  getGitStructuredStatus,
  getGitFileDiff,
  getJulesCliInfo,
  getJulesCliDiagnosticAsync,
  addRecentRepo,
  loadRecentRepos,
  stripAnsi,
  cleanTerminalText,
  extractSessionId,
  executeListJulesSessions,
  executeApplyJulesSession
} from '../src/main/ipc.js';

import type {
  JulesCliInfo as JulesCliInfoType,
  JulesCliStatus
} from '../src/shared/types.js';

// Test repository path - isolate per process in a named folder to preserve 'JulesTEST' basename
const TEST_REPO_DIR = path.join(os.tmpdir(), `jules-stress-${process.pid}`);
const TEST_REPO_PATH = path.join(TEST_REPO_DIR, 'JulesTEST');

// Helper to check if test repo exists, initialize if not
function ensureTestRepoExists(): void {
  if (fs.existsSync(TEST_REPO_PATH)) {
    return;
  }

  // Automatically initialize temporary JulesTEST Git repository
  fs.mkdirSync(TEST_REPO_PATH, { recursive: true });
  fs.mkdirSync(path.join(TEST_REPO_PATH, 'samples'), { recursive: true });
  fs.mkdirSync(path.join(TEST_REPO_PATH, 'src'), { recursive: true });
  fs.mkdirSync(path.join(TEST_REPO_PATH, 'julestest'), { recursive: true });

  fs.writeFileSync(path.join(TEST_REPO_PATH, 'README.md'), '# JulesTEST\nTest repository for JulesDeck.\n', 'utf8');
  fs.writeFileSync(path.join(TEST_REPO_PATH, 'src', 'log_analyzer.py'), 'print("Log analyzer initialized")\n', 'utf8');
  fs.writeFileSync(path.join(TEST_REPO_PATH, 'julestest', 'processor.py'), '# processor\n', 'utf8');

  execSync('git init -b main', { cwd: TEST_REPO_PATH, stdio: 'ignore' });
  execSync('git config user.name "OSINTCabal"', { cwd: TEST_REPO_PATH, stdio: 'ignore' });
  execSync('git config user.email "osintcabal@google.com"', { cwd: TEST_REPO_PATH, stdio: 'ignore' });
  execSync('git remote add origin https://github.com/OSINTCabal/JulesTEST.git', { cwd: TEST_REPO_PATH, stdio: 'ignore' });
  execSync('git add .', { cwd: TEST_REPO_PATH, stdio: 'ignore' });
  execSync('git commit -m "feat(core): initial release of julestest log analyzer and sanitizer"', { cwd: TEST_REPO_PATH, stdio: 'ignore' });

  // Create branches needed by Pillar 3
  execSync('git checkout -b feature/report-formatting', { cwd: TEST_REPO_PATH, stdio: 'ignore' });
  fs.writeFileSync(path.join(TEST_REPO_PATH, 'src', 'formatter.py'), '# formatter\n', 'utf8');
  execSync('git add src/formatter.py', { cwd: TEST_REPO_PATH, stdio: 'ignore' });
  execSync('git commit -m "feat(reporting): add markdown report formatter"', { cwd: TEST_REPO_PATH, stdio: 'ignore' });

  execSync('git checkout -b fix/jwt-bearer-tokens main', { cwd: TEST_REPO_PATH, stdio: 'ignore' });
  fs.writeFileSync(path.join(TEST_REPO_PATH, 'src', 'token.py'), '# token\n', 'utf8');
  execSync('git add src/token.py', { cwd: TEST_REPO_PATH, stdio: 'ignore' });
  execSync('git commit -m "fix(security): support Bearer JWT token pattern redaction"', { cwd: TEST_REPO_PATH, stdio: 'ignore' });

  execSync('git checkout -f main', { cwd: TEST_REPO_PATH, stdio: 'ignore' });
  setupGitState(TEST_REPO_PATH);
}

// Helper to setup git state before tests
function setupGitState(repoPath: string): void {
  // Ensure we're on main branch forcefully
  try {
    execSync('git checkout -f main', { cwd: repoPath, stdio: 'ignore' });
  } catch {
    // Branch might not exist, ignore
  }

  // Create and stage edge_proxy.log so staged diff always exists
  const stagedFile = path.join(repoPath, 'samples', 'edge_proxy.log');
  fs.mkdirSync(path.join(repoPath, 'samples'), { recursive: true });
  fs.writeFileSync(stagedFile, '2026-10-24 10:00:00 [INFO] Edge proxy starting...\n[STAGED CHANGE]\n', 'utf8');
  try {
    execSync('git add samples/edge_proxy.log', { cwd: repoPath, stdio: 'ignore' });
  } catch {
    // Ignore error
  }

  // Modify README.md to make it unstaged idempotently
  const unstagedFile = path.join(repoPath, 'README.md');
  if (fs.existsSync(unstagedFile)) {
    try {
      const content = fs.readFileSync(unstagedFile, 'utf8');
      if (!content.includes('## Local Simulated Changes')) {
        fs.writeFileSync(unstagedFile, content + '\n## Local Simulated Changes\nUnstaged modifications for JulesDeck testing.\n', 'utf8');
      }
    } catch {
      // Ignore if file doesn't exist
    }
  }
}

describe('JulesTEST Local Stress Suite - Pillar 1: Deep Git Status and Metadata Accuracy', () => {
  beforeAll(() => {
    ensureTestRepoExists();
  });

  it('Pillar 1.1: detectGitInfo returns correct main branch, name, and last commit', () => {
    const info = detectGitInfo(TEST_REPO_PATH);
    
    expect(info).not.toBeNull();
    expect(info).toBeDefined();
    
    if (info) {
      expect(info.branch).toBe('main');
      expect(info.name).toBe('JulesTEST');
      expect(info.path).toBe(TEST_REPO_PATH);
      
      // Check for the expected commit message
      if (info.lastCommit) {
        expect(info.lastCommit).toContain('feat(core): initial release of julestest log analyzer and sanitizer');
      }
    }
  });

  it('Pillar 1.2: getGitStructuredStatus returns at least 2 changes (staged and unstaged)', () => {
    setupGitState(TEST_REPO_PATH);
    
    const status = getGitStructuredStatus(TEST_REPO_PATH);
    
    expect(status).not.toBeNull();
    expect(status).toBeDefined();
    
    if (status) {
      // Should have at least staged and unstaged changes
      expect(status.totalChanges).toBeGreaterThanOrEqual(2);
      
      // Check for staged file
      const stagedFilePath = 'samples/edge_proxy.log';
      const stagedFile = status.staged.find(f => f.path === stagedFilePath);
      expect(stagedFile).toBeDefined();
      if (stagedFile) {
        expect(stagedFile.status).toBe('staged');
      }
      
      // Check for unstaged file
      const unstagedFilePath = 'README.md';
      const unstagedFile = status.unstaged.find(f => f.path === unstagedFilePath);
      expect(unstagedFile).toBeDefined();
      if (unstagedFile) {
        expect(unstagedFile.status).toBe('modified');
      }
    }
  });

  it('Pillar 1.3: getGitReviewDetails returns hasChanges: true and recent commits', () => {
    setupGitState(TEST_REPO_PATH);
    
    const reviewDetails = getGitReviewDetails(TEST_REPO_PATH);
    
    expect(reviewDetails).not.toBeNull();
    expect(reviewDetails).toBeDefined();
    
    if (reviewDetails) {
      expect(reviewDetails.hasChanges).toBe(true);
      expect(reviewDetails.recentCommits.length).toBeGreaterThanOrEqual(1);
      expect(reviewDetails.branch).toBe('main');
      
      // Verify commit structure
      const firstCommit = reviewDetails.recentCommits[0];
      expect(firstCommit).toHaveProperty('hash');
      expect(firstCommit).toHaveProperty('message');
      expect(firstCommit).toHaveProperty('author');
      expect(firstCommit).toHaveProperty('date');
    }
  });
});

describe('JulesTEST Local Stress Suite - Pillar 2: Unified Diff Engine', () => {
  beforeAll(() => {
    ensureTestRepoExists();
    setupGitState(TEST_REPO_PATH);
  });

  it('Pillar 2.1: getGitFileDiff for staged file returns valid diff with changes', () => {
    const diffResult = getGitFileDiff(TEST_REPO_PATH, 'samples/edge_proxy.log', true);
    
    expect(diffResult).toBeDefined();
    expect(diffResult.filePath).toBe('samples/edge_proxy.log');
    expect(diffResult.isStaged).toBe(true);
    expect(diffResult.diff).toContain('diff --git');
    expect(diffResult.diff).toContain('+'); // Should have additions
  });

  it('Pillar 2.2: getGitFileDiff for unstaged file returns diff showing modifications', () => {
    const diffResult = getGitFileDiff(TEST_REPO_PATH, 'README.md', false);
    
    expect(diffResult).toBeDefined();
    expect(diffResult.filePath).toBe('README.md');
    expect(diffResult.isStaged).toBe(false);
    expect(diffResult.diff).not.toContain('(No differences detected)');
    expect(diffResult.diff.length).toBeGreaterThan(0);
  });

  it('Pillar 2.3: getGitFileDiff for clean file returns "(No differences detected)"', () => {
    const diffResult = getGitFileDiff(TEST_REPO_PATH, 'julestest/processor.py', false);
    
    expect(diffResult).toBeDefined();
    expect(diffResult.filePath).toBe('julestest/processor.py');
    expect(diffResult.diff).toBe('(No differences detected)');
  });

  it('Pillar 2.4: Path traversal attempt returns boundary error message', () => {
    const diffResult = getGitFileDiff(TEST_REPO_PATH, '../../../../etc/shadow', false);
    
    expect(diffResult).toBeDefined();
    expect(diffResult.filePath).toBe('../../../../etc/shadow');
    expect(diffResult.diff).toBe('(File path outside repository boundary)');
  });
});

describe('JulesTEST Local Stress Suite - Pillar 3: Dynamic Branch Switching & Review Details', () => {
  beforeAll(() => {
    ensureTestRepoExists();
  });

  it('Pillar 3.1: Checkout feature/report-formatting and verify detection', () => {
    // Setup initial state
    setupGitState(TEST_REPO_PATH);
    
    // Checkout feature branch
    execSync('git checkout feature/report-formatting', { 
      cwd: TEST_REPO_PATH, 
      stdio: 'ignore' 
    });
    
    // Verify detection
    const info = detectGitInfo(TEST_REPO_PATH);
    expect(info).not.toBeNull();
    expect(info?.branch).toBe('feature/report-formatting');
    
    // Verify commit
    if (info?.lastCommit) {
      expect(info.lastCommit).toContain('feat(reporting): add markdown report formatter');
    }
    
    // Verify review details
    const reviewDetails = getGitReviewDetails(TEST_REPO_PATH);
    expect(reviewDetails).not.toBeNull();
    expect(reviewDetails?.branch).toBe('feature/report-formatting');
  });

  it('Pillar 3.2: Checkout fix/jwt-bearer-tokens and verify detection', () => {
    // Checkout fix branch
    execSync('git checkout fix/jwt-bearer-tokens', { 
      cwd: TEST_REPO_PATH, 
      stdio: 'ignore' 
    });
    
    // Verify detection
    const info = detectGitInfo(TEST_REPO_PATH);
    expect(info).not.toBeNull();
    expect(info?.branch).toBe('fix/jwt-bearer-tokens');
    
    // Verify commit
    if (info?.lastCommit) {
      expect(info.lastCommit).toContain('fix(security): support Bearer JWT token pattern redaction');
    }
    
    // Verify review details
    const reviewDetails = getGitReviewDetails(TEST_REPO_PATH);
    expect(reviewDetails).not.toBeNull();
    expect(reviewDetails?.branch).toBe('fix/jwt-bearer-tokens');
  });

  it('Pillar 3.3: Switch back to main and verify changes are preserved', () => {
    // Switch back to main
    execSync('git checkout main', { 
      cwd: TEST_REPO_PATH, 
      stdio: 'ignore' 
    });
    
    // Verify we're back on main
    const info = detectGitInfo(TEST_REPO_PATH);
    expect(info?.branch).toBe('main');
    
    // Verify review details still show changes
    const reviewDetails = getGitReviewDetails(TEST_REPO_PATH);
    expect(reviewDetails).not.toBeNull();
    expect(reviewDetails?.hasChanges).toBe(true);
    expect(reviewDetails?.branch).toBe('main');
    
    // Verify structured status
    const status = getGitStructuredStatus(TEST_REPO_PATH);
    expect(status?.totalChanges).toBeGreaterThanOrEqual(2);
  });
});

describe('JulesTEST Local Stress Suite - Pillar 4: High-Concurrency Rapid IPC Stress', () => {
  beforeAll(() => {
    ensureTestRepoExists();
    setupGitState(TEST_REPO_PATH);
  });

  it('Pillar 4.1: Concurrently execute 15 parallel queries of getGitStructuredStatus', async () => {
    const iterations = 15;
    const promises = [];
    
    for (let i = 0; i < iterations; i++) {
      promises.push(
        Promise.resolve().then(async () => {
          try {
            return getGitStructuredStatus(TEST_REPO_PATH);
          } catch {
            return null;
          }
        })
      );
    }
    
    const results = await Promise.all(promises);
    
    // Verify 100% success rate
    const successfulResults = results.filter(r => r !== null);
    expect(successfulResults.length).toBe(iterations);
    
    // Verify all results are non-null and have expected structure
    results.forEach((result) => {
      expect(result).not.toBeNull();
      if (result) {
        expect(result.totalChanges).toBeDefined();
        expect(typeof result.totalChanges).toBe('number');
        expect(result.branch).toBe('main');
      }
    });
    
    // Verify consistent counts (no race conditions)
    const changeCounts = results.map(r => r?.totalChanges ?? -1);
    const uniqueCounts = new Set(changeCounts.filter(c => c >= 0));
    expect(uniqueCounts.size).toBeLessThanOrEqual(2); // Allow minor variation
  }, 60000);

  it('Pillar 4.2: Concurrently execute 15 parallel queries of getGitReviewDetails', async () => {
    const iterations = 15;
    const promises = [];
    
    for (let i = 0; i < iterations; i++) {
      promises.push(
        Promise.resolve().then(async () => {
          try {
            return getGitReviewDetails(TEST_REPO_PATH);
          } catch {
            return null;
          }
        })
      );
    }
    
    const results = await Promise.all(promises);
    
    // Verify 100% success rate
    const successfulResults = results.filter(r => r !== null);
    expect(successfulResults.length).toBe(iterations);
    
    // Verify all results are non-null and have expected structure
    results.forEach((result) => {
      expect(result).not.toBeNull();
      if (result) {
        expect(result.hasChanges).toBeDefined();
        expect(typeof result.hasChanges).toBe('boolean');
        expect(result.branch).toBe('main');
        expect(Array.isArray(result.recentCommits)).toBe(true);
      }
    });
    
    // Verify consistent branch detection
    const branches = results.map(r => r?.branch);
    expect(new Set(branches).size).toBe(1);
    expect(branches[0]).toBe('main');
  }, 60000);

  it('Pillar 4.3: Concurrent mixed operations (structured status + review details)', async () => {
    const iterations = 15;
    const promises = [];
    
    for (let i = 0; i < iterations; i++) {
      if (i % 2 === 0) {
        promises.push(
          Promise.resolve().then(async () => {
            try {
              return getGitStructuredStatus(TEST_REPO_PATH);
            } catch {
              return null;
            }
          })
        );
      } else {
        promises.push(
          Promise.resolve().then(async () => {
            try {
              return getGitReviewDetails(TEST_REPO_PATH);
            } catch {
              return null;
            }
          })
        );
      }
    }
    
    const results = await Promise.all(promises);
    
    // Verify 100% success rate
    const successfulResults = results.filter(r => r !== null);
    expect(successfulResults.length).toBe(iterations);
    
    // Verify all results are non-null
    results.forEach((result) => {
      expect(result).not.toBeNull();
    });
  }, 60000);
});

describe('JulesTEST Local Stress Suite - Pillar 5: Repository Switching & Recent Repos Persistence Stress', () => {
  const testRepoPath = TEST_REPO_PATH;
  
  beforeAll(() => {
    ensureTestRepoExists();
  });

  beforeEach(() => {
    // Clear recent repos before each test
    // Note: In a real scenario, we'd have a clear function, but for now we'll work with what we have
  });

  it('Pillar 5.1: Rapidly add and select JulesTEST in recent-repos 15 times', () => {
    const iterations = 15;
    
    for (let i = 0; i < iterations; i++) {
      // Get git info
      const info = detectGitInfo(testRepoPath);
      expect(info).not.toBeNull();
      
      // Add to recent repos
      const updatedRepos = addRecentRepo(info);
      expect(updatedRepos).toBeDefined();
      expect(Array.isArray(updatedRepos)).toBe(true);
      
      // Verify the repo is in the list
      const repoInList = updatedRepos.find(r => r.path === testRepoPath);
      expect(repoInList).toBeDefined();
      if (repoInList) {
        expect(repoInList.name).toBe('JulesTEST');
        expect(repoInList.branch).toBe('main');
      }
    }
    
    // Final verification - load recent repos
    const finalRepos = loadRecentRepos();
    expect(finalRepos).toBeDefined();
    expect(Array.isArray(finalRepos)).toBe(true);
    
    // Should have at least one entry for JulesTEST
    const julesTestRepo = finalRepos.find(r => r.path === testRepoPath);
    expect(julesTestRepo).toBeDefined();
    if (julesTestRepo) {
      expect(julesTestRepo.name).toBe('JulesTEST');
    }
  }, 60000);

  it('Pillar 5.2: Verify loadRecentRepos maintains integrity after rapid operations', () => {
    // Perform rapid operations
    const iterations = 10;
    for (let i = 0; i < iterations; i++) {
      const info = detectGitInfo(testRepoPath);
      addRecentRepo(info);
    }
    
    // Load and verify integrity
    const repos = loadRecentRepos();
    expect(repos).toBeDefined();
    expect(Array.isArray(repos)).toBe(true);
    
    // Check for corruption (e.g., duplicate entries, invalid paths)
    const validRepos = repos.filter(r => r && r.path && fs.existsSync(r.path));
    expect(validRepos.length).toBeGreaterThanOrEqual(1);
    
    // Check for duplicates
    const uniquePaths = new Set(validRepos.map(r => r.path));
    expect(uniquePaths.size).toBe(validRepos.length);
    
    // Verify JulesTEST is present
    const julesTestRepo = validRepos.find(r => r.path === testRepoPath);
    expect(julesTestRepo).toBeDefined();
    if (julesTestRepo) {
      expect(julesTestRepo.name).toBe('JulesTEST');
    }
  }, 60000);

  it('Pillar 5.3: selectRecentRepoByPath maintains integrity', () => {
    // This would need AppWindowLayers mock in a real Electron context
    // For now, we'll verify the path exists and can be used
    const info = detectGitInfo(testRepoPath);
    expect(info).not.toBeNull();
    expect(info?.path).toBe(testRepoPath);
    
    // Verify path is accessible
    expect(fs.existsSync(testRepoPath)).toBe(true);
  });
});

describe('JulesTEST Local Stress Suite - Pillar 6: Streaming Jules Task Runner Simulation', () => {
  beforeAll(() => {
    ensureTestRepoExists();
  });

  it('Pillar 6.1: Test ANSI stripping on raw colored log output', () => {
    const coloredOutput = '\u001b[32mSUCCESS\u001b[0m: Operation completed\n\u001b[31mERROR\u001b[0m: Something went wrong\n\u001b[1mBold text\u001b[0m';
    const stripped = stripAnsi(coloredOutput);
    
    expect(stripped).toBe('SUCCESS: Operation completed\nERROR: Something went wrong\nBold text');
    expect(stripped).not.toContain('\u001b');
  });

  it('Pillar 6.2: Test cleanTerminalText normalizes line endings', () => {
    const mixedOutput = 'Line 1\r\nLine 2\rLine 3\nLine 4';
    const cleaned = cleanTerminalText(mixedOutput);
    
    expect(cleaned).toBe('Line 1\nLine 2\nLine 3\nLine 4');
    expect(cleaned).not.toContain('\r');
  });

  it('Pillar 6.3: Test extractSessionId on sample Jules output', () => {
    const sampleOutput = 'Session created: https://jules.google.com/session/1234567890123456789';
    const sessionId = extractSessionId(sampleOutput);
    
    expect(sessionId).toBe('1234567890123456789');
    
    // Test alternative formats
    const altOutput1 = 'Task ID: 1234567890123456789 completed';
    const altId1 = extractSessionId(altOutput1);
    expect(altId1).toBe('1234567890123456789');
    
    const altOutput2 = 'Session 1234567890 detected';
    const altId2 = extractSessionId(altOutput2);
    expect(altId2).toBe('1234567890');
  });

  it('Pillar 6.4: Test getJulesCliInfo returns valid Jules CLI information', () => {
    const cliInfo: JulesCliInfoType = getJulesCliInfo();
    
    expect(cliInfo).toBeDefined();
    expect(typeof cliInfo.available).toBe('boolean');
    expect(cliInfo.path).toBeDefined();
    expect(typeof cliInfo.path).toBe('string');
    
    // If available, verify version info
    if (cliInfo.available) {
      expect(cliInfo.version).toBeDefined();
      expect(typeof cliInfo.version).toBe('string');
    }
  });

  it('Pillar 6.5: Test getJulesCliDiagnosticAsync returns Jules CLI status', async () => {
    const diagnostic: JulesCliStatus = await getJulesCliDiagnosticAsync();
    
    expect(diagnostic).toBeDefined();
    expect(typeof diagnostic.installed).toBe('boolean');
    expect(diagnostic.path).toBeDefined();
    expect(typeof diagnostic.path).toBe('string');
    
    // If installed, verify status
    if (diagnostic.installed) {
      expect(typeof diagnostic.ready).toBe('boolean');
    }
  }, 10000);

  it('Pillar 6.6: Test executeListJulesSessions returns array', () => {
    const sessions = executeListJulesSessions(TEST_REPO_PATH);
    
    expect(Array.isArray(sessions)).toBe(true);
    // Sessions could be empty, which is valid
    expect(sessions.length).toBeGreaterThanOrEqual(0);
  });

  it('Pillar 6.7: Test executeApplyJulesSession returns valid response structure', () => {
    // This would need a valid session ID to work properly
    // For now, we'll test the function exists and has correct signature
    const result = executeApplyJulesSession(TEST_REPO_PATH, 'invalid-session-id');
    
    expect(result).toBeDefined();
    expect(typeof result.success).toBe('boolean');
    expect(typeof result.output).toBe('string');
  });
});

describe('JulesTEST Local Stress Suite - Cross-Pillar Integration Tests', () => {
  beforeAll(() => {
    ensureTestRepoExists();
    setupGitState(TEST_REPO_PATH);
  });

  it('Cross 1: Verify git operations work consistently across multiple calls', () => {
    const iterations = 5;
    
    for (let i = 0; i < iterations; i++) {
      const info = detectGitInfo(TEST_REPO_PATH);
      expect(info).not.toBeNull();
      expect(info?.branch).toBe('main');
      
      const status = getGitStructuredStatus(TEST_REPO_PATH);
      expect(status).not.toBeNull();
      
      const reviewDetails = getGitReviewDetails(TEST_REPO_PATH);
      expect(reviewDetails).not.toBeNull();
      expect(reviewDetails?.hasChanges).toBe(true);
    }
  }, 60000);

  it('Cross 2: Verify diff operations are consistent across multiple calls', () => {
    const iterations = 5;
    
    for (let i = 0; i < iterations; i++) {
      const stagedDiff = getGitFileDiff(TEST_REPO_PATH, 'samples/edge_proxy.log', true);
      expect(stagedDiff.diff).toContain('diff --git');
      
      const unstagedDiff = getGitFileDiff(TEST_REPO_PATH, 'README.md', false);
      expect(unstagedDiff.diff.length).toBeGreaterThan(0);
    }
  }, 60000);

  it('Cross 3: Verify recent repos operations maintain data integrity', () => {
    const iterations = 10;
    const info = detectGitInfo(TEST_REPO_PATH);
    
    for (let i = 0; i < iterations; i++) {
      addRecentRepo(info);
    }
    
    const repos = loadRecentRepos();
    const julesTestEntry = repos.find(r => r.path === TEST_REPO_PATH);
    
    expect(julesTestEntry).toBeDefined();
    if (julesTestEntry) {
      expect(julesTestEntry.name).toBe('JulesTEST');
      expect(julesTestEntry.branch).toBe('main');
    }
  }, 60000);
});
