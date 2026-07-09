#!/usr/bin/env node
/*
 * @file gh/GraphQL plumbing for the `driving-cursor-bugbot` skill — the
 *   mechanical half of the Bugbot review-and-fix loop, so the skill keeps only
 *   the AI judgment (classify each finding) and the human-stop inline. Every
 *   GitHub call goes through the `gh` CLI (keychain-auth, no token in argv);
 *   owner/repo resolve from `gh repo view` so the script works in any checkout.
 *
 *   Subcommands:
 *     inventory <PR>            — emit Bugbot review comments as JSON.
 *     reply <comment-id> <state> — threaded reply + conditional resolve.
 *     resolve <PR>             — sweep replied-to Bugbot threads, resolve them.
 *     already-fixed <PR>       — git-log scan for findings a later commit fixed.
 *
 *   Library: import { inventory, replyToFinding } from './bugbot.mts'
 *   CLI:     node .../lib/bugbot.mts inventory 123
 *            node .../lib/bugbot.mts reply 456789 fixed
 *            node .../lib/bugbot.mts resolve 123
 *            node .../lib/bugbot.mts already-fixed 123
 */

import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

const logger = getDefaultLogger()

// Cursor Bugbot posts under the `cursor` / `cursor[bot]` App logins
// (historically `bugbot`). GitHub usernames are case-insensitive but
// case-PRESERVING: the API `.user.login` is canonical, but the same handle in
// message text (an @-mention, the OAuth-returned name) can be mixed case — so
// match case-insensitively.
// See https://github.com/orgs/community/discussions/51746
const BUGBOT_LOGIN_RE = /bugbot|cursor/i

export interface BugbotFinding {
  readonly body: string
  readonly commitId: string
  readonly id: number
  readonly line: number | undefined
  readonly path: string
}

export interface OwnerRepo {
  readonly owner: string
  readonly repo: string
}

export interface ReplyResult {
  readonly commentId: number
  readonly replied: boolean
  readonly resolved: boolean
  readonly threadId: string | undefined
}

export type FindingState =
  | 'already-fixed'
  | 'false-positive'
  | 'fixed'
  | 'wont-fix'

const RESOLVING_STATES: ReadonlySet<FindingState> = new Set<FindingState>([
  'already-fixed',
  'false-positive',
  'fixed',
])

/**
 * Run `gh` and return trimmed stdout, surfacing a clean error on failure.
 */
export async function gh(args: readonly string[]): Promise<string> {
  try {
    const result = await spawn('gh', args as string[])
    return String(result.stdout)
  } catch (e) {
    throw new Error(`gh ${args.join(' ')} failed: ${errorMessage(e)}`)
  }
}

/**
 * Resolve `{ owner, repo }` for the current checkout via `gh repo view`.
 */
export async function resolveOwnerRepo(): Promise<OwnerRepo> {
  const out = await gh([
    'repo',
    'view',
    '--json',
    'owner,name',
    '--jq',
    '{owner: .owner.login, repo: .name}',
  ])
  const parsed = JSON.parse(out) as { owner: string; repo: string }
  return {
    __proto__: null,
    owner: parsed.owner,
    repo: parsed.repo,
  } as OwnerRepo
}

/**
 * Refuse to operate on a draft PR. Bugbot review-and-fix pushes changes and
 * replies on review threads — a draft is explicit WIP, never a review target.
 * Throws loud when the PR is a draft.
 */
export async function assertNotDraft(pr: number): Promise<void> {
  const out = await gh([
    'pr',
    'view',
    String(pr),
    '--json',
    'isDraft',
    '--jq',
    '.isDraft',
  ])
  if (out.trim() === 'true') {
    throw new Error(
      `PR #${pr} is a draft — refusing to drive Bugbot on it. ` +
        'Where: driving-cursor-bugbot. Saw: isDraft=true; wanted: a ' +
        'ready-for-review PR. Fix: mark the PR ready for review, or run on a ' +
        'non-draft PR.',
    )
  }
}

/**
 * List Bugbot review comments on a PR as structured findings.
 */
export async function inventory(pr: number): Promise<readonly BugbotFinding[]> {
  await assertNotDraft(pr)
  const { owner, repo } = await resolveOwnerRepo()
  const out = await gh([
    'api',
    '--paginate',
    `repos/${owner}/${repo}/pulls/${pr}/comments`,
  ])
  const comments = JSON.parse(out) as ReadonlyArray<{
    body: string
    commit_id: string
    id: number
    line: number | null
    path: string
    user: { login: string }
  }>
  const findings: BugbotFinding[] = []
  for (let i = 0, { length } = comments; i < length; i += 1) {
    const c = comments[i]!
    if (!BUGBOT_LOGIN_RE.test(c.user.login)) {
      continue
    }
    findings.push({
      __proto__: null,
      body: c.body,
      commitId: c.commit_id,
      id: c.id,
      line: c.line ?? undefined,
      path: c.path,
    } as unknown as BugbotFinding)
  }
  return findings
}

/**
 * Look up the GraphQL review-thread node id (`PRRT_…`) for a given inline
 * comment databaseId. Returns `undefined` when no matching thread is found.
 */
export async function findThreadId(options: {
  comment: number
  owner: string
  pr: number
  repo: string
}): Promise<string | undefined> {
  const { comment, owner, pr, repo } = {
    __proto__: null,
    ...options,
  } as typeof options
  const query = `
    query BugbotThreadLookup($pr: Int!, $owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) {
          reviewThreads(first: 100) {
            nodes {
              id
              isResolved
              comments(first: 1) { nodes { databaseId } }
            }
          }
        }
      }
    }`
  const out = await gh([
    'api',
    'graphql',
    '-f',
    `query=${query}`,
    '-f',
    `owner=${owner}`,
    '-f',
    `repo=${repo}`,
    '-F',
    `pr=${pr}`,
    '--jq',
    `.data.repository.pullRequest.reviewThreads.nodes[] | select(.comments.nodes[0].databaseId == ${comment}) | .id`,
  ])
  const id = out.trim()
  return id || undefined
}

/**
 * Resolve a single review thread by its node id.
 */
export async function resolveThread(threadId: string): Promise<void> {
  const mutation = `
    mutation($threadId: ID!) {
      resolveReviewThread(input: { threadId: $threadId }) {
        thread { id isResolved }
      }
    }`
  await gh([
    'api',
    'graphql',
    '-f',
    `query=${mutation}`,
    '-f',
    `threadId=${threadId}`,
  ])
}

/**
 * Find the PR number that an inline review comment belongs to.
 */
export async function prForComment(
  options: OwnerRepo & { comment: number },
): Promise<number> {
  const { comment, owner, repo } = {
    __proto__: null,
    ...options,
  } as typeof options
  const out = await gh([
    'api',
    `repos/${owner}/${repo}/pulls/comments/${comment}`,
    '--jq',
    '.pull_request_url',
  ])
  const url = out.trim()
  const match = /\/pulls\/(\d+)$/.exec(url)
  if (!match) {
    throw new Error(
      `cannot derive PR from comment ${comment}: pull_request_url was ${url || '(empty)'}`,
    )
  }
  return Number(match[1])
}

/**
 * Post a threaded reply on an inline review comment and, for resolving states,
 * resolve the thread. `wont-fix` replies but leaves the thread open.
 */
export async function replyToFinding(options: {
  body: string
  comment: number
  state: FindingState
}): Promise<ReplyResult> {
  const { body, comment, state } = {
    __proto__: null,
    ...options,
  } as typeof options
  const { owner, repo } = await resolveOwnerRepo()
  const pr = await prForComment({ comment, owner, repo })
  await gh([
    'api',
    `repos/${owner}/${repo}/pulls/${pr}/comments/${comment}/replies`,
    '-X',
    'POST',
    '-f',
    `body=${body}`,
  ])
  if (!RESOLVING_STATES.has(state)) {
    return {
      __proto__: null,
      commentId: comment,
      replied: true,
      resolved: false,
      threadId: undefined,
    } as ReplyResult
  }
  const threadId = await findThreadId({ comment, owner, pr, repo })
  if (threadId) {
    await resolveThread(threadId)
  }
  return {
    __proto__: null,
    commentId: comment,
    replied: true,
    resolved: Boolean(threadId),
    threadId,
  } as ReplyResult
}

/**
 * Sweep a PR's Bugbot review threads and resolve every one that already has an
 * author reply (more than one comment in the thread) and isn't resolved yet.
 * Returns the thread ids resolved.
 */
export async function resolveRepliedThreads(
  pr: number,
): Promise<readonly string[]> {
  const { owner, repo } = await resolveOwnerRepo()
  const query = `
    query BugbotThreadStates($pr: Int!, $owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) {
          reviewThreads(first: 100) {
            nodes {
              id
              isResolved
              comments(first: 50) { nodes { author { login } } }
            }
          }
        }
      }
    }`
  const out = await gh([
    'api',
    'graphql',
    '-f',
    `query=${query}`,
    '-f',
    `owner=${owner}`,
    '-f',
    `repo=${repo}`,
    '-F',
    `pr=${pr}`,
  ])
  const data = JSON.parse(out) as {
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: ReadonlyArray<{
              comments: {
                nodes: ReadonlyArray<{ author: { login: string } | null }>
              }
              id: string
              isResolved: boolean
            }>
          }
        }
      }
    }
  }
  const nodes = data.data.repository.pullRequest.reviewThreads.nodes
  const resolved: string[] = []
  for (let i = 0, { length } = nodes; i < length; i += 1) {
    const node = nodes[i]!
    if (node.isResolved) {
      continue
    }
    const comments = node.comments.nodes
    const startedByBugbot = comments[0]?.author
      ? BUGBOT_LOGIN_RE.test(comments[0].author.login)
      : false
    const hasAuthorReply = comments
      .slice(1)
      .some(c => c.author && !BUGBOT_LOGIN_RE.test(c.author.login))
    if (startedByBugbot && hasAuthorReply) {
      await resolveThread(node.id)
      resolved.push(node.id)
    }
  }
  return resolved
}

/**
 * For each Bugbot finding, scan the PR-branch git log since the finding's
 * `commitId` for a later commit that touches the finding's file — a candidate
 * "already fixed" signal the skill confirms before replying.
 */
export async function scanAlreadyFixed(pr: number): Promise<
  ReadonlyArray<{
    finding: BugbotFinding
    fixCommits: readonly string[]
  }>
> {
  const findings = await inventory(pr)
  const results: Array<{
    finding: BugbotFinding
    fixCommits: readonly string[]
  }> = []
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const finding = findings[i]!
    const fixCommits = await gitCommitsTouchingSince(
      finding.commitId,
      finding.path,
    )
    results.push({
      __proto__: null,
      finding,
      fixCommits,
    } as (typeof results)[number])
  }
  return results
}

/**
 * List local commits after `sinceSha` that touch `path` (newest first).
 */
export async function gitCommitsTouchingSince(
  sinceSha: string,
  path: string,
): Promise<readonly string[]> {
  try {
    const result = await spawn('git', [
      'log',
      '--format=%H',
      `${sinceSha}..HEAD`,
      '--',
      path,
    ])
    return String(result.stdout)
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
  } catch (e) {
    throw new Error(
      `git log ${sinceSha}..HEAD -- ${path} failed: ${errorMessage(e)}`,
    )
  }
}

/**
 * CLI entry. See the file header for subcommands.
 */
export async function main(argv: readonly string[]): Promise<void> {
  const [command, ...rest] = argv
  if (command === 'inventory') {
    const pr = Number(rest[0])
    if (!Number.isInteger(pr)) {
      logger.fail('usage: bugbot.mts inventory <PR>')
      process.exitCode = 1
      return
    }
    logger.log(JSON.stringify(await inventory(pr), undefined, 2))
    return
  }
  if (command === 'reply') {
    const comment = Number(rest[0])
    const state = rest[1] as FindingState | undefined
    const body = rest[2]
    if (!Number.isInteger(comment) || !state) {
      logger.fail('usage: bugbot.mts reply <comment-id> <state> [body]')
      process.exitCode = 1
      return
    }
    const result = await replyToFinding({
      body: body ?? '',
      comment,
      state,
    })
    logger.log(JSON.stringify(result, undefined, 2))
    return
  }
  if (command === 'resolve') {
    const pr = Number(rest[0])
    if (!Number.isInteger(pr)) {
      logger.fail('usage: bugbot.mts resolve <PR>')
      process.exitCode = 1
      return
    }
    logger.log(JSON.stringify(await resolveRepliedThreads(pr), undefined, 2))
    return
  }
  if (command === 'already-fixed') {
    const pr = Number(rest[0])
    if (!Number.isInteger(pr)) {
      logger.fail('usage: bugbot.mts already-fixed <PR>')
      process.exitCode = 1
      return
    }
    logger.log(JSON.stringify(await scanAlreadyFixed(pr), undefined, 2))
    return
  }
  logger.fail('usage: bugbot.mts <inventory|reply|resolve|already-fixed> [...]')
  process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    logger.fail(errorMessage(e))
    process.exitCode = 1
  })
}
