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
// Bypass phrase: `Allow squash-history-nudge bypass`. Disable

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
// prefer-async-spawn: sync-required — hook fires synchronously at
// turn-end and must finish before stdin/stdout close.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { currentBranch, resolveDefaultBranch } from '../_shared/git-branch.mts'
import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow squash-history-nudge bypass'
const BYPASS_LOOKBACK_USER_TURNS = 8
const HISTORY_COMMIT_THRESHOLD = Number.parseInt(
  process.env['SOCKET_SQUASH_HISTORY_COMMIT_THRESHOLD'] ?? '50',
  10,
)

interface FleetRepo {
  readonly name: string
  readonly optIns?: readonly string[] | undefined
}

interface FleetRoster {
  readonly repos: readonly FleetRepo[]
}

function gitSafe(cwd: string, args: string[]): string | undefined {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (r.status !== 0 || typeof r.stdout !== 'string') {
    return undefined
  }
  return r.stdout.trim()
}

/**
 * Identify the canonical repo name. Prefer the GitHub remote (handles checkout
 * dir renames like `socket-cli-fix-foo`); fall back to the working-tree
 * basename.
 */
export function resolveRepoName(cwd: string): string | undefined {
  const remote = gitSafe(cwd, ['config', '--get', 'remote.origin.url'])
  if (remote) {
    // git@github.com:Org/repo.git OR https://github.com/Org/repo(.git)?
    const m = /[/:](?<repo>[^/:]+?)(?:\.git)?$/.exec(remote)
    if (m && m.groups?.repo) {
      return m.groups.repo
    }
  }
  const base = path.basename(cwd)
  return base || undefined
}

export function readRoster(rosterPath: string): FleetRoster | undefined {
  if (!existsSync(rosterPath)) {
    return undefined
  }
  try {
    const raw = readFileSync(rosterPath, 'utf8')
    return JSON.parse(raw) as FleetRoster
  } catch {
    return undefined
  }
}

export function isOptedIn(
  roster: FleetRoster,
  repoName: string,
  optIn: string,
): boolean {
  for (let i = 0, { length } = roster.repos; i < length; i += 1) {
    const r = roster.repos[i]!
    if (r.name === repoName) {
      return (r.optIns ?? []).includes(optIn)
    }
  }
  return false
}

function commitCount(cwd: string, ref: string): number {
  const out = gitSafe(cwd, ['rev-list', '--count', ref])
  /* c8 ignore start - defensive: git rev-list --count fails only on repo corruption, unreachable in tests */
  if (out === undefined) {
    return 0
  }
  /* c8 ignore stop */
  const n = Number.parseInt(out, 10)
  /* c8 ignore next - defensive: git rev-list --count always returns a decimal integer */
  return Number.isFinite(n) ? n : 0
}

export const check = (payload: ToolCallPayload): GuardResult => {
  const cwd = payload?.cwd ?? process.cwd()

  const repoRoot = gitSafe(cwd, ['rev-parse', '--show-toplevel']) ?? cwd
  const rosterCandidates = [
    path.join(
      repoRoot,
      'template/base/.claude/skills/fleet/cascading-fleet/lib/fleet-repos.json',
    ),
    path.join(
      repoRoot,
      '.claude/skills/fleet/cascading-fleet/lib/fleet-repos.json',
    ),
  ]
  let roster: FleetRoster | undefined
  for (let i = 0, { length } = rosterCandidates; i < length; i += 1) {
    roster = readRoster(rosterCandidates[i]!)
    if (roster) {
      break
    }
  }
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
  if (count <= HISTORY_COMMIT_THRESHOLD) {
    return undefined
  }

  if (
    bypassPhrasePresent(
      payload?.transcript_path,
      BYPASS_PHRASE,
      BYPASS_LOOKBACK_USER_TURNS,
    )
  ) {
    return undefined
  }

  return notify(
    [
      `💡 squash-history-nudge: ${repoName} is opted into the squash-history convention.`,
      `   The default branch \`${branch}\` has ${count} commits (threshold ${HISTORY_COMMIT_THRESHOLD}).`,
      `   Consider running the \`squashing-history\` skill to collapse to a single Initial commit.`,
      `   Skill: .claude/skills/fleet/squashing-history/SKILL.md`,
      `   Suppress for this session: type "${BYPASS_PHRASE}" verbatim.`,
    ].join('\n'),
  )
}

export const hook = defineHook({
  check,
  event: 'Stop',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
