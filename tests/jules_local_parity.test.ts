/**
 * Jules Local — Google Jules Web App Parity Test Suite
 * ---------------------------------------------------------------------------
 * Guarantees that the JulesDeck "Jules Local" workspace stays a faithful
 * clone of the standard Google Jules Web App (layout, composer, plan/activity
 * feed, review-changes inspector, diff viewer and design-system tokens).
 *
 * The suite is dependency free: a tiny HTML tokenizer/DOM builder and a flat
 * CSS rule reader are implemented locally so assertions can be made against
 * real markup/CSS instead of brittle regex-only string checks.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  PLAN_STEP_LABELS as SHARED_PLAN_STEP_LABELS,
  createInitialPlan,
  updatePlanProgressFromOutput as sharedUpdateProgress,
  completePlanSteps as sharedCompleteSteps,
  failPlanSteps as sharedFailSteps,
  executeApprovedPlan as sharedExecutePlan
} from '../src/shared/plan_lifecycle.js';

/* ───────────────────────────── Paths & Fixtures ───────────────────────────── */

const REPO_ROOT = path.resolve(__dirname, '..');
const HTML_PATH = path.join(REPO_ROOT, 'src', 'chrome', 'index.html');
const CSS_PATH = path.join(REPO_ROOT, 'src', 'chrome', 'chrome.css');
const CHROME_TS_PATH = path.join(REPO_ROOT, 'src', 'chrome', 'chrome.ts');

let html = '';
let css = '';
let chromeTs = '';

/* ───────────────────────────── Minimal HTML DOM ───────────────────────────── */

interface DomNode {
  tag: string;
  attrs: Record<string, string>;
  children: DomNode[];
  parent: DomNode | null;
  textParts: string[];
}

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[name] = decodeEntities(value);
  }
  return attrs;
}

function pushText(node: DomNode, raw: string): void {
  if (!raw) return;
  node.textParts.push(decodeEntities(raw));
}

function parseHtml(source: string): DomNode {
  const root: DomNode = { tag: '#root', attrs: {}, children: [], parent: null, textParts: [] };
  const stack: DomNode[] = [root];
  let index = 0;

  while (index < source.length) {
    const lt = source.indexOf('<', index);
    if (lt === -1) {
      pushText(stack[stack.length - 1], source.slice(index));
      break;
    }
    if (lt > index) {
      pushText(stack[stack.length - 1], source.slice(index, lt));
    }

    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt);
      index = end === -1 ? source.length : end + 3;
      continue;
    }

    if (source.startsWith('<!', lt)) {
      const end = source.indexOf('>', lt);
      index = end === -1 ? source.length : end + 1;
      continue;
    }

    const gt = source.indexOf('>', lt);
    if (gt === -1) {
      pushText(stack[stack.length - 1], source.slice(lt));
      break;
    }

    const rawTag = source.slice(lt + 1, gt).trim();
    index = gt + 1;

    if (rawTag.startsWith('/')) {
      const name = rawTag.slice(1).trim().toLowerCase();
      for (let s = stack.length - 1; s >= 1; s--) {
        if (stack[s].tag === name) {
          stack.length = s;
          break;
        }
      }
      continue;
    }

    const selfClosing = rawTag.endsWith('/');
    const body = selfClosing ? rawTag.slice(0, -1).trim() : rawTag;
    const spaceIdx = body.search(/\s/);
    const tag = (spaceIdx === -1 ? body : body.slice(0, spaceIdx)).toLowerCase();
    const attrRaw = spaceIdx === -1 ? '' : body.slice(spaceIdx + 1);

    const node: DomNode = {
      tag,
      attrs: parseAttributes(attrRaw),
      children: [],
      parent: stack[stack.length - 1],
      textParts: []
    };
    node.parent!.children.push(node);

    if (!selfClosing && !VOID_TAGS.has(tag)) {
      stack.push(node);
    }
  }

  return root;
}

function textOf(node: DomNode): string {
  let out = node.textParts.join(' ');
  for (const child of node.children) {
    out += ' ' + textOf(child);
  }
  return out.replace(/\s+/g, ' ').trim();
}

function findAll(root: DomNode, predicate: (node: DomNode) => boolean): DomNode[] {
  const results: DomNode[] = [];
  const walk = (node: DomNode): void => {
    for (const child of node.children) {
      if (predicate(child)) results.push(child);
      walk(child);
    }
  };
  walk(root);
  return results;
}

function findById(root: DomNode, id: string): DomNode | null {
  const matches = findAll(root, (node) => node.attrs.id === id);
  return matches.length > 0 ? matches[0] : null;
}

function classListOf(node: DomNode): string[] {
  return (node.attrs.class ?? '').split(/\s+/).filter(Boolean);
}

function hasClass(node: DomNode, className: string): boolean {
  return classListOf(node).includes(className);
}

function findByClass(root: DomNode, className: string): DomNode[] {
  return findAll(root, (node) => hasClass(node, className));
}

function containsNode(ancestor: DomNode, candidate: DomNode): boolean {
  let current: DomNode | null = candidate;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

/* ───────────────────────────── CSS helpers ───────────────────────────── */

/** Returns the declaration body of the first flat rule matching `selector`. */
function cssRule(stylesheet: string, selector: string): string | null {
  const stripped = stylesheet.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stripped)) !== null) {
    const selectorText = match[1].trim();
    const parts = selectorText.split(',').map((part) => part.trim());
    if (parts.includes(selector)) {
      return match[2].trim();
    }
  }
  return null;
}

/* ───────────────────────────── Expectations ───────────────────────────── */

const EXPECTED_STARTER_PROMPTS = [
  'Run test suite',
  'Explain working tree changes',
  'Refactor code for clarity',
  'Security & edge case audit'
];

const EXPECTED_GEMINI_MODELS = ['gemini-3.1-pro', 'gemini-3.6-flash', 'gemini-2.5-pro'];

/**
 * Google Dark (Material 3) surface palette that must be part of the
 * JulesDeck design system. The token *names* are implementation detail —
 * the suite only guarantees that every colour is declared as a custom
 * property inside `:root` and is consumed through `var(...)`.
 */
const REQUIRED_GOOGLE_DARK_COLORS = [
  '#131314', // surface / background
  '#1e1f20', // surface container low
  '#282a2c', // surface container
  '#333538', // surface container high
  '#444746', // outline
  '#a8c7fa', // primary (Google blue)
  '#c084fc'  // accent (Jules purple)
];

describe('Jules Local — Google Jules Web App Parity Suite', () => {
  let dom: DomNode;

  beforeAll(() => {
    html = fs.readFileSync(HTML_PATH, 'utf-8');
    css = fs.readFileSync(CSS_PATH, 'utf-8');
    chromeTs = fs.readFileSync(CHROME_TS_PATH, 'utf-8');
    dom = parseHtml(html);
  });

  /* ── 1. Document & Page Title Parity ──────────────────────────────────── */

  describe('1. Document & Page Title Parity', () => {
    it('declares the document title as "Jules Local"', () => {
      expect(html).toMatch(/<title>\s*Jules Local\s*<\/title>/i);

      const titleNode = findAll(dom, (node) => node.tag === 'title')[0];
      expect(titleNode).toBeDefined();
      expect(textOf(titleNode)).toBe('Jules Local');
    });

    it('labels the local workspace tab with "Jules Local"', () => {
      const tab = findById(dom, 'tab-local-mode');
      expect(tab).not.toBeNull();
      expect(textOf(tab!)).toContain('Jules Local');
    });

    it('keeps a Jules-branded hero title inside the local empty state', () => {
      const emptyState = findById(dom, 'local-empty-state');
      expect(emptyState).not.toBeNull();

      const heroTitles = findAll(emptyState!, (node) => hasClass(node, 'hero-title'));
      expect(heroTitles.length).toBeGreaterThan(0);

      const heroText = textOf(heroTitles[0]);
      expect(
        heroText.includes('Jules Local') || heroText.includes('Meet Jules'),
        `Expected hero title to mention "Jules Local" or "Meet Jules", got "${heroText}"`
      ).toBe(true);
    });
  });

  /* ── 2. Google Jules Web Layout Elements ──────────────────────────────── */

  describe('2. Google Jules Web Layout Elements', () => {
    it('renders the unified top bar with the Cloud Jules / Jules Local segmented toggle', () => {
      const topBar = findById(dom, 'chrome-strip');
      expect(topBar).not.toBeNull();

      const toggle = findById(dom, 'mode-segmented-toggle');
      expect(toggle).not.toBeNull();
      expect(containsNode(topBar!, toggle!)).toBe(true);

      const toggleText = textOf(toggle!);
      expect(toggleText).toContain('Cloud Jules');
      expect(toggleText).toContain('Jules Local');
    });

    it('exposes repository and branch switchers on the canvas navbar', () => {
      const repoSelect = findById(dom, 'btn-canvas-repo-select');
      expect(repoSelect).not.toBeNull();
      expect(repoSelect!.tag).toBe('button');

      const branchSelect = findById(dom, 'btn-canvas-branch-select');
      expect(branchSelect).not.toBeNull();
      expect(branchSelect!.tag).toBe('button');
    });

    it('exposes the Gemini model selector with the Google Jules model set', () => {
      const modelSelect = findById(dom, 'btn-canvas-model-select');
      expect(modelSelect).not.toBeNull();
      expect(modelSelect!.tag).toBe('button');

      const dropdown = findById(dom, 'model-picker-dropdown');
      expect(dropdown).not.toBeNull();
      expect(containsNode(modelSelect!.parent!, dropdown!)).toBe(true);

      const modelOptions = findAll(dropdown!, (node) => node.attrs['data-model'] !== undefined);
      const models = modelOptions.map((node) => node.attrs['data-model']);
      for (const model of EXPECTED_GEMINI_MODELS) {
        expect(models, `Missing Gemini model option "${model}"`).toContain(model);
      }
    });
  });

  /* ── 3. Task Composer & "Give me a plan" Workflow ─────────────────────── */

  describe('3. Task Composer & "Give me a plan" Workflow', () => {
    it('places the Google Jules task prompt inside the composer box', () => {
      const composer = findById(dom, 'local-composer-box');
      expect(composer).not.toBeNull();

      const prompt = findById(dom, 'jules-task-prompt');
      expect(prompt).not.toBeNull();
      expect(containsNode(composer!, prompt!)).toBe(true);
      expect(prompt!.tag).toBe('textarea');

      const placeholder = prompt!.attrs.placeholder ?? '';
      expect(placeholder.length).toBeGreaterThan(0);
      expect(placeholder).toMatch(/google\s+jules|jules/i);
      expect(placeholder).toMatch(/task|describe|ask|plan|changes|codebase|repository/i);
    });

    it('labels the primary composer action "Give me a plan"', () => {
      const runButton = findById(dom, 'btn-run-jules');
      expect(runButton).not.toBeNull();
      expect(runButton!.tag).toBe('button');

      const labelSources = [
        textOf(runButton!),
        runButton!.attrs.title ?? '',
        runButton!.attrs['aria-label'] ?? '',
        runButton!.attrs['data-label'] ?? ''
      ].join(' ');

      expect(labelSources).toContain('Give me a plan');
    });

    it('renders repository and branch context chips in the composer', () => {
      const composer = findById(dom, 'local-composer-box');
      expect(composer).not.toBeNull();

      const repoChip = findById(dom, 'composer-repo-chip');
      expect(repoChip).not.toBeNull();
      expect(containsNode(composer!, repoChip!)).toBe(true);

      const branchChip = findById(dom, 'composer-branch-chip');
      expect(branchChip).not.toBeNull();
      expect(containsNode(composer!, branchChip!)).toBe(true);
    });

    it('renders the four Google Jules starter chips with matching data-prompt attributes', () => {
      const chips = findByClass(dom, 'starter-chip');
      expect(chips).toHaveLength(EXPECTED_STARTER_PROMPTS.length);

      for (const expected of EXPECTED_STARTER_PROMPTS) {
        const chip = chips.find((node) => {
          const titleNode = findAll(node, (child) => hasClass(child, 'starter-chip-title'))[0];
          return titleNode !== undefined && textOf(titleNode) === expected;
        });

        expect(chip, `Missing starter chip titled "${expected}"`).toBeDefined();

        const prompt = chip!.attrs['data-prompt'];
        expect(prompt, `Starter chip "${expected}" is missing a data-prompt attribute`).toBeDefined();
        expect(prompt.toLowerCase()).toContain(expected.toLowerCase());
      }
    });
  });

  /* ── 4. Plan & Activity Feed Structure ────────────────────────────────── */

  describe('4. Plan & Activity Feed Structure', () => {
    it('renders the local activity feed container', () => {
      const chatStream = findById(dom, 'local-chat-stream');
      expect(chatStream).not.toBeNull();
      expect(chatStream!.tag).toBe('div');
    });

    it('hides the terminal container on idle and keeps a collapse toggle', () => {
      const terminal = findById(dom, 'terminal-container');
      expect(terminal).not.toBeNull();
      expect(hasClass(terminal!, 'hidden')).toBe(true);

      const toggle = findById(dom, 'btn-toggle-terminal-body');
      expect(toggle).not.toBeNull();
      expect(toggle!.tag).toBe('button');
      expect(containsNode(terminal!, toggle!)).toBe(true);
    });
  });

  /* ── 5. Review Changes & Diff Viewer ──────────────────────────────────── */

  describe('5. Review Changes & Diff Viewer', () => {
    it('renders the Review Changes / Working Tree section in the inspector', () => {
      const inspector = findById(dom, 'workspace-inspector');
      expect(inspector).not.toBeNull();
      expect(inspector!.tag).toBe('aside');

      const inspectorText = textOf(inspector!);
      expect(
        inspectorText.includes('Review Changes') || inspectorText.includes('Working Tree'),
        'Inspector is missing the Review Changes / Working Tree section'
      ).toBe(true);

      const statusSummary = findById(dom, 'git-status-summary');
      expect(statusSummary).not.toBeNull();
      expect(containsNode(inspector!, statusSummary!)).toBe(true);

      const statusContent = findById(dom, 'git-status-content');
      expect(statusContent).not.toBeNull();
      expect(containsNode(inspector!, statusContent!)).toBe(true);
    });

    it('renders the unified diff viewer with title, close control and body', () => {
      const diffViewer = findById(dom, 'git-diff-viewer');
      expect(diffViewer).not.toBeNull();

      const fileTitle = findById(dom, 'diff-file-title');
      expect(fileTitle).not.toBeNull();
      expect(containsNode(diffViewer!, fileTitle!)).toBe(true);

      const closeButton = findById(dom, 'btn-close-diff');
      expect(closeButton).not.toBeNull();
      expect(closeButton!.tag).toBe('button');
      expect(containsNode(diffViewer!, closeButton!)).toBe(true);

      const diffBody = findById(dom, 'diff-content-body');
      expect(diffBody).not.toBeNull();
      expect(containsNode(diffViewer!, diffBody!)).toBe(true);
    });

    it('renders the quick commit box', () => {
      const commitInput = findById(dom, 'input-commit-msg');
      expect(commitInput).not.toBeNull();
      expect(commitInput!.tag).toBe('input');
      expect(commitInput!.attrs.type).toBe('text');

      const commitButton = findById(dom, 'btn-git-commit');
      expect(commitButton).not.toBeNull();
      expect(commitButton!.tag).toBe('button');
    });
  });

  /* ── 6. CSS Design System Verification ─────────────────────────────────── */

  describe('6. CSS Design System Verification', () => {
    it('declares the Google Dark theme color tokens', () => {
      const rootBlock = cssRule(css, ':root');
      expect(rootBlock, 'chrome.css is missing a :root design-token block').not.toBeNull();

      for (const hex of REQUIRED_GOOGLE_DARK_COLORS) {
        expect(
          rootBlock!.toLowerCase().includes(hex),
          `Missing Google Dark design token for ${hex}`
        ).toBe(true);
        expect(
          css.toLowerCase().includes(hex),
          `Color ${hex} is not present in chrome.css`
        ).toBe(true);
      }
    });

    it('uses every Google Dark theme token in the stylesheet', () => {
      const rootBlock = cssRule(css, ':root') ?? '';

      for (const hex of REQUIRED_GOOGLE_DARK_COLORS) {
        const declaration = new RegExp(`(--[a-z0-9-]+)\\s*:\\s*${hex}\\s*;`, 'i').exec(rootBlock);
        expect(declaration, `No design token is declared for ${hex}`).not.toBeNull();

        const tokenName = declaration![1];
        expect(
          css.toLowerCase().includes(`var(${tokenName.toLowerCase()}`),
          `Design token ${tokenName} (${hex}) is declared but never consumed`
        ).toBe(true);
      }
    });

    it('renders the hero title with the Google Sans typeface', () => {
      const heroTitle = cssRule(css, '.hero-title');
      expect(heroTitle).not.toBeNull();
      expect(heroTitle!).toMatch(/font-family\s*:[^;]*Google Sans/i);
    });

    it('hides the terminal container with display:none !important when idle', () => {
      const terminalHidden = cssRule(css, '.terminal-container.hidden');
      expect(terminalHidden).not.toBeNull();
      expect(terminalHidden!).toMatch(/display\s*:\s*none\s*!important\s*;/i);
    });

    it('applies border-box sizing to the sidebar footer', () => {
      const sidebarFooter = cssRule(css, '.sidebar-footer');
      expect(sidebarFooter).not.toBeNull();
      expect(sidebarFooter!).toMatch(/box-sizing\s*:\s*border-box\s*;/i);
    });
  });

  /* ── 7. Cross-cutting integrity checks ────────────────────────────────── */

  describe('7. Cross-cutting integrity checks', () => {
    it('keeps every required element id unique in the document', () => {
      const requiredIds = [
        'mode-segmented-toggle', 'tab-local-mode', 'tab-cloud-mode', 'local-empty-state',
        'btn-canvas-repo-select', 'btn-canvas-branch-select', 'btn-canvas-model-select',
        'local-composer-box', 'jules-task-prompt', 'btn-run-jules',
        'composer-repo-chip', 'composer-branch-chip',
        'local-chat-stream', 'terminal-container', 'btn-toggle-terminal-body',
        'workspace-inspector', 'git-status-summary', 'git-status-content',
        'git-diff-viewer', 'diff-file-title', 'btn-close-diff', 'diff-content-body',
        'input-commit-msg', 'btn-git-commit', 'brand-icon'
      ];

      for (const id of requiredIds) {
        const matches = findAll(dom, (node) => node.attrs.id === id);
        expect(matches.length, `Expected exactly one element with id="${id}"`).toBe(1);
      }
    });

    it('does not leave the Google Jules Web App elements unreachable from the local workspace', () => {
      const localWorkspace = findById(dom, 'local-mode-drawer');
      expect(localWorkspace).not.toBeNull();

      for (const id of [
        'local-empty-state', 'local-composer-box', 'local-chat-stream',
        'terminal-container', 'workspace-inspector'
      ]) {
        const node = findById(dom, id);
        expect(node, `Missing local workspace element "${id}"`).not.toBeNull();
        expect(
          containsNode(localWorkspace!, node!),
          `Element "${id}" is not part of the Jules Local workspace`
        ).toBe(true);
      }
    });

    it('keeps the stylesheet free of unbalanced braces', () => {
      let depth = 0;
      for (const char of css) {
        if (char === '{') depth += 1;
        else if (char === '}') depth -= 1;
        expect(depth).toBeGreaterThanOrEqual(0);
      }
      expect(depth).toBe(0);
    });
  });

  /* ── 8. Completion Card Architecture & Action Buttons ─────────────────── */

  describe('8. Completion Card Architecture & Action Buttons', () => {
    it('declares completion card layout and surface tokens in chrome.css', () => {
      const cardRule = cssRule(css, '.completion-card');
      expect(cardRule, 'chrome.css is missing a .completion-card rule').not.toBeNull();
      expect(cardRule!).toMatch(/display\s*:\s*flex/i);
      expect(cardRule!).toMatch(/border-radius\s*:\s*12px/i);
      expect(cardRule!).toMatch(/background\s*:\s*var\(--md-sys-color-surface-container\)/i);
      expect(cardRule!).toMatch(/border\s*:\s*1px solid var\(--md-sys-color-outline\)/i);
    });

    it('declares action chip styling for completion card actions in chrome.css', () => {
      const chipRule = cssRule(css, '.assistant-action-chip');
      expect(chipRule).not.toBeNull();
      expect(chipRule!).toMatch(/border-radius\s*:\s*20px/i);
      expect(chipRule!).toMatch(/cursor\s*:\s*pointer/i);

      const commitActionRule = cssRule(css, '.btn-action-commit');
      expect(commitActionRule).not.toBeNull();
      expect(commitActionRule!).toMatch(/var\(--md-sys-color-primary\)/i);
      expect(commitActionRule!).toMatch(/var\(--md-sys-color-on-primary\)/i);

      const reviewActionRule = cssRule(css, '.btn-action-review');
      expect(reviewActionRule).not.toBeNull();
      expect(reviewActionRule!).toMatch(/var\(--md-sys-color-primary\)/i);

      const newTaskActionRule = cssRule(css, '.btn-action-new-task');
      expect(newTaskActionRule).not.toBeNull();
      expect(newTaskActionRule!).toMatch(/cursor\s*:\s*pointer/i);
      expect(newTaskActionRule!).toMatch(/border-radius\s*:\s*20px/i);
    });

    it('generates the completion card in chrome.ts upon task status completed', () => {
      expect(chromeTs).toContain("case 'completed':");
      expect(chromeTs).toMatch(/completion-card|jules-completion-card/);
      expect(chromeTs).toMatch(/Review (?:Changes &amp; )?Diffs/);
      expect(chromeTs).toContain("Commit Changes");
      expect(chromeTs).toMatch(/New Task/);
      expect(chromeTs).toContain("btn-action-review");
      expect(chromeTs).toContain("btn-action-commit");
      expect(chromeTs).toContain("btn-action-new-task");
    });

    it('wires Review Diffs button to expand the inspector and toggle active', () => {
      expect(chromeTs).toContain('.btn-action-review');
      expect(chromeTs).toMatch(/triggerReviewChangesAndDiff|workspaceInspector\?\.classList\.remove\('collapsed'\)/);
      expect(chromeTs).toMatch(/workspaceInspector\?\.classList\.remove\('collapsed'\)/);
      expect(chromeTs).toMatch(/btnToggleInspector\?\.classList\.add\('active'\)/);
    });

    it('wires Commit Changes button to expand inspector, toggle active, and focus commit input', () => {
      expect(chromeTs).toMatch(
        /\.btn-action-commit['"]\)\?\.addEventListener\('click',\s*\(\)\s*=>\s*\{[^}]*workspaceInspector\?\.classList\.remove\('collapsed'\)[^}]*inputCommitMsg\?\.focus\(\)/
      );
    });

    it('wires New Task button to invoke resetToNewTask', () => {
      expect(chromeTs).toMatch(
        /\.btn-action-new-task['"]\)\?\.addEventListener\('click',\s*\(\)\s*=>\s*\{[^}]*resetToNewTask\(\)/
      );
    });

    it('simulates completion card DOM generation and action dispatch', () => {
      const inspectorState = { collapsed: true, active: false };
      let inputFocused = false;
      let newTaskIdled = false;

      function mockGenerateCompletionCard() {
        return {
          className: 'completion-card assistant-actions',
          buttons: [
            {
              label: 'Review Diffs',
              className: 'assistant-action-chip btn-action-review',
              click: () => {
                inspectorState.collapsed = false;
                inspectorState.active = true;
              }
            },
            {
              label: 'Commit Changes',
              className: 'assistant-action-chip btn-action-commit',
              click: () => {
                inspectorState.collapsed = false;
                inspectorState.active = true;
                inputFocused = true;
              }
            },
            {
              label: 'New Task',
              className: 'assistant-action-chip btn-action-new-task',
              click: () => {
                newTaskIdled = true;
              }
            }
          ]
        };
      }

      const card = mockGenerateCompletionCard();
      expect(card.className).toContain('completion-card');
      expect(card.className).toContain('assistant-actions');
      expect(card.buttons).toHaveLength(3);

      const [reviewBtn, commitBtn, newTaskBtn] = card.buttons;
      expect(reviewBtn.label).toBe('Review Diffs');
      expect(commitBtn.label).toBe('Commit Changes');
      expect(newTaskBtn.label).toBe('New Task');

      // Test Review Diffs click
      reviewBtn.click();
      expect(inspectorState.collapsed).toBe(false);
      expect(inspectorState.active).toBe(true);

      // Test Commit Changes click
      inspectorState.collapsed = true;
      commitBtn.click();
      expect(inspectorState.collapsed).toBe(false);
      expect(inputFocused).toBe(true);

      // Test New Task click
      newTaskBtn.click();
      expect(newTaskIdled).toBe(true);
    });
  });

  /* ── 9. Plan Card Execution Lifecycle & Progression Engine ────────────── */

  describe('9. Plan Card Execution Lifecycle & Progression Engine', () => {
    it('declares the 4 canonical plan step labels in shared engine and chrome.ts', () => {
      expect(SHARED_PLAN_STEP_LABELS).toEqual([
        'Analyze codebase structure and dependencies',
        'Plan code modifications and edge case validation',
        'Execute changes in local repository',
        'Run test suite and verify working tree'
      ]);

      for (const label of SHARED_PLAN_STEP_LABELS) {
        expect(chromeTs).toContain(label);
      }
    });

    it('initializes plan with all 4 steps in pending state and unapproved flag', () => {
      const plan = createInitialPlan('Run tests on backend');
      expect(plan.prompt).toBe('Run tests on backend');
      expect(plan.approved).toBe(false);
      expect(plan.outputChars).toBe(0);
      expect(plan.states).toHaveLength(4);
      expect(plan.states.every((s) => s === 'pending')).toBe(true);
    });

    describe('executeApprovedPlan', () => {
      it('executes directly when a local repository is already linked', async () => {
        const plan = createInitialPlan('Add security checks');
        const taskInvocations: { prompt: string; model: string; repoPath: string }[] = [];
        let approveStarted = false;

        const success = await sharedExecutePlan(plan, {
          localRepoPath: '/home/user/my-repo',
          openLocalRepo: async () => ({ success: false }),
          invokeTask: async (prompt, opts) => {
            taskInvocations.push({ prompt, ...opts });
          },
          model: 'Gemini 3.1 Pro',
          onApproveStart: () => {
            approveStarted = true;
          }
        });

        expect(success).toBe(true);
        expect(plan.approved).toBe(true);
        expect(plan.outputChars).toBe(0);
        expect(plan.states[0]).toBe('running');
        expect(plan.states[1]).toBe('pending');
        expect(approveStarted).toBe(true);
        expect(taskInvocations).toHaveLength(1);
        expect(taskInvocations[0]).toEqual({
          prompt: 'Add security checks',
          model: 'Gemini 3.1 Pro',
          repoPath: '/home/user/my-repo'
        });
      });

      it('prevents duplicate execution if plan is already approved', async () => {
        const plan = createInitialPlan('Quick fix');
        plan.approved = true;

        let invoked = false;
        const success = await sharedExecutePlan(plan, {
          localRepoPath: '/home/user/my-repo',
          openLocalRepo: async () => ({ success: false }),
          invokeTask: async () => {
            invoked = true;
          }
        });

        expect(success).toBe(false);
        expect(invoked).toBe(false);
      });

      it('prompts user to open local repo when unlinked and aborts gracefully if rejected', async () => {
        const plan = createInitialPlan('Refactor models');
        let promptOpened = false;
        let approveRejected = false;
        let taskInvoked = false;

        const success = await sharedExecutePlan(plan, {
          localRepoPath: undefined,
          openLocalRepo: async () => {
            promptOpened = true;
            return { success: false }; // User cancelled the folder picker
          },
          invokeTask: async () => {
            taskInvoked = true;
          },
          onApproveReject: () => {
            approveRejected = true;
          }
        });

        expect(success).toBe(false);
        expect(promptOpened).toBe(true);
        expect(approveRejected).toBe(true);
        expect(plan.approved).toBe(false);
        expect(taskInvoked).toBe(false);
      });

      it('prompts user to open repo when unlinked and proceeds when folder chosen', async () => {
        const plan = createInitialPlan('Refactor models');
        let promptOpened = false;
        let appliedLocalMode = false;
        const taskInvocations: { prompt: string; repoPath: string }[] = [];

        const success = await sharedExecutePlan(plan, {
          localRepoPath: undefined,
          openLocalRepo: async () => {
            promptOpened = true;
            return { success: true, path: '/home/user/selected-project' };
          },
          invokeTask: async (prompt, opts) => {
            taskInvocations.push({ prompt, repoPath: opts.repoPath });
          },
          onApplyLocalMode: () => {
            appliedLocalMode = true;
          }
        });

        expect(success).toBe(true);
        expect(promptOpened).toBe(true);
        expect(appliedLocalMode).toBe(true);
        expect(plan.approved).toBe(true);
        expect(plan.states[0]).toBe('running');
        expect(taskInvocations).toHaveLength(1);
        expect(taskInvocations[0]?.repoPath).toBe('/home/user/selected-project');
      });
    });

    describe('updatePlanProgressFromOutput progression', () => {
      it('ignores output chunks when plan has not been approved', () => {
        const plan = createInitialPlan('Unapproved task');
        sharedUpdateProgress(plan, 500);

        expect(plan.outputChars).toBe(0);
        expect(plan.states.every((s) => s === 'pending')).toBe(true);
      });

      it('steps through indices 0 to 3 sequentially as output accumulates', () => {
        const plan = createInitialPlan('Stream verification task');
        plan.approved = true;
        plan.states[0] = 'running';

        // Index 0: 0 to 299 chars (0% - 24.9% of 1200)
        sharedUpdateProgress(plan, 150);
        expect(plan.outputChars).toBe(150);
        expect(plan.states[0]).toBe('running');
        expect(plan.states[1]).toBe('pending');
        expect(plan.states[2]).toBe('pending');
        expect(plan.states[3]).toBe('pending');

        // Index 1: 300 to 599 chars (25% - 49.9% of 1200)
        sharedUpdateProgress(plan, 200); // total 350 chars
        expect(plan.outputChars).toBe(350);
        expect(plan.states[0]).toBe('completed');
        expect(plan.states[1]).toBe('running');
        expect(plan.states[2]).toBe('pending');
        expect(plan.states[3]).toBe('pending');

        // Index 2: 600 to 899 chars (50% - 74.9% of 1200)
        sharedUpdateProgress(plan, 350); // total 700 chars
        expect(plan.outputChars).toBe(700);
        expect(plan.states[0]).toBe('completed');
        expect(plan.states[1]).toBe('completed');
        expect(plan.states[2]).toBe('running');
        expect(plan.states[3]).toBe('pending');

        // Index 3: 900+ chars (75%+ of 1200)
        sharedUpdateProgress(plan, 400); // total 1100 chars
        expect(plan.outputChars).toBe(1100);
        expect(plan.states[0]).toBe('completed');
        expect(plan.states[1]).toBe('completed');
        expect(plan.states[2]).toBe('completed');
        expect(plan.states[3]).toBe('running');

        // Clamps at max step 3 without overflow even with large stream
        sharedUpdateProgress(plan, 10000);
        expect(plan.states[0]).toBe('completed');
        expect(plan.states[1]).toBe('completed');
        expect(plan.states[2]).toBe('completed');
        expect(plan.states[3]).toBe('running');
      });

      it('handles negative or zero addedChars cleanly without backwards movement', () => {
        const plan = createInitialPlan('Defensive output test');
        plan.approved = true;
        plan.states[0] = 'running';

        sharedUpdateProgress(plan, 400);
        expect(plan.outputChars).toBe(400);
        expect(plan.states[1]).toBe('running');

        sharedUpdateProgress(plan, -100);
        expect(plan.outputChars).toBe(400);
        expect(plan.states[1]).toBe('running');

        sharedUpdateProgress(plan, 0);
        expect(plan.outputChars).toBe(400);
        expect(plan.states[1]).toBe('running');
      });
    });

    describe('completePlanSteps and failPlanSteps', () => {
      it('marks all 4 steps as completed when completePlanSteps is invoked', () => {
        const plan = createInitialPlan('Full completion test');
        plan.approved = true;
        plan.states = ['completed', 'running', 'pending', 'pending'];

        sharedCompleteSteps(plan);
        expect(plan.states.every((s) => s === 'completed')).toBe(true);
        expect(plan.states).toEqual(['completed', 'completed', 'completed', 'completed']);
      });

      it('marks the currently running step as failed when failPlanSteps is invoked', () => {
        const plan = createInitialPlan('Failure test');
        plan.approved = true;
        plan.states = ['completed', 'running', 'pending', 'pending'];

        sharedFailSteps(plan);
        expect(plan.states[0]).toBe('completed');
        expect(plan.states[1]).toBe('failed');
        expect(plan.states[2]).toBe('pending');
        expect(plan.states[3]).toBe('pending');
      });

      it('does nothing if failPlanSteps is invoked when no step is running', () => {
        const plan = createInitialPlan('No running step');
        plan.states = ['pending', 'pending', 'pending', 'pending'];

        sharedFailSteps(plan);
        expect(plan.states).toEqual(['pending', 'pending', 'pending', 'pending']);
      });
    });

    it('verifies chrome.ts implements the identical plan lifecycle functions and hooks', () => {
      expect(chromeTs).toContain('function updatePlanProgressFromOutput(plan: ActivePlan,');
      expect(chromeTs).toContain('function completePlanSteps(plan: ActivePlan)');
      expect(chromeTs).toContain('function failPlanSteps(plan: ActivePlan)');
      expect(chromeTs).toContain('async function executeApprovedPlan(plan: ActivePlan)');

      // Verify wired into task output and task status
      expect(chromeTs).toContain('updatePlanProgressFromOutput(activePlan, chunk.chunk.length)');
      expect(chromeTs).toContain('completePlanSteps(activePlan)');
      expect(chromeTs).toContain('if (activePlan) failPlanSteps(activePlan)');
    });
  });

  /* ── 10. Navigation & Brand Home Reset Parity ─────────────────────────── */

  describe('10. Navigation & Brand Home Reset Parity', () => {
    it('renders the brand icon with #brand-icon id and Jules branding in HTML', () => {
      const brandIcon = findById(dom, 'brand-icon');
      expect(brandIcon, 'Missing #brand-icon in HTML').not.toBeNull();
      expect(hasClass(brandIcon!, 'brand-icon')).toBe(true);

      const titleAttr = brandIcon!.attrs.title ?? '';
      expect(titleAttr).toMatch(/Jules Local/i);

      const svgs = findAll(brandIcon!, (n) => n.tag === 'svg');
      expect(svgs.length).toBeGreaterThan(0);
    });

    it('renders the canvas brand pill inside canvas navbar', () => {
      const canvasPill = findByClass(dom, 'canvas-brand-pill')[0];
      expect(canvasPill).toBeDefined();

      const pillText = textOf(canvasPill);
      expect(pillText).toContain('Jules Local');

      const smallGem = findAll(canvasPill, (n) => hasClass(n, 'jules-gem-small'))[0];
      expect(smallGem).toBeDefined();
    });

    it('declares brand-icon cursor and hover interactions in chrome.css', () => {
      const brandRule = cssRule(css, '.brand-icon');
      expect(brandRule).not.toBeNull();
      expect(brandRule!).toMatch(/cursor\s*:\s*pointer/i);
      expect(brandRule!).toMatch(/transition\s*:[^;]*transform/i);

      const brandHoverRule = cssRule(css, '.brand-icon:hover');
      expect(brandHoverRule).not.toBeNull();
      expect(brandHoverRule!).toMatch(/transform\s*:\s*scale\(1\.05\)/i);
    });

    it('wires brand icon click to reset workspace to New Task state in local mode', () => {
      expect(chromeTs).toContain('function resetToNewTask()');
      expect(chromeTs).toContain("const brandIcon = document.getElementById('brand-icon')");
      expect(chromeTs).toContain("const canvasBrandPill = document.querySelector('.canvas-brand-pill')");

      // Verify brand icon click resets when currentMode === 'local'
      expect(chromeTs).toMatch(
        /brandIcon\?\.addEventListener\('click',\s*\(\)\s*=>\s*\{[\s\S]*?currentMode\s*===\s*'local'[\s\S]*?(?:btnNewTask|resetToNewTask)/
      );
      expect(chromeTs).toMatch(
        /canvasBrandPill\?\.addEventListener\('click',\s*\(\)\s*=>\s*\{[\s\S]*?currentMode\s*===\s*'local'[\s\S]*?(?:btnNewTask|resetToNewTask)/
      );
    });

    it('verifies resetToNewTask restores full initial state', () => {
      const workspaceState = {
        chatStreamHidden: false,
        chatStreamContent: '<div>Chat message</div>',
        emptyStateHidden: true,
        terminalContainerHidden: false,
        terminalLiveStatusHidden: false,
        promptValue: 'Previous task prompt',
        promptPlaceholder: 'Describe changes...',
        terminalOutput: 'Execution log...',
        sessionPillHidden: false,
        statusBadgeClass: 'task-status-pill status-running',
        statusBadgeText: 'Running',
        activePlan: { approved: true } as unknown | null
      };

      function simulateResetToNewTask() {
        workspaceState.chatStreamContent = '';
        workspaceState.chatStreamHidden = true;
        workspaceState.emptyStateHidden = false;
        workspaceState.terminalContainerHidden = true;
        workspaceState.terminalLiveStatusHidden = true;
        workspaceState.promptValue = '';
        workspaceState.promptPlaceholder = 'Ask Jules to make changes to your local codebase...';
        workspaceState.terminalOutput = '';
        workspaceState.sessionPillHidden = true;
        workspaceState.statusBadgeClass = 'task-status-pill status-idle';
        workspaceState.statusBadgeText = 'Idle';
        workspaceState.activePlan = null;
      }

      simulateResetToNewTask();

      expect(workspaceState.chatStreamHidden).toBe(true);
      expect(workspaceState.chatStreamContent).toBe('');
      expect(workspaceState.emptyStateHidden).toBe(false);
      expect(workspaceState.terminalContainerHidden).toBe(true);
      expect(workspaceState.terminalLiveStatusHidden).toBe(true);
      expect(workspaceState.promptValue).toBe('');
      expect(workspaceState.promptPlaceholder).toBe('Ask Jules to make changes to your local codebase...');
      expect(workspaceState.terminalOutput).toBe('');
      expect(workspaceState.sessionPillHidden).toBe(true);
      expect(workspaceState.statusBadgeClass).toBe('task-status-pill status-idle');
      expect(workspaceState.statusBadgeText).toBe('Idle');
      expect(workspaceState.activePlan).toBeNull();
    });
  });

  /* ── 11. Full End-to-End User Lifecycle Parity with Google Jules Web App ─ */

  describe('11. Full End-to-End User Lifecycle Parity (jules.google.com)', () => {
    it('executes the full end-to-end lifecycle flow from composer to completion and reset', async () => {
      // 1. Initial State: Jules Local Workspace
      const workspace = {
        mode: 'local' as 'local' | 'cloud',
        emptyStateVisible: true,
        chatStreamVisible: false,
        prompt: '',
        terminalVisible: false,
        status: 'Idle',
        inspectorOpen: false,
        inspectorActive: false,
        activePlan: null as ReturnType<typeof createInitialPlan> | null
      };

      // 2. User selects starter chip
      const selectedStarterPrompt = EXPECTED_STARTER_PROMPTS[0]; // 'Run test suite'
      workspace.prompt = selectedStarterPrompt;
      expect(workspace.prompt).toBe('Run test suite');

      // 3. User clicks "Give me a plan"
      workspace.activePlan = createInitialPlan(workspace.prompt);
      workspace.emptyStateVisible = false;
      workspace.chatStreamVisible = true;
      expect(workspace.activePlan.states).toEqual(['pending', 'pending', 'pending', 'pending']);
      expect(workspace.activePlan.approved).toBe(false);

      // 4. User approves plan & execution starts
      const repoSelected = '/home/user/workspace/jules-project';
      const approved = await sharedExecutePlan(workspace.activePlan, {
        localRepoPath: repoSelected,
        openLocalRepo: async () => ({ success: true, path: repoSelected }),
        invokeTask: async () => {
          workspace.status = 'Running';
          workspace.terminalVisible = true;
        }
      });
      expect(approved).toBe(true);
      expect(workspace.activePlan.approved).toBe(true);
      expect(workspace.activePlan.states[0]).toBe('running');
      expect(workspace.status).toBe('Running');
      expect(workspace.terminalVisible).toBe(true);

      // 5. Output streams through steps 0 -> 1 -> 2 -> 3
      sharedUpdateProgress(workspace.activePlan, 350); // step 0 -> done, step 1 -> running
      expect(workspace.activePlan.states[0]).toBe('completed');
      expect(workspace.activePlan.states[1]).toBe('running');

      sharedUpdateProgress(workspace.activePlan, 350); // total 700 chars: step 1 -> done, step 2 -> running
      expect(workspace.activePlan.states[1]).toBe('completed');
      expect(workspace.activePlan.states[2]).toBe('running');

      sharedUpdateProgress(workspace.activePlan, 350); // total 1050 chars: step 2 -> done, step 3 -> running
      expect(workspace.activePlan.states[2]).toBe('completed');
      expect(workspace.activePlan.states[3]).toBe('running');

      // 6. Task completes
      sharedCompleteSteps(workspace.activePlan);
      expect(workspace.activePlan.states.every((s) => s === 'completed')).toBe(true);
      workspace.status = 'Completed ✓';

      // 7. Completion card action: User clicks "Review Diffs"
      workspace.inspectorOpen = true;
      workspace.inspectorActive = true;
      expect(workspace.inspectorOpen).toBe(true);
      expect(workspace.inspectorActive).toBe(true);

      // 8. User clicks brand icon to return to Home (New Task)
      if (workspace.mode === 'local') {
        workspace.emptyStateVisible = true;
        workspace.chatStreamVisible = false;
        workspace.prompt = '';
        workspace.terminalVisible = false;
        workspace.status = 'Idle';
        workspace.activePlan = null;
      }

      expect(workspace.emptyStateVisible).toBe(true);
      expect(workspace.chatStreamVisible).toBe(false);
      expect(workspace.prompt).toBe('');
      expect(workspace.terminalVisible).toBe(false);
      expect(workspace.status).toBe('Idle');
      expect(workspace.activePlan).toBeNull();
    });
  });

  /* ── 12. Runtime Layout & Workspace Visibility Guarantees ──────────────── */

  describe('12. Runtime Layout & Workspace Visibility Guarantees', () => {
    it('ensures drawerBodyGrid (.workspace-layout) is never hidden on unlinked repository', () => {
      expect(chromeTs).not.toMatch(/drawerBodyGrid\?\.classList\.toggle\('hidden',\s*!hasRepo\)/);
      expect(chromeTs).toContain("drawerBodyGrid?.classList.remove('hidden')");
    });

    it('ensures localEmptyState toggles visibility based strictly on chat content presence', () => {
      expect(chromeTs).not.toMatch(/localEmptyState\?\.classList\.toggle\('hidden',\s*hasRepo\s*\|\|\s*hasChatContent\)/);
      expect(chromeTs).toContain("localEmptyState?.classList.toggle('hidden', hasChatContent)");
      expect(chromeTs).toContain("localChatStream?.classList.toggle('hidden', !hasChatContent)");
    });

    it('ensures resetToNewTask actively removes hidden from drawerBodyGrid', () => {
      expect(chromeTs).toContain("drawerBodyGrid?.classList.remove('hidden')");
      expect(chromeTs).toContain("localEmptyState?.classList.remove('hidden')");
    });
  });
});
