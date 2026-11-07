/**
 * Jules Local — Plan Card Lifecycle Engine
 * ---------------------------------------------------------------------------
 * Implements pure state management for the 4-step execution lifecycle of
 * Jules Local tasks, matching Google Jules Web App (`jules.google.com`).
 */

export const PLAN_STEP_LABELS = [
  'Analyze codebase structure and dependencies',
  'Plan code modifications and edge case validation',
  'Execute changes in local repository',
  'Run test suite and verify working tree'
] as const;

export const PLAN_EXPECTED_OUTPUT_CHARS = 1200;
export const DEFAULT_PLAN_LABEL = 'Give me a plan';

export type PlanStepState = 'pending' | 'running' | 'completed' | 'failed';

export interface PlanState {
  prompt: string;
  states: PlanStepState[];
  outputChars: number;
  approved: boolean;
  statusText?: string;
}

export function createInitialPlan(prompt: string): PlanState {
  return {
    prompt,
    states: PLAN_STEP_LABELS.map(() => 'pending' as PlanStepState),
    outputChars: 0,
    approved: false
  };
}

export function updatePlanProgressFromOutput(plan: PlanState, addedChars: number): void {
  if (!plan.approved) return;
  plan.outputChars += Math.max(0, addedChars);
  const fraction = Math.min(1, plan.outputChars / PLAN_EXPECTED_OUTPUT_CHARS);
  const activeIndex = Math.min(PLAN_STEP_LABELS.length - 1, Math.floor(fraction * PLAN_STEP_LABELS.length));
  for (let i = 0; i < PLAN_STEP_LABELS.length; i++) {
    const state = plan.states[i];
    if (i < activeIndex) {
      if (state !== 'completed') plan.states[i] = 'completed';
    } else if (i === activeIndex) {
      if (state !== 'running' && state !== 'completed') plan.states[i] = 'running';
    } else if (state !== 'pending') {
      plan.states[i] = 'pending';
    }
  }
}

export function completePlanSteps(plan: PlanState): void {
  for (let i = 0; i < PLAN_STEP_LABELS.length; i++) {
    if (plan.states[i] !== 'completed') plan.states[i] = 'completed';
  }
}

export function failPlanSteps(plan: PlanState): void {
  const runningIndex = plan.states.findIndex((state) => state === 'running');
  if (runningIndex >= 0) {
    plan.states[runningIndex] = 'failed';
  }
}

export interface ExecutePlanContext {
  localRepoPath?: string;
  openLocalRepo: () => Promise<{ success: boolean; path?: string }>;
  invokeTask: (prompt: string, options: { model: string; repoPath: string }) => Promise<void>;
  model?: string;
  onApproveStart?: () => void;
  onApproveReject?: () => void;
  onApplyLocalMode?: () => void;
}

export async function executeApprovedPlan(
  plan: PlanState,
  ctx: ExecutePlanContext
): Promise<boolean> {
  if (plan.approved) return false;
  plan.approved = true;
  plan.outputChars = 0;

  ctx.onApproveStart?.();

  let repoPath = ctx.localRepoPath;
  if (!repoPath) {
    const res = await ctx.openLocalRepo();
    if (!res?.success || !res.path) {
      ctx.onApproveReject?.();
      plan.approved = false;
      return false;
    }
    repoPath = res.path;
    ctx.onApplyLocalMode?.();
  }

  plan.states[0] = 'running';
  const model = ctx.model || 'Gemini 3.1 Pro';
  await ctx.invokeTask(plan.prompt, { model, repoPath });
  return true;
}
