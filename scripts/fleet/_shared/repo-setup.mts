/**
 * @file Discover repo-owned setup steps. A member extends the setup wizard by
 *   dropping runnable step scripts into scripts/repo/setup/ — the fleet/repo
 *   segmentation seam for setup (same shape as scripts/repo/check/ and
 *   .claude/hooks/{fleet,repo}/). The wizard (scripts/fleet/setup/index.mts)
 *   runs the discovered steps after its fleet steps; the dir being absent is
 *   the vacuous pass every member starts from. Steps run in sorted order, so an
 *   order-dependent step must sort after its prerequisite (e.g. native-host
 *   before trusted-publisher-extension).
 */

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

export function discoverRepoSetup(repoRoot: string): string[] {
  const dir = path.join(repoRoot, 'scripts', 'repo', 'setup')
  if (!existsSync(dir)) {
    return []
  }
  return readdirSync(dir)
    .filter(f => f.endsWith('.mts'))
    .toSorted()
    .map(f => `scripts/repo/setup/${f}`)
}
