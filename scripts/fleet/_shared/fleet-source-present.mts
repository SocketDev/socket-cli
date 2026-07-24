/**
 * @file Presence probes for fleet SOURCE trees. A bundle-only member runs
 *   hooks from `.claude/hooks/fleet/_dist/bundle.cjs` and lint rules from
 *   `.config/fleet/oxlint-plugin.mjs` — the per-hook / per-rule SOURCE dirs
 *   live only in the wheelhouse. Source-shape checks (registry docs, dispatch
 *   regen, CLAUDE.md citation resolution, enforcer inventory) validate SOURCE,
 *   so they gate on these probes and skip where no source ships instead of
 *   false-failing against an intentionally absent tree.
 */

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

// Count `<name>/index.mts` dirs (skipping `_`-prefixed infra like `_shared/` +
// `_dispatch/`) under a fleet source root. 0 = no source ships here.
function countSourceDirs(root: string): number {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return 0
  }
  let count = 0
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const d = entries[i]!
    if (
      d.isDirectory() &&
      !d.name.startsWith('_') &&
      existsSync(path.join(root, d.name, 'index.mts'))
    ) {
      count += 1
    }
  }
  return count
}

/**
 * True when per-hook SOURCE dirs exist under `.claude/hooks/fleet/` (the
 * wheelhouse, or a member before the bundle-only cutover).
 */
export function hasFleetHookSource(repoRoot: string): boolean {
  return countSourceDirs(path.join(repoRoot, '.claude', 'hooks', 'fleet')) > 0
}

/**
 * True when per-rule SOURCE dirs exist under
 * `.config/fleet/oxlint-plugin/fleet/`.
 */
export function hasOxlintRuleSource(repoRoot: string): boolean {
  return (
    countSourceDirs(
      path.join(repoRoot, '.config', 'fleet', 'oxlint-plugin', 'fleet'),
    ) > 0
  )
}
