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
 */

import process from 'node:process'

import { discoverAiAgents } from '@socketsecurity/lib-stable/ai/discover'
import { AI_PROFILE } from '@socketsecurity/lib-stable/ai/profiles'
import { spawnAiAgent } from '@socketsecurity/lib-stable/ai/spawn'
// oxlint-disable-next-line socket/prefer-async-spawn -- sequential git plumbing; one bounded read per group before the commit loop.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { FLOOR_EFFORT, FLOOR_MODEL } from '../lib/known-models.mts'

import type { CommitGroup } from '../land-work.mts'

// Bounds — keep the prompt cheap and the summaries terse. A large diff is
// truncated (the summary is high-level; it needs signal, not the whole patch).
const MAX_DIFF_CHARS_PER_GROUP = 6000
const MAX_PROMPT_CHARS = 40_000
const MAX_SUMMARY_CHARS = 400
// Bounded so a slow/cold AI never stalls turn-end for long — fail-open on timeout.
const SUMMARY_TIMEOUT_MS = 30_000

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
    return new Map()
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
