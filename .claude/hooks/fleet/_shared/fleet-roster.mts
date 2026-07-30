/*
 * @file Shared reader for the cascade roster (cascading-fleet/lib/
 *   fleet-repos.json) and its per-repo opt-ins. Distinct from fleet-repos.mts,
 *   which is the BROAD membership set ("may fleet tooling act on this repo at
 *   all"): the roster lists template-cascade targets and what each has opted
 *   into (e.g. `squash-history`).
 *
 *   Consumed by squash-history-nudge and the divergence hooks (land-fast-nudge)
 *   so a squash-history repo's diverged / orphan default branch is recognized
 *   as the EXPECTED, canonical state — origin carries the pre-squash history and
 *   local is the source of truth — rather than a fast-land cherry-pick target.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { gitOut } from './git-branch.mts'
import { fleetRosterPaths } from './paths.mts'

export interface FleetRepo {
  readonly name: string
  readonly optIns?: readonly string[] | undefined
  // Release profile (selects the packager + which release workflow is enabled):
  // 'js' | 'node' | 'binary' | 'custom' | 'none'. Unset = 'none' (advisory).
  readonly publishes?: string | undefined
}

export interface FleetRoster {
  readonly repos: readonly FleetRepo[]
}

// The complete set of capability opt-ins a roster entry may declare in its
// `optIns` array. This tuple is the single source of truth for which
// capabilities exist — a member opts into one by listing it, and any value
// outside this set is a typo the roster validator rejects. Kept sorted.
//   - freeform-readme: public README is exempt from the five-section skeleton.
//   - squash-history: default branch is squashed on a cadence (local is
//     canonical, origin holds pre-squash history).
//   - thin: member is a thin-distribution consumer — it untracks the
//     wholly-fleet payload and fetches it from the release bundle.
export const KNOWN_OPT_INS = [
  'freeform-readme',
  'squash-history',
  'thin',
] as const

export type FleetOptIn = (typeof KNOWN_OPT_INS)[number]

/**
 * Identify the canonical repo name for the checkout at `cwd`. Prefer the GitHub
 * remote slug (survives checkout-dir renames like `socket-cli-fix-foo`); fall
 * back to the working-tree basename.
 */
export function repoNameFromRemoteUrl(remote: string): string | undefined {
  // Git preserves native separators in local file remotes on Windows. Treat
  // those like URL separators before extracting the final repo segment.
  const normalized = normalizePath(remote.trim())
  const m = /[/:](?<repo>[^/:]+?)(?:\.git)?$/.exec(normalized)
  return m?.groups?.['repo']
}

export function resolveRepoName(cwd: string): string | undefined {
  const remote = gitOut(cwd, ['config', '--get', 'remote.origin.url'])
  const remoteName = remote ? repoNameFromRemoteUrl(remote) : undefined
  if (remoteName) {
    return remoteName
  }
  const base = path.basename(cwd)
  return base || undefined
}

/**
 * Parse a roster JSON file, or `undefined` when missing / unparseable.
 */
export function readRoster(rosterPath: string): FleetRoster | undefined {
  if (!existsSync(rosterPath)) {
    return undefined
  }
  try {
    return JSON.parse(readFileSync(rosterPath, 'utf8')) as FleetRoster
  } catch {
    return undefined
  }
}

/**
 * Load the cascade roster relative to a repo root, trying the in-repo template
 * seed first, so the wheelhouse itself resolves, then the live tree.
 */
export function loadRosterFromRepo(repoRoot: string): FleetRoster | undefined {
  const candidates = fleetRosterPaths(repoRoot)
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const roster = readRoster(candidates[i]!)
    if (roster) {
      return roster
    }
  }
  return undefined
}

/**
 * True when `repoName` has opted into `optIn` in the roster.
 */
export function isOptedIn(
  roster: FleetRoster,
  repoName: string,
  optIn: string,
): boolean {
  for (let i = 0, { length } = roster.repos; i < length; i += 1) {
    const r = roster.repos[i]!
    if (r.name === repoName) {
      return (r.optIns ?? []).includes(optIn)
    }
  }
  return false
}

/**
 * True when `value` is one of the KNOWN_OPT_INS capabilities. A member's
 * `optIns` entry that fails this predicate is a typo, not a capability.
 */
export function isKnownOptIn(value: string): value is FleetOptIn {
  return (KNOWN_OPT_INS as readonly string[]).includes(value)
}

/**
 * Validate every member's `optIns` against KNOWN_OPT_INS. Returns one error
 * string per unrecognized opt-in (naming the member, the bad value, and the
 * known set). An empty array means the roster's capability declarations are all
 * valid — so a new capability validates only after it is added to
 * KNOWN_OPT_INS, and a typo like `thn` is rejected.
 */
export function validateRosterOptIns(roster: FleetRoster): string[] {
  const errors: string[] = []
  for (let i = 0, { length } = roster.repos; i < length; i += 1) {
    const repo = roster.repos[i]!
    const optIns = repo.optIns ?? []
    for (let j = 0, count = optIns.length; j < count; j += 1) {
      const optIn = optIns[j]!
      if (!isKnownOptIn(optIn)) {
        errors.push(
          `${repo.name}: unknown opt-in "${optIn}" — known opt-ins are ${KNOWN_OPT_INS.join(', ')}.`,
        )
      }
    }
  }
  return errors
}

/**
 * The release profile for `repoName` — `js` | `node` | `binary` | `custom` |
 * `none`. Selects the packager + which release workflow a repo enables.
 * Defaults to `none` when unset or the repo is absent.
 */
export function publishProfile(roster: FleetRoster, repoName: string): string {
  for (let i = 0, { length } = roster.repos; i < length; i += 1) {
    const r = roster.repos[i]!
    if (r.name === repoName) {
      return r.publishes ?? 'none'
    }
  }
  return 'none'
}

/**
 * True when the checkout at `repoRoot` has opted into `optIn` — loads the
 * repo's roster and resolves its canonical name, then checks its `optIns`.
 * Returns false when the roster is missing or the name is unresolvable.
 */
export function isRepoOptedIn(repoRoot: string, optIn: FleetOptIn): boolean {
  const roster = loadRosterFromRepo(repoRoot)
  if (!roster) {
    return false
  }
  const name = resolveRepoName(repoRoot)
  if (!name) {
    return false
  }
  return isOptedIn(roster, name, optIn)
}

/**
 * True when the checkout at `repoRoot` is opted into the squash-history
 * cadence. For such a repo, local <default-branch> is canonical and origin
 * holds the pre-squash history — a diverged / orphan main is EXPECTED, resolved
 * by a force-push (`SQUASH_HISTORY=1 git push --force-with-lease`), never a
 * fast-land cherry-pick onto origin.
 */
export function isSquashOptIn(repoRoot: string): boolean {
  return isRepoOptedIn(repoRoot, 'squash-history')
}

/**
 * True when the checkout at `repoRoot` is a thin-distribution consumer — it
 * untracks the wholly-fleet payload and fetches it from the release bundle.
 * The roster is the single source of truth for thin membership: enforcement
 * the belt-wiring check, derives from this, never from a hand-maintained list.
 */
export function isThinOptIn(repoRoot: string): boolean {
  return isRepoOptedIn(repoRoot, 'thin')
}
