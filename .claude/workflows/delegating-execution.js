export const meta = {
  description:
    'Tiered delegation cycle: big-brain plan → floor execute → big-brain review → floor follow-up. Benign planning on Fable, security-sensitive planning on Opus 4.8 directly.',
  name: 'delegating-execution',
  phases: [
    {
      title: 'Plan',
      detail:
        'big-brain agent writes the numbered plan + execution prompt to .claude/plans/',
    },
    {
      title: 'Execute',
      detail: 'floor agent follows the plan verbatim in a git worktree',
    },
    {
      title: 'Review',
      detail:
        'big-brain agent diffs the result against the plan; severity + file:line findings',
    },
    {
      title: 'Follow-up',
      detail: 'floor agent applies each finding, re-runs gates, commits',
    },
  ],
  whenToUse:
    'Non-trivial build/design work where the plan is a deliverable and execution is delegable. args: { task: string, sensitivity?: "benign"|"security" (default "security" — fail-safe away from Fable refusals), mechanical?: boolean (execute/followup on the haiku/low floor when the work is provably mechanical — a cascade, a rename, applying an enumerated finding list) }.',
}

// args validation — fail LOUD (code-first-then-ai): missing task throws with
// What / Where / Saw-vs-wanted / Fix.
// Normalize args: the harness may marshal it as a JSON string (saved-workflow
// invocation) or as an object; a bare non-JSON string is the task itself.
let input = args
if (typeof input === 'string') {
  try {
    input = JSON.parse(input)
  } catch {
    input = { task: input }
  }
}
const task = input && typeof input === 'object' ? input.task : undefined
if (!task || typeof task !== 'string') {
  throw new Error(
    'delegating-execution: missing task. Where: workflow args. Saw: ' +
      JSON.stringify(args) +
      '. Wanted: { task: string, sensitivity?: "benign"|"security" }. Fix: pass args.task.',
  )
}
const sensitivity = input.sensitivity === 'benign' ? 'benign' : 'security'
// Explicit caller opt-in — no inference. When true the execute/followup phases
// run on the haiku/low floor (see MECHANICAL_ROUTE in route.mts).
const mechanical = input.mechanical === true

// Tier-table mirror — source of truth: scripts/fleet/lib/delegating-execution/route.mts
// (saved workflows cannot import repo TS at runtime; keep in lockstep).
// benign big-brain = Fable, effort undefined (adaptive-only — an effort key on a
// Fable spawn is a fable-fallback violation); security big-brain = Opus 4.8
// DIRECTLY: Fable classifiers false-positive on benign security work and the
// refusal→Opus fallback is not live yet (see fable-fallback.md).
function resolveBigBrain(sens) {
  if (sens === 'benign') {
    return { effort: undefined, model: 'claude-fable-5' }
  }
  return { effort: 'high', model: 'claude-opus-4-8' }
}
const bigBrain = resolveBigBrain(sensitivity)
// Floor executor tier. Default sonnet/medium — execution follows a written plan,
// but multi-file source edits need judgment a haiku pass lacks (escalation above
// the haiku/low floor justified; the plan bounds the reasoning). When the caller
// marks the work mechanical (a cascade, a rename, applying an enumerated finding
// list) drop to the haiku/low floor — mirror of MECHANICAL_ROUTE in
// scripts/fleet/lib/delegating-execution/route.mts.
const FLOOR = mechanical
  ? { effort: 'low', model: 'claude-haiku-4-5' }
  : { effort: 'medium', model: 'claude-sonnet-4-6' }

// JSON Schema objects for structured agent output (properties ASCII-sorted).
const EXECUTE_SCHEMA = {
  additionalProperties: false,
  properties: {
    commits: { items: { type: 'string' }, type: 'array' },
    deviations: { type: 'string' },
    outcome: {
      enum: ['blocked', 'complete', 'partial'],
      type: 'string',
    },
  },
  required: ['outcome'],
  type: 'object',
}

const FOLLOWUP_SCHEMA = {
  additionalProperties: false,
  properties: {
    commits: { items: { type: 'string' }, type: 'array' },
    outcome: {
      enum: ['blocked', 'clean', 'findings-remain'],
      type: 'string',
    },
    remaining: { type: 'string' },
  },
  required: ['outcome'],
  type: 'object',
}

const PLAN_SCHEMA = {
  additionalProperties: false,
  properties: {
    planDocPath: { type: 'string' },
    stepsCount: { type: 'number' },
    summary: { type: 'string' },
  },
  required: ['planDocPath'],
  type: 'object',
}

const REVIEW_SCHEMA = {
  additionalProperties: false,
  properties: {
    findings: {
      items: {
        additionalProperties: false,
        properties: {
          file: { type: 'string' },
          fix: { type: 'string' },
          line: { type: 'string' },
          severity: {
            enum: ['critical', 'high', 'low', 'medium'],
            type: 'string',
          },
        },
        type: 'object',
      },
      type: 'array',
    },
    verdict: {
      enum: ['approve', 'revise'],
      type: 'string',
    },
  },
  required: ['verdict'],
  type: 'object',
}

// prompt mirror — source of truth: scripts/fleet/lib/delegating-execution/prompts.mts
function buildPlanPrompt(t, sens) {
  return [
    `Task: ${t}`,
    `Sensitivity: ${sens}`,
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

function buildExecutePrompt(planDocPath, t) {
  return [
    `Task: ${t}`,
    '',
    `Read the plan at ${planDocPath} and follow the plan verbatim.`,
    '',
    'Execution rules:',
    '- Work in a git worktree off the default branch — never the primary checkout.',
    '- Commit surgically as you go (Conventional Commits, no AI attribution).',
    '- Run pnpm run fix then pnpm run check from the repo root before finishing.',
    '- Record any deviation from the plan with a one-line reason in your output.',
    '- A deviation must be minimal; the plan is the contract.',
  ].join('\n')
}

function buildReviewPrompt(planDocPath, t, sens) {
  return [
    `Task: ${t}`,
    `Sensitivity: ${sens}`,
    '',
    `Diff the landed result against the plan at ${planDocPath}.`,
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

function buildFollowupPrompt(planDocPath, t, findings) {
  return [
    `Task: ${t}`,
    '',
    `Plan doc: ${planDocPath}`,
    '',
    'Apply every finding listed below. Never offer "fix vs accept-as-gap" — pick the fix.',
    '',
    'After applying all findings:',
    '- Run pnpm run fix then pnpm run check from the repo root.',
    '- Commit surgically (Conventional Commits, no AI attribution).',
    '- Report anything that resisted with a reason.',
    '',
    'Findings:',
    findings,
  ].join('\n')
}

phase('Plan')
const planPromptText = buildPlanPrompt(task, sensitivity)
// big-brain tier: planning is where reasoning pays (token-spend); model/effort
// routed by sensitivity above.
const plan = await agent(planPromptText, {
  effort: bigBrain.effort,
  label: 'plan',
  model: bigBrain.model,
  phase: 'Plan',
  schema: PLAN_SCHEMA,
})

if (!plan || !plan.planDocPath) {
  throw new Error(
    'delegating-execution: plan phase produced no planDocPath. Where: plan agent result. Saw: ' +
      JSON.stringify(plan) +
      '. Wanted: { planDocPath: string }. Fix: re-run; if it recurs, check plan agent output.',
  )
}

phase('Execute')
const executePromptText = buildExecutePrompt(plan.planDocPath, task)
// floor tier: execution follows the written plan verbatim.
const exec = await agent(executePromptText, {
  effort: FLOOR.effort,
  label: 'execute',
  model: FLOOR.model,
  phase: 'Execute',
  schema: EXECUTE_SCHEMA,
})

phase('Review')
const reviewPromptText = buildReviewPrompt(plan.planDocPath, task, sensitivity)
// big-brain tier: review is where reasoning pays; same model/effort as plan.
const review = await agent(reviewPromptText, {
  effort: bigBrain.effort,
  label: 'review',
  model: bigBrain.model,
  phase: 'Review',
  schema: REVIEW_SCHEMA,
})

phase('Follow-up')
let followup = undefined
const findings = review && Array.isArray(review.findings) ? review.findings : []
if (review && review.verdict === 'approve' && findings.length === 0) {
  log('Review approved with no findings — skipping follow-up phase.')
} else {
  const followupPromptText = buildFollowupPrompt(
    plan.planDocPath,
    task,
    JSON.stringify(findings),
  )
  // floor tier: applying enumerated findings is mechanical, bounded by the list.
  followup = await agent(followupPromptText, {
    effort: FLOOR.effort,
    label: 'followup',
    model: FLOOR.model,
    phase: 'Follow-up',
    schema: FOLLOWUP_SCHEMA,
  })
}

log(
  `delegating-execution complete. sensitivity=${sensitivity} plan=${plan.planDocPath} execute.outcome=${exec?.outcome} review.verdict=${review?.verdict} followup.outcome=${followup?.outcome}`,
)
return { execute: exec, followup, plan, review, sensitivity }
