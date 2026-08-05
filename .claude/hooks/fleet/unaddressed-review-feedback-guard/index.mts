#!/usr/bin/env node
// Claude Code Stop hook — unaddressed-review-feedback-guard.
//
// The RESPOND half of the PR review cycle. When THIS session opened or
// pushed a PR, review feedback, bot or human, must be RESPONDED to — a reply
// carrying a fix or an evidence-backed explanation — before the turn ends.
// Operators kept having to repeat "respond to the bot feedback and review";
// this makes skipping it a block, not a default.
//
// Complements bot-comment-collapse-guard, which is the COLLAPSE half:
// bot-comment-collapse-guard fires only AFTER this session already resolved
// threads (a `resolveReviewThread` mutation) and checks the top-level bot
// summaries are minimized. This guard fires EARLIER — the session drove a PR
// but left review threads with no reply — so the two chain: respond here,
// then resolve + minimize there. `isBotLogin` is imported from the collapse
// guard, single source of truth for review-bot classification, never forked.
//
// Detection is code-is-law: the guard scans this session's Bash tool calls
// for an active-work signal on a PR (`gh pr create`, `git push`, or a
// `gh pr comment|review|edit`) plus the concrete PR references it touched
// (a PR URL, a `gh pr <verb> <n> --repo <owner>/<repo>`, or a
// `repos/<owner>/<repo>/pulls/<n>` REST path), then queries each PR's LIVE
// state via `gh api graphql` for review threads that are unresolved and whose
// LAST comment is not the authenticated operator's — feedback nobody replied
// to. GitHub is the source of truth; a session that already replied (its
// login had the last word) or resolved the thread passes without ceremony.
//
// Blocks the Stop while a PR the session drove has an un-replied review
// thread; the message carries the exact `addPullRequestReviewThreadReply`
// command per thread. Fails open on gh / network / parse errors (the guard
// enforces a hygiene contract, it must never wedge a session over GitHub
// availability).
//
// Bypass: `Allow review-feedback bypass`.

import { block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { commandsFor, flagValue } from '../_shared/shell-command.mts'
import { isGhPrCreate } from '../_shared/gh-pr-command.mts'
import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'
import {
  BYPASS_LOOKBACK_USER_TURNS,
  bypassPhrasePresent,
  extractToolUseBlocks,
  readLines,
  resolveRoleAndContent,
} from '../_shared/transcript.mts'
// isBotLogin is the fleet's single review-bot classifier — imported, never
// forked, so a bot login added there is honored here too.
import { isBotLogin } from '../bot-comment-collapse-guard/index.mts'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

const BYPASS_PHRASE = 'Allow review-feedback bypass'

// `gh pr <verb>` verbs that mean the session is actively DRIVING the PR (as
// opposed to merely viewing someone else's). Paired with `gh pr create` and
// `git push`, these gate the whole check so a read-only `gh pr view` of a
// colleague's PR never triggers a reply obligation.
const PR_WRITE_VERBS: ReadonlySet<string> = new Set([
  'comment',
  'create',
  'edit',
  'merge',
  'new',
  'ready',
  'review',
])

// A PR reference the session touched: enough to address a live GraphQL query.
export interface PrRef {
  readonly number: number
  readonly owner: string
  readonly repo: string
}

// A PR URL anywhere in a command: github.com/<owner>/<repo>/pull/<n>.
const PR_URL_RE =
  /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)/g
// A REST pulls path in a `gh api` call: repos/<owner>/<repo>/pulls/<n>.
const PR_API_RE = /repos\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pulls\/(\d+)/g

// Lines that can possibly carry a PR interaction, so a megatranscript costs a
// substring test per line before any JSON parse.
const LINE_PREFILTER: readonly string[] = [
  'git push',
  'gh pr',
  '/pull/',
  'pulls/',
]

/**
 * Is there an active-work signal on a PR in this session — a `gh pr create`,
 * a `git push`, or a `gh pr comment|review|edit|...`? Without one the session
 * only read PRs, so no reply is owed and the guard stays silent.
 */
export function hasActiveWorkSignal(commands: readonly string[]): boolean {
  for (let i = 0, { length } = commands; i < length; i += 1) {
    const command = commands[i]!
    if (isGhPrCreate(command)) {
      return true
    }
    const gitCmds = commandsFor(command, 'git')
    for (let gi = 0, glen = gitCmds.length; gi < glen; gi += 1) {
      if (gitCmds[gi]!.args[0] === 'push') {
        return true
      }
    }
    const ghCmds = commandsFor(command, 'gh')
    for (let hi = 0, hlen = ghCmds.length; hi < hlen; hi += 1) {
      const args = ghCmds[hi]!.args
      if (args[0] === 'pr' && PR_WRITE_VERBS.has(args[1] ?? '')) {
        return true
      }
    }
  }
  return false
}

/**
 * Every distinct PR the session named — from a PR URL, a `gh api` pulls path,
 * or a `gh pr <verb> <n> --repo <owner>/<repo>` (a bare number with no
 * resolvable owner/repo is skipped: the live query needs both).
 */
export function extractPrRefs(commands: readonly string[]): PrRef[] {
  const seen = new Map<string, PrRef>()
  const add = (owner: string, repo: string, num: number) => {
    if (owner && repo && Number.isInteger(num) && num > 0) {
      seen.set(`${owner}/${repo}#${num}`, { number: num, owner, repo })
    }
  }
  for (let i = 0, { length } = commands; i < length; i += 1) {
    const command = commands[i]!
    // matchAll yields an iterator, not an array — for…of is the read shape.
    for (const m of command.matchAll(PR_URL_RE)) {
      add(m[1]!, m[2]!, Number(m[3]))
    }
    for (const m of command.matchAll(PR_API_RE)) {
      add(m[1]!, m[2]!, Number(m[3]))
    }
    const ghCmds = commandsFor(command, 'gh')
    for (let hi = 0, hlen = ghCmds.length; hi < hlen; hi += 1) {
      const args = ghCmds[hi]!.args
      if (args[0] !== 'pr') {
        continue
      }
      const num = args.find(a => /^\d+$/.test(a))
      const repoFlag = flagValue(args, '--repo', '-R')
      if (num && repoFlag && repoFlag.includes('/')) {
        const [owner, repo] = repoFlag.split('/')
        add(owner ?? '', repo ?? '', Number(num))
      }
    }
  }
  return [...seen.values()]
}

interface ReviewComment {
  author?: { login?: string | undefined } | null | undefined
  bodyText?: string | undefined
}

interface ReviewThreadNode {
  comments?: { nodes?: ReviewComment[] | null | undefined } | null | undefined
  id?: string | undefined
  isResolved?: boolean | undefined
  path?: string | undefined
}

export interface PullRequestThreads {
  reviewThreads?:
    | { nodes?: ReviewThreadNode[] | null | undefined }
    | null
    | undefined
}

export interface ThreadViolation {
  readonly id: string
  readonly isBot: boolean
  readonly path: string | undefined
  readonly reviewer: string
  readonly snippet: string | undefined
}

// First non-empty line of a comment body, trimmed + capped — a locator hint in
// the block message, never the whole body.
function firstLine(body: string | undefined): string | undefined {
  if (!body) {
    return undefined
  }
  const bodyLines = body.split('\n')
  for (let i = 0, { length } = bodyLines; i < length; i += 1) {
    const trimmed = bodyLines[i]!.trim()
    if (trimmed.length > 0) {
      return trimmed.length > 100 ? `${trimmed.slice(0, 97)}...` : trimmed
    }
  }
  return undefined
}

/**
 * The violating review threads on one PR: unresolved, non-empty, and whose
 * LAST comment was authored by someone other than the authenticated operator
 * (`viewerLogin`) — feedback the operator has not replied to. When the
 * operator's own login had the last word, the thread is answered (nothing
 * owed). Bot vs human is `isBotLogin` on that last author (message labeling +
 * ensuring human reviewers count too, not only bots).
 */
export function findUnansweredThreads(
  pr: PullRequestThreads,
  viewerLogin: string,
): ThreadViolation[] {
  const out: ThreadViolation[] = []
  const viewer = viewerLogin.toLowerCase()
  const threads = pr.reviewThreads?.nodes ?? []
  for (let i = 0, { length } = threads; i < length; i += 1) {
    const thread = threads[i]
    if (!thread || thread.isResolved !== false || thread.id === undefined) {
      continue
    }
    const comments = thread.comments?.nodes ?? []
    if (comments.length === 0) {
      continue
    }
    const last = comments[comments.length - 1]
    const lastLogin = last?.author?.login
    if (typeof lastLogin !== 'string' || lastLogin.length === 0) {
      continue
    }
    // The operator had the last word — the thread is answered.
    if (lastLogin.toLowerCase() === viewer) {
      continue
    }
    out.push({
      id: thread.id,
      isBot: isBotLogin(lastLogin),
      path: thread.path,
      reviewer: lastLogin,
      snippet: firstLine(last?.bodyText),
    })
  }
  return out
}

/**
 * The exact in-thread reply command for a violating thread. The body is a
 * placeholder — the operator supplies the fix or evidence-backed explanation.
 */
export function buildReplyCommand(threadId: string): string {
  return (
    `gh api graphql -f query='mutation { addPullRequestReviewThreadReply(input: ` +
    `{pullRequestReviewThreadId: "${threadId}", ` +
    `body: "<fix landed, or evidence-backed explanation>"}) ` +
    `{ comment { id } } }'`
  )
}

// Bounded transcript scan: only lines that can possibly carry a PR interaction
// are JSON-parsed. Collects this session's assistant Bash commands.
function sessionBashCommands(transcriptPath: string | undefined): string[] {
  const commands: string[] = []
  const lines = readLines(transcriptPath)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (!LINE_PREFILTER.some(token => line.includes(token))) {
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
    const uses = extractToolUseBlocks(resolved.content)
    for (let ui = 0, ulen = uses.length; ui < ulen; ui += 1) {
      const use = uses[ui]!
      const command = (
        use.input as { command?: unknown | undefined } | undefined
      )?.command
      if (use.name === 'Bash' && typeof command === 'string') {
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

// The live review-thread state + the authenticated operator's login for one
// PR, or undefined on any gh / parse failure, fail open.
function threadsForPr(
  pr: PrRef,
): { pr: PullRequestThreads; viewer: string } | undefined {
  const data = ghJson([
    'api',
    'graphql',
    '-f',
    `query=query { viewer { login } repository(owner: "${pr.owner}", name: "${pr.repo}") { pullRequest(number: ${pr.number}) { reviewThreads(first: 100) { nodes { id isResolved path comments(first: 100) { nodes { author { login } bodyText } } } } } } }`,
  ]) as
    | {
        data?:
          | {
              repository?:
                | { pullRequest?: PullRequestThreads | null | undefined }
                | null
                | undefined
              viewer?: { login?: string | undefined } | null | undefined
            }
          | undefined
      }
    | undefined
  const viewer = data?.data?.viewer?.login
  const prData = data?.data?.repository?.pullRequest
  if (typeof viewer !== 'string' || !viewer || !prData) {
    return undefined
  }
  return { pr: prData, viewer }
}

export const check = (payload: ToolCallPayload): GuardResult => {
  const commands = sessionBashCommands(payload.transcript_path)
  if (!hasActiveWorkSignal(commands)) {
    return undefined
  }
  const refs = extractPrRefs(commands)
  if (refs.length === 0) {
    return undefined
  }

  // Checked BEFORE the network calls: a bypassed turn skips the gh queries.
  if (
    bypassPhrasePresent(
      payload.transcript_path,
      BYPASS_PHRASE,
      BYPASS_LOOKBACK_USER_TURNS,
    )
  ) {
    return undefined
  }

  const lines: string[] = []
  for (let i = 0, { length } = refs; i < length; i += 1) {
    const ref = refs[i]!
    const result = threadsForPr(ref)
    if (result === undefined) {
      // gh unavailable / PR not found — fail open for this PR.
      continue
    }
    const violations = findUnansweredThreads(result.pr, result.viewer)
    if (violations.length === 0) {
      continue
    }
    for (let vi = 0, vlen = violations.length; vi < vlen; vi += 1) {
      const violation = violations[vi]!
      const kind = violation.isBot ? 'bot' : 'human'
      const where = violation.path ? ` (${violation.path})` : ''
      const snippet = violation.snippet ? ` "${violation.snippet}"` : ''
      lines.push(
        `   ✗ ${ref.owner}/${ref.repo}#${ref.number} ${kind} ${violation.reviewer}${where}${snippet} → ${buildReplyCommand(violation.id)}`,
      )
    }
  }
  if (lines.length === 0) {
    return undefined
  }

  return block(
    [
      '🚨 unaddressed-review-feedback-guard: un-replied review feedback on a PR this session drove — reply to each thread (a fix or an evidence-backed explanation), then resolve + minimize',
      ...lines,
    ].join('\n'),
  )
}

export const hook = defineHook({
  bypass: ['review-feedback'],
  bypassOptional: true,
  check,
  event: 'Stop',
  scope: 'convention',
  type: 'guard',
})
void runHook(hook, import.meta.url)
