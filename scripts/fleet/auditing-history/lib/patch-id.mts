/**
 * @file The load-bearing, near-zero-false-positive thrash detector: untagged
 *   content-reverts via `git patch-id`. A true revert produces a diff that is
 *   the inverse of the original commit's diff; `git patch-id --stable` hashes a
 *   diff into a value that is STABLE across the inverse pairing the way `git
 *   cherry` / `--cherry-mark` rely on — so two in-window commits sharing a
 *   patch-id are an apply/undo pair. When the later one is NOT
 *   `revert:`-tagged, that's an accidental/undocumented revert: history that
 *   undoes itself without saying so. `findUntaggedReverts` is PURE (operates on
 *   already-collected `WindowCommit[]`), so the same function backs both the
 *   auditing-history skill engine and the commit-thrash-nudge Stop hook —
 *   the two can't drift. Collecting the commits (running git) is the caller's
 *   job (`window.mts`).
 */

import type { Attribution, RevertPair, WindowCommit } from './types.mts'

/**
 * Classify how close two commits are in authorship — the "stepping on toes"
 * signal.
 *
 * - Same author + same minute → `same-session` (one session churning its own
 *   work)
 * - Same author, further apart → `same-session` (still one person; self-thrash)
 * - Different author → `cross-author` (two people/sessions collided)
 *
 * `same-email` with a wide time gap is still the same author; the cross-SESSION
 * nuance (one author, two concurrent worktrees) can't be proven from git
 * metadata alone, so we fold it into the author-identity axis: different email
 * is the actionable "someone else stepped on this" case.
 */
export function classifyAttribution(
  a: WindowCommit,
  b: WindowCommit,
): Attribution {
  if (a.authorEmail !== b.authorEmail) {
    return 'cross-author'
  }
  // Same author. If the two commits are far apart in time, treat as cross-session self-collision
  // (likely two work sessions); otherwise a single session's own churn.
  const gapMs = Math.abs(Date.parse(a.when) - Date.parse(b.when))
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000
  return gapMs > SIX_HOURS_MS ? 'cross-session' : 'same-session'
}

/**
 * Find apply/undo pairs in `commits` (window order, oldest→newest) that share a
 * `git patch-id` where the LATER commit is not `revert:`-tagged. Each earlier
 * commit pairs with the next later commit of the same patch-id (an apply then
 * its undo); a `revert:`-tagged undo is intentional and skipped.
 *
 * Commits with no patch-id (empty/unparseable diff) never pair. Pure — the test
 * drives it directly.
 */
export function findUntaggedReverts(
  commits: readonly WindowCommit[],
): RevertPair[] {
  const pairs: RevertPair[] = []
  // Track the most recent un-paired commit per patch-id, oldest→newest.
  const pendingByPatchId = new Map<string, WindowCommit>()
  for (let i = 0, { length } = commits; i < length; i += 1) {
    const commit = commits[i]!
    const { patchId } = commit
    if (patchId === undefined) {
      continue
    }
    const earlier = pendingByPatchId.get(patchId)
    if (earlier === undefined) {
      pendingByPatchId.set(patchId, commit)
      continue
    }
    // `commit` shares a patch-id with an earlier un-paired commit → apply/undo pair.
    if (!commit.isRevertTagged) {
      pairs.push({
        kind: 'untagged-revert',
        original: earlier,
        undo: commit,
        attribution: classifyAttribution(earlier, commit),
      })
    }
    // Whether tagged or not, this pairing is consumed; a third same-patch-id commit re-arms.
    pendingByPatchId.delete(patchId)
  }
  return pairs
}

/**
 * Does a commit subject begin with a `revert:` / `revert(scope):` / `revert!:`
 * Conventional Commit type? Used by `window.mts` to set
 * `WindowCommit.isRevertTagged`. Case-insensitive on the type.
 */
export function isRevertSubject(subject: string): boolean {
  // Matches a Conventional Commit `revert` type at start of subject (case-insensitive).
  // `^revert` — literal word anchored to start
  // `(?:\([^)]*\))?` — non-capturing group: optional scope `(…)`, `[^)]*` matches any chars except `)`
  // `!?` — optional breaking-change marker
  // `:` — required colon terminating the type prefix
  return /^revert(?:\([^)]*\))?!?:/i.test(subject.trimStart())
}
