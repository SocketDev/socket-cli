/**
 * @file Bot-feedback collection and the FULL collapse for handled findings.
 *   Collection reads all three comment surfaces (review comments, reviews,
 *   issue comments); a bot is any `[bot]` login. Verdicts on findings are
 *   judgment and stay with the operator or an AI pass — this module only does
 *   the deterministic halves: list, reply, resolve, minimize.
 *   "Collapse" means BOTH halves, per the bot-comment-collapse law: resolve
 *   the review thread AND minimize the bot's top-level review body. A resolved
 *   thread with an expanded summary is half-done.
 *   Never auto-minimized: org security-bot alerts (license and supply-chain
 *   Warns) — those carry decisions only a human can make. The one sanctioned
 *   auto-collapse is a staging bot duplicating its production twin.
 */

import { ghGraphql, ghRestJson, runGh } from './gh.mts'

import type { GhRunner } from './gh.mts'

export interface BotComment {
  readonly author: string
  readonly body: string
  readonly id: number
  readonly nodeId: string
  readonly surface: 'issue-comment' | 'review-comment' | 'review'
}

export interface BotFeedback {
  readonly comments: readonly BotComment[]
  readonly pr: number
}

const BOT_LOGIN_RE = /\[bot\]$/

export function isBotLogin(login: string): boolean {
  return BOT_LOGIN_RE.test(login)
}

/**
 * True for the org's own security bots, whose alert comments are decisions
 * for a human — the collapse commands refuse them unless the comment is a
 * staging duplicate.
 */
export function isSecurityAlertBot(login: string): boolean {
  return login.startsWith('socket-security')
}

/**
 * True when `login` is the staging twin of a production bot that also
 * commented — the one shape safe to minimize as DUPLICATE with no judgment.
 */
export function isStagingDuplicate(
  login: string,
  allLogins: readonly string[],
): boolean {
  if (!login.includes('-staging[bot]')) {
    return false
  }
  const production = login.replace('-staging[bot]', '[bot]')
  return allLogins.includes(production)
}

interface RawComment {
  body?: string | undefined
  id?: number | undefined
  node_id?: string | undefined
  state?: string | undefined
  user?: { login?: string | undefined } | undefined
}

function toBotComments(
  raw: unknown,
  surface: BotComment['surface'],
): BotComment[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const out: BotComment[] = []
  for (let i = 0, { length } = raw; i < length; i += 1) {
    const c = raw[i] as RawComment
    const login = c?.user?.login ?? ''
    if (!isBotLogin(login)) {
      continue
    }
    out.push({
      author: login,
      body: c.body ?? '',
      id: c.id ?? 0,
      nodeId: c.node_id ?? '',
      surface,
    })
  }
  return out
}

/**
 * All bot comments on one PR, across the three surfaces.
 */
export async function collectBotFeedback(
  repo: string,
  pr: number,
  gh: GhRunner = runGh,
): Promise<BotFeedback> {
  const [reviewComments, reviews, issueComments] = await Promise.all([
    ghRestJson(`repos/${repo}/pulls/${pr}/comments`, '.', gh),
    ghRestJson(`repos/${repo}/pulls/${pr}/reviews`, '.', gh),
    ghRestJson(`repos/${repo}/issues/${pr}/comments`, '.', gh),
  ])
  return {
    comments: [
      ...toBotComments(reviewComments, 'review-comment'),
      ...toBotComments(reviews, 'review'),
      ...toBotComments(issueComments, 'issue-comment'),
    ],
    pr,
  }
}

/**
 * Post a reply into a review-comment thread. The body is the caller's — this
 * module never writes prose.
 */
export async function replyToReviewComment(
  repo: string,
  pr: number,
  commentId: number,
  body: string,
  gh: GhRunner = runGh,
): Promise<boolean> {
  const { exitCode } = await gh([
    'api',
    `repos/${repo}/pulls/${pr}/comments/${commentId}/replies`,
    '-f',
    `body=${body}`,
  ])
  return exitCode === 0
}

const PR_THREADS_QUERY =
  'query($id:ID!){node(id:$id){... on PullRequest{reviewThreads(first:100)' +
  '{nodes{id isResolved comments(first:1){nodes{databaseId author{login}}}}}}}}'

export interface ReviewThread {
  readonly author: string
  readonly firstCommentId: number
  readonly isResolved: boolean
  readonly threadId: string
}

/**
 * Review threads for a PR, fetched by node id so no repo name enters the
 * GraphQL text. Requires the PR's node id from a prior REST read.
 */
export async function listReviewThreads(
  prNodeId: string,
  gh: GhRunner = runGh,
): Promise<readonly ReviewThread[]> {
  const data = (await ghGraphql(PR_THREADS_QUERY, { id: prNodeId }, gh)) as
    | {
        data?:
          | {
              node?:
                | {
                    reviewThreads?:
                      | {
                          nodes?:
                            | Array<{
                                comments?:
                                  | {
                                      nodes?:
                                        | Array<{
                                            author?:
                                              | { login?: string | undefined }
                                              | undefined
                                            databaseId?: number | undefined
                                          }>
                                        | undefined
                                    }
                                  | undefined
                                id?: string | undefined
                                isResolved?: boolean | undefined
                              }>
                            | undefined
                        }
                      | undefined
                  }
                | undefined
            }
          | undefined
      }
    | undefined
  const nodes = data?.data?.node?.reviewThreads?.nodes ?? []
  const out: ReviewThread[] = []
  for (let i = 0, { length } = nodes; i < length; i += 1) {
    const t = nodes[i]!
    const first = t.comments?.nodes?.[0]
    out.push({
      author: first?.author?.login ?? '',
      firstCommentId: first?.databaseId ?? 0,
      isResolved: t.isResolved === true,
      threadId: t.id ?? '',
    })
  }
  return out
}

const RESOLVE_THREAD_MUTATION =
  'mutation($id:ID!){resolveReviewThread(input:{threadId:$id})' +
  '{thread{isResolved}}}'

export async function resolveReviewThread(
  threadId: string,
  gh: GhRunner = runGh,
): Promise<boolean> {
  const data = (await ghGraphql(
    RESOLVE_THREAD_MUTATION,
    { id: threadId },
    gh,
  )) as
    | {
        data?:
          | {
              resolveReviewThread?:
                | { thread?: { isResolved?: boolean | undefined } | undefined }
                | undefined
            }
          | undefined
      }
    | undefined
  return data?.data?.resolveReviewThread?.thread?.isResolved === true
}

const MINIMIZE_MUTATION =
  'mutation($id:ID!,$why:ReportedContentClassifiers!)' +
  '{minimizeComment(input:{subjectId:$id,classifier:$why})' +
  '{minimizedComment{isMinimized}}}'

export type MinimizeClassifier = 'DUPLICATE' | 'OUTDATED' | 'RESOLVED'

export async function minimizeComment(
  nodeId: string,
  classifier: MinimizeClassifier,
  gh: GhRunner = runGh,
): Promise<boolean> {
  const data = (await ghGraphql(
    MINIMIZE_MUTATION,
    { id: nodeId, why: classifier },
    gh,
  )) as
    | {
        data?:
          | {
              minimizeComment?:
                | {
                    minimizedComment?:
                      | { isMinimized?: boolean | undefined }
                      | undefined
                  }
                | undefined
            }
          | undefined
      }
    | undefined
  return data?.data?.minimizeComment?.minimizedComment?.isMinimized === true
}
