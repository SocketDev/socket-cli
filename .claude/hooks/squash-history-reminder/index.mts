#!/usr/bin/env node
// Claude Code Stop hook — squash-history-reminder.
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
// `template/.claude/skills/squashing-history/SKILL.md` skill that
// does the actual squash.
//
// Bypass phrase: `Allow squash-history-reminder bypass`. Disable
// entirely via SOCKET_SQUASH_HISTORY_REMINDER_DISABLED.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
// prefer-async-spawn: sync-required — hook fires synchronously at
// turn-end and must finish before stdin/stdout close.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow squash-history-reminder bypass'
const BYPASS_LOOKBACK_USER_TURNS = 8
const HISTORY_COMMIT_THRESHOLD = Number.parseInt(
  process.env['SOCKET_SQUASH_HISTORY_COMMIT_THRESHOLD'] ?? '50',
  10,
)

interface StopPayload {
  readonly transcript_path?: string | undefined
  readonly cwd?: string | undefined
}

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
    const m = /[/:]([^/:]+?)(?:\.git)?$/.exec(remote)
    if (m && m[1]) {
      return m[1]
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

function defaultBranch(cwd: string): string {
  const sym = gitSafe(cwd, ['symbolic-ref', 'refs/remotes/origin/HEAD'])
  if (sym) {
    return sym.replace(/^refs\/remotes\/origin\//, '')
  }
  for (const candidate of ['main', 'master']) {
    if (
      gitSafe(cwd, [
        'show-ref',
        '--verify',
        '--quiet',
        `refs/remotes/origin/${candidate}`,
      ]) !== undefined
    ) {
      return candidate
    }
  }
  return 'main'
}

function currentBranch(cwd: string): string | undefined {
  return gitSafe(cwd, ['branch', '--show-current'])
}

function commitCount(cwd: string, ref: string): number {
  const out = gitSafe(cwd, ['rev-list', '--count', ref])
  if (out === undefined) {
    return 0
  }
  const n = Number.parseInt(out, 10)
  return Number.isFinite(n) ? n : 0
}

async function main(): Promise<void> {
  if (process.env['SOCKET_SQUASH_HISTORY_REMINDER_DISABLED']) {
    return
  }
  const raw = await readStdin()
  if (!raw.trim()) {
    return
  }
  let payload: StopPayload
  try {
    payload = JSON.parse(raw) as StopPayload
  } catch {
    return
  }
  const cwd = payload.cwd ?? process.cwd()

  const repoRoot = gitSafe(cwd, ['rev-parse', '--show-toplevel']) ?? cwd
  const rosterCandidates = [
    path.join(
      repoRoot,
      'template/.claude/skills/cascading-fleet/lib/fleet-repos.json',
    ),
    path.join(repoRoot, '.claude/skills/cascading-fleet/lib/fleet-repos.json'),
  ]
  let roster: FleetRoster | undefined
  for (let i = 0, { length } = rosterCandidates; i < length; i += 1) {
    roster = readRoster(rosterCandidates[i]!)
    if (roster) {
      break
    }
  }
  if (!roster) {
    return
  }

  const repoName = resolveRepoName(repoRoot)
  if (!repoName) {
    return
  }
  if (!isOptedIn(roster, repoName, 'squash-history')) {
    return
  }

  const branch = currentBranch(repoRoot)
  const base = defaultBranch(repoRoot)
  if (branch !== base) {
    return
  }

  const count = commitCount(repoRoot, branch)
  if (count <= HISTORY_COMMIT_THRESHOLD) {
    return
  }

  if (
    bypassPhrasePresent(
      payload.transcript_path,
      BYPASS_PHRASE,
      BYPASS_LOOKBACK_USER_TURNS,
    )
  ) {
    return
  }

  process.stderr.write(
    [
      `💡 squash-history-reminder: ${repoName} is opted into the squash-history convention.`,
      `   The default branch \`${branch}\` has ${count} commits (threshold ${HISTORY_COMMIT_THRESHOLD}).`,
      `   Consider running the \`squashing-history\` skill to collapse to a single Initial commit.`,
      `   Skill: .claude/skills/squashing-history/SKILL.md`,
      `   Suppress for this session: type "${BYPASS_PHRASE}" verbatim, or set`,
      `   SOCKET_SQUASH_HISTORY_REMINDER_DISABLED=1 to disable entirely.`,
      '',
    ].join('\n'),
  )
}

main().catch(e => {
  process.stderr.write(
    `squash-history-reminder: hook error (continuing): ${(e as Error).message}\n`,
  )
})
