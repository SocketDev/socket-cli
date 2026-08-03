/**
 * @file Discover repo-owned check scripts. A member extends `check --all` by
 *   dropping assertion-named scripts into scripts/repo/check/ — the fleet/repo
 *   segmentation seam for checks (same shape as .claude/hooks/{fleet,repo}/
 *   and .github/actions/{fleet,repo}/). check.mts appends the discovered
 *   scripts to its fail-fast step list; the dir being absent is the vacuous
 *   pass every member starts from.
 */

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

export function discoverRepoChecks(repoRoot: string): string[] {
  const dir = path.join(repoRoot, 'scripts', 'repo', 'check')
  if (!existsSync(dir)) {
    return []
  }
  return readdirSync(dir)
    .filter(f => f.endsWith('.mts'))
    .toSorted()
    .map(f => `scripts/repo/check/${f}`)
}
