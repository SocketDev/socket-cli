/**
 * PR-activity scanner — the deterministic engine behind recurring
 * review-follow-up loops (code first, then AI: the script owns the
 * heartbeat, the gh queries, the state diffing, and the all-quiet report;
 * the agent only acts when this prints CHANGES or fails).
 *
 * Usage: node scripts/fleet/scan-pr-activity.mts <config.json> [--quiet]
 *
 * Config (JSON object):
 * repoDir          absolute path of the checkout to run gh from
 * repoSlug         owner/name for API routes (e.g. SocketDev/depscan)
 * watchedComments  [{ pr: number, commentId: number }] — replies + reactions
 * authors          logins whose NEW open PRs (no human comments) to surface
 * dupPairs         [[prA, prB]] — report when either closes
 * selfLogin        login whose own comments don't count as replies
 * createdSince     YYYY-MM-DD floor for the new-PR search.
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

const logger = getDefaultLogger()

const BOT_AUTHOR_PATTERN = /bot|linear|cursor|copilot/i

export interface WatchedComment {
  readonly commentId: number
  readonly pr: number
}

export interface ScanConfig {
  readonly authors: string[]
  readonly createdSince: string
  readonly dupPairs: number[][]
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
  readonly newPrs: string[]
  readonly reactionChanges: string[]
  readonly replies: CommentActivity[]
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
    report.newPrs.length > 0 ||
    report.reactionChanges.length > 0 ||
    report.replies.length > 0
  )
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
    newPrs: [],
    reactionChanges: [],
    replies: [],
  }
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
      'author,comments,reviews',
      '--jq',
      '{author: .author.login, comments: [.comments[] | {a: .author.login, at: .createdAt, body: .body}], reviews: [.reviews[] | {a: .author.login, body: .body}]}',
    ])
    if (out === undefined) {
      report.errors.push(`pr ${pr}: comment fetch failed`)
      continue
    }
    let payload: {
      author: string
      comments: Array<{ a: string; at: string; body: string }>
      reviews: Array<{ a: string; body: string }>
    }
    try {
      payload = JSON.parse(out) as typeof payload
    } catch {
      report.errors.push(`pr ${pr}: unparseable comment payload`)
      continue
    }
    const { author: prAuthor, comments, reviews } = payload
    for (const c of comments) {
      if (c.at <= since) {
        continue
      }
      if (c.a === config.selfLogin || BOT_AUTHOR_PATTERN.test(c.a)) {
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

  const search = gh([
    'pr',
    'list',
    '--state',
    'open',
    '--search',
    `created:>=${config.createdSince}`,
    '--json',
    'number,title,author,url,comments',
  ])
  if (search === undefined) {
    report.errors.push('new-PR search failed')
  } else {
    try {
      const rows = JSON.parse(search) as Array<{
        author: { login: string }
        comments: Array<{ author: { login: string } }>
        number: number
        title: string
        url: string
      }>
      for (const row of rows) {
        if (!config.authors.includes(row.author.login)) {
          continue
        }
        // A PR I've already commented on is handled — suppress it, or the
        // scan re-detects it as "new/uncommented" every tick and the loop
        // never converges (my own comment doesn't count as someone else
        // engaging, but it DOES mean I've engaged).
        if (row.comments.some(c => c.author.login === config.selfLogin)) {
          continue
        }
        const humanComments = row.comments.filter(
          c =>
            c.author.login !== config.selfLogin &&
            !BOT_AUTHOR_PATTERN.test(c.author.login),
        )
        if (humanComments.length === 0) {
          report.newPrs.push(`#${row.number} ${row.title} ${row.url}`)
        }
      }
    } catch {
      report.errors.push('unparseable new-PR search payload')
    }
  }

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
      `quiet: nothing new on the ${config.watchedComments.length} watched ` +
      `comments, no uncommented PRs from ${config.authors.join('/')}, ` +
      `dup pair ${pairs} still open. Board unchanged.`
    )
  }
  const lines = ['SCAN: CHANGES']
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
  for (const line of report.newPrs) {
    lines.push(`- new uncommented PR: ${line}`)
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
