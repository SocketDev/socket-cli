/*
 * @file The release boundary for `commits-have-no-ai-attribution`: the commit
 *   at or below which the scanned branch's history is already published, so a
 *   finding there is frozen rather than actionable. Rewriting a published
 *   commit breaks the provenance of the release built from it, which makes
 *   reporting it noise the operator cannot act on.
 *   Resolution is OFFLINE and deterministic, because a fleet check has to give
 *   the same verdict in CI as on a laptop. Two sources, in order:
 *
 *   1. A `release.releaseLine` declaration in
 *      `.config/repo/socket-wheelhouse.json`. `boundaryTag` names the tag
 *      outright; `branch` names the ref the customer release line lives on, for
 *      a repo whose releases are cut somewhere other than the branch being
 *      scanned; `tagPattern` is a glob naming which tags are release tags, for a
 *      repo that also pushes build-asset tags onto the same branch. Precedence
 *      is `boundaryTag`, then `branch`, then `tagPattern` filtering the
 *      ancestry search below.
 *   2. Otherwise the newest tag that is an ANCESTOR of the ref being scanned, read
 *      with `git describe --tags --abbrev=0` and confirmed with `git merge-base
 *      --is-ancestor`. ANCESTRY, NEVER TAG RECENCY. A repo can carry several
 *      independent release lines at once, and their divergence is the
 *      architecture rather than a defect. Picking the newest tag by DATE
 *      reaches across lines and can land on one that is dead: on socket-cli the
 *      newest tag by date names a v2.x prerelease line that never ships to
 *      customers, while npm's `latest` comes from a v1.x line the scanned
 *      branch left behind. Ancestry against the scanned ref cannot make that
 *      mistake — a tag that is not in the scanned ref's history is not a
 *      boundary for it.
 */

import { isPlainObject } from '@socketsecurity/lib-stable/objects/predicates'

import { loadSocketWheelhouseConfig } from '../../paths.mts'

import type { GitRunner } from './commit-history.mts'

/**
 * A repo's declaration of where its customer release line lives, read from
 * `release.releaseLine` in `.config/repo/socket-wheelhouse.json`. Every field
 * is optional. Precedence when several are present: `boundaryTag` wins
 * outright, `branch` picks the ref the ancestry search walks, and `tagPattern`
 * narrows which tags that search may return.
 */
export interface ReleaseLineDeclaration {
  /**
   * The tag that IS the boundary, e.g. `v1.1.152`. Use it when the line's
   * newest release is not the newest tag reachable from anywhere.
   */
  readonly boundaryTag?: string | undefined
  /**
   * The ref the customer release line lives on, e.g. `origin/v1.x`. The
   * boundary becomes the newest tag reachable from THAT ref instead of from
   * the ref being scanned.
   */
  readonly branch?: string | undefined
  /**
   * A `git tag --list` glob naming which tags are release tags, e.g. `v*`. Set
   * it when the repo also pushes build-asset tags onto the scanned branch:
   * those are newer, so an unfiltered ancestry pick lands on one of them. Only
   * a tag matching the glob can become the boundary.
   */
  readonly tagPattern?: string | undefined
}

/**
 * Where the boundary landed, or why there is none.
 */
export type ReleaseBoundary =
  /**
   * Named outright by `release.releaseLine.boundaryTag`.
   */
  | {
      readonly kind: 'declared-tag'
      readonly tag: string
      readonly commit: string
    }
  /**
   * The newest tag reachable from `of` (the scanned ref, or a declared branch).
   * `tagPattern` is set when a declared glob narrowed the candidates.
   */
  | {
      readonly kind: 'ancestor-tag'
      readonly tag: string
      readonly commit: string
      readonly of: string
      readonly tagPattern?: string | undefined
    }
  /**
   * The repository carries no tags: nothing has been released yet.
   */
  | { readonly kind: 'no-tags' }
  /**
   * Tags exist, but none is in the scanned ref's history. When `tagPattern` is
   * set, `tagCount` counts only the tags matching that glob, and the shortfall
   * is the declared pattern's rather than the repository's.
   */
  | {
      readonly kind: 'no-ancestor-tag'
      readonly ref: string
      readonly tagCount: number
      readonly tagPattern?: string | undefined
    }

/**
 * A boundary the repository declared but git cannot resolve. Loud on purpose:
 * a declaration that points at nothing must never quietly degrade into a
 * tag-ancestry guess.
 */
export class ReleaseBoundaryError extends Error {}

/**
 * The `release.releaseLine` block from the member config under `repoRoot`, or
 * undefined when the repo declares none. Malformed values are ignored rather
 * than thrown on, so a stray key in the config cannot take the gate down; the
 * tag-ancestry fallback covers the repo instead.
 */
export function readReleaseLineDeclaration(
  repoRoot: string,
): ReleaseLineDeclaration | undefined {
  const config = loadSocketWheelhouseConfig(repoRoot)
  if (!config) {
    return undefined
  }
  const release = config.value['release']
  if (!isPlainObject(release)) {
    return undefined
  }
  const declared = release['releaseLine']
  if (!isPlainObject(declared)) {
    return undefined
  }
  const boundaryTag = declared['boundaryTag']
  const branch = declared['branch']
  const tagPattern = declared['tagPattern']
  const result: {
    boundaryTag?: string | undefined
    branch?: string | undefined
    tagPattern?: string | undefined
  } = {}
  if (typeof boundaryTag === 'string' && boundaryTag.trim()) {
    result.boundaryTag = boundaryTag.trim()
  }
  if (typeof branch === 'string' && branch.trim()) {
    result.branch = branch.trim()
  }
  if (typeof tagPattern === 'string' && tagPattern.trim()) {
    result.tagPattern = tagPattern.trim()
  }
  return result.boundaryTag || result.branch || result.tagPattern
    ? result
    : undefined
}

/**
 * The commit a ref, tag, or SHA points at, peeling an annotated tag to the
 * commit it wraps. Undefined when git cannot resolve it.
 */
export async function resolveCommitSha(
  git: GitRunner,
  rev: string,
): Promise<string | undefined> {
  const res = await git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`])
  const sha = res.stdout.trim()
  return res.ok && sha ? sha : undefined
}

/**
 * How many non-blank lines a tag listing carries. Both tag counters print one
 * tag per line, so the counting is shared rather than written twice.
 */
export function countTagLines(stdout: string): number {
  let count = 0
  const lines = stdout.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    if (lines[i]!.trim()) {
      count += 1
    }
  }
  return count
}

/**
 * How many tags the repository carries. Separates "nothing has been released
 * yet" from "released, but not on this line" — two states that need different
 * messages.
 */
export async function countTags(git: GitRunner): Promise<number> {
  const res = await git(['for-each-ref', '--format=%(refname)', 'refs/tags'])
  return res.ok ? countTagLines(res.stdout) : 0
}

/**
 * How many tags match a declared `tagPattern` glob, whether or not they are
 * ancestors of anything. It is the honest denominator for a pattern that found
 * no boundary: it tells "the repo tags releases differently than declared"
 * (zero matches) apart from "matching releases exist, just not on this line".
 */
export async function countTagsMatchingPattern(
  git: GitRunner,
  tagPattern: string,
): Promise<number> {
  const res = await git(['tag', '--list', tagPattern])
  return res.ok ? countTagLines(res.stdout) : 0
}

/**
 * Whether `commit` is in `ref`'s history. `merge-base --is-ancestor` exits 0
 * for yes and 1 for no, so a failed spawn and a real "no" look the same here —
 * both mean "do not treat this as a boundary", which is the safe direction.
 */
export async function isAncestorCommit(
  git: GitRunner,
  commit: string,
  ref: string,
): Promise<boolean> {
  const res = await git(['merge-base', '--is-ancestor', commit, ref])
  return res.ok
}

/**
 * Options for {@link resolveReleaseBoundary}.
 */
export interface ResolveReleaseBoundaryOptions {
  readonly declaration?: ReleaseLineDeclaration | undefined
}

/**
 * The release boundary for `scanRef`, the ref whose history is being scanned
 * (e.g. `origin/main`). Throws ReleaseBoundaryError when the repository
 * declared a boundary git cannot resolve.
 */
export async function resolveReleaseBoundary(
  git: GitRunner,
  scanRef: string,
  options?: ResolveReleaseBoundaryOptions | undefined,
): Promise<ReleaseBoundary> {
  const opts = { __proto__: null, ...options } as ResolveReleaseBoundaryOptions
  const { declaration } = opts
  const declaredTag = declaration?.boundaryTag
  if (declaredTag) {
    const commit = await resolveCommitSha(git, declaredTag)
    if (!commit) {
      throw new ReleaseBoundaryError(
        `release.releaseLine.boundaryTag names "${declaredTag}", which git cannot resolve to a commit in this checkout`,
      )
    }
    return { commit, kind: 'declared-tag', tag: declaredTag }
  }
  const declaredBranch = declaration?.branch
  if (declaredBranch && !(await resolveCommitSha(git, declaredBranch))) {
    throw new ReleaseBoundaryError(
      `release.releaseLine.branch names "${declaredBranch}", which git cannot resolve to a commit in this checkout`,
    )
  }
  const describeRef = declaredBranch ?? scanRef
  const declaredPattern = declaration?.tagPattern
  // `--match` filters the candidates before describe picks among them, so a
  // build-asset tag on the same branch can never win the newest-ancestor race.
  const described = await git([
    'describe',
    '--tags',
    '--abbrev=0',
    ...(declaredPattern ? ['--match', declaredPattern] : []),
    describeRef,
  ])
  const tag = described.ok ? described.stdout.trim() : ''
  if (tag) {
    const commit = await resolveCommitSha(git, tag)
    // `git describe` walks ancestry already, but confirming it keeps the
    // safety property explicit and catches an annotated tag whose peeled
    // commit is not what the describe output implied.
    if (commit && (await isAncestorCommit(git, commit, describeRef))) {
      return {
        commit,
        kind: 'ancestor-tag',
        of: describeRef,
        tag,
        ...(declaredPattern ? { tagPattern: declaredPattern } : {}),
      }
    }
  }
  // A declared pattern that matched nothing never degrades into an unfiltered
  // search: that would hand the boundary straight back to the asset tag the
  // pattern was written to exclude. Report the shortfall as the pattern's.
  if (declaredPattern) {
    return {
      kind: 'no-ancestor-tag',
      ref: describeRef,
      tagCount: await countTagsMatchingPattern(git, declaredPattern),
      tagPattern: declaredPattern,
    }
  }
  const tagCount = await countTags(git)
  return tagCount === 0
    ? { kind: 'no-tags' }
    : { kind: 'no-ancestor-tag', ref: describeRef, tagCount }
}

/**
 * The commit SHAs on `scanRef` that the boundary does NOT cover — the
 * unreleased tail. One `git rev-list` answers it for the whole scan, so the
 * cost does not grow with the number of findings.
 */
export async function collectUnreleasedShas(
  git: GitRunner,
  scanRef: string,
  boundaryCommit: string,
): Promise<Set<string>> {
  const res = await git(['rev-list', scanRef, `^${boundaryCommit}`])
  if (!res.ok) {
    throw new ReleaseBoundaryError(
      `git rev-list ${scanRef} ^${boundaryCommit} failed, so the released and unreleased halves of the history cannot be told apart`,
    )
  }
  const shas = new Set<string>()
  const lines = res.stdout.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const sha = lines[i]!.trim()
    if (sha) {
      shas.add(sha)
    }
  }
  return shas
}

/**
 * Split findings into the ones above the boundary (actionable) and the ones at
 * or below it (frozen). Pure, so the partition is testable without a
 * repository.
 */
export function partitionByUnreleasedShas<T extends { readonly sha: string }>(
  findings: readonly T[],
  unreleasedShas: ReadonlySet<string>,
): { reported: T[]; frozen: T[] } {
  const reported: T[] = []
  const frozen: T[] = []
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const finding = findings[i]!
    if (unreleasedShas.has(finding.sha)) {
      reported.push(finding)
    } else {
      frozen.push(finding)
    }
  }
  return { frozen, reported }
}

/**
 * A one-line name for the boundary, for the summary and failure text.
 */
export function describeReleaseBoundary(boundary: ReleaseBoundary): string {
  switch (boundary.kind) {
    case 'declared-tag': {
      return `${boundary.tag} (declared in release.releaseLine.boundaryTag)`
    }
    case 'ancestor-tag': {
      return boundary.tagPattern
        ? `${boundary.tag} (newest tag matching \`${boundary.tagPattern}\` reachable from ${boundary.of})`
        : `${boundary.tag} (newest tag reachable from ${boundary.of})`
    }
    case 'no-tags': {
      return 'none — the repository carries no tags, so nothing is released yet'
    }
    case 'no-ancestor-tag': {
      return boundary.tagPattern
        ? `none — ${boundary.tagCount} tag(s) match the declared release.releaseLine.tagPattern \`${boundary.tagPattern}\` but none is in ${boundary.ref}'s history`
        : `none — ${boundary.tagCount} tag(s) exist but none is in ${boundary.ref}'s history`
    }
  }
}
