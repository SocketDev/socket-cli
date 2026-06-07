// Shared shape-and-reachability validator for a 40-char hex commit
// SHA pin. Three callers across workflow.mts, bash.mts, and
// package-json.mts had duplicated this exact two-stage check; this
// helper consolidates them so a future tweak (e.g. allow shortened
// SHAs behind a flag) only touches one site.

import { verifyCommitSha, type Cache } from './cache.mts'

export interface RefShapeOk {
  ok: true
}

export interface RefShapeBad {
  ok: false
  // Categorical problem string, ready to drop into the `problem`
  // field of UsesIssue / SubmoduleIssue / PackageJsonIssue.
  problem: string
}

export type RefValidation = RefShapeOk | RefShapeBad

// Stage 1: shape — must be exactly 40 hex chars. Returns a
// categorical problem for partial-hex (truncated SHA) vs anything else
// (version tag, branch name).
export function validateRefShape(ref: string): RefValidation {
  if (/^[0-9a-f]{40}$/i.test(ref)) {
    return { ok: true }
  }
  return {
    ok: false,
    problem: /^[0-9a-f]+$/i.test(ref)
      ? `truncated SHA (${ref.length} hex chars, need exactly 40)`
      : `not a SHA pin (got "${ref}"; fleet requires full 40-char hex)`,
  }
}

// Stage 2: reachability — gh api repos/<ownerRepo>/commits/<sha>.
// Only call this after validateRefShape returns ok.
export function validateRefReachable(
  ownerRepo: string,
  ref: string,
  cache: Cache,
): RefValidation {
  if (verifyCommitSha(ownerRepo, ref, cache)) {
    return { ok: true }
  }
  return {
    ok: false,
    problem: `SHA ${ref.slice(0, 10)}… not reachable in ${ownerRepo} (gh api 404). Either the SHA was mistyped or the repo is private and gh isn't authed for it.`,
  }
}
