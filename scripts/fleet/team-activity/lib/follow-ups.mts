/**
 * @file Follow-up signals — the half of the scan that tracks conversations the
 *   operator is already in: new replies on watched review comments, reaction
 *   deltas on them, and movement on known duplicate PR pairs. Ported from the
 *   original single-repo scanner and generalized to multi-repo (each watched
 *   comment carries its own repo, defaulting to the first configured repo). A
 *   reply is attributed to the comment/review it quotes so a thread between two
 *   other people is never mistaken for a reply to the operator.
 */

import { isBotLogin } from '../../lib/github-bots.mts'

import type {
  CommentActivity,
  CommentAuthorRole,
  GhRunner,
  ScanState,
  TeamActivityConfig,
} from './types.mts'

export interface FollowUpResult {
  readonly closedDups: string[]
  readonly errors: string[]
  readonly reactionChanges: string[]
  readonly replies: CommentActivity[]
}

// Attribute a reply's leading `>`-quoted text to whoever wrote it — the
// difference between "this answers OUR comment" and "someone else's thread".
export function attributeQuote(
  reply: { a: string; body: string },
  comments: ReadonlyArray<{ a: string; body: string }>,
  reviews: ReadonlyArray<{ a: string; body: string }>,
): string | undefined {
  const quoted = reply.body.split('\n').find(line => line.startsWith('>'))
  if (!quoted) {
    return undefined
  }
  const needle = quoted.replace(/^>\s?/, '').trim().slice(0, 120)
  if (needle.length < 12) {
    return undefined
  }
  for (const c of comments) {
    if (c.a !== reply.a && c.body.includes(needle)) {
      return `${c.a}'s comment`
    }
  }
  for (const r of reviews) {
    if (r.a !== reply.a && r.body.includes(needle)) {
      return `${r.a}'s review`
    }
  }
  return undefined
}

function defaultRepo(config: TeamActivityConfig): string {
  return config.repos[0] ?? `${config.org}/${config.org}`
}

interface CommentPayload {
  author: string
  comments: Array<{ a: string; at: string; body: string }>
  reviews: Array<{ a: string; body: string }>
}

// Scan watched-comment threads for new replies since the last tick.
function scanReplies(
  config: TeamActivityConfig,
  since: string,
  gh: GhRunner,
  errors: string[],
): CommentActivity[] {
  const replies: CommentActivity[] = []
  const seen = new Set<string>()
  for (const watched of config.watchedComments) {
    const repo = watched.repo ?? defaultRepo(config)
    const key = `${repo}#${watched.pr}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    const out = gh([
      'pr',
      'view',
      String(watched.pr),
      '--repo',
      repo,
      '--json',
      'author,comments,reviews',
      '--jq',
      '{author: .author.login, comments: [.comments[] | {a: .author.login, at: .createdAt, body: .body}], reviews: [.reviews[] | {a: .author.login, body: .body}]}',
    ])
    if (out === undefined) {
      errors.push(`pr ${repo}#${watched.pr}: comment fetch failed`)
      continue
    }
    let payload: CommentPayload
    try {
      payload = JSON.parse(out) as CommentPayload
    } catch {
      errors.push(`pr ${repo}#${watched.pr}: unparseable comment payload`)
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
      replies.push({
        author: c.a,
        body: c.body.slice(0, 400),
        createdAt: c.at,
        pr: watched.pr,
        quotedFrom: attributeQuote(c, comments, reviews),
        repo,
        role,
      })
    }
  }
  return replies
}

// Scan watched-comment reaction totals; report + persist deltas.
function scanReactions(
  config: TeamActivityConfig,
  state: ScanState,
  gh: GhRunner,
  errors: string[],
): string[] {
  const changes: string[] = []
  for (const watched of config.watchedComments) {
    const repo = watched.repo ?? defaultRepo(config)
    const out = gh([
      'api',
      `repos/${repo}/issues/comments/${watched.commentId}`,
      '--jq',
      '.reactions.total_count',
    ])
    if (out === undefined) {
      errors.push(`comment ${watched.commentId}: reaction fetch failed`)
      continue
    }
    const total = Number(out.trim())
    const key = String(watched.commentId)
    const previous = state.reactions[key] ?? 0
    if (Number.isFinite(total) && total !== previous) {
      changes.push(
        `comment ${watched.commentId} (PR ${watched.pr}): reactions ${previous} -> ${total}`,
      )
      state.reactions[key] = total
    }
  }
  return changes
}

// Scan known dup pairs; report when either member leaves OPEN.
function scanDupPairs(
  config: TeamActivityConfig,
  gh: GhRunner,
  errors: string[],
): string[] {
  const closed: string[] = []
  const repo = defaultRepo(config)
  for (const pair of config.dupPairs) {
    for (const pr of pair) {
      const out = gh([
        'pr',
        'view',
        String(pr),
        '--repo',
        repo,
        '--json',
        'state',
        '--jq',
        '.state',
      ])
      if (out === undefined) {
        errors.push(`dup pair pr ${pr}: state fetch failed`)
        continue
      }
      if (out.trim() !== 'OPEN') {
        closed.push(`#${pr} is now ${out.trim()}`)
      }
    }
  }
  return closed
}

// Run all three follow-up scans. Mutates `state.reactions`.
export function scanFollowUps(
  config: TeamActivityConfig,
  state: ScanState,
  gh: GhRunner,
): FollowUpResult {
  const errors: string[] = []
  const replies = scanReplies(config, state.scannedAt, gh, errors)
  const reactionChanges = scanReactions(config, state, gh, errors)
  const closedDups = scanDupPairs(config, gh, errors)
  return { closedDups, errors, reactionChanges, replies }
}
