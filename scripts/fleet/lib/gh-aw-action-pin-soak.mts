/**
 * @file Soak-gate decision + enforcement for gh-aw compiled action SHA pins.
 *   Splits the pure partition logic (`actions-lock.json` parse, before/after
 *   diff, Socket-exempt / advanced / held partition) and the on-disk restore
 *   from the recompile driver in `../sync-gh-aw-action-pins.mts`, keeping that
 *   driver under the file-size cap and making the enforcement wiring
 *   (`soakGateCompile`'s restore-to-pre-compile + delete-fresh loop) unit
 *   testable without a `gh aw` subprocess.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

import { SOAK_DAYS } from '../constants/soak.mts'
import { isSocketSourcedRepository } from '../constants/socket-scopes.mts'

const DAY_MS = 86_400_000

// One resolved action pin from `actions-lock.json`.
export interface ActionPin {
  repo: string
  sha: string
  version: string
}

// A pin whose resolved SHA changed (or newly appeared) across a recompile,
// keyed by the action's `owner/repo/...` identity. `oldSha` is undefined for a
// newly-introduced action.
export interface ActionPinBump {
  newSha: string
  oldSha: string | undefined
  repo: string
  version: string
}

// A bump the soak gate refused: a NON-Socket action whose new SHA is younger
// than the soak window (or whose commit date could not be verified — fail
// closed). `committedAt` is undefined when the date was unresolvable.
export interface HeldActionPin {
  bump: ActionPinBump
  committedAt: Date | undefined
  remainingMs: number
}

// The soak partition of a set of pin bumps: `advanced` cleared the window,
// `exempt` are Socket-owned (own provenance pipeline, no soak), `held` are the
// too-young / unverifiable non-Socket bumps the gate keeps at their old pin.
export interface ActionPinPartition {
  advanced: ActionPinBump[]
  exempt: ActionPinBump[]
  held: HeldActionPin[]
}

// Resolves the commit date of `sha` in `owner/repo`. Injectable so the unit
// tests drive the partition without `gh` or the network; returns undefined when
// the date can't be resolved (an unverifiable date is never soak-cleared).
export type ResolveCommitDate = (
  ownerRepo: string,
  sha: string,
) => Date | undefined

// Parse `actions-lock.json` into a repo-keyed pin map. A malformed / empty
// document yields an empty map (a repo with no pinned actions is a vacuous
// pass, never a throw).
export function parseActionsLock(json: string): Map<string, ActionPin> {
  const out = new Map<string, ActionPin>()
  let doc: unknown
  try {
    doc = JSON.parse(json)
  } catch {
    return out
  }
  if (!doc || typeof doc !== 'object') {
    return out
  }
  const entries = (doc as { entries?: unknown | undefined }).entries
  if (!entries || typeof entries !== 'object') {
    return out
  }
  const values = Object.values(entries as Record<string, unknown>)
  for (let i = 0, { length } = values; i < length; i += 1) {
    const value = values[i]!
    if (!value || typeof value !== 'object') {
      continue
    }
    const { repo, sha, version } = value as {
      repo?: unknown | undefined
      sha?: unknown | undefined
      version?: unknown | undefined
    }
    if (
      typeof repo === 'string' &&
      typeof sha === 'string' &&
      typeof version === 'string'
    ) {
      out.set(repo, { repo, sha, version })
    }
  }
  return out
}

// Reduce a gh-aw action `repo` field (`owner/repo` or `owner/repo/subpath`) to
// the `owner/repo` slug the GitHub commits API needs. Returns the input
// unchanged when it has fewer than two segments.
export function actionOwnerRepo(repo: string): string {
  const parts = repo.split('/')
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : repo
}

// Diff two pin maps by repo identity: every after-pin whose SHA differs from
// its before-pin (or that is newly present) is a bump. Keying on repo (not the
// `repo@version` lock key) means a version bump that changes the key is still
// recognized as the same action advancing.
export function diffActionPins(
  before: Map<string, ActionPin>,
  after: Map<string, ActionPin>,
): ActionPinBump[] {
  const bumps: ActionPinBump[] = []
  for (const [repo, pin] of after) {
    const prior = before.get(repo)
    if (prior?.sha === pin.sha) {
      continue
    }
    bumps.push({
      newSha: pin.sha,
      oldSha: prior?.sha,
      repo,
      version: pin.version,
    })
  }
  return bumps.toSorted((a, b) => a.repo.localeCompare(b.repo))
}

// Soak-partition pin bumps. Socket-owned action repos are exempt (own
// provenance pipeline, mirroring the npm SOCKET_SCOPES bypass). Every other
// bump must clear `soakDays` measured from its new SHA's commit date; a
// too-young OR unverifiable date is held at the old pin. Pure given
// `resolveCommitDate` — the primary unit-test target.
export function partitionActionPinBumps(config: {
  bumps: readonly ActionPinBump[]
  now: Date
  resolveCommitDate: ResolveCommitDate
  soakDays: number
}): ActionPinPartition {
  const { bumps, now, resolveCommitDate, soakDays } = {
    __proto__: null,
    ...config,
  } as typeof config
  const soakMs = soakDays * DAY_MS
  const nowMs = now.getTime()
  const advanced: ActionPinBump[] = []
  const exempt: ActionPinBump[] = []
  const held: HeldActionPin[] = []
  for (let i = 0, { length } = bumps; i < length; i += 1) {
    const bump = bumps[i]!
    if (isSocketSourcedRepository(bump.repo)) {
      exempt.push(bump)
      continue
    }
    const committedAt = resolveCommitDate(
      actionOwnerRepo(bump.repo),
      bump.newSha,
    )
    if (!committedAt || Number.isNaN(committedAt.getTime())) {
      held.push({ bump, committedAt: undefined, remainingMs: soakMs })
      continue
    }
    const ageMs = nowMs - committedAt.getTime()
    if (ageMs >= soakMs) {
      advanced.push(bump)
    } else {
      held.push({ bump, committedAt, remainingMs: soakMs - ageMs })
    }
  }
  return { advanced, exempt, held }
}

// The deterministic `aw/actions-lock.json` path for a workflow source: out of
// `workflows/` into `.github/`, then into the sibling `aw/` dir. Derived by
// path shape, not by git tracking, so a first-time lock file is still gated.
export function actionsLockPathFor(mdPath: string): string {
  return path.join(
    path.dirname(path.dirname(mdPath)),
    'aw',
    'actions-lock.json',
  )
}

// The deterministic compiled `.lock.yml` path for a workflow source: the
// sibling of the `.md`. Derived by path shape so a first-time compile output
// is still covered by the soak restore.
export function lockYmlPathFor(mdPath: string): string {
  return mdPath.replace(/\.md$/u, '.lock.yml')
}

// Read `file`, returning '' when absent/unreadable (a missing lock file is an
// empty pin set, never a throw).
export function readFileSafe(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

// Enforce the soak window on the pins one recompile advanced. Diffs the
// workflow's `actions-lock.json` before/after; a non-Socket action whose new
// SHA is younger than SOAK_DAYS (or whose commit date can't be verified) is
// HELD — every output file is rolled back to its pre-compile state so a fresh
// third-party action can't land before its soak. Files that existed before are
// restored from `beforeContents`; files the recompile created fresh (absent
// from the snapshot) are deleted, so a brand-new lock introducing an un-soaked
// pin can't persist on disk. Socket action repos bypass (own provenance
// pipeline). Returns the held pins for reporting.
export function soakGateCompile(config: {
  beforeContents: ReadonlyMap<string, string>
  mdPath: string
  outputPaths: readonly string[]
  resolveCommitDate: ResolveCommitDate
}): HeldActionPin[] {
  const { beforeContents, mdPath, outputPaths, resolveCommitDate } = {
    __proto__: null,
    ...config,
  } as typeof config
  const lockPath = actionsLockPathFor(mdPath)
  const before = parseActionsLock(beforeContents.get(lockPath) ?? '')
  const after = parseActionsLock(readFileSafe(lockPath))
  const bumps = diffActionPins(before, after)
  if (bumps.length === 0) {
    return []
  }
  const { held } = partitionActionPinBumps({
    bumps,
    now: new Date(),
    resolveCommitDate,
    soakDays: SOAK_DAYS,
  })
  if (held.length === 0) {
    return []
  }
  for (const [file, content] of beforeContents) {
    writeFileSync(file, content, 'utf8')
  }
  for (let i = 0, { length } = outputPaths; i < length; i += 1) {
    const file = outputPaths[i]!
    if (!beforeContents.has(file) && existsSync(file)) {
      safeDeleteSync(file)
    }
  }
  return held
}
