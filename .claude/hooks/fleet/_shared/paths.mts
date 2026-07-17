/**
 * @file Canonical filesystem paths shared by fleet hooks. Paths are built here
 *   once and consumed by runtime code and tests instead of being reconstructed
 *   at each call site.
 */

import path from 'node:path'

const FLEET_ROSTER_RELATIVE_PATHS: readonly string[] = [
  'template/base/.claude/skills/fleet/cascading-fleet/lib/fleet-repos.json',
  '.claude/skills/fleet/cascading-fleet/lib/fleet-repos.json',
]

export function fleetRosterPaths(repoRoot: string): readonly string[] {
  return FLEET_ROSTER_RELATIVE_PATHS.map(relativePath =>
    path.join(repoRoot, relativePath),
  )
}
