/**
 * @file Whose-work — classify local, unpushed work so a session never
 *   mis-attributes its OWN earlier commits to a phantom parallel session.
 *   Recall resets across context compaction, and every fleet commit shares
 *   one git identity — so "a recent commit I don't remember" is NOT evidence
 *   of another agent. The deterministic, git-native discriminator: commits
 *   reachable from HEAD but not from the upstream / default remote branch are
 *   LOCAL work toward local main. On a single-user checkout that is your own
 *   (and any aligned session's) cumulative work — land it, don't investigate.
 *   A genuine parallel-session conflict is a divergent same-file edit that
 *   appears WHILE you work (a file changing between two of your own reads).
 *   History alone cannot show that; this tool does not pretend to. It answers
 *   the question that actually mis-fires — "is this unfamiliar commit mine?" —
 *   with "local + your identity = yours by default."
 *   Run it whenever `git log` surprises you, before ever pausing to warn about
 *   a parallel agent. Informational: exits 0 unless git itself fails.
 */

import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

const logger = getDefaultLogger()

// Fields are separated by the ASCII unit-separator: git's `%x1f` format token
// emits the byte, and we split on it. Subjects can contain any punctuation but
// never a raw 0x1f, so parsing stays unambiguous.
const FIELD_SEP = String.fromCharCode(0x1f)
const LOG_FORMAT = ['%H', '%ae', '%an', '%aI', '%s'].join('%x1f')

export interface WorkCommit {
  readonly authorEmail: string
  readonly authorName: string
  readonly isoDate: string
  readonly sha: string
  readonly subject: string
}

export interface WorkClassification {
  readonly mine: readonly WorkCommit[]
  readonly otherIdentity: readonly WorkCommit[]
}

function git(cwd: string, args: readonly string[]): string | undefined {
  const r = spawnSync('git', args as string[], { cwd, timeout: 5000 })
  if (r.status !== 0) {
    return undefined
  }
  return String(r.stdout).trim()
}

/**
 * The ref to diff HEAD against for "local, unpushed" work: the tracking
 * upstream if set, else the remote's default branch, else the local default.
 * Returns undefined when none resolves (a detached / brand-new repo).
 */
export function resolveBaseRef(cwd: string): string | undefined {
  const upstream = git(cwd, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{u}',
  ])
  if (upstream) {
    return upstream
  }
  const originHead = git(cwd, ['symbolic-ref', 'refs/remotes/origin/HEAD'])
  if (originHead) {
    return originHead.replace(/^refs\/remotes\//, '')
  }
  for (const branch of ['origin/main', 'origin/master', 'main', 'master']) {
    if (git(cwd, ['rev-parse', '--verify', '--quiet', branch]) !== undefined) {
      return branch
    }
  }
  return undefined
}

/**
 * Parse `git log --format=<LOG_FORMAT>` output into commits. Pure — every
 * malformed line is skipped rather than throwing.
 */
export function parseCommitLog(raw: string): WorkCommit[] {
  const commits: WorkCommit[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      continue
    }
    const parts = line.split(FIELD_SEP)
    if (parts.length < 5) {
      continue
    }
    commits.push({
      authorEmail: parts[1]!,
      authorName: parts[2]!,
      isoDate: parts[3]!,
      sha: parts[0]!,
      subject: parts[4]!,
    })
  }
  return commits
}

/**
 * Commits reachable from HEAD but not from `baseRef` — local, unpushed work.
 * Empty when HEAD is at/behind base or git fails.
 */
export function localAheadCommits(cwd: string, baseRef: string): WorkCommit[] {
  const raw = git(cwd, ['log', `${baseRef}..HEAD`, `--format=${LOG_FORMAT}`])
  if (!raw) {
    return []
  }
  return parseCommitLog(raw)
}

/**
 * The checkout's current committer email (`git config user.email`). Undefined
 * when unset.
 */
export function currentIdentityEmail(cwd: string): string | undefined {
  return git(cwd, ['config', 'user.email']) || undefined
}

/**
 * Split local-ahead commits into those by the current identity ("mine" —
 * yours by default) and those by another identity. Pure.
 */
export function classifyWork(options: {
  commits: readonly WorkCommit[]
  myEmail: string | undefined
}): WorkClassification {
  const opts = { __proto__: null, ...options } as typeof options
  const { commits, myEmail } = opts
  const mine: WorkCommit[] = []
  const otherIdentity: WorkCommit[] = []
  for (const c of commits) {
    if (myEmail && c.authorEmail === myEmail) {
      mine.push(c)
    } else {
      otherIdentity.push(c)
    }
  }
  return { mine, otherIdentity }
}

function shortSha(sha: string): string {
  return sha.slice(0, 9)
}

/**
 * Human-readable verdict. Leads with own-work-first so the reader's default
 * is "this is mine," not "this is a parallel agent." Pure.
 */
export function formatReport(options: {
  baseRef: string | undefined
  classification: WorkClassification
  myEmail: string | undefined
}): string {
  const opts = { __proto__: null, ...options } as typeof options
  const { baseRef, classification, myEmail } = opts
  const { mine, otherIdentity } = classification
  const lines: string[] = []
  if (!baseRef) {
    lines.push(
      'No upstream/default base resolved — cannot classify local-ahead work.',
      'Treat recent commits by your own identity as your own earlier work.',
    )
    return lines.join('\n')
  }
  const total = mine.length + otherIdentity.length
  lines.push(
    `${total} local-ahead commit(s) vs ${baseRef} (unpushed local work toward local main).`,
  )
  if (total === 0) {
    lines.push('Nothing local-ahead. HEAD is at/behind the base.')
    return lines.join('\n')
  }
  lines.push(
    '',
    `YOURS by default — ${mine.length} commit(s) by ${myEmail ?? '(identity unset)'}:`,
  )
  for (const c of mine.slice(0, 15)) {
    lines.push(`  ${shortSha(c.sha)}  ${c.isoDate}  ${c.subject}`)
  }
  if (mine.length > 15) {
    lines.push(`  ... and ${mine.length - 15} more`)
  }
  if (otherIdentity.length) {
    lines.push(
      '',
      `Other identity — ${otherIdentity.length} commit(s) (still local; usually a bot/co-author, not a rival session):`,
    )
    for (const c of otherIdentity.slice(0, 10)) {
      lines.push(`  ${shortSha(c.sha)}  ${c.authorEmail}  ${c.subject}`)
    }
  }
  lines.push(
    '',
    "Verdict: local-ahead commits are your (and any aligned session's) cumulative",
    "work toward local main — land, don't investigate. A real parallel session is a",
    'file changing between two of your OWN reads this turn, not an unfamiliar commit.',
  )
  return lines.join('\n')
}

export function main(cwd: string = process.cwd()): number {
  const baseRef = resolveBaseRef(cwd)
  const myEmail = currentIdentityEmail(cwd)
  const commits = baseRef ? localAheadCommits(cwd, baseRef) : []
  const classification = classifyWork({ commits, myEmail })
  const asJson = process.argv.includes('--json')
  if (asJson) {
    logger.log(
      JSON.stringify({ baseRef, myEmail, ...classification }, undefined, 2),
    )
  } else {
    logger.log(formatReport({ baseRef, classification, myEmail }))
  }
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
