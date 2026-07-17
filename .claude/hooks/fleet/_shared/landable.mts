/*
 * @file Single-source classification of which dirty git-status entries the
 *   auto-lander (`scripts/fleet/land-work.mts`) will hand-commit vs. skip. The
 *   auto-lander and `dirty-worktree-stop-guard` MUST agree: a path the lander
 *   refuses to land is a path the stop-guard must not demand a human commit.
 *   These lived inside land-work.mts and were only "kept in lock-step" by a
 *   comment; the guard couldn't see them and drifted. Extracted here so both
 *   consumers import ONE definition (single-source-of-truth rule).
 *
 *   Pure — no spawn, no IO, no clock. Unit-tested directly.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

// Tracked-but-generated paths that live inside source areas yet are never
// hand-authored — a formatter/build/lockfile step writes them. Neither the
// auto-lander nor a human commits them by hand; their generator owns them.
export const GENERATED_PATTERNS = [
  /(?:^|\/)pnpm-lock\.yaml$/,
  /(?:^|\/)_dispatch\/bundle\.cjs$/,
  /(?:^|\/)(?:build|dist|coverage|coverage-isolated)\//,
]

/**
 * True for a tracked-but-generated path (lockfile, hook bundle, build/coverage
 * output) that sits in a source area but is machine-written, not authored.
 * Pure.
 */
export function isGenerated(p: string): boolean {
  const np = normalizePath(p)
  for (let i = 0, { length } = GENERATED_PATTERNS; i < length; i += 1) {
    const re = GENERATED_PATTERNS[i]!
    if (re.test(np)) {
      return true
    }
  }
  return false
}

/**
 * True for a porcelain status that marks an UNMERGED (conflicted) path:
 * any `U`, or the both-added/both-deleted pairs `AA`/`DD`. Never auto-commit
 * one — an unresolved conflict must be resolved by a human, not landed. Pure.
 */
export function isUnmerged(status: string): boolean {
  return status.includes('U') || status === 'AA' || status === 'DD'
}

/**
 * True when a porcelain status shows BOTH an index change AND a worktree change
 * (e.g. `MM`, `AM`, `RM`): the staged blob and the on-disk file differ, so a
 * `git add` before commit would fold in whatever is unstaged — possibly a
 * concurrent session's hunks to a file both touched. The auto-lander skips
 * these (surfaces for manual review) rather than blend authorship. `??`
 * (untracked) is not both-touched. Pure.
 */
export function isBothTouched(status: string): boolean {
  const index = status[0] ?? ' '
  const worktree = status[1] ?? ' '
  return index !== ' ' && index !== '?' && worktree !== ' ' && worktree !== '?'
}
