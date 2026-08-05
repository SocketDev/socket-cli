/**
 * @file Turning read history into findings for
 *   `commits-have-no-ai-attribution`. `commit-history.mts` decides which
 *   commits are in scope and reads them; this module matches the AI-attribution
 *   fingerprints against them, splits the matches at the release boundary, and
 *   sorts branch names by who can see them.
 *   Two things are deliberately NOT failures. A commit at or below the release
 *   boundary is frozen — rewriting it breaks the provenance of the release
 *   built from it — so it is counted and reported on one informational line. A
 *   local branch carrying an agent prefix has never left this checkout, so it
 *   is informational too; only an `origin/` branch fails, because only that one
 *   is published for a detection engine to read.
 */

import {
  matchAiBranchPrefix,
  matchAiCommitAttribution,
  normalizeBranchName,
} from '../../../../.claude/hooks/fleet/_shared/ai-attribution.mts'
import {
  AttributionScanError,
  describeGitFailure,
  scanAllHistoryCommits,
  scanDefaultBranchCommits,
  scanUnpushedCommits,
  UnreleasedLineError,
} from './commit-history.mts'
import {
  collectUnreleasedShas,
  partitionByUnreleasedShas,
} from './release-boundary.mts'

import type {
  CommitRecord,
  GitRunner,
  ScopedRecords,
} from './commit-history.mts'
import type {
  ReleaseBoundary,
  ReleaseLineDeclaration,
} from './release-boundary.mts'

/**
 * A commit whose message carries an AI-attribution fingerprint.
 */
export interface CommitFinding {
  readonly sha: string
  readonly subject: string
  readonly label: string
  readonly line: string
}

/**
 * A branch whose name starts with an AI-agent tool prefix.
 */
export interface BranchFinding {
  readonly ref: string
  readonly branch: string
  readonly prefix: string
}

export interface AttributionScan {
  readonly commits: readonly CommitFinding[]
  readonly frozenCommits: readonly CommitFinding[]
  readonly branches: readonly BranchFinding[]
  readonly localBranches: readonly BranchFinding[]
  readonly commitsScanned: number
  readonly branchesScanned: number
  readonly scope: string
  readonly boundary: ReleaseBoundary | undefined
}

export interface ScanOptions {
  /**
   * Scan every ref and ignore the release boundary — the widest audit sweep.
   */
  readonly all?: boolean | undefined
  readonly releaseLine?: ReleaseLineDeclaration | undefined
  /**
   * Scan only the commits not yet on the default branch.
   */
  readonly unpushed?: boolean | undefined
}

/**
 * The commits whose message matches an AI-attribution fingerprint, each paired
 * with the offending line so the failure can quote it. Pure.
 */
export function findAiAttributionCommits(
  records: readonly CommitRecord[],
): CommitFinding[] {
  const findings: CommitFinding[] = []
  for (let i = 0, { length } = records; i < length; i += 1) {
    const record = records[i]!
    const match = matchAiCommitAttribution(record.body)
    if (!match) {
      continue
    }
    findings.push({
      label: match.label,
      line: match.line,
      sha: record.sha,
      subject: record.subject,
    })
  }
  return findings
}

/**
 * Split `git for-each-ref` output into refs, dropping the symbolic
 * `refs/remotes/<remote>/HEAD` pointers. Each of those aliases a branch the
 * listing already carries, so keeping it would double-report. Pure.
 */
export function parseBranchRefs(forEachRef: string): string[] {
  const refs: string[] = []
  const lines = forEachRef.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const ref = lines[i]!.trim()
    if (ref === '' || ref.endsWith('/HEAD')) {
      continue
    }
    refs.push(ref)
  }
  return refs
}

/**
 * The refs whose branch name starts with an AI-agent tool prefix. Pure.
 */
export function findAiPrefixedBranches(
  refs: readonly string[],
): BranchFinding[] {
  const findings: BranchFinding[] = []
  for (let i = 0, { length } = refs; i < length; i += 1) {
    const ref = refs[i]!
    const prefix = matchAiBranchPrefix(ref)
    if (prefix) {
      findings.push({ branch: normalizeBranchName(ref), prefix, ref })
    }
  }
  return findings
}

/**
 * Split branch findings by who can see them. A `refs/remotes/…` branch is
 * published, so it advertises the agent prefix to anyone reading the
 * repository and fails the check. A `refs/heads/…` branch lives only in this
 * checkout, so it is reported for information and never fails. Pure.
 */
export function partitionBranchFindings(findings: readonly BranchFinding[]): {
  published: BranchFinding[]
  local: BranchFinding[]
} {
  const published: BranchFinding[] = []
  const local: BranchFinding[] = []
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const finding = findings[i]!
    if (finding.ref.startsWith('refs/remotes/')) {
      published.push(finding)
    } else {
      local.push(finding)
    }
  }
  return { local, published }
}

/**
 * Split commit findings at the release boundary. Everything at or below it is
 * frozen. A scope with no boundary (`--all`, `--unpushed`) reports everything
 * it found, and a default-branch scan whose boundary is undefined while
 * findings are waiting throws UnreleasedLineError rather than guessing which
 * half of the history is already published.
 */
export async function splitCommitsAtBoundary(
  git: GitRunner,
  scoped: ScopedRecords,
  findings: readonly CommitFinding[],
): Promise<{
  commits: readonly CommitFinding[]
  frozen: readonly CommitFinding[]
}> {
  const { boundary, scanRef } = scoped
  if (!boundary || !scanRef || boundary.kind === 'no-tags') {
    return { commits: findings, frozen: [] }
  }
  if (boundary.kind === 'no-ancestor-tag') {
    if (findings.length) {
      throw new UnreleasedLineError({
        findingCount: findings.length,
        ref: boundary.ref,
        tagCount: boundary.tagCount,
        ...(boundary.tagPattern ? { tagPattern: boundary.tagPattern } : {}),
      })
    }
    return { commits: findings, frozen: [] }
  }
  const unreleased = await collectUnreleasedShas(git, scanRef, boundary.commit)
  const split = partitionByUnreleasedShas(findings, unreleased)
  return { commits: split.reported, frozen: split.frozen }
}

/**
 * Read the repository and report every AI-attribution fingerprint in scope.
 * Throws AttributionScanError when git, the repository, its commits, or the
 * release boundary cannot be read — the caller turns that into a loud non-zero
 * exit.
 */
export async function scanForAiAttribution(
  git: GitRunner,
  options?: ScanOptions | undefined,
): Promise<AttributionScan> {
  const opts = { __proto__: null, ...options } as ScanOptions
  const inside = await git(['rev-parse', '--is-inside-work-tree'])
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    throw new AttributionScanError(
      inside.error
        ? `git could not read this directory as a work tree: ${inside.error}`
        : 'git could not read this directory as a work tree',
    )
  }
  const head = await git(['rev-parse', '--verify', '--quiet', 'HEAD'])
  if (!head.ok || !head.stdout.trim()) {
    throw new AttributionScanError(
      head.error
        ? `the repository has no commits: ${head.error}`
        : 'the repository has no commits',
    )
  }

  let scoped: ScopedRecords
  if (opts.unpushed) {
    scoped = await scanUnpushedCommits(git)
  } else if (opts.all) {
    scoped = await scanAllHistoryCommits(git)
  } else {
    scoped = await scanDefaultBranchCommits(git, opts.releaseLine)
  }

  const { commits, frozen } = await splitCommitsAtBoundary(
    git,
    scoped,
    findAiAttributionCommits(scoped.records),
  )

  const refs = await git([
    'for-each-ref',
    '--format=%(refname)',
    'refs/heads',
    'refs/remotes/origin',
  ])
  if (!refs.ok) {
    throw new AttributionScanError(describeGitFailure('git for-each-ref', refs))
  }
  const branchRefs = parseBranchRefs(refs.stdout)
  const branches = partitionBranchFindings(findAiPrefixedBranches(branchRefs))

  return {
    boundary: scoped.boundary,
    branches: branches.published,
    branchesScanned: branchRefs.length,
    commits,
    commitsScanned: scoped.records.length,
    frozenCommits: frozen,
    localBranches: branches.local,
    scope: scoped.scope,
  }
}
