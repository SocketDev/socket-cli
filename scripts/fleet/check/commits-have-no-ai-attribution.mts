/**
 * @file Code-as-law for the fleet's "NO AI attribution" commit rule. Two
 *   fingerprints are asserted absent from the repository. The first is an
 *   AI-attribution trailer in a commit message, meaning a `Co-authored-by:`
 *   naming a vendor agent or a "Generated with …" tag line. The second is an
 *   AI-agent branch prefix — `codex/`, `devin/`, `aider/`, `copilot/`,
 *   `swe-agent/`, `swe-bench/` — on any local or remote branch. The rule
 *   already exists in prose. CLAUDE.md requires Conventional Commits,
 *   lowercase, with NO AI attribution. This makes it executable, and it matters
 *   past tidiness: both fingerprints are scored by the public
 *   `@unveil/identity` detection engine, which reads the same trailers and
 *   branch prefixes off a repository and labels the account that pushed them. A
 *   trailer the commit-msg hook missed sits in history advertising itself, and
 *   a commit minted with `--no-verify` or in another tool is exactly how one
 *   gets there. Default scope is every commit reachable from any ref — the
 *   whole-history verdict `pnpm run check` needs, since the fleet's own
 *   worktree-hygiene rules (primary checkout stays on the default branch, land
 *   often) mean HEAD equals origin/<default> almost always, which would make an
 *   unpushed-only default scan report a false green in the steady state.
 *   `--unpushed` narrows the commit scan to the commits reachable from HEAD but
 *   not from the default branch or its origin counterpart (the unpushed / in-PR
 *   set) — useful as a fast pre-push spot check, never as the whole-tree gate.
 *   Both scopes also check every local and origin branch name. The default
 *   branch is resolved from git, never hard-coded. FAILS LOUD when it cannot
 *   resolve what it is checking: no git, no repository, no commits, a shallow
 *   clone under the full-history scan, or a full-history scan that resolves to
 *   0 commits despite HEAD existing all exit non-zero rather than reporting a
 *   green they did not earn. Usage: node
 *   scripts/fleet/check/commits-have-no-ai-attribution.mts [--unpushed]
 */

import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  matchAiBranchPrefix,
  matchAiCommitAttribution,
  normalizeBranchName,
} from '../../../.claude/hooks/fleet/_shared/ai-attribution.mts'
import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

const RECORD_SEPARATOR = '\x1e'
const FIELD_SEPARATOR = '\x1f'
const COMMIT_FORMAT = `--format=%H${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%B${RECORD_SEPARATOR}`

/**
 * One commit as read from `git log`.
 */
export interface CommitRecord {
  readonly sha: string
  readonly subject: string
  readonly body: string
}

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

export interface GitRunner {
  (args: readonly string[]): Promise<{
    ok: boolean
    stdout: string
    error?: string | undefined
  }>
}

export interface AttributionScan {
  readonly commits: readonly CommitFinding[]
  readonly branches: readonly BranchFinding[]
  readonly commitsScanned: number
  readonly branchesScanned: number
  readonly scope: string
}

function gitRunner(cwd: string): GitRunner {
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
 * The refs to exclude from the default commit scan. On a feature branch that
 * is the default branch plus its origin counterpart; on the default branch
 * itself only the origin counterpart, so the scan still sees unpushed work
 * instead of nothing. Pure.
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

export class AttributionScanError extends Error {}

/**
 * A "git <command> failed" message, with the captured spawn error appended
 * when one is available. A bare "failed" hides whether the cause was a
 * missing repository, a permission error, or an oversized output buffer —
 * appending the real reason keeps the loud-exit `Saw:` line honest.
 */
function describeGitFailure(
  command: string,
  result: { error?: string | undefined },
): string {
  return result.error
    ? `${command} failed: ${result.error}`
    : `${command} failed`
}

/**
 * Scan the commits reachable from HEAD but not from the default branch or its
 * origin counterpart — the unpushed / in-PR set. Reports 0 commits as a real,
 * clean state meaning nothing is unpushed, not as a vacuous scan.
 */
async function scanUnpushedCommits(
  git: GitRunner,
): Promise<{ scope: string; records: CommitRecord[] }> {
  const defaultBranch = await resolveDefaultBranch(git)
  if (!defaultBranch) {
    const log = await git(['log', '--all', COMMIT_FORMAT])
    if (!log.ok) {
      throw new AttributionScanError(describeGitFailure('git log --all', log))
    }
    return {
      records: parseCommitRecords(log.stdout),
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
  return { records: parseCommitRecords(log.stdout), scope }
}

/**
 * Scan every commit reachable from any ref. Throws when the checkout is
 * shallow — a truncated graph cannot honestly be reported as "all reachable
 * history" — and throws when HEAD resolves but the scan still turns up 0
 * commits, since that combination means the log parser or the `--all` scope
 * is broken, not that the repository is empty (an empty repository was
 * already rejected by the HEAD check in the caller).
 */
async function scanAllHistoryCommits(
  git: GitRunner,
): Promise<{ scope: string; records: CommitRecord[] }> {
  const shallow = await git(['rev-parse', '--is-shallow-repository'])
  if (shallow.ok && shallow.stdout.trim() === 'true') {
    throw new AttributionScanError(
      'this checkout is a shallow clone, so "all reachable history" would be a lie — fetch full history (e.g. `git fetch --unshallow`) or pass --unpushed to scan only the commits not yet on the default branch',
    )
  }
  const log = await git(['log', '--all', COMMIT_FORMAT])
  if (!log.ok) {
    throw new AttributionScanError(describeGitFailure('git log --all', log))
  }
  const records = parseCommitRecords(log.stdout)
  if (records.length === 0) {
    throw new AttributionScanError(
      'git log --all resolved 0 commits even though HEAD exists, which means the scan is broken, not that the repository is empty',
    )
  }
  return { records, scope: 'all reachable history' }
}

/**
 * Read the repository and report every AI-attribution fingerprint in scope.
 * Throws AttributionScanError when git, the repository, or its commits cannot
 * be read — the caller turns that into a loud non-zero exit.
 */
export async function scanForAiAttribution(
  git: GitRunner,
  options?: { unpushed?: boolean | undefined } | undefined,
): Promise<AttributionScan> {
  const opts = { __proto__: null, ...options } as {
    unpushed?: boolean | undefined
  }
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

  const { records, scope } = opts.unpushed
    ? await scanUnpushedCommits(git)
    : await scanAllHistoryCommits(git)

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

  return {
    branches: findAiPrefixedBranches(branchRefs),
    branchesScanned: branchRefs.length,
    commits: findAiAttributionCommits(records),
    commitsScanned: records.length,
    scope,
  }
}

/**
 * The failure report for a scan that found something.
 */
export function formatFindings(scan: AttributionScan): string {
  const lines: string[] = [
    '[commits-have-no-ai-attribution] AI-attribution fingerprint(s) found.',
    '',
    '  What: an AI-attribution commit trailer or an AI-agent branch prefix.',
    '  The fleet bans these as commit noise, and they are also read by the',
    '  public @unveil/identity engine, which scores them as automation signals',
    '  against the account that pushed them.',
    '',
  ]
  if (scan.commits.length) {
    lines.push(`  Where — ${scan.commits.length} commit(s) (${scan.scope}):`)
    for (const finding of scan.commits) {
      lines.push(`    - ${finding.sha.slice(0, 12)} ${finding.subject}`)
      lines.push(`      saw:    ${finding.line}`)
      lines.push(`      wanted: no attribution trailer (${finding.label})`)
    }
    lines.push('')
  }
  if (scan.branches.length) {
    lines.push(`  Where — ${scan.branches.length} branch(es):`)
    for (const finding of scan.branches) {
      lines.push(`    - ${finding.ref}`)
      lines.push(`      saw:    branch name "${finding.branch}"`)
      lines.push(
        `      wanted: no "${finding.prefix}" AI-agent prefix on the branch name`,
      )
    }
    lines.push('')
  }
  lines.push('  Fix:')
  if (scan.commits.length) {
    lines.push(
      '    - Unpushed commit, most recent: `git commit --amend` and delete the',
      '      trailer line.',
      '    - Unpushed span: `node scripts/fleet/strip-ai-attribution.mts --base',
      '      <ref>` rewrites the messages deterministically (or run an',
      '      interactive rebase and reword each one).',
      '    - Already pushed: rewriting published history is a separate decision',
      "      that is yours to make, not this check's. This check reports the",
      '      commits; it does not tell you to rewrite or republish them.',
    )
  }
  if (scan.branches.length) {
    lines.push(
      '    - Rename the branch to a Conventional-Commit-style name, e.g.',
      '      `git branch -m <old> refactor/<topic>`. A remote branch also needs',
      '      the new name pushed and the old ref retired, which is a decision',
      '      for whoever owns that branch.',
    )
  }
  lines.push('')
  return lines.join('\n')
}

/**
 * The clean-run summary.
 */
export function formatCleanSummary(scan: AttributionScan): string {
  return `[commits-have-no-ai-attribution] ok — ${scan.commitsScanned} commit(s) (${scan.scope}) and ${scan.branchesScanned} branch(es) carry no AI attribution.`
}

export async function runCheck(
  repoRoot: string,
  options?:
    | { unpushed?: boolean | undefined; git?: GitRunner | undefined }
    | undefined,
): Promise<number> {
  const opts = { __proto__: null, ...options } as {
    unpushed?: boolean | undefined
    git?: GitRunner | undefined
  }
  const git = opts.git ?? gitRunner(repoRoot)
  let scan: AttributionScan
  try {
    scan = await scanForAiAttribution(git, { unpushed: opts.unpushed })
  } catch (e) {
    const reason = e instanceof AttributionScanError ? e.message : String(e)
    logger.fail(
      [
        '[commits-have-no-ai-attribution] cannot verify the AI-attribution rule.',
        '',
        '  What:   the scan could not read the repository.',
        `  Where:  ${repoRoot}`,
        `  Saw:    ${reason}.`,
        '  Fix:    resolve the condition above, then re-run. Reporting a pass',
        '          here would be a false green.',
        '',
      ].join('\n'),
    )
    return 1
  }
  if (scan.commits.length || scan.branches.length) {
    logger.fail(formatFindings(scan))
    return 1
  }
  logger.info(formatCleanSummary(scan))
  return 0
}

export async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { unpushed: { type: 'boolean' } },
    strict: false,
  })
  return await runCheck(REPO_ROOT, { unpushed: !!values['unpushed'] })
}

if (isMainModule(import.meta.url)) {
  runMain(main)
}
