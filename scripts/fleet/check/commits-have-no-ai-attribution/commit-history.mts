/*
 * @file Reading commit history for `commits-have-no-ai-attribution`: the git
 *   runner, the record parser, and the three scopes a run can ask for.
 *
 *   - DEFAULT — the public default branch (`origin/<default>`, or the local
 *     branch when the repo has no origin), paired with its release boundary. A
 *     commit that lives only in some other local ref was never published, so it
 *     is out of scope; a commit at or below the boundary is frozen.
 *   - `--all` — every commit reachable from any ref, boundary ignored. The widest
 *     audit sweep.
 *   - `--unpushed` — the commits reachable from HEAD but not from the default
 *     branch or its origin counterpart. A pre-push spot check. The default
 *     branch is resolved from git, never hard-coded. Every unreadable state
 *     throws rather than returning an empty result: a green nobody earned is
 *     worse than a loud failure.
 */

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { normalizeBranchName } from '../../../../.claude/hooks/fleet/_shared/ai-attribution.mts'
import { resolveReleaseBoundary } from './release-boundary.mts'

import type {
  ReleaseBoundary,
  ReleaseLineDeclaration,
} from './release-boundary.mts'

const RECORD_SEPARATOR = '\x1e'
const FIELD_SEPARATOR = '\x1f'

/**
 * The `git log --format` string every scope shares, so one parser handles all
 * of them.
 */
export const COMMIT_FORMAT = `--format=%H${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%B${RECORD_SEPARATOR}`

/**
 * One commit as read from `git log`.
 */
export interface CommitRecord {
  readonly sha: string
  readonly subject: string
  readonly body: string
}

export interface GitRunner {
  (args: readonly string[]): Promise<{
    ok: boolean
    stdout: string
    error?: string | undefined
  }>
}

/**
 * What one scope resolved to: the commits it read, the ref it read them from,
 * the release boundary that applies, and a human-readable name for all of it.
 */
export interface ScopedRecords {
  readonly boundary: ReleaseBoundary | undefined
  readonly records: CommitRecord[]
  readonly scanRef: string | undefined
  readonly scope: string
}

export class AttributionScanError extends Error {}

/**
 * The scanned branch carries findings but no release boundary, so there is no
 * way to tell a frozen published commit from one an operator can still fix.
 * Its own class because the caller prints a different report for it.
 */
export class UnreleasedLineError extends AttributionScanError {
  readonly findingCount: number
  readonly ref: string
  readonly tagCount: number
  /**
   * The declared `release.releaseLine.tagPattern` glob when one narrowed the
   * search, so the report can say the pattern matched nothing instead of
   * blaming the repository's whole tag set.
   */
  readonly tagPattern: string | undefined

  constructor(config: {
    findingCount: number
    ref: string
    tagCount: number
    tagPattern?: string | undefined
  }) {
    const cfg = { __proto__: null, ...config } as typeof config
    const shortfall = cfg.tagPattern
      ? `none of the ${cfg.tagCount} tag(s) matching the declared release.releaseLine.tagPattern \`${cfg.tagPattern}\``
      : `none of the repository's ${cfg.tagCount} tag(s)`
    super(
      `${cfg.ref} carries ${cfg.findingCount} AI-attribution finding(s), and ${shortfall} is in its history, so the release boundary is undefined`,
    )
    this.findingCount = cfg.findingCount
    this.ref = cfg.ref
    this.tagCount = cfg.tagCount
    this.tagPattern = cfg.tagPattern
  }
}

export function gitRunner(cwd: string): GitRunner {
  return async args => {
    try {
      const res = await spawn('git', args as string[], {
        cwd,
        stdioString: true,
      })
      return { ok: res.code === 0, stdout: String(res.stdout ?? '') }
    } catch (e) {
      return { ok: false, stdout: '', error: errorMessage(e) }
    }
  }
}

/**
 * Split `git log` output written with COMMIT_FORMAT back into records. Pure,
 * so the parsing is testable without a repository.
 */
export function parseCommitRecords(gitLog: string): CommitRecord[] {
  const records: CommitRecord[] = []
  const chunks = gitLog.split(RECORD_SEPARATOR)
  for (let i = 0, { length } = chunks; i < length; i += 1) {
    const chunk = chunks[i]!.replace(/^\n+/, '')
    if (chunk.trim() === '') {
      continue
    }
    const fields = chunk.split(FIELD_SEPARATOR)
    if (fields.length < 3) {
      continue
    }
    records.push({
      sha: fields[0]!.trim(),
      subject: fields[1]!,
      body: fields.slice(2).join(FIELD_SEPARATOR),
    })
  }
  return records
}

/**
 * A "git <command> failed" message, with the captured spawn error appended
 * when one is available. A bare "failed" hides whether the cause was a
 * missing repository, a permission error, or an oversized output buffer —
 * appending the real reason keeps the loud-exit `Saw:` line honest.
 */
export function describeGitFailure(
  command: string,
  result: { error?: string | undefined },
): string {
  return result.error
    ? `${command} failed: ${result.error}`
    : `${command} failed`
}

/**
 * Throw when the checkout is shallow. A truncated graph makes both "all
 * reachable history" and tag ancestry unreliable, and a boundary read off a
 * truncated graph would freeze the wrong span of commits. On a CI runner the
 * shallow state is the bootstrap checkout's own depth-1 fetch, not an
 * operator's choice, so the check self-heals there: one `git fetch
 * --unshallow --tags` completes the graph, and only a still-shallow repo
 * after that fetch throws. Off-runner the refusal stays loud and
 * network-free — a dev box's shallow clone is the operator's to fix.
 */
export async function assertNotShallowCheckout(
  git: GitRunner,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const shallow = await git(['rev-parse', '--is-shallow-repository'])
  if (!shallow.ok || shallow.stdout.trim() !== 'true') {
    return
  }
  // When the self-heal runs and the checkout is STILL shallow, the reason the
  // fetch gave is the whole diagnosis. Discarding it leaves CI reporting only
  // "shallow clone", which is the symptom the heal was supposed to remove.
  let healReport = ''
  if (env['GITHUB_ACTIONS'] === 'true') {
    const fetched = await git([
      'fetch',
      '--quiet',
      '--unshallow',
      '--tags',
      'origin',
    ])
    const after = await git(['rev-parse', '--is-shallow-repository'])
    if (after.ok && after.stdout.trim() !== 'true') {
      return
    }
    healReport = fetched.ok
      ? ' The CI self-heal fetch exited 0 yet the checkout is still shallow.'
      : ` The CI self-heal fetch failed: ${fetched.error || 'git reported no error text'}.`
  }
  throw new AttributionScanError(
    'this checkout is a shallow clone, so "all reachable history" would be a lie — fetch full history (e.g. `git fetch --unshallow`) or pass --unpushed to scan only the commits not yet on the default branch.' +
      healReport,
  )
}

/**
 * Read one scope's commits, throwing when git fails and when the read comes
 * back empty despite HEAD existing — that combination means the scope or the
 * parser is broken, not that the repository is empty.
 */
export async function readCommitRecords(
  git: GitRunner,
  revisions: readonly string[],
): Promise<CommitRecord[]> {
  const logArgs = ['log', ...revisions, COMMIT_FORMAT]
  const log = await git(logArgs)
  if (!log.ok) {
    throw new AttributionScanError(
      describeGitFailure(`git ${logArgs.join(' ')}`, log),
    )
  }
  const records = parseCommitRecords(log.stdout)
  if (records.length === 0) {
    throw new AttributionScanError(
      `git ${logArgs.join(' ')} resolved 0 commits even though HEAD exists, which means the scan is broken, not that the repository is empty`,
    )
  }
  return records
}

/**
 * The refs to exclude from the `--unpushed` commit scan. On a feature branch
 * that is the default branch plus its origin counterpart; on the default
 * branch itself only the origin counterpart, so the scan still sees unpushed
 * work instead of nothing. Pure.
 */
export function resolveScopeExclusions(config: {
  currentBranch: string | undefined
  defaultBranch: string
  hasLocalDefault: boolean
  hasRemoteDefault: boolean
}): string[] {
  const cfg = { __proto__: null, ...config } as typeof config
  const exclusions: string[] = []
  if (cfg.hasLocalDefault && cfg.currentBranch !== cfg.defaultBranch) {
    exclusions.push(cfg.defaultBranch)
  }
  if (cfg.hasRemoteDefault) {
    exclusions.push(`origin/${cfg.defaultBranch}`)
  }
  return exclusions
}

/**
 * The repository's default branch: the remote's own HEAD pointer first, then
 * a local `main`, then `master`. Undefined when none of the three resolve.
 */
export async function resolveDefaultBranch(
  git: GitRunner,
): Promise<string | undefined> {
  const originHead = await git(['symbolic-ref', 'refs/remotes/origin/HEAD'])
  if (originHead.ok && originHead.stdout.trim()) {
    return normalizeBranchName(originHead.stdout)
  }
  for (const candidate of ['main', 'master']) {
    const verified = await git([
      'rev-parse',
      '--verify',
      '--quiet',
      `refs/heads/${candidate}`,
    ])
    if (verified.ok && verified.stdout.trim()) {
      return candidate
    }
  }
  return undefined
}

/**
 * The ref the default scope reads: the origin copy of the default branch when
 * one exists, since that is the history the public can see, and the local
 * branch otherwise. Undefined when neither resolves.
 */
export async function resolveScanRef(
  git: GitRunner,
  defaultBranch: string,
): Promise<string | undefined> {
  const remote = await git([
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/remotes/origin/${defaultBranch}`,
  ])
  if (remote.ok && remote.stdout.trim()) {
    return `origin/${defaultBranch}`
  }
  const local = await git([
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/heads/${defaultBranch}`,
  ])
  return local.ok && local.stdout.trim() ? defaultBranch : undefined
}

/**
 * Scan the commits reachable from HEAD but not from the default branch or its
 * origin counterpart — the unpushed / in-PR set. Reports 0 commits as a real,
 * clean state meaning nothing is unpushed, not as a vacuous scan.
 */
export async function scanUnpushedCommits(
  git: GitRunner,
): Promise<ScopedRecords> {
  const defaultBranch = await resolveDefaultBranch(git)
  if (!defaultBranch) {
    const log = await git(['log', '--all', COMMIT_FORMAT])
    if (!log.ok) {
      throw new AttributionScanError(describeGitFailure('git log --all', log))
    }
    return {
      boundary: undefined,
      records: parseCommitRecords(log.stdout),
      scanRef: undefined,
      scope: 'all reachable history (no default branch resolved)',
    }
  }
  const currentBranch = await git([
    'symbolic-ref',
    '--short',
    '--quiet',
    'HEAD',
  ])
  const localDefault = await git([
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/heads/${defaultBranch}`,
  ])
  const remoteDefault = await git([
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/remotes/origin/${defaultBranch}`,
  ])
  const exclusions = resolveScopeExclusions({
    currentBranch: currentBranch.ok
      ? currentBranch.stdout.trim() || undefined
      : undefined,
    defaultBranch,
    hasLocalDefault: localDefault.ok && !!localDefault.stdout.trim(),
    hasRemoteDefault: remoteDefault.ok && !!remoteDefault.stdout.trim(),
  })
  const scope = exclusions.length
    ? `HEAD not ${exclusions.join(' ')}`
    : 'HEAD (no default-branch ref to exclude)'
  const logArgs = ['log', 'HEAD', COMMIT_FORMAT]
  for (const ref of exclusions) {
    logArgs.push(`^${ref}`)
  }
  const log = await git(logArgs)
  if (!log.ok) {
    throw new AttributionScanError(
      describeGitFailure(`git ${logArgs.join(' ')}`, log),
    )
  }
  return {
    boundary: undefined,
    records: parseCommitRecords(log.stdout),
    scanRef: undefined,
    scope,
  }
}

/**
 * Scan every commit reachable from any ref, boundary ignored.
 */
export async function scanAllHistoryCommits(
  git: GitRunner,
): Promise<ScopedRecords> {
  await assertNotShallowCheckout(git)
  return {
    boundary: undefined,
    records: await readCommitRecords(git, ['--all']),
    scanRef: undefined,
    scope: 'all reachable history',
  }
}

/**
 * Scan the public default branch and resolve its release boundary — the
 * default scope.
 */
export async function scanDefaultBranchCommits(
  git: GitRunner,
  declaration: ReleaseLineDeclaration | undefined,
): Promise<ScopedRecords> {
  await assertNotShallowCheckout(git)
  const defaultBranch = await resolveDefaultBranch(git)
  if (!defaultBranch) {
    throw new AttributionScanError(
      'the default branch could not be resolved from origin/HEAD, refs/heads/main, or refs/heads/master',
    )
  }
  const scanRef = await resolveScanRef(git, defaultBranch)
  if (!scanRef) {
    throw new AttributionScanError(
      `neither refs/remotes/origin/${defaultBranch} nor refs/heads/${defaultBranch} exists, so the public default branch cannot be read`,
    )
  }
  const boundary = await resolveReleaseBoundary(
    git,
    scanRef,
    declaration ? { declaration } : undefined,
  )
  return {
    boundary,
    records: await readCommitRecords(git, [scanRef]),
    scanRef,
    scope: `${scanRef} (the public default branch)`,
  }
}
