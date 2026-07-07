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

import { gitOut } from './git-branch.mts'

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

/**
 * Identify the canonical repo name for the checkout at `cwd`. Prefer the GitHub
 * remote slug (survives checkout-dir renames like `socket-cli-fix-foo`); fall
 * back to the working-tree basename.
 */
export function resolveRepoName(cwd: string): string | undefined {
  const remote = gitOut(cwd, ['config', '--get', 'remote.origin.url'])?.trim()
  if (remote) {
    // git@github.com:Org/repo.git OR https://github.com/Org/repo(.git)?
    const m = /[/:](?<repo>[^/:]+?)(?:\.git)?$/.exec(remote)
    if (m?.groups?.['repo']) {
      return m.groups['repo']
    }
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
 * seed first (so the wheelhouse itself resolves) then the live tree.
 */
export function loadRosterFromRepo(repoRoot: string): FleetRoster | undefined {
  const candidates = [
    path.join(
      repoRoot,
      'template/base/.claude/skills/fleet/cascading-fleet/lib/fleet-repos.json',
    ),
    path.join(
      repoRoot,
      '.claude/skills/fleet/cascading-fleet/lib/fleet-repos.json',
    ),
  ]
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
 * True when the checkout at `repoRoot` is opted into the squash-history
 * cadence. For such a repo, local <default-branch> is canonical and origin
 * holds the pre-squash history — a diverged / orphan main is EXPECTED, resolved
 * by a force-push (`SQUASH_HISTORY=1 git push --force-with-lease`), never a
 * fast-land cherry-pick onto origin.
 */
export function isSquashOptIn(repoRoot: string): boolean {
  const roster = loadRosterFromRepo(repoRoot)
  if (!roster) {
    return false
  }
  const name = resolveRepoName(repoRoot)
  if (!name) {
    return false
  }
  return isOptedIn(roster, name, 'squash-history')
}
