/*
 * @file How far back the AI-attribution scan should look.
 *
 *   The rule exists to keep attribution trailers OUT of history. Once a commit
 *   is published, that ship has sailed: clearing it means rewriting released
 *   history and force-pushing, which orphans provenance attestations and
 *   invalidates every SHA a fork, clone, or PR link resolves. That trade was
 *   measured on a real member — nine trailers against a rewrite of a
 *   1,600-commit range — and rejected.
 *
 *   A whole-history scan therefore reports findings nobody will ever action,
 *   and a check that always fails stops being read. The horizon bounds the
 *   scan to the commits that are still REWRITABLE, so a failure is always
 *   something the author can fix right now.
 *
 *   Three scopes, narrowest first:
 *
 *   - `unpushed` — commits not yet on the default branch. The tightest, and
 *     the right default for a pre-commit or in-PR run.
 *   - `since-release` — commits after the newest release tag. The right gate
 *     for a default branch that accumulates work between releases: it covers
 *     everything a maintainer can still consolidate before cutting one.
 *   - `all` — every reachable commit. Correct for an audit, wrong for a gate.
 *
 *   A horizon NEVER silently narrows a clean-history claim: the scan reports
 *   which scope produced the verdict, so "no findings" always says what it
 *   looked at.
 */

export type HorizonScope = 'all' | 'since-release' | 'unpushed'

/**
 * A resolved horizon: the git revision the scan starts after, plus the scope
 * that produced it for the report.
 *
 * `startAfter` undefined means no lower bound — the whole history.
 */
export interface ScanHorizon {
  readonly scope: HorizonScope
  readonly startAfter: string | undefined
}

// A release tag: `v` then a semver core. Deliberately strict — a moving tag
// like `latest`, or a build-asset pin such as `base-assets-<name>-<date>`, is
// not a release boundary, and treating one as the horizon would silently skip
// real commits.
const RELEASE_TAG_RE = /^v\d+\.\d+\.\d+(?:[-+].+)?$/

export function isReleaseTag(tag: string): boolean {
  return RELEASE_TAG_RE.test(tag)
}

/**
 * The newest release tag from `git tag --merged <branch> --sort=-creatordate`
 * output, or undefined when the branch carries none.
 *
 * Takes the FIRST matching line rather than sorting here: git already ordered
 * them by creation date, and re-deriving an order from the tag text would get
 * `v1.1.10` vs `v1.1.9` wrong.
 */
export function newestReleaseTag(mergedTagsOutput: string): string | undefined {
  const lines = mergedTagsOutput.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const tag = lines[i]!.trim()
    if (tag !== '' && isReleaseTag(tag)) {
      return tag
    }
  }
  return undefined
}

/**
 * Resolve the horizon for a requested scope.
 *
 * `since-release` falls back to `all` when the branch carries no release tag —
 * a repo that has never released has no published history to protect, so the
 * whole thing is still rewritable and scanning it is correct rather than
 * noisy. The returned scope records the fallback so the report cannot claim a
 * narrower scan than it ran.
 */
export function resolveHorizon(
  requested: HorizonScope,
  mergedTagsOutput: string,
): ScanHorizon {
  if (requested !== 'since-release') {
    return { scope: requested, startAfter: undefined }
  }
  const tag = newestReleaseTag(mergedTagsOutput)
  if (tag === undefined) {
    return { scope: 'all', startAfter: undefined }
  }
  return { scope: 'since-release', startAfter: tag }
}

/**
 * The `git log` range for a horizon: `<startAfter>..HEAD`, or `HEAD` when the
 * scan is unbounded.
 */
export function horizonRange(horizon: ScanHorizon): string {
  return horizon.startAfter === undefined
    ? 'HEAD'
    : `${horizon.startAfter}..HEAD`
}

/**
 * One line naming what the scan actually covered, so a pass is never mistaken
 * for a whole-history clean bill.
 */
export function describeHorizon(horizon: ScanHorizon): string {
  if (horizon.scope === 'unpushed') {
    return 'commits not yet on the default branch'
  }
  if (horizon.scope === 'since-release') {
    return `commits since ${String(horizon.startAfter)}`
  }
  return 'all reachable history'
}
