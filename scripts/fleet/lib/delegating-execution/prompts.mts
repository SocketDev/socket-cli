// Codified phase prompts for the delegating-execution cycle. Pure builders —
// the workflow JS carries a byte-mirrored copy of the key sentences (it cannot
// import TS); this file is the source of truth.

import type { TierSensitivity } from './types.mts'

export interface ExecutePromptOptions {
  readonly planDocPath: string
  readonly task: string
}

export interface FollowupPromptOptions {
  readonly findings: string
  readonly planDocPath: string
  readonly task: string
}

export interface PlanPromptOptions {
  readonly sensitivity: TierSensitivity
  readonly task: string
}

export interface ReviewPromptOptions {
  readonly planDocPath: string
  readonly sensitivity: TierSensitivity
  readonly task: string
}

export function executePrompt(config: ExecutePromptOptions): string {
  const cfg: ExecutePromptOptions = {
    __proto__: null,
    ...config,
  } as ExecutePromptOptions
  return [
    `Task: ${cfg.task}`,
    '',
    `Read the plan at ${cfg.planDocPath} and follow the plan verbatim.`,
    '',
    'Execution rules:',
    '- Work in a git worktree off the default branch — never the primary checkout.',
    '- Commit surgically as you go (Conventional Commits, no AI attribution).',
    '- Run pnpm run fix then pnpm run check from the repo root before finishing.',
    '- Record any deviation from the plan with a one-line reason in your output.',
    '- A deviation must be minimal; the plan is the contract.',
  ].join('\n')
}

export function followupPrompt(config: FollowupPromptOptions): string {
  const cfg: FollowupPromptOptions = {
    __proto__: null,
    ...config,
  } as FollowupPromptOptions
  return [
    `Task: ${cfg.task}`,
    '',
    `Plan doc: ${cfg.planDocPath}`,
    '',
    'Apply every finding listed below. Never offer "fix vs accept-as-gap" — pick the fix.',
    '',
    'After applying all findings:',
    '- Run pnpm run fix then pnpm run check from the repo root.',
    '- Commit surgically (Conventional Commits, no AI attribution).',
    '- Report anything that resisted with a reason.',
    '',
    'Findings:',
    cfg.findings,
  ].join('\n')
}

export function planPrompt(config: PlanPromptOptions): string {
  const cfg: PlanPromptOptions = {
    __proto__: null,
    ...config,
  } as PlanPromptOptions
  return [
    `Task: ${cfg.task}`,
    `Sensitivity: ${cfg.sensitivity}`,
    '',
    'Write a numbered plan for this task.',
    '',
    'Requirements for the plan:',
    '- Each numbered step names the exact files and rules it touches.',
    '- Settle all final names up front — cascaded names must not churn across commits.',
    '- Write the plan to .claude/plans/delegating-<slug>.md (slug = kebab-case from the task).',
    '- Include a fenced execution prompt a floor model can run verbatim.',
    '- do not edit source files — the plan is the only output of this phase.',
    '',
    'The execution prompt must be self-contained: the floor model reads it cold with no',
    'prior context. Include the plan doc path, the task summary, and all hard rules.',
  ].join('\n')
}

export function reviewPrompt(config: ReviewPromptOptions): string {
  const cfg: ReviewPromptOptions = {
    __proto__: null,
    ...config,
  } as ReviewPromptOptions
  return [
    `Task: ${cfg.task}`,
    `Sensitivity: ${cfg.sensitivity}`,
    '',
    `Diff the landed result against the plan at ${cfg.planDocPath}.`,
    '',
    'Review rules:',
    '- Every finding needs: severity (critical/high/medium/low), file:line, and a concrete fix.',
    '- Subagent output counts and file lists are leads, not facts — grep/read before relaying.',
    '- Verdict "approve" only when every numbered step in the plan is satisfied.',
    '- append your findings and verdict to the plan doc.',
    '',
    'severity scale: critical = blocks merge; high = must fix before merge;',
    'medium = should fix; low = nice-to-have.',
  ].join('\n')
}
