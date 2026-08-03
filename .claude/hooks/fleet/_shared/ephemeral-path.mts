/**
 * @file Classify a path as an EPHEMERAL scratch location — the agent session
 *   scratchpad or a `/tmp` working draft — that is never committed repo source.
 *   A path qualifies only when it is BOTH under an OS temp root AND in a
 *   recognizable scratch area: a `scratchpad/` segment or an agent session temp
 *   dir (`claude-<uid>/`). A repo worktree that merely happens to be checked
 *   out under `/tmp` (a CI runner, a `git worktree` in `/private/tmp`) has
 *   neither marker, so it is NOT ephemeral. Roots are segment-anchored, so a
 *   repo dir merely NAMED `tmp` is unaffected. Shared so two concerns agree on
 *   "this is scratch, not repo source": markdown-filename-guard skips its
 *   doc-name rules for these paths, and the fleet-context detectors
 *   (isFleetManagedDir / isFleetTarget) resolve them NON-fleet instead of
 *   failing safe toward fleet — so a fleet-only convention guard doesn't fire
 *   on a draft the model stages there for another repo.
 */

import os from 'node:os'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

/**
 * True when `absPath` is a session scratchpad / temp working draft: under an OS
 * temp root AND carrying a `scratchpad/` or `claude-<uid>/` scratch marker.
 */
export function isEphemeralPath(absPath: string): boolean {
  const normalized = normalizePath(absPath)
  const underTempRoot = [
    normalizePath(os.tmpdir()),
    '/private/tmp',
    '/private/var/folders',
    '/tmp',
    '/var/folders',
  ].some(root => normalized === root || normalized.startsWith(`${root}/`))
  if (!underTempRoot) {
    return false
  }
  return (
    /\/scratchpad(?:\/|$)/.test(normalized) || /\/claude-\d+\//.test(normalized)
  )
}
