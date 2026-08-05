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
  // GitHub org, when the member lives outside the home org (SocketDev).
  readonly owner?: string | undefined
  // Release channels — select the packagers and which release workflows are
  // enabled. A LIST, because a member can ship to several at once: stuie goes
  // to both npm and crates.io, sdxgen to both npm and GitHub release assets.
  // Required and non-empty: `["none"]` has to be stated outright, so a member
  // that does publish can never be read as one that does not.
  readonly publishes: readonly FleetPublishTarget[]
}

export interface FleetRoster {
  readonly repos: readonly FleetRepo[]
}

// The complete set of capability opt-ins a roster entry may declare in its
// `optIns` array. This tuple is the single source of truth for which
// capabilities exist — a member opts into one by listing it, and any value
// outside this set is a typo the roster validator rejects. Kept sorted.
//   - squash-history: default branch is squashed on a cadence (local is
//     canonical, origin holds pre-squash history).
export const KNOWN_OPT_INS = ['squash-history'] as const

export type FleetOptIn = (typeof KNOWN_OPT_INS)[number]

// Every release channel a member may declare. Single source of truth for
// `publishes`, so a new channel validates only after it is added here. Kept
// sorted.
//   - binary: signed executables attached to a GitHub release.
//   - cargo: a crate on crates.io.
//   - custom: a channel with its own publisher (an editor or browser
//     extension marketplace).
//   - github-action: consumed as `owner/repo@<tag>` straight from the git
//     tree. Named for the channel rather than a bare `action`, which reads as
//     any generic action.
//   - js: an npm package.
//   - none: nothing ships; the repo is consumed in place or internal only.
export const KNOWN_PUBLISH_TARGETS = [
  'binary',
  'cargo',
  'custom',
  'github-action',
  'js',
  'none',
] as const

export type FleetPublishTarget = (typeof KNOWN_PUBLISH_TARGETS)[number]

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

/**
 * The GitHub org/owner segment from a git remote URL — the path component
 * immediately before the repo segment `repoNameFromRemoteUrl` extracts.
 * Handles both `git@github.com:Owner/repo.git` (ssh, `:` before the owner)
 * and `https://github.com/Owner/repo.git` (https, `/` throughout). Splits on
 * every `/` and `:` after stripping a trailing `.git`, the same separator
 * handling as `repoNameFromRemoteUrl`; undefined when the remote has fewer
 * than two path segments (no owner to extract).
 */
export function ownerFromRemoteUrl(remote: string): string | undefined {
  const normalized = normalizePath(remote.trim()).replace(/\.git$/, '')
  const segments = normalized.split(/[/:]/).filter(Boolean)
  return segments.length >= 2 ? segments[segments.length - 2] : undefined
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
 * The roster entry for `repoName`, or undefined when the roster does not name
 * it. Presence is an answer in its own right: a repo the roster never lists is
 * not a member, which is a different fact from a member that declares
 * `publishes: ["none"]`.
 */
export function findRosterRepo(
  roster: FleetRoster,
  repoName: string,
): FleetRepo | undefined {
  for (let i = 0, { length } = roster.repos; i < length; i += 1) {
    const repo = roster.repos[i]!
    if (repo.name === repoName) {
      return repo
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
  const repo = findRosterRepo(roster, repoName)
  return (repo?.optIns ?? []).includes(optIn)
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
 * True when `value` is one of the KNOWN_PUBLISH_TARGETS channels.
 */
export function isKnownPublishTarget(
  value: string,
): value is FleetPublishTarget {
  return (KNOWN_PUBLISH_TARGETS as readonly string[]).includes(value)
}

/**
 * The publish channels a roster entry declares, read from parsed JSON rather
 * than trusted from the type. Accepts the list every canonical entry carries
 * and a lone string, which is how a single-channel member reads, and drops
 * anything outside KNOWN_PUBLISH_TARGETS so an unknown value can never reach a
 * caller as a channel. An empty result means "nothing readable was declared",
 * which is a different answer from `['none']`.
 *
 * The strictness lives in `validateRosterPublishes`, which gates the roster
 * this repo owns. A reader looking at some other checkout's copy has to cope
 * with whatever is on disk there instead of throwing.
 */
export function normalizePublishTargets(
  value: unknown,
): readonly FleetPublishTarget[] {
  const raw = typeof value === 'string' ? [value] : value
  if (!Array.isArray(raw)) {
    return []
  }
  const targets: FleetPublishTarget[] = []
  for (let i = 0, { length } = raw; i < length; i += 1) {
    const entry: unknown = raw[i]
    if (typeof entry === 'string' && isKnownPublishTarget(entry)) {
      targets.push(entry)
    }
  }
  return targets
}

/**
 * Validate every member's `publishes` against KNOWN_PUBLISH_TARGETS. Returns
 * one error string per member that omits it or names a channel outside the
 * set.
 *
 * An omission is an error rather than a default, because the reader cannot
 * tell "nothing ships" from "nobody filled this in" — and guessing `none` for
 * the second case hides a member's real release channel from everything that
 * derives behaviour from this field.
 */
export function validateRosterPublishes(roster: FleetRoster): string[] {
  const errors: string[] = []
  for (let i = 0, { length } = roster.repos; i < length; i += 1) {
    const repo = roster.repos[i]!
    const declared: unknown = repo.publishes
    if (!Array.isArray(declared) || declared.length === 0) {
      errors.push(
        `${repo.name}: missing "publishes" — declare a non-empty list drawn from ${KNOWN_PUBLISH_TARGETS.join(', ')} (use ["none"] when nothing ships).`,
      )
      continue
    }
    const seen = new Set<string>()
    for (let j = 0, count = declared.length; j < count; j += 1) {
      const target: unknown = declared[j]
      if (typeof target !== 'string' || !isKnownPublishTarget(target)) {
        errors.push(
          `${repo.name}: unknown publish target "${String(target)}" — known targets are ${KNOWN_PUBLISH_TARGETS.join(', ')}.`,
        )
        continue
      }
      if (seen.has(target)) {
        errors.push(`${repo.name}: duplicate publish target "${target}".`)
      }
      seen.add(target)
    }
    // `none` means nothing ships, so pairing it with a real channel states two
    // contradictory things and leaves the reader no way to tell which is true.
    if (seen.has('none') && seen.size > 1) {
      errors.push(
        `${repo.name}: "none" cannot be combined with another target — drop it, or make it the only entry.`,
      )
    }
  }
  return errors
}

/**
 * The release channels for `repoName`, drawn from KNOWN_PUBLISH_TARGETS. They
 * select the packagers and which release workflows a repo enables.
 *
 * Falls back to `['none']` only when the repo is absent from the roster — a
 * present member always declares at least one, which
 * `validateRosterPublishes` enforces. A present member whose declaration is
 * unreadable yields an empty list, so a caller can tell "declared nothing
 * ships" from "declared something this reader cannot make sense of".
 */
export function publishChannels(
  roster: FleetRoster,
  repoName: string,
): readonly FleetPublishTarget[] {
  const repo = findRosterRepo(roster, repoName)
  return repo ? normalizePublishTargets(repo.publishes) : ['none']
}

/**
 * True when `repoName` ships to `target`. The question nearly every caller
 * actually has, and it reads the same whether the member has one channel or
 * several.
 */
export function publishesTo(
  roster: FleetRoster,
  repoName: string,
  target: FleetPublishTarget,
): boolean {
  return publishChannels(roster, repoName).includes(target)
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
 *
 * Thin is not an opt-in: EVERY roster member is a thin consumer. Two shapes
 * fall outside it, by identity rather than configuration:
 *
 * - A checkout that is not on the roster at all — the fleet default applies to
 *   members, never to an arbitrary repo holding a roster copy on disk.
 * - The wheelhouse itself — it PRODUCES the bundle, so fetching its own payload
 *   would be circular; the producer is never a consumer.
 */
export function isThinMember(repoRoot: string): boolean {
  const roster = loadRosterFromRepo(repoRoot)
  if (!roster) {
    return false
  }
  const name = resolveRepoName(repoRoot)
  if (!name || name === 'socket-wheelhouse') {
    return false
  }
  return !!findRosterRepo(roster, name)
}
