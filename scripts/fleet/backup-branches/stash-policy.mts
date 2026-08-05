/*
 * @file The stash-lane classifier, as pure data + pure functions — no git, no
 *   network, so every rule here is unit-testable without a fixture repo.
 *   `stashes.mts` gathers the evidence and performs the archive + drop. Twin of
 *   `policy.mts`, which does the same job for the branch lane.
 *
 *   `git stash` belongs to the CHECKOUT rather than to any one session: every
 *   agent session, every hand-run `git stash push`, and every flow that parks
 *   work before a rebase pushes onto one shared list nothing ever sweeps. A
 *   wheelhouse checkout held 11 when this was written, the oldest naming paths
 *   that two renames had already retired.
 *
 *   A stash is SUPERSEDED when its content is already accounted for. Three
 *   tests, in the order a verdict prefers them:
 *
 *   1. ALREADY-APPLIED — the stash's own diff reverse-applies to the current
 *      tree, so the tree already carries every hunk.
 *   2. PATHS-GONE — every path it touches is absent from the checkout, so a
 *      rename or a relocation superseded the file it was editing.
 *   3. REGENERABLE-ONLY — it touches nothing but files a script recreates (a
 *      lockfile, the composed workspace yaml), so the bytes are reproducible.
 *
 *   Anything else is KEPT, with the reason recorded. So is anything whose
 *   evidence is incomplete: a probe that could not run is BLINDNESS, and
 *   blindness is not absence. That is the same fail-closed posture
 *   `findUniqueContent` takes in the branch lane, and for the same reason — a
 *   stash is frequently the only copy of the work in it.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

// Files a script owns end to end, so the bytes in a stash are reproducible
// rather than lost. Matched by EXACT basename: the fleet's canonical catalog
// SOURCE is `.config/fleet/pnpm-workspace.fleet.yaml`, hand-edited and
// cascaded, so a looser `*.yaml` or `*.fleet.yaml` rule would classify the one
// workspace file that is NOT regenerable. The root `pnpm-workspace.yaml` is
// composed from that source by the cascade, and the lockfiles come back from
// their package manager's install.
export const REGENERABLE_BASENAMES: ReadonlySet<string> = new Set([
  'Cargo.lock',
  'go.sum',
  'package-lock.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'uv.lock',
  'yarn.lock',
])

// Directories that hold build output only. A path with one of these as a whole
// segment is regenerable by the build that emits it.
export const REGENERABLE_DIR_SEGMENTS: ReadonlySet<string> = new Set([
  '_dist',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'target',
])

/**
 * True when a script can recreate `filePath`'s bytes — a lockfile, the composed
 * workspace yaml, or anything inside a build-output directory.
 *
 * This is a REGENERABILITY question, not the lint gate's
 * `isNeverGated`: that one answers "never format- or lint-check this," which
 * covers `.d.ts` output and vendored trees but says nothing about a lockfile.
 */
export function isRegenerablePath(filePath: string): boolean {
  const segments = normalizePath(filePath).split('/')
  const basename = segments[segments.length - 1]
  if (basename !== undefined && REGENERABLE_BASENAMES.has(basename)) {
    return true
  }
  for (let i = 0, { length } = segments; i < length - 1; i += 1) {
    if (REGENERABLE_DIR_SEGMENTS.has(segments[i]!)) {
      return true
    }
  }
  return false
}

export type StashSupersededReason =
  | 'already-applied'
  | 'paths-gone'
  | 'regenerable-only'

/**
 * Everything the classifier needs about one stash, gathered by `stashes.mts`.
 *
 * The three probe fields are TRI-STATE on purpose. `undefined` means the probe
 * could not run, which must never read as a passing test — see the blindness
 * branch in {@link classifyStashEvidence}.
 */
export interface StashEvidence {
  // Position in `git stash list` at the moment it was read. Shifts whenever
  // anything drops or pushes a stash, which is why `sha` is the real identity.
  readonly index: number
  // The stash commit's SHA — stable, and what the archive ref points at.
  readonly sha: string
  // The `git stash list` subject, e.g. `On main: pre lib-6.2.2 bump`.
  readonly subject: string
  // Every path the stash touches, tracked changes AND carried untracked files.
  readonly touchedPaths: readonly string[] | undefined
  // Whether `git apply --reverse --check` accepted the stash's own patch.
  readonly reverseApplies: boolean | undefined
  // Which of `touchedPaths` still exist in the checkout.
  readonly presentPaths: readonly string[] | undefined
}

export interface StashVerdict {
  readonly index: number
  readonly sha: string
  readonly subject: string
  readonly superseded: boolean
  // Which of the three tests fired. Undefined when the stash is kept.
  readonly reason: StashSupersededReason | undefined
  // The receipt for the verdict, phrased for an operator deciding by hand.
  readonly evidence: string
}

// Evidence lines name paths; print enough to judge, not a wall.
export const MAX_EVIDENCE_PATHS_SHOWN = 6

/**
 * Render up to {@link MAX_EVIDENCE_PATHS_SHOWN} paths, noting how many more
 * there are so the count in the sentence is always the TRUE total.
 */
export function formatEvidencePaths(paths: readonly string[]): string {
  const shown = paths.slice(0, MAX_EVIDENCE_PATHS_SHOWN)
  const rest = paths.length - shown.length
  return rest > 0
    ? `${shown.join(', ')}, and ${String(rest)} more`
    : shown.join(', ')
}

/**
 * Classify one stash from its gathered evidence.
 *
 * Every probe runs before this is called, rather than short-circuiting on the
 * first hit, so a probe that FAILED can never be mistaken for one that passed.
 * The ordering below is the verdict's preference — cheapest, most direct
 * explanation first — not an evaluation order.
 */
export function classifyStashEvidence(evidence: StashEvidence): StashVerdict {
  const { index, reverseApplies, sha, subject } = evidence
  const base = { index, sha, subject }
  const blind: string[] = []
  if (evidence.touchedPaths === undefined) {
    blind.push('touched-paths')
  }
  if (reverseApplies === undefined) {
    blind.push('reverse-apply')
  }
  if (evidence.presentPaths === undefined) {
    blind.push('present-paths')
  }
  if (blind.length > 0) {
    return {
      ...base,
      evidence:
        `classification is incomplete — the ${blind.join(' and ')} probe(s) ` +
        `could not run, and blindness is not absence`,
      reason: undefined,
      superseded: false,
    }
  }
  const touchedPaths = evidence.touchedPaths!
  const total = touchedPaths.length
  if (total === 0) {
    return {
      ...base,
      evidence: 'it touches no path, so there is nothing to compare against',
      reason: undefined,
      superseded: false,
    }
  }
  if (reverseApplies === true) {
    return {
      ...base,
      evidence:
        `its diff reverse-applies to the current tree, so all ` +
        `${String(total)} path(s) already carry this content`,
      reason: 'already-applied',
      superseded: true,
    }
  }
  const present = new Set(evidence.presentPaths!)
  const gone: string[] = []
  const regenerable: string[] = []
  for (let i = 0; i < total; i += 1) {
    const touched = touchedPaths[i]!
    if (!present.has(touched)) {
      gone.push(touched)
    }
    if (isRegenerablePath(touched)) {
      regenerable.push(touched)
    }
  }
  if (gone.length === total) {
    return {
      ...base,
      evidence:
        `all ${String(total)} path(s) it touches are gone from the ` +
        `checkout, so a rename or relocation superseded them: ` +
        `${formatEvidencePaths(gone)}`,
      reason: 'paths-gone',
      superseded: true,
    }
  }
  if (regenerable.length === total) {
    return {
      ...base,
      evidence:
        `all ${String(total)} path(s) it touches are regenerable by a ` +
        `script: ${formatEvidencePaths(regenerable)}`,
      reason: 'regenerable-only',
      superseded: true,
    }
  }
  const held: string[] = []
  for (let i = 0; i < total; i += 1) {
    const touched = touchedPaths[i]!
    if (present.has(touched) && !isRegenerablePath(touched)) {
      held.push(touched)
    }
  }
  return {
    ...base,
    evidence:
      `its diff does not reverse-apply, and ${String(held.length)} of ` +
      `${String(total)} path(s) it touches still exist and are not ` +
      `regenerable: ${formatEvidencePaths(held)}`,
    reason: undefined,
    superseded: false,
  }
}
