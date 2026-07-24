/**
 * @file The nested-`.gitignore` predicate, shared by the write-time
 *   `no-nested-gitignore-guard` hook and the belt-scan check
 *   `scripts/fleet/check/gitignore-is-single-file.mts` so the two never diverge
 *   (1 predicate, 1 reference). Lives under `_shared/` (ships to members,
 *   survives the bundle-only cutover) because the check runs in members.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

/**
 * A repo-relative POSIX path is a NESTED `.gitignore` (a violation) when its
 * basename is `.gitignore` and it does NOT sit at a canonical root — the repo
 * root (`.gitignore`) or a template archetype root (`template/<archetype>/
 * .gitignore`). Any deeper `.gitignore` is nested. Pure.
 */
export function isNestedGitignore(repoRelativePath: string): boolean {
  const p = normalizePath(repoRelativePath)
  if (p !== '.gitignore' && !p.endsWith('/.gitignore')) {
    return false
  }
  if (p === '.gitignore') {
    return false
  }
  if (/^template\/[^/]+\/\.gitignore$/.test(p)) {
    return false
  }
  // cargo-fuzz generates + owns `<crate>/fuzz/.gitignore` (ignores its transient
  // target/artifacts/coverage output while the seed corpus stays tracked). It is
  // a tool-mandated convention, not a fleet fork — exempt it so a Rust fuzz repo
  // stays green.
  if (p === 'fuzz/.gitignore' || p.endsWith('/fuzz/.gitignore')) {
    return false
  }
  return true
}
