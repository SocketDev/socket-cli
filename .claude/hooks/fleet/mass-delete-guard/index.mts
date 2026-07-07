#!/usr/bin/env node
// Claude Code PreToolUse hook — mass-delete-guard.
//
// Blocks a `git commit` whose STAGED tree would delete a catastrophic
// fraction of the repo: ≥ 50 deleted files, OR > 75% of the tree's tracked
// files. That shape is almost never an intentional change — it's a clobbered
// index: a `git read-tree`, a `git commit` fired against a near-empty or
// foreign index, a stray rename/test artifact left in the worktree, or a
// misfired scripted commit. The commit lands a tree with a handful of files
// and tens of thousands of deletions; if it gets pushed, recovery is ugly.
//
// Why a guard and not just "be careful": a session committed
// `2396 files / 329k deletions` from a 1-file index TWICE in a row (the second
// on top of the first), and only recovered because nothing had been pushed —
// `git reset --mixed` to the prior good commit, worktree intact. A pre-commit
// gate catches it before the bad commit exists.
//
// Detection: on a `git commit`, count staged deletions
// (`git diff --cached --diff-filter=D --name-only`) and the tree's tracked
// file count (`git ls-files`). Block when deletions ≥ DELETE_FLOOR or
// deletions / max(tracked, 1) > DELETE_RATIO.
//
// Fails OPEN on any hook error (exit 0 + stderr note) — a guard bug must never
// wedge commits.
//
// Bypass:
//   - `Allow mass-delete bypass` in a recent user turn — for a genuine large
//     removal (dropping a vendored tree, deleting a retired package).
//   - `FLEET_SYNC=1` prefix — cascade commits legitimately replace whole
//     fleet dirs and are trusted.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Bash",
//     "tool_input": { "command": "..." },
//     "transcript_path": "/.../session.jsonl" }

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import process from 'node:process'

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { findInvocation } from '../_shared/shell-command.mts'
import { squashSentinelAllows } from '../_shared/squash-sentinel.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASES = ['Allow mass-delete bypass'] as const

// Pre-flight triggers: the dispatcher skips importing this guard unless the raw
// payload contains one of these substrings. The guard can only ever block when
// `isGitCommit(command)` is true, and that detection
// (`findInvocation(command, { binary: 'git', subcommand: 'commit' })`) requires
// `commit` as a non-flag argument of a `git` segment. So `commit` is a
// necessary substring of every blocking command — safe to gate on.
export const triggers: readonly string[] = ['commit']

// A commit deleting at least this many files is catastrophic regardless of
// repo size — catches a wipe in a large repo where the ratio alone wouldn't
// trip until far too late.
const DELETE_FLOOR = 50
// …or deleting more than this fraction of the tracked tree — catches a wipe
// in a small repo where 50 files is most of it.
const DELETE_RATIO = 0.75

export function getRepoDir(): string {
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

export function isGitCommit(command: string): boolean {
  return findInvocation(command, { binary: 'git', subcommand: 'commit' })
}

/**
 * Count files staged for DELETION in the index (vs HEAD).
 */
export function countStagedDeletions(repoDir: string): number {
  const r = spawnSync(
    'git',
    ['diff', '--cached', '--diff-filter=D', '--name-only'],
    { cwd: repoDir, timeout: 5000 },
  )
  if (r.status !== 0) {
    return 0
  }
  return String(r.stdout)
    .split('\n')
    .map((s: string) => s.trim())
    .filter(Boolean).length
}

/**
 * Count files tracked in HEAD's tree (the denominator for the ratio test).
 */
export function countTrackedFiles(repoDir: string): number {
  const r = spawnSync('git', ['ls-files'], { cwd: repoDir, timeout: 5000 })
  if (r.status !== 0) {
    return 0
  }
  return String(r.stdout)
    .split('\n')
    .map((s: string) => s.trim())
    .filter(Boolean).length
}

/**
 * Decide whether a staged deletion count is catastrophic for a tree of the
 * given size. Returns the reason string when it is, or undefined.
 */
export function catastrophicReason(
  deletions: number,
  tracked: number,
): string | undefined {
  if (deletions >= DELETE_FLOOR) {
    return `${deletions} files staged for deletion (≥ ${DELETE_FLOOR})`
  }
  const ratio = deletions / Math.max(tracked, 1)
  if (ratio > DELETE_RATIO) {
    return `${deletions} of ${tracked} tracked files staged for deletion (> ${Math.round(
      DELETE_RATIO * 100,
    )}%)`
  }
  return undefined
}

export const check = bashGuard((command, payload) => {
  if (!isGitCommit(command)) {
    return undefined
  }
  // Cascade commits legitimately replace whole fleet directories; the
  // FLEET_SYNC sentinel marks a trusted cascade run (same opt-in the
  // no-revert / overeager-staging guards honor).
  if (/(?:^|\s)FLEET_SYNC\s*=\s*1\b/.test(command)) {
    return undefined
  }
  // The squashing-history collapse commit deletes files removed since the root
  // commit; the hardened SQUASH_HISTORY=1 sentinel authorizes it (no phrase).
  if (squashSentinelAllows(command)) {
    return undefined
  }

  const repoDir = getRepoDir()
  const deletions = countStagedDeletions(repoDir)
  if (deletions === 0) {
    return undefined
  }
  const tracked = countTrackedFiles(repoDir)
  const reason = catastrophicReason(deletions, tracked)
  if (!reason) {
    return undefined
  }

  const transcriptPath = payload.transcript_path
  if (
    transcriptPath &&
    bypassPhrasePresent(transcriptPath, BYPASS_PHRASES, 3)
  ) {
    return undefined
  }

  return block(
    [
      `[mass-delete-guard] Blocked: this commit would wipe most of the repo.`,
      '',
      `  ${reason}.`,
      '',
      '  A commit that deletes this much is almost always a clobbered index',
      '  (a stray git read-tree, a commit fired against a near-empty or',
      '  foreign index, a misfired scripted commit), not an intentional',
      '  change. Pushing it makes recovery ugly.',
      '',
      '  Check first:',
      '    git status            # is the worktree actually intact?',
      '    git diff --cached --stat | tail -1',
      '  If the index is wrong, reset it (worktree is usually fine):',
      '    git reset --mixed HEAD',
      '  then stage only what you meant: git add <file>…',
      '',
      '  Genuinely removing a large tree (vendored dir, retired package)?',
      '  Type "Allow mass-delete bypass" in chat, then retry.',
    ].join('\n'),
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
