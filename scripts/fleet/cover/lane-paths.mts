/*
 * @file Expand a lane's declared capability paths into the concrete on-disk
 *   directories a lane spawns its tool in. The coverage-lanes-are-wired check
 *   BLESSES glob magic in a declared path (a `packages/*` style glob), so a
 *   lane must agree with the check and resolve those globs before it spawns:
 *   `cargo` and `go` run with the declared path as their cwd, and a literal
 *   glob cwd throws ENOENT, which — uncaught in the per-path loop — takes the
 *   whole `cover` run down before the valid paths run. Expanding here keeps the
 *   lane and the check reading the same declaration the same way.
 *
 *   A magic-free path passes through untouched. A glob that matches no
 *   directory contributes nothing, so a lane whose every path resolves to
 *   nothing measures nothing and reports that as a failure — the same
 *   never-false-green outcome the lane already owns.
 */

import { globSync } from '@socketsecurity/lib-stable/globs/match'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

/**
 * Glob magic that makes a declared path unusable as a literal spawn cwd. The
 * same class the check's `hasGlobMagic` gates on, kept here so the lane's
 * expansion and the check's probing never disagree about what counts as a glob.
 */
const GLOB_MAGIC_RE = /[!*?[\]{}]/

/**
 * True when `declaredPath` carries glob magic (`packages/*` is a glob,
 * `crates/core` is a literal directory).
 */
export function hasGlobMagic(declaredPath: string): boolean {
  return GLOB_MAGIC_RE.test(declaredPath)
}

/**
 * Resolve a lane's declared capability paths to the concrete, repo-relative
 * directories it should spawn in, in a stable order and de-duplicated. A
 * literal path is kept as-is; a glob is expanded to the directories it matches
 * under `repoRoot`. Every returned entry is a normalized forward-slash path.
 */
export function expandLanePaths(
  repoRoot: string,
  paths: readonly string[],
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (entry: string): void => {
    if (!seen.has(entry)) {
      seen.add(entry)
      out.push(entry)
    }
  }
  for (let i = 0, { length } = paths; i < length; i += 1) {
    const entry = normalizePath(paths[i]!)
    if (!hasGlobMagic(entry)) {
      add(entry)
      continue
    }
    const matches = globSync(entry, { cwd: repoRoot, onlyDirectories: true })
    matches.sort()
    for (let j = 0, { length: matchCount } = matches; j < matchCount; j += 1) {
      add(normalizePath(matches[j]!))
    }
  }
  return out
}
