/*
 * PR-activity scanner — the deterministic engine behind recurring
 * review-follow-up loops (code first, then AI: the script owns the
 * heartbeat, the gh queries, the state diffing, and the all-quiet report;
 * the agent only acts when this prints CHANGES or fails).
 *
 * Two tiers of signal, by design (see the fleet PR-review doctrine):
 *
 * - REPLY-WORTHY — you were explicitly pulled in: a review was requested from
 *   you, or you were @-mentioned in a fresh issue/PR. Engage these.
 * - REVIEW FYI — open, non-draft team PRs whose only commenters are bots (no
 *   teammate has weighed in yet). Look, don't reply unless pulled in. DRAFT PRs
 *   are never surfaced. Bot authorship is resolved by the canonical
 *   `isBotLogin` (Cursor, Copilot, CodeRabbit, Codex, Claude, Pullfrog, the
 *   Socket bot, …), so a PR a bot touched still counts as needing a human.
 *
 * Usage: node scripts/fleet/scan-pr-activity.mts <config.json> [--quiet]
 *
 * Config (JSON object):
 * repoDir          absolute path of the checkout to run gh from
 * repoSlug         owner/name for API routes (e.g. SocketDev/depscan)
 * org              owner to scope org-wide pull-in search (defaults to
 * repoSlug's owner) — where "review requested" / "@me" count
 * watchedComments  [{ pr: number, commentId: number }] — replies + reactions
 * authors          logins whose open, bot-only, non-draft PRs to surface (FYI)
 * dupPairs         [[prA, prB]] — report when either closes
 * selfLogin        login whose review-requests / mentions to surface, and whose
 * own comments don't count as replies.
 *
 * State (sibling `<config>.state.json`, script-owned): last scan time and
 * per-comment reaction totals, so "new" means since the previous tick.
 *
 * Output contract (the recurring prompt relays this verbatim):
 * exit 0, "SCAN: all quiet — …"   nothing changed; the agent ends the turn
 * exit 0, "SCAN: CHANGES" + bullets   the agent investigates/acts
 * exit 1, heartbeat/auth failure  the agent reports the re-auth ask.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import os from 'node:os'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
// oxlint-disable-next-line socket/prefer-async-spawn -- sequential CLI probe loop; sync keeps the state machine trivial and the process short-lived.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { refreshGhHeartbeat } from './gh-heartbeat.mts'
import { isBotLogin } from './lib/github-bots.mts'

const logger = getDefaultLogger()

export interface WatchedComment {
  readonly commentId: number
  readonly pr: number
}

export interface ScanConfig {
  readonly authors: string[]
  readonly dupPairs: number[][]
  readonly org?: string | undefined
  readonly repoDir: string
  readonly repoSlug: string
  readonly selfLogin: string
  readonly watchedComments: WatchedComment[]
}

export interface ScanState {
  reactions: Record<string, number>
  scannedAt: string
}

export interface GhRunner {
  (args: string[]): string | undefined
}

// Config paths accept `~/` so the file carries no hardcoded home prefix.
export function expandHome(p: string): string {
  return p.startsWith('~/') ? `${os.homedir()}/${p.slice(2)}` : p
}

// The org to scope pull-in search: explicit config, else the repoSlug owner.
export function resolveOrg(config: ScanConfig): string {
  return config.org ?? config.repoSlug.split('/')[0] ?? ''
}

function makeGhRunner(repoDir: string): GhRunner {
  return args => {
    const result = spawnSync('gh', args, { cwd: repoDir, stdio: 'pipe' })
    if (result.status !== 0) {
      return undefined
    }
    return String(result.stdout)
  }
}

// Who a reply's author is relative to the watched conversation. The reply
// handler engages ONLY when a comment addresses selfLogin's own comments —
// a thread between the PR author and another reviewer is theirs, not ours.
export type CommentAuthorRole = 'other' | 'pr-author' | 'team'

export interface CommentActivity {
  readonly author: string
  readonly body: string
  readonly createdAt: string
  readonly pr: number
  readonly quotedFrom: string | undefined
  readonly role: CommentAuthorRole
}

export interface ScanReport {
  readonly closedDups: string[]
  readonly errors: string[]
  readonly mentions: string[]
  readonly reactionChanges: string[]
  readonly replies: CommentActivity[]
  readonly reviewCandidates: string[]
  readonly reviewRequests: string[]
}

// Attribute a reply's leading `>`-quoted text to whoever wrote it — the
// difference between "this answers OUR comment" and "this is someone else's
// thread". (Root cause: a reply quoting a teammate's review was mistaken for
// a reply to our own comment and answered on the user's behalf.)
export function attributeQuote(
  reply: { a: string; body: string },
  comments: Array<{ a: string; body: string }>,
  reviews: Array<{ a: string; body: string }>,
): string | undefined {
  const quoted = reply.body
    .split('\n')
    .find(line => line.startsWith('> ') || line.startsWith('>'))
  if (!quoted) {
    return undefined
  }
  const needle = quoted.replace(/^>\s?/, '').trim().slice(0, 120)
  if (needle.length < 12) {
    return undefined
  }
  for (let i = 0, { length } = comments; i < length; i += 1) {
    const c = comments[i]!
    if (c.a !== reply.a && c.body.includes(needle)) {
      return `${c.a}'s comment`
    }
  }
  for (let i = 0, { length } = reviews; i < length; i += 1) {
    const r = reviews[i]!
    if (r.a !== reply.a && r.body.includes(needle)) {
      return `${r.a}'s review`
    }
  }
  return undefined
}

export function scanChanged(report: ScanReport): boolean {
  return (
    report.closedDups.length > 0 ||
    report.errors.length > 0 ||
    report.mentions.length > 0 ||
    report.reactionChanges.length > 0 ||
    report.replies.length > 0 ||
    report.reviewCandidates.length > 0 ||
    report.reviewRequests.length > 0
  )
}

// A search row from `gh search prs|issues --json`. `isDraft` exists only on
// `search prs` (issue search has no draft concept); `author` is available on
// both and lets us skip bot-authored items (Dependabot bumps, etc.).
interface SearchRow {
  author?: { login?: string | undefined } | undefined
  isDraft?: boolean | undefined
  number: number
  repository?: { nameWithOwner?: string | undefined } | undefined
  title: string
  url: string
}

function parseSearchRows(out: string): SearchRow[] {
  const parsed = JSON.parse(out) as SearchRow[]
  return Array.isArray(parsed) ? parsed : []
}

function formatRow(row: SearchRow): string {
  const slug = row.repository?.nameWithOwner
  const ref = slug ? `${slug}#${row.number}` : `#${row.number}`
  return `${ref} ${row.title} ${row.url}`
}

// Watched-comment replies + reaction deltas. Bots and self are never a reply.
function scanWatchedThreads(
  config: ScanConfig,
  state: ScanState,
  gh: GhRunner,
  report: ScanReport,
): void {
  const since = state.scannedAt
  const prs = [...new Set(config.watchedComments.map(c => c.pr))].toSorted(
    (a, b) => a - b,
  )
  for (const pr of prs) {
    const out = gh([
      'pr',
      'view',
      String(pr),
      '--json',
      'author,comments,reviews,state',
      '--jq',
      '{author: .author.login, state: .state, comments: [.comments[] | {a: .author.login, at: .createdAt, body: .body}], reviews: [.reviews[] | {a: .author.login, body: .body}]}',
    ])
    if (out === undefined) {
      report.errors.push(`pr ${pr}: comment fetch failed`)
      continue
    }
    let payload: {
      author: string
      comments: Array<{ a: string; at: string; body: string }>
      reviews: Array<{ a: string; body: string }>
      state: string
    }
    try {
      payload = JSON.parse(out) as typeof payload
    } catch {
      report.errors.push(`pr ${pr}: unparseable comment payload`)
      continue
    }
    // Never surface replies on a closed/merged PR — we don't comment there.
    if (payload.state !== 'OPEN') {
      continue
    }
    const { author: prAuthor, comments, reviews } = payload
    for (const c of comments) {
      if (c.at <= since || c.a === config.selfLogin || isBotLogin(c.a)) {
        continue
      }
      const role: CommentAuthorRole =
        c.a === prAuthor
          ? 'pr-author'
          : config.authors.includes(c.a)
            ? 'team'
            : 'other'
      report.replies.push({
        author: c.a,
        body: c.body.slice(0, 400),
        createdAt: c.at,
        pr,
        quotedFrom: attributeQuote(c, comments, reviews),
        role,
      })
    }
  }
  for (const watched of config.watchedComments) {
    const out = gh([
      'api',
      `repos/${config.repoSlug}/issues/comments/${watched.commentId}`,
      '--jq',
      '.reactions.total_count',
    ])
    if (out === undefined) {
      report.errors.push(`comment ${watched.commentId}: reaction fetch failed`)
      continue
    }
    const total = Number(out.trim())
    const key = String(watched.commentId)
    const previous = state.reactions[key] ?? 0
    if (Number.isFinite(total) && total !== previous) {
      report.reactionChanges.push(
        `comment ${watched.commentId} (PR ${watched.pr}): reactions ${previous} -> ${total}`,
      )
      state.reactions[key] = total
    }
  }
}

// REPLY-WORTHY: a review was explicitly requested from selfLogin. Drafts are
// excluded (a draft cannot really be requesting your review yet), and so are
// bot-authored PRs — a Dependabot bump with an auto-requested review is not a
// human asking for feedback.
function scanReviewRequests(
  config: ScanConfig,
  gh: GhRunner,
  report: ScanReport,
): void {
  const out = gh([
    'search',
    'prs',
    '--owner',
    resolveOrg(config),
    '--review-requested',
    config.selfLogin,
    '--state',
    'open',
    '--json',
    'author,number,title,url,isDraft,repository',
    '--limit',
    '50',
  ])
  if (out === undefined) {
    report.errors.push('review-requested search failed')
    return
  }
  try {
    for (const row of parseSearchRows(out)) {
      if (!row.isDraft && !isBotLogin(row.author?.login ?? '')) {
        report.reviewRequests.push(formatRow(row))
      }
    }
  } catch {
    report.errors.push('unparseable review-requested payload')
  }
}

// REPLY-WORTHY: selfLogin was @-mentioned in an issue/PR updated since the last
// tick (fresh asks only). Bot-authored items are skipped. `gh search issues`
// has no draft field, so drafts are not filtered here — a direct @-mention is
// an explicit ask worth surfacing even on a draft.
function scanMentions(
  config: ScanConfig,
  state: ScanState,
  gh: GhRunner,
  report: ScanReport,
): void {
  const sinceDate = state.scannedAt.slice(0, 10)
  const out = gh([
    'search',
    'issues',
    `updated:>=${sinceDate}`,
    '--owner',
    resolveOrg(config),
    '--mentions',
    config.selfLogin,
    '--state',
    'open',
    '--json',
    'author,number,title,url,repository',
    '--limit',
    '50',
  ])
  if (out === undefined) {
    report.errors.push('mentions search failed')
    return
  }
  try {
    for (const row of parseSearchRows(out)) {
      if (!isBotLogin(row.author?.login ?? '')) {
        report.mentions.push(formatRow(row))
      }
    }
  } catch {
    report.errors.push('unparseable mentions payload')
  }
}

// REVIEW FYI: open, non-draft PRs by a roster author whose only commenters are
// bots (no teammate, and not selfLogin, has weighed in). No date floor.
function scanReviewCandidates(
  config: ScanConfig,
  gh: GhRunner,
  report: ScanReport,
): void {
  const search = gh([
    'pr',
    'list',
    '--repo',
    config.repoSlug,
    '--state',
    'open',
    '--json',
    'number,title,author,url,comments,isDraft',
    '--limit',
    '100',
  ])
  if (search === undefined) {
    report.errors.push('review-candidate search failed')
    return
  }
  try {
    const rows = JSON.parse(search) as Array<{
      author: { login: string }
      comments: Array<{ author: { login: string } }>
      isDraft?: boolean | undefined
      number: number
      title: string
      url: string
    }>
    for (const row of rows) {
      if (row.isDraft || !config.authors.includes(row.author.login)) {
        continue
      }
      // A PR I've already commented on is handled — my own comment counts as
      // engagement, so it must not resurface every tick (loop convergence).
      if (row.comments.some(c => c.author.login === config.selfLogin)) {
        continue
      }
      const humanComments = row.comments.filter(
        c => c.author.login !== config.selfLogin && !isBotLogin(c.author.login),
      )
      if (humanComments.length === 0) {
        report.reviewCandidates.push(`#${row.number} ${row.title} ${row.url}`)
      }
    }
  } catch {
    report.errors.push('unparseable review-candidate payload')
  }
}

function scanDupPairs(
  config: ScanConfig,
  gh: GhRunner,
  report: ScanReport,
): void {
  for (const pair of config.dupPairs) {
    for (const pr of pair) {
      const out = gh([
        'pr',
        'view',
        String(pr),
        '--json',
        'state',
        '--jq',
        '.state',
      ])
      if (out === undefined) {
        report.errors.push(`dup pair pr ${pr}: state fetch failed`)
        continue
      }
      if (out.trim() !== 'OPEN') {
        report.closedDups.push(`#${pr} is now ${out.trim()}`)
      }
    }
  }
}

// One full scan pass. Mutates `state` (reaction totals + scannedAt) so the
// caller can persist it after reporting.
export function runScan(
  config: ScanConfig,
  state: ScanState,
  gh: GhRunner,
): ScanReport {
  const report: ScanReport = {
    closedDups: [],
    errors: [],
    mentions: [],
    reactionChanges: [],
    replies: [],
    reviewCandidates: [],
    reviewRequests: [],
  }
  scanWatchedThreads(config, state, gh, report)
  scanReviewRequests(config, gh, report)
  scanMentions(config, state, gh, report)
  scanReviewCandidates(config, gh, report)
  scanDupPairs(config, gh, report)
  state.scannedAt = new Date().toISOString()
  return report
}

export function renderReport(config: ScanConfig, report: ScanReport): string {
  if (!scanChanged(report)) {
    const pairs = config.dupPairs
      .map(p => p.map(n => `#${n}`).join('/'))
      .join(', ')
    return (
      `SCAN: all quiet — heartbeat green, ${config.repoSlug.split('/')[1]} ` +
      `quiet: no review requests or mentions for ${config.selfLogin}, ` +
      `no bot-only PRs from ${config.authors.join('/')}, nothing new on the ` +
      `${config.watchedComments.length} watched comments, ` +
      `dup pair ${pairs} still open. Board unchanged.`
    )
  }
  const lines = ['SCAN: CHANGES']
  for (const line of report.reviewRequests) {
    lines.push(`- review requested of you: ${line}`)
  }
  for (const line of report.mentions) {
    lines.push(`- you were @-mentioned: ${line}`)
  }
  for (const r of report.replies) {
    const role = r.role === 'pr-author' ? 'PR author' : r.role
    const quote = r.quotedFrom ? `, quotes ${r.quotedFrom}` : ''
    const caution =
      r.quotedFrom && !r.quotedFrom.startsWith(`${config.selfLogin}'`)
        ? ` [NOT a reply to ${config.selfLogin} — engage only if it addresses ${config.selfLogin} directly]`
        : ''
    lines.push(
      `- reply on PR ${r.pr} by ${r.author} (${role}${quote})${caution} at ${r.createdAt}: ${r.body}`,
    )
  }
  for (const line of report.reactionChanges) {
    lines.push(`- ${line}`)
  }
  for (const line of report.reviewCandidates) {
    lines.push(`- review FYI (bot-only, reply only if pulled in): ${line}`)
  }
  for (const line of report.closedDups) {
    lines.push(`- dup pair movement: ${line}`)
  }
  for (const line of report.errors) {
    lines.push(`- scan error: ${line}`)
  }
  return lines.join('\n')
}

export function statePathFor(configPath: string): string {
  return `${configPath}.state.json`
}

export function loadState(configPath: string): ScanState {
  const statePath = statePathFor(configPath)
  if (existsSync(statePath)) {
    try {
      const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as ScanState
      if (parsed && typeof parsed === 'object' && parsed.scannedAt) {
        return {
          reactions: parsed.reactions ?? {},
          scannedAt: parsed.scannedAt,
        }
      }
    } catch {
      // Fall through to a fresh state — a torn state file must not stop the
      // scan; the worst case is one tick that re-reports recent activity.
    }
  }
  return { reactions: {}, scannedAt: new Date().toISOString() }
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const configPath = process.argv.slice(2).find(a => !a.startsWith('--'))
  if (!configPath) {
    logger.fail(
      '[scan-pr-activity] no config. Where: CLI args. Saw: none; wanted: a config JSON path. Fix: node scripts/fleet/scan-pr-activity.mts <config.json>',
    )
    process.exitCode = 1
    return
  }
  let config: ScanConfig
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8')) as ScanConfig
  } catch (e) {
    logger.fail(
      `[scan-pr-activity] unreadable config. Where: ${configPath}. Saw: ${(e as Error).message}; wanted: the JSON shape in this script's header. Fix: correct the file.`,
    )
    process.exitCode = 1
    return
  }
  const heartbeat = refreshGhHeartbeat()
  if (!heartbeat.stamped) {
    logger.fail(`[scan-pr-activity] ${heartbeat.reason}`)
    process.exitCode = 1
    return
  }
  const state = loadState(configPath)
  const report = runScan(
    config,
    state,
    makeGhRunner(expandHome(config.repoDir)),
  )
  writeFileSync(statePathFor(configPath), JSON.stringify(state, undefined, 1))
  const rendered = renderReport(config, report)
  if (!quiet || scanChanged(report)) {
    logger.log(rendered)
  } else {
    logger.log(rendered.split(' — ')[0] ?? rendered)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
