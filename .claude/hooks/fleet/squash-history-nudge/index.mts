#!/usr/bin/env node
// Claude Code Stop hook — squash-history-nudge.
//
// Reminds the operator about the `squashing-history` skill when:
//   1. The current repo's `name` (from the local git remote OR
//      basename of the working tree) is listed in the fleet
//      roster's `optIns: ['squash-history']` set.
//   2. The current branch is the repo's default branch (per the
//      fleet's _Default branch fallback_ rule — main → master).
//   3. The default branch has more than HISTORY_COMMIT_THRESHOLD
//      commits (default 50). Tunable via env.
//
// The reminder is a soft one-liner; pairs with the
// `template/base/.claude/skills/fleet/squashing-history/SKILL.md` skill that
// does the actual squash.
//
import process from 'node:process'

import {
  currentBranch,
  gitOut,
  resolveDefaultBranch,
} from '../_shared/git-branch.mts'
import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import {
  isOptedIn,
  loadRosterFromRepo,
  readRoster,
  resolveRepoName,
} from '../_shared/fleet-roster.mts'

const DEFAULT_HISTORY_COMMIT_THRESHOLD = Number.parseInt(
  process.env['SOCKET_SQUASH_HISTORY_COMMIT_THRESHOLD'] ?? '50',
  10,
)

export interface SquashHistoryCheckOptions {
  readonly commitThreshold?: number | undefined
}

export { isOptedIn, readRoster, resolveRepoName }

function commitCount(cwd: string, ref: string): number {
  const out = gitOut(cwd, ['rev-list', '--count', ref])
  /* c8 ignore start - defensive: git rev-list --count fails only on repo corruption, unreachable in tests */
  if (out === undefined) {
    return 0
  }
  /* c8 ignore stop */
  const n = Number.parseInt(out, 10)
  /* c8 ignore next - defensive: git rev-list --count always returns a decimal integer */
  return Number.isFinite(n) ? n : 0
}

export const check = (
  payload: ToolCallPayload,
  options: SquashHistoryCheckOptions = {},
): GuardResult => {
  const opts = { __proto__: null, ...options } as SquashHistoryCheckOptions
  const cwd = payload?.cwd ?? process.cwd()
  const commitThreshold =
    opts.commitThreshold ?? DEFAULT_HISTORY_COMMIT_THRESHOLD

  const repoRoot = gitOut(cwd, ['rev-parse', '--show-toplevel']) ?? cwd
  const roster = loadRosterFromRepo(repoRoot)
  if (!roster) {
    return undefined
  }

  const repoName = resolveRepoName(repoRoot)
  /* c8 ignore start - defensive: resolveRepoName returns undefined only when path.basename returns empty (root path), unreachable in tests */
  if (!repoName) {
    return undefined
  }
  /* c8 ignore stop */
  if (!isOptedIn(roster, repoName, 'squash-history')) {
    return undefined
  }

  const branch = currentBranch(repoRoot)
  const base = resolveDefaultBranch(repoRoot)
  if (branch !== base) {
    return undefined
  }

  const count = commitCount(repoRoot, branch)
  if (count <= commitThreshold) {
    return undefined
  }

  return notify(
    [
      `💡 squash-history-nudge: ${repoName} is opted into the squash-history convention.`,
      `   The default branch \`${branch}\` has ${count} commits (threshold ${commitThreshold}).`,
      `   Consider running the \`squashing-history\` skill to collapse to a single Initial commit.`,
      `   Skill: .claude/skills/fleet/squashing-history/SKILL.md`,
    ].join('\n'),
  )
}

export const hook = defineHook({
  bypass: ['squash-history-nudge'],
  bypassOptional: true,
  check,
  event: 'Stop',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
