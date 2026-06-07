/**
 * @file Shared git-state predicate. `isInTransientGitState(repoDir)` is true
 *   when a repo is NOT on a normal branch tip — detached HEAD or an in-progress
 *   rebase / merge / cherry-pick. A fresh commit in that state lands on a stale
 *   or throwaway ref, so cascade auto-commit (sync-scaffolding/commit.mts) and
 *   the no-cascade-transient-git-guard hook both gate on this. Single
 *   source of truth so the two paths can't drift.
 */

// oxlint-disable-next-line socket/prefer-async-spawn -- hook + sync runner need sync stdin/stdout + typed string return; v5 lib spawnSync omits 'encoding'.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * True when a fresh commit in `repoDir` would land on a stale or transient ref.
 * Covers a missing `.git`, detached HEAD, and in-progress rebase / merge /
 * cherry-pick (each leaves a marker dir or file under `.git/`).
 */
export function isInTransientGitState(repoDir: string): boolean {
  const gitDir = path.join(repoDir, '.git')
  if (!existsSync(gitDir)) {
    return true
  }
  const head = spawnSync(
    'git',
    ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    {
      cwd: repoDir,
    },
  )
  if (head.status !== 0) {
    // Detached HEAD — symbolic-ref exits non-zero.
    return true
  }
  const markers = [
    'CHERRY_PICK_HEAD',
    'MERGE_HEAD',
    'rebase-apply',
    'rebase-merge',
  ]
  for (let i = 0, { length } = markers; i < length; i += 1) {
    if (existsSync(path.join(gitDir, markers[i]!))) {
      return true
    }
  }
  return false
}
