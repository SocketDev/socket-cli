#!/usr/bin/env node
// Claude Code Stop hook — bot-comment-collapse-guard.
//
// "Resolve the bot comments" means the FULL visual collapse: resolving the
// review threads AND minimizing the bot's top-level review summaries /
// comments as RESOLVED. Sessions kept doing only the first half — resolved
// threads auto-collapse, but a review bot's "found N issues" summary body
// does NOT, and stays loud on the PR page (depscan #23256 / #23218,
// 2026-07-24: the operator had to ask repeatedly).
//
// Detection is code-is-law: the guard scans this session's Bash tool calls
// for `resolveReviewThread` mutations, maps the `PRRT_…` thread ids to
// their pull requests via a `gh api graphql` node lookup, then queries each
// PR's LIVE state for bot-authored, un-minimized reviews and issue
// comments. GitHub is the source of truth — a session that minimized in a
// later command, or resolved threads on a PR whose bot summaries were
// already collapsed, passes without ceremony.
//
// Blocks the Stop while violations remain; the message carries the exact
// `gh api graphql` minimizeComment command per surface. Fails open on gh /
// network / parse errors (the guard enforces a hygiene contract, it must
// never wedge a session over GitHub availability).
//
// Bypass: `Allow bot-collapse bypass`.

import { block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'
import {
  BYPASS_LOOKBACK_USER_TURNS,
  bypassPhrasePresent,
  extractToolUseBlocks,
  readLines,
  resolveRoleAndContent,
} from '../_shared/transcript.mts'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

const BYPASS_PHRASE = 'Allow bot-collapse bypass'

// Review-bot logins, GraphQL form (no `[bot]` suffix) and REST form (with
// it). Deliberately a known-set + suffix test, not a bare /bot/ substring —
// a human login like "abbott" must never count.
const BOT_LOGIN_SET: ReadonlySet<string> = new Set([
  'bugbot',
  'coderabbitai',
  'copilot',
  'cursor',
  'dependabot',
  'github-actions',
  'renovate',
])

export function isBotLogin(login: string): boolean {
  const normalized = login.toLowerCase()
  return (
    normalized.endsWith('[bot]') ||
    BOT_LOGIN_SET.has(normalized.replace(/\[bot\]$/, ''))
  )
}

// Thread ids as they appear in `resolveReviewThread` mutation calls.
const THREAD_ID_RE = /PRRT_[A-Za-z0-9_-]+/g

/**
 * Pull every distinct `PRRT_…` id out of the session's Bash commands that
 * ran a resolveReviewThread mutation. Commands that merely LIST threads
 * (a query, not the mutation) contribute nothing.
 */
export function extractResolvedThreadIds(
  commands: readonly string[],
): string[] {
  const ids = new Set<string>()
  for (const command of commands) {
    if (!command.includes('resolveReviewThread')) {
      continue
    }
    for (const match of command.match(THREAD_ID_RE) ?? []) {
      ids.add(match)
    }
  }
  return [...ids]
}

export interface BotSurface {
  readonly author: string
  readonly id: string
  readonly kind: 'comment' | 'review'
}

interface MinimizableNode {
  author?: { login?: string | undefined } | null | undefined
  body?: string | null | undefined
  id?: string | undefined
  isMinimized?: boolean | undefined
}

interface PullRequestSurfaces {
  comments?: { nodes?: MinimizableNode[] | null | undefined } | null | undefined
  reviews?: { nodes?: MinimizableNode[] | null | undefined } | null | undefined
}

/**
 * The violating surfaces on one PR: bot-authored, not minimized, with a
 * non-empty body (an empty review shell — an inline-comments-only review —
 * has nothing to collapse).
 */
export function findUncollapsedBotSurfaces(
  pr: PullRequestSurfaces,
): BotSurface[] {
  const out: BotSurface[] = []
  const scan = (
    nodes: MinimizableNode[] | null | undefined,
    kind: BotSurface['kind'],
  ) => {
    for (const node of nodes ?? []) {
      const login = node.author?.login
      if (
        node.id !== undefined &&
        login !== undefined &&
        login !== null &&
        isBotLogin(login) &&
        node.isMinimized === false &&
        (node.body ?? '').trim().length > 0
      ) {
        out.push({ author: login, id: node.id, kind })
      }
    }
  }
  scan(pr.reviews?.nodes, 'review')
  scan(pr.comments?.nodes, 'comment')
  return out
}

export function buildMinimizeCommand(subjectId: string): string {
  return (
    `gh api graphql -f query='mutation { minimizeComment(input: ` +
    `{subjectId: "${subjectId}", classifier: RESOLVED}) ` +
    `{ minimizedComment { isMinimized } } }'`
  )
}

// Bounded transcript scan: only lines that can possibly carry the mutation
// are parsed, so a megatranscript costs a substring test per line.
function sessionResolveCommands(transcriptPath: string | undefined): string[] {
  const commands: string[] = []
  for (const line of readLines(transcriptPath)) {
    if (!line.includes('resolveReviewThread')) {
      continue
    }
    let evt: unknown
    try {
      evt = JSON.parse(line)
    } catch {
      continue
    }
    const resolved = resolveRoleAndContent(evt)
    if (resolved?.role !== 'assistant') {
      continue
    }
    for (const use of extractToolUseBlocks(resolved.content)) {
      const command = (
        use.input as { command?: unknown | undefined } | undefined
      )?.command
      if (
        use.name === 'Bash' &&
        typeof command === 'string' &&
        command.includes('resolveReviewThread')
      ) {
        commands.push(command)
      }
    }
  }
  return commands
}

function ghJson(args: readonly string[]): unknown {
  const r = spawnSync('gh', [...args], { timeout: spawnTimeoutMs(15_000) })
  if (r.status !== 0 || typeof r.stdout !== 'string') {
    return undefined
  }
  try {
    return JSON.parse(r.stdout)
  } catch {
    return undefined
  }
}

interface PrRef {
  readonly nameWithOwner: string
  readonly number: number
}

// Thread ids → the distinct PRs they belong to. One nodes() lookup.
function pullRequestsForThreads(threadIds: readonly string[]): PrRef[] {
  const idList = threadIds.map(id => `"${id}"`).join(', ')
  const data = ghJson([
    'api',
    'graphql',
    '-f',
    `query=query { nodes(ids: [${idList}]) { ... on PullRequestReviewThread { pullRequest { number repository { nameWithOwner } } } } }`,
  ]) as
    | {
        data?:
          | {
              nodes?:
                | Array<{
                    pullRequest?:
                      | {
                          number?: number | undefined
                          repository?:
                            | { nameWithOwner?: string | undefined }
                            | undefined
                        }
                      | undefined
                  } | null>
                | null
                | undefined
            }
          | undefined
      }
    | undefined
  const seen = new Map<string, PrRef>()
  for (const node of data?.data?.nodes ?? []) {
    const number = node?.pullRequest?.number
    const nameWithOwner = node?.pullRequest?.repository?.nameWithOwner
    if (typeof number === 'number' && typeof nameWithOwner === 'string') {
      seen.set(`${nameWithOwner}#${number}`, { nameWithOwner, number })
    }
  }
  return [...seen.values()]
}

function surfacesForPr(pr: PrRef): BotSurface[] | undefined {
  const [owner, name] = pr.nameWithOwner.split('/')
  if (!owner || !name) {
    return undefined
  }
  const data = ghJson([
    'api',
    'graphql',
    '-f',
    `query=query { repository(owner: "${owner}", name: "${name}") { pullRequest(number: ${pr.number}) { reviews(first: 50) { nodes { id isMinimized author { login } body } } comments(first: 100) { nodes { id isMinimized author { login } body } } } } }`,
  ]) as
    | {
        data?:
          | {
              repository?:
                | { pullRequest?: PullRequestSurfaces | null | undefined }
                | null
                | undefined
            }
          | undefined
      }
    | undefined
  const prData = data?.data?.repository?.pullRequest
  if (!prData) {
    return undefined
  }
  return findUncollapsedBotSurfaces(prData)
}

export const check = (payload: ToolCallPayload): GuardResult | undefined => {
  const commands = sessionResolveCommands(payload.transcript_path)
  const threadIds = extractResolvedThreadIds(commands)
  if (threadIds.length === 0) {
    return undefined
  }

  if (
    bypassPhrasePresent(
      payload.transcript_path,
      BYPASS_PHRASE,
      BYPASS_LOOKBACK_USER_TURNS,
    )
  ) {
    return undefined
  }

  const prs = pullRequestsForThreads(threadIds)
  if (prs.length === 0) {
    // gh unavailable / ids stale — fail open.
    return undefined
  }

  const lines: string[] = []
  for (const pr of prs) {
    const violations = surfacesForPr(pr)
    if (violations === undefined || violations.length === 0) {
      continue
    }
    lines.push(`  ${pr.nameWithOwner}#${pr.number}:`)
    for (const violation of violations) {
      lines.push(
        `    - ${violation.kind} by ${violation.author} (${violation.id})`,
      )
      lines.push(`      ${buildMinimizeCommand(violation.id)}`)
    }
  }
  if (lines.length === 0) {
    return undefined
  }

  return block(
    [
      '🚨 bot-comment-collapse-guard: review threads were resolved this',
      '   session, but bot review summaries/comments on the same PR(s) are',
      '   still expanded.',
      '',
      '"Resolve the bot comments" means the full visual collapse: resolve',
      "the threads AND minimize the bot's top-level bodies as RESOLVED.",
      '',
      'Still expanded:',
      ...lines,
      '',
      'Run the minimize command(s) above, then end the turn.',
      '',
      `Bypass (the user must type verbatim in a recent turn): \`${BYPASS_PHRASE}\``,
    ].join('\n'),
  )
}

export const hook = defineHook({
  bypass: ['bot-collapse'],
  bypassOptional: true,
  check,
  event: 'Stop',
  scope: 'convention',
  type: 'guard',
})
void runHook(hook, import.meta.url)
