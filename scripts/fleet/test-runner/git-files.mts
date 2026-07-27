/**
 * @file Git-backed file discovery for the fleet test runner
 *   (scripts/fleet/test.mts): the staged / modified / untracked path lists the
 *   scope resolver works from. Each call shells out to git via a no-shell
 *   spawnSync (per socket/prefer-spawn-over-execsync).
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

export function gitFiles(args: string[], cwd?: string | undefined): string[] {
  // spawnSync with array args — no shell interpolation. Matches the
  // socket/prefer-spawn-over-execsync rule contract.
  const r = spawnSync('git', args, {
    ...(cwd ? { cwd } : {}),
    stdio: ['ignore', 'pipe', 'pipe'],
    stdioString: true,
  })
  if (r.status !== 0 || typeof r.stdout !== 'string') {
    return []
  }
  return r.stdout
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

export function getStagedFiles(): string[] {
  return gitFiles(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
}

export function getModifiedFiles(): string[] {
  return gitFiles(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD'])
}

// Untracked, non-ignored paths (git's "others"). Excluded from the staged run
// so a foreign, mid-write test another live actor hasn't committed yet can't
// gate a staged commit on a file outside its own scope.
export function getUntrackedFiles(): string[] {
  return gitFiles(['ls-files', '--others', '--exclude-standard'])
}
