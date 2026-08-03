/**
 * @file AI-assisted below-the-fold summaries for auto-landed commits.
 *   land-work composes each grouped commit's deterministic SUBJECT + per-
 *   directory file digest (land-work/message.mts, always). This module adds the
 *   optional value-add: ONE floor-tier AI call per auto-land that reads the
 *   grouped diffs and returns a high-level "what & why" for each multi-file
 *   group, which land-work inserts below the fold, above the digest.
 *   Code-first-then-AI: this is the residue the deterministic composer cedes.
 *   Every failure path — no claude CLI, model unavailable/overloaded, a
 *   non-zero exit, unparseable output, the LAND_WORK_NO_AI opt-out — returns an
 *   empty map and the commit keeps its deterministic body. The AI never gates a
 *   land.
 *   Recursion: land-work sets SOCKET_LAND_WORK_ACTIVE for its run, which the
 *   headless child inherits (spawnAiAgent forwards process.env), so the child's
 *   own auto-land-on-stop hook no-ops — the read-only profile also lets it
 *   mutate nothing.
 *   Keyless fallback: when no claude CLI resolves, a repo that opted into
 *   `ai.localAssist` in `.config/repo/socket-wheelhouse.json` gets the same
 *   below-the-fold summaries from the odai CLI — on-device, summary-class,
 *   no ANTHROPIC_API_KEY (_shared/odai.mts). Same fail-open contract: any
 *   skip or failure keeps the deterministic body, and the whole leg is
 *   bounded by a total budget so a cold local model never stalls a land.
 */

import process from 'node:process'

import { discoverAiAgents } from '@socketsecurity/lib-stable/ai/discover'
import { AI_PROFILE } from '@socketsecurity/lib-stable/ai/profiles'
import { spawnAiAgent } from '@socketsecurity/lib-stable/ai/spawn'
// oxlint-disable-next-line socket/prefer-async-spawn -- sequential git plumbing; one bounded read per group before the commit loop.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { FLOOR_EFFORT, FLOOR_MODEL } from '../lib/known-models.mts'
import {
  localAssistEnabled,
  resolveOdaiBin,
  runOdai,
} from '../_shared/odai.mts'

import type { CommitGroup } from '../land-work.mts'

// Bounds — keep the prompt cheap and the summaries terse. A large diff is
// truncated (the summary is high-level; it needs signal, not the whole patch).
const MAX_DIFF_CHARS_PER_GROUP = 6000
const MAX_PROMPT_CHARS = 40_000
const MAX_SUMMARY_CHARS = 400
// A commit subject stays scannable in `git log --oneline`; keep the on-device
// description well under the ~72-char convention.
const MAX_SUBJECT_DESC_CHARS = 72
// Bounded so a slow/cold AI never stalls turn-end for long — fail-open on timeout.
const SUMMARY_TIMEOUT_MS = 30_000
// Keyless-fallback bounds. odai is one call PER GROUP — small local models
// can't hold a multi-group prompt — so each call gets a per-prompt budget
// wide enough for a cold headless-Chrome bridge launch, and the loop stops at
// a total budget so a long land never queues minutes of local inference.
const ODAI_PROMPT_TIMEOUT_MS = 45_000
const ODAI_TOTAL_BUDGET_MS = 90_000

async function claudeAvailable(cwd: string): Promise<boolean> {
  const discovered = await discoverAiAgents({ repoRoot: cwd })
  return 'claude' in discovered
}

function groupDiff(cwd: string, paths: readonly string[]): string {
  // Tracked-file changes only — new/untracked files never appear in a HEAD
  // diff, and the deterministic digest already names them. Read raw + cap.
  const r = spawnSync('git', ['diff', 'HEAD', '--', ...paths], {
    cwd,
    stdioString: false,
    timeout: 20_000,
  })
  const out = String(r.stdout ?? '')
  return out.length > MAX_DIFF_CHARS_PER_GROUP
    ? `${out.slice(0, MAX_DIFF_CHARS_PER_GROUP)}\n… (truncated)`
    : out
}

function buildPrompt(cwd: string, groups: readonly CommitGroup[]): string {
  const sections: string[] = []
  for (const g of groups) {
    const diff = groupDiff(cwd, g.paths)
    sections.push(
      `### ${g.scope} (${g.paths.length} files)\n` +
        `Files:\n${g.paths.join('\n')}\n` +
        `Diff (may be truncated; new files omitted):\n${diff || '(no tracked-file diff — new or renamed files)'}`,
    )
  }
  let body = sections.join('\n\n')
  if (body.length > MAX_PROMPT_CHARS) {
    body = `${body.slice(0, MAX_PROMPT_CHARS)}\n… (truncated)`
  }
  return (
    'You are writing the body summary for several auto-generated git commits. ' +
    'Each section is one commit, grouping changed files under a scope. For each ' +
    'scope, write a high-level summary (1-3 short sentences) of WHAT changed and ' +
    'why, for a teammate skimming git log. Do not list file names (the commit ' +
    'already lists them). Return ONLY a JSON object mapping each scope name to ' +
    `its summary string — no markdown, no code fences.\n\n${body}`
  )
}

/**
 * Parse the model's stdout into a scope→summary map. Tolerates an accidental.
 *
 * ```fence;
 * collapses whitespace and caps length. Never throws — a bad payload yields an
 * empty map (the caller then keeps the deterministic body). Pure.
 * ```
 */
export function parseSummaries(
  stdout: string,
  scopes: readonly string[],
): Map<string, string> {
  const out = new Map<string, string>()
  let text = stdout.trim()
  // Strips a markdown code fence the model may wrap its JSON in: optional
  // ```json (or bare ```) opener, captures everything up to the closing ```
  // (group 1 is the fenced body), anchored to the whole trimmed string.
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text)
  if (fence) {
    text = fence[1]!.trim()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return out
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return out
  }
  const known = new Set(scopes)
  for (const [key, value] of Object.entries(parsed)) {
    if (known.has(key) && typeof value === 'string') {
      const clean = value
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_SUMMARY_CHARS)
      if (clean) {
        out.set(key, clean)
      }
    }
  }
  return out
}

/**
 * Produce a scope→summary map for the multi-file groups in `groups`, via one
 * bounded floor-tier AI call. Returns an empty map on any opt-out / unavailable
 * / failure path — the caller always has the deterministic body to fall back
 * to, so this never blocks or fails a land.
 */
export async function summarizeGroups(
  cwd: string,
  groups: readonly CommitGroup[],
): Promise<Map<string, string>> {
  if (process.env['LAND_WORK_NO_AI']) {
    return new Map()
  }
  const multi = groups.filter(g => g.paths.length > 1)
  if (multi.length === 0) {
    return new Map()
  }
  if (!(await claudeAvailable(cwd))) {
    return await odaiSummaries(cwd, multi)
  }
  let result: Awaited<ReturnType<typeof spawnAiAgent>>
  try {
    // Floor tier (haiku / low): a one-sentence diff summary is the cheapest
    // class of AI task — pinning effort alongside the model is the CLAUDE.md
    // token-spend rule. Read-only profile (no Bash/Edit/Write) so the headless
    // child mutates nothing.
    result = await spawnAiAgent({
      ...AI_PROFILE.read,
      cwd,
      effort: FLOOR_EFFORT,
      model: FLOOR_MODEL,
      prompt: buildPrompt(cwd, multi),
      timeoutMs: SUMMARY_TIMEOUT_MS,
    })
  } catch {
    return new Map()
  }
  if (result.exitCode !== 0 || result.unavailable || result.overloaded) {
    return new Map()
  }
  return parseSummaries(
    result.stdout,
    multi.map(g => g.scope),
  )
}

/**
 * Keyless fallback: summarize each multi-file group's diff through the odai
 * CLI. Runs ONLY when the repo opted into `ai.localAssist` and a odai binary
 * resolves — otherwise an empty map, same as every other unavailable path.
 * One `odai summarize` call per group because small on-device models can't
 * hold the multi-group prompt the claude path sends; the loop stops on the
 * first failure and at the total budget, and any partial result is fine —
 * groups without a summary keep their deterministic body.
 */
export async function odaiSummaries(
  cwd: string,
  groups: readonly CommitGroup[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!localAssistEnabled(cwd)) {
    return out
  }
  const bin = resolveOdaiBin()
  if (!bin) {
    return out
  }
  const deadline = Date.now() + ODAI_TOTAL_BUDGET_MS
  for (const g of groups) {
    if (Date.now() >= deadline) {
      break
    }
    const diff = groupDiff(cwd, g.paths)
    if (!diff) {
      continue
    }
    const run = await runOdai('summarize', diff, {
      bin,
      cwd,
      timeoutMs: ODAI_PROMPT_TIMEOUT_MS,
    })
    if (run.outcome !== 'ok') {
      // A skip means no backend at all and a failure would repeat per group —
      // either way the remaining groups keep their deterministic bodies.
      break
    }
    const value = run.value as { summary?: unknown | undefined }
    if (typeof value?.summary === 'string') {
      const clean = value.summary
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_SUMMARY_CHARS)
      if (clean) {
        out.set(g.scope, clean)
      }
    }
  }
  return out
}

/**
 * Strip a leading Conventional-Commit prefix (`type`, optional `(scope)`,
 * optional `!`, colon) from an on-device commit-msg suggestion, returning just
 * the description on one line, whitespace-collapsed and capped. land-work
 * re-attaches the structural `type(scope):` it already derived, so only the
 * description is borrowed from the model. Pure.
 */
export function subjectDescription(raw: string): string {
  const firstLine = raw.split('\n')[0] ?? ''
  const stripped = firstLine.trim().replace(/^\w+(\([^)]+\))?!?:\s*/, '')
  return stripped.replace(/\s+/g, ' ').trim().slice(0, MAX_SUBJECT_DESC_CHARS)
}

/**
 * Keyless commit subjects: for each multi-file group, ask the on-device
 * `commit-msg` task for a Conventional-Commit subject and keep only its
 * description. Same opt-in, budget-bounded, fail-open contract as
 * odaiSummaries — any opt-out / unavailable / skip / failure yields no entry
 * and the group keeps its deterministic `update <areas>` subject.
 */
export async function odaiSubjects(
  cwd: string,
  groups: readonly CommitGroup[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!localAssistEnabled(cwd)) {
    return out
  }
  // Single-file groups already name their file in the subject, so only
  // multi-file groups have a `update <areas>` description worth replacing.
  const multi = groups.filter(g => g.paths.length > 1)
  if (multi.length === 0) {
    return out
  }
  const bin = resolveOdaiBin()
  if (!bin) {
    return out
  }
  const deadline = Date.now() + ODAI_TOTAL_BUDGET_MS
  for (let i = 0, { length } = multi; i < length; i += 1) {
    const g = multi[i]!
    if (Date.now() >= deadline) {
      break
    }
    const diff = groupDiff(cwd, g.paths)
    if (!diff) {
      continue
    }
    const run = await runOdai('commit-msg', diff, {
      bin,
      cwd,
      timeoutMs: ODAI_PROMPT_TIMEOUT_MS,
    })
    if (run.outcome !== 'ok') {
      break
    }
    const value = run.value as { subject?: unknown | undefined }
    if (typeof value?.subject === 'string') {
      const desc = subjectDescription(value.subject)
      if (desc) {
        out.set(g.scope, desc)
      }
    }
  }
  return out
}
