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
 *   History alone cannot show that — the DIRTY-FILE section answers it from
 *   the active-edits ledger instead: each dirty path gets a verdict (a live
 *   actor wrote it recently / a stale actor / a shared generated artifact /
 *   nothing recorded), with the writer's actor id and write age, via the SAME
 *   attribution loop the dirty-worktree stop guard blocks on.
 *   Run it whenever `git log` or `git status` surprises you, before ever
 *   pausing to warn about a parallel agent. Informational: exits 0 unless git
 *   itself fails.
 */

import { statSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  attributeDirtyPath,
  COLLISION_WINDOW_MS,
  listOtherActorLedgerPaths,
  normalizeForLedger,
  readActorLedger,
  resolveStoreRoot,
} from '../../.claude/hooks/fleet/_shared/active-edits-ledger.mts'
import { isGenerated } from '../../.claude/hooks/fleet/_shared/landable.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { REPO_ROOT } from './paths.mts'

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
  const lines = raw.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
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
export function classifyWork(config: {
  commits: readonly WorkCommit[]
  myEmail: string | undefined
}): WorkClassification {
  const cfg = { __proto__: null, ...config } as typeof config
  const { commits, myEmail } = cfg
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
export function formatReport(config: {
  baseRef: string | undefined
  classification: WorkClassification
  myEmail: string | undefined
}): string {
  const cfg = { __proto__: null, ...config } as typeof config
  const { baseRef, classification, myEmail } = cfg
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
  const mineShown = mine.slice(0, 15)
  for (let i = 0, { length } = mineShown; i < length; i += 1) {
    const c = mineShown[i]!
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
    const otherShown = otherIdentity.slice(0, 10)
    for (let i = 0, { length } = otherShown; i < length; i += 1) {
      const c = otherShown[i]!
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

export interface DirtyVerdict {
  readonly path: string
  readonly verdict:
    | 'LIVE-ACTOR'
    | 'STALE-ACTOR'
    | 'SHARED-ARTIFACT'
    | 'UNATTRIBUTED'
  readonly actorId?: string | undefined
  readonly ageMinutes?: number | undefined
  readonly via?: string | undefined
}

/**
 * Attribute every dirty path via the active-edits ledger. A CLI run has no
 * transcript, so "own vs foreign" cannot be split — every actor ledger is a
 * candidate writer and the verdict names the most-recent one. The calling
 * session knows its own recent edits; anything LIVE-ACTOR it does not
 * recognize as its own is hands-off.
 */
export function attributeDirtyPaths(cwd: string): DirtyVerdict[] {
  // stdioString:false — the trimming default eats the leading space of an
  // unstaged ` M <path>` entry and shifts the first parsed path left by
  // one char (the land-work porcelain pitfall).
  const status = spawnSync('git', ['status', '--porcelain', '-z'], {
    cwd,
    stdioString: false,
    timeout: 10_000,
  })
  if (status.status !== 0) {
    return []
  }
  const dirty = String(status.stdout ?? '')
    .split('\0')
    .filter(Boolean)
    .map(entry => entry.slice(3))
    .filter(Boolean)
  const storeRoot = resolveStoreRoot(cwd)
  // Own actor unknown in a CLI run — pass '' so every ledger is a candidate.
  const ledgers = listOtherActorLedgerPaths(storeRoot, '').map(p =>
    readActorLedger(p),
  )
  const now = Date.now()
  const out: DirtyVerdict[] = []
  for (let i = 0, { length } = dirty; i < length; i += 1) {
    const rel = dirty[i]!
    if (isGenerated(rel)) {
      out.push({ path: rel, verdict: 'SHARED-ARTIFACT' })
      continue
    }
    const normalized = normalizeForLedger(path.resolve(cwd, rel))
    const attribution = attributeDirtyPath(normalized, undefined, ledgers, {
      now,
    })
    if (attribution.owner === 'unknown') {
      out.push({ path: rel, verdict: 'UNATTRIBUTED' })
      continue
    }
    out.push({
      path: rel,
      verdict:
        attribution.owner === 'foreign-live' ? 'LIVE-ACTOR' : 'STALE-ACTOR',
      actorId: attribution.actorLabel
        ? `${attribution.actorId} (${attribution.actorLabel}${attribution.actorPid ? `, pid ${attribution.actorPid}` : ''})`
        : attribution.actorId,
      ageMinutes: attribution.ageMs
        ? Math.round(attribution.ageMs / 60_000)
        : undefined,
      via: attribution.via,
    })
  }
  return out
}

/**
 * Report .git/index.lock contention: present + fresh = an in-flight git op
 * (retry shortly); present + old = likely orphaned by a crashed process.
 */
export function formatIndexLockReport(cwd: string): string | undefined {
  const lockPath = path.join(cwd, '.git', 'index.lock')
  let stat
  try {
    // oxlint-disable-next-line socket/prefer-exists-sync -- need mtime for the age readout
    stat = statSync(lockPath)
  } catch {
    return undefined
  }
  const ageSec = Math.round((Date.now() - stat.mtimeMs) / 1000)
  return (
    `.git/index.lock present (${ageSec}s old) — ` +
    (ageSec < 120
      ? 'an in-flight git operation; retry shortly rather than removing it.'
      : 'older than any normal operation; likely orphaned by a crashed process.')
  )
}

export function formatDirtyReport(verdicts: readonly DirtyVerdict[]): string {
  if (verdicts.length === 0) {
    return 'Working tree clean — no dirty paths to attribute.'
  }
  const lines = [`Dirty paths (${verdicts.length}) — ledger attribution:`]
  for (let i = 0, { length } = verdicts; i < length; i += 1) {
    const v = verdicts[i]!
    const who = v.actorId ? `  actor ${v.actorId}` : ''
    const age = v.ageMinutes !== undefined ? `  ${v.ageMinutes}m ago` : ''
    const via = v.via ? `  (via ${v.via})` : ''
    lines.push(`  ${v.verdict.padEnd(15)} ${v.path}${who}${age}${via}`)
  }
  lines.push(
    '',
    `LIVE-ACTOR = a live session wrote it (${Math.round(COLLISION_WINDOW_MS / 60_000)}m collision window applies) —`,
    'hands off unless the actor is you. UNATTRIBUTED = no ledger record (a',
    'human edit, a pre-session write, or a Bash write the recorder missed).',
  )
  return lines.join('\n')
}

export function main(cwd: string = REPO_ROOT): number {
  const baseRef = resolveBaseRef(cwd)
  const myEmail = currentIdentityEmail(cwd)
  const commits = baseRef ? localAheadCommits(cwd, baseRef) : []
  const classification = classifyWork({ commits, myEmail })
  const dirtyVerdicts = attributeDirtyPaths(cwd)
  const asJson = process.argv.includes('--json')
  if (asJson) {
    logger.log(
      JSON.stringify(
        { baseRef, dirty: dirtyVerdicts, myEmail, ...classification },
        undefined,
        2,
      ),
    )
  } else {
    logger.log(formatReport({ baseRef, classification, myEmail }))
    logger.log('')
    logger.log(formatDirtyReport(dirtyVerdicts))
    const lockReport = formatIndexLockReport(cwd)
    if (lockReport) {
      logger.log('')
      logger.log(lockReport)
    }
  }
  return 0
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main()
}
