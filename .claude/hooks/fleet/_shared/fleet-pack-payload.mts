// Shared "is this path the fleet-pack's payload?" classifier.
//
// In the thin model a consumer repo does not track the fleet payload. The
// fleet-pack release delivers it, `prepare` fetches it, and `.gitignore` keeps
// it out of the index. A healthy consumer therefore has ~2,000 untracked files
// under the payload roots at all times. That is CORRECT STATE, not dirt.
//
// Two failure modes this exists to stop, pulling in opposite directions:
//
//   1. An agent sees thousands of untracked files, reads the checkout as
//      broken, and "cleans up" — deleting a payload it cannot restore while
//      the release check is refusing, or committing it back into the repo and
//      undoing the thin conversion.
//
//   2. The dirty-worktree stop guard counts those files and blocks every
//      turn-end, demanding a commit that must never happen. That strands the
//      turn on work no one is allowed to land.
//
// One definition serves every consumer of it: the payload staging guard (which
// BLOCKS adds), this classifier's use in dirty-worktree-stop-guard (which
// EXCLUDES them from the count), and the auto-lander (which skips them). A
// second definition would drift, and the two guards would disagree about the
// same file.
//
// Source of truth: these roots mirror `fleetPackOwnedPaths` in the dep-0
// fetcher (scripts/repo/bootstrap/fleet.mjs), which computes the real untrack
// set from the release manifest. The patterns here are the cheap static form a
// hook can evaluate without importing the fetcher on every spawn;
// `fleet-pack-payload-roots-agree` (check) asserts the two never diverge.
//
// NOT payload, deliberately: `.github/workflows/**` and
// `.github/actions/fleet/**` stay TRACKED, because GitHub reads them from the
// committed branch tree before any fetch step could repopulate them. Hybrid
// files (scripts/fleet/check.mts, lint.mts, test.mts) and the dep-0 fetcher
// itself stay tracked for the same class of reason: something must exist
// before the payload arrives.

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

/**
 * Repo-relative path prefixes the fleet-pack owns. A consumer fetches these;
 * it never tracks them.
 */
export const FLEET_PACK_PAYLOAD_ROOTS: readonly string[] = [
  '.agents/',
  'scripts/fleet/',
]

/**
 * Paths that live UNDER a payload root but stay tracked anyway. The CI surface
 * must be committed for GitHub to read it, and the hybrid runners must exist
 * for `package.json` scripts to delegate to before a fetch has happened.
 */
export const FLEET_PACK_TRACKED_EXCEPTIONS: readonly string[] = [
  'scripts/fleet/check.mts',
  'scripts/fleet/lint.mts',
  'scripts/fleet/test.mts',
]

/**
 * True when `filePath` is fleet-pack payload: under a payload root, and not one
 * of the tracked exceptions. Pure, and cheap enough to call per porcelain line.
 *
 * Paths are normalized first so a Windows `scripts\fleet\x.mts` classifies the
 * same as its POSIX form — a separator-sensitive `startsWith` would silently
 * return false on Windows and let the payload through both guards.
 */
export function isFleetPackPayloadPath(filePath: string): boolean {
  const normalized = normalizePath(filePath)
  for (
    let i = 0, { length } = FLEET_PACK_TRACKED_EXCEPTIONS;
    i < length;
    i += 1
  ) {
    if (normalized === FLEET_PACK_TRACKED_EXCEPTIONS[i]) {
      return false
    }
  }
  for (let i = 0, { length } = FLEET_PACK_PAYLOAD_ROOTS; i < length; i += 1) {
    if (normalized.startsWith(FLEET_PACK_PAYLOAD_ROOTS[i]!)) {
      return true
    }
  }
  return false
}

/**
 * Split `paths` into the fleet-pack payload and everything else. Callers that
 * report counts use this so the payload can be named as expected state rather
 * than folded into a dirt total.
 */
export function splitFleetPackPayload(paths: readonly string[]): {
  other: string[]
  payload: string[]
} {
  const other: string[] = []
  const payload: string[] = []
  for (let i = 0, { length } = paths; i < length; i += 1) {
    const p = paths[i]!
    if (isFleetPackPayloadPath(p)) {
      payload.push(p)
    } else {
      other.push(p)
    }
  }
  return { other, payload }
}
