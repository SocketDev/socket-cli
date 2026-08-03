/*
 * @file Shared scope-flag resolution for the fleet runners (lint, test, check,
 *   fix). One place decides how the scope flags map to a mode, so every runner
 *   accepts the SAME flags identically instead of each re-deriving them (and
 *   drifting). The modes:
 *
 *     --all       the whole workspace
 *     --staged    the git index (what .git-hooks/pre-commit uses)
 *     --modified  files modified in the working tree vs HEAD (git's own
 *                 "modified" term; detected via stat/mtime). This is also the
 *                 no-flag default.
 *     --changed   alias of --modified
 *
 *   `--all` takes precedence over `--staged`, which takes precedence over the
 *   modified default — matching the long-standing ternary each runner used.
 *   `check.mts` forwards exactly `SCOPE_FLAGS` to `lint.mts`; `fix.mts` forwards
 *   all argv; `lint.mts` + `test.mts` call `resolveScopeMode` directly.
 */

export type ScopeMode = 'staged' | 'all' | 'modified'

// Every scope flag the runners recognize. `--changed` is the alias of
// `--modified`; both select the working-tree-vs-HEAD scope. Sorted (socket/sort).
export const SCOPE_FLAGS: readonly string[] = [
  '--all',
  '--changed',
  '--modified',
  '--staged',
]

// True when `arg` is one of the recognized scope flags. Used by check.mts to
// decide which flags to forward to the lint runner.
export function isScopeFlag(arg: string): boolean {
  return SCOPE_FLAGS.includes(arg)
}

// Resolve the scope mode from a runner's argv. `--all` wins, then `--staged`;
// everything else (including `--modified`, its alias `--changed`, and no flag)
// is the working-tree "modified" scope.
export function resolveScopeMode(argv: readonly string[]): ScopeMode {
  if (argv.includes('--all')) {
    return 'all'
  }
  if (argv.includes('--staged')) {
    return 'staged'
  }
  return 'modified'
}

// Explicit positional file paths → win over every scope mode (including
// --all), tracked or brand-new. `getModifiedFiles`/`getStagedFiles` resolve
// through `git diff`, which never surfaces an untracked (never-`git add`ed)
// file, so a brand-new file passed explicitly on argv (`pnpm run fix
// <new-file>`) was silently dropped from the git-diff-derived scope while the
// scope-count log still reported success. Positional args (anything not
// starting with `-`) win over the git-diff scope entirely, matching
// `scripts/fleet/test.mts`'s `fileArgs()` convention: flags (scope flags,
// `--fix`, `--quiet`/`--silent`) are filtered out, and what remains is treated
// as file paths. Shared by lint.mts (re-exported for its existing consumers)
// and fix.mts, which needs the same convention to decide whether a run is
// scoped to named files without importing lint.mts's own CLI module —
// importing it would also re-run its top-level argv/runner-construction side
// effects.
export function resolveExplicitFiles(argv: readonly string[]): string[] {
  return argv.filter(a => !a.startsWith('-'))
}
