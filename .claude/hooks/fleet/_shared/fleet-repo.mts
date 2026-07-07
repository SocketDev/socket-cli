/**
 * @file Detect whether an edited file belongs to a FLEET-MANAGED repo. Fleet
 *   edit-time guards that merely mirror a fleet LINT RULE (logger over console,
 *   function declarations over arrow consts, `import type`, …) must not fire on
 *   a non-fleet sibling repo: those repos run their own toolchain (biome,
 *   eslint, whatever) and the fleet conventions simply don't apply there, so a
 *   fleet session editing a non-fleet repo would otherwise demand `socket-lint`
 *   opt-out comments in code that isn't fleet-linted at all. A repo is
 *   fleet-managed iff its root carries `.config/fleet/` (the cascaded fleet
 *   oxlint/oxfmt config tree — present in every fleet member, absent in
 *   non-fleet repos). Detection walks up from the file to the first `.git` repo
 *   root. FAIL-SAFE: when the repo can't be determined (no `.git` found before
 *   the filesystem root), assume fleet-managed so a guard keeps enforcing
 *   rather than silently going quiet. EXCEPTION: a session-scratchpad / temp
 *   working draft (`isEphemeralPath` — under a temp root AND carrying a
 *   `scratchpad/` or `claude-<uid>/` marker) is never fleet source, so it
 *   resolves NON-fleet, not fail-safe-to-fleet. A plain `/tmp` repo worktree
 *   (CI runner, `git worktree`) has no scratch marker, so it still fails safe.
 *   Security / safety guards (secret content, personal paths, git-state) must
 *   NOT use this — they apply everywhere, so they don't opt into the fleet
 *   skip.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { isEphemeralPath } from './ephemeral-path.mts'

/**
 * True when `filePath` lives inside a fleet-managed repo (root has
 * `.config/fleet/`). Confidently false only when a `.git` repo root is reached
 * with no `.config/fleet/`. Undeterminable → true (fail toward enforcement).
 */
export function isFleetManagedPath(filePath: string): boolean {
  if (!filePath) {
    return true
  }
  return isFleetManagedDir(path.dirname(path.resolve(filePath)))
}

/**
 * True when `dir` (or an ancestor) is the root of a fleet-managed repo
 * (`.config/fleet/`). Confidently false only when a `.git` repo root is
 * reached with no `.config/fleet/`. Undeterminable → true (fail toward
 * enforcement). Used by Bash lint/tooling guards to skip commands whose
 * working directory is a non-fleet repo.
 */
export function isFleetManagedDir(dir: string): boolean {
  if (!dir) {
    return true
  }
  const start = path.resolve(dir)
  let cur = start
  // Cap the climb so a pathological path can't loop unbounded.
  for (let i = 0; i < 64; i += 1) {
    if (existsSync(path.join(cur, '.config', 'fleet'))) {
      return true
    }
    if (existsSync(path.join(cur, '.git'))) {
      // Repo root reached without a fleet config → a non-fleet repo.
      return false
    }
    const parent = path.dirname(cur)
    if (parent === cur) {
      break
    }
    cur = parent
  }
  // No repo marker anywhere above `dir`. A session-scratchpad / temp working
  // draft is not fleet source, so resolve it NON-fleet — that keeps a
  // fleet-only convention guard from firing on a draft the model stages there
  // for another repo. (A fleet worktree that lives under a temp dir already
  // returned true above via its `.config/fleet/`, and a plain `/tmp` worktree
  // has no scratch marker.) Any OTHER undeterminable path fails safe TO fleet
  // so a guard keeps enforcing rather than going quiet.
  return !isEphemeralPath(start)
}
