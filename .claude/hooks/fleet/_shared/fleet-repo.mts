/**
 * @file Detect whether an edited file belongs to a FLEET-MANAGED repo. Fleet
 *   edit-time guards that merely mirror a fleet LINT RULE (logger over
 *   console, function declarations over arrow consts, `import type`, …) must
 *   not fire on a non-fleet sibling repo: those repos run their own toolchain
 *   (biome, eslint, whatever) and the fleet conventions simply don't apply
 *   there, so a fleet session editing a non-fleet repo would otherwise demand
 *   `socket-lint` opt-out comments in code that isn't fleet-linted at all.
 *
 *   A repo is fleet-managed iff its root carries `.config/fleet/` (the cascaded
 *   fleet oxlint/oxfmt config tree — present in every fleet member, absent in
 *   non-fleet repos). Detection walks up from the file to the first `.git`
 *   repo root.
 *
 *   FAIL-SAFE: when the repo can't be determined (no `.git` found before the
 *   filesystem root), assume fleet-managed so a guard keeps enforcing rather
 *   than silently going quiet. Security / safety guards (secret content,
 *   personal paths, git-state) must NOT use this — they apply everywhere, so
 *   they don't opt into the fleet-only skip.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

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
  let cur = path.resolve(dir)
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
  return true
}
