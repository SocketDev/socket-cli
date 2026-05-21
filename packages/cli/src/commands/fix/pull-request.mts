import { RequestError } from '@octokit/request-error'

import { UNKNOWN_VALUE } from '@socketsecurity/lib-stable/constants/sentinels'
import { debug, debugDir } from '@socketsecurity/lib-stable/debug/output'
import { isNonEmptyString } from '@socketsecurity/lib-stable/strings/predicates'

import {
  getSocketFixBranchPattern,
  getSocketFixPullRequestBody,
  getSocketFixPullRequestTitle,
} from './git.mts'
import { logPrEvent } from './pr-lifecycle-logger.mts'
import {
  GQL_PAGE_SENTINEL,
  GQL_PR_STATE_CLOSED,
  GQL_PR_STATE_MERGED,
  GQL_PR_STATE_OPEN,
} from '../../constants/github.mts'
import { formatErrorWithDetail } from '../../util/error/errors.mjs'
import {
  cacheFetch,
  getOctokit,
  getOctokitGraphql,
  handleGraphqlError,
  withGitHubRetry,
  writeCache,
} from '../../util/git/github.mts'
import type { GhsaDetails, Pr } from '../../util/git/github.mts'
import { createPrProvider } from '../../util/git/provider-factory.mts'

import type { OctokitResponse } from '@octokit/types'
import type { JsonContent } from '@socketsecurity/lib-stable/fs/types'

type GQL_MERGE_STATE_STATUS =
  | 'BEHIND'
  | 'BLOCKED'
  | 'CLEAN'
  | 'DIRTY'
  | 'DRAFT'
  | 'HAS_HOOKS'
  | 'UNKNOWN'
  | 'UNSTABLE'

type GQL_PR_STATE = 'OPEN' | 'CLOSED' | 'MERGED'

export type PrMatch = {
  author: string
  baseRefName: string
  headRefName: string
  mergeStateStatus: GQL_MERGE_STATE_STATUS
  number: number
  state: GQL_PR_STATE
  title: string
}

export async function cleanupSocketFixPrs(
  owner: string,
  repo: string,
  ghsaId: string,
): Promise<PrMatch[]> {
  const contextualMatches = await getSocketFixPrsWithContext(owner, repo, {
    ghsaId,
  })

  if (!contextualMatches.length) {
    return []
  }

  const cachesToSave = new Map<string, JsonContent>()
  const provider = createPrProvider()

  const settledMatches = await Promise.allSettled(
    contextualMatches.map(async ({ context, match }) => {
      // Update stale PRs.
      // https://docs.github.com/en/graphql/reference/enums#mergestatestatus
      if (match.mergeStateStatus === 'BEHIND') {
        const { number: prNum } = match
        const prRef = `PR #${prNum}`
        try {
          // Update the PR using the provider.
          await provider.updatePr({
            owner,
            repo,
            prNumber: prNum,
            head: match.headRefName,
            base: match.baseRefName,
          })

          debug(`pr: updated stale ${prRef}`)
          logPrEvent('updated', prNum, ghsaId, 'Updated from base branch')

          // Update cache entry - only GraphQL is used now.
          context.entry.mergeStateStatus = 'CLEAN'
          // Mark cache to be saved.
          cachesToSave.set(context.cacheKey, context.data)
        } catch (e) {
          debug(formatErrorWithDetail(`pr: failed to update ${prRef}`, e))
          debugDir(e)
        }
      }

      // Clean up merged PR branches.
      if (match.state === GQL_PR_STATE_MERGED) {
        const { number: prNum } = match
        const prRef = `PR #${prNum}`
        try {
          const success = await provider.deleteBranch(match.headRefName)
          if (success) {
            debug(`pr: deleted merged branch ${match.headRefName} for ${prRef}`)
            logPrEvent('merged', prNum, ghsaId, 'Branch cleaned up')
            /* c8 ignore start - branch-delete failure path; depends on remote git state we don't control in tests */
          } else {
            debug(
              `pr: failed to delete branch ${match.headRefName} for ${prRef}`,
            )
          }
          /* c8 ignore stop */
        } catch (e) {
          // Don't treat this as a hard error - branch might already be deleted.
          debug(
            formatErrorWithDetail(
              `pr: failed to delete branch ${match.headRefName} for ${prRef}`,
              e,
            ),
          )
          debugDir(e)
        }
      }

      return match
    }),
  )

  if (cachesToSave.size) {
    await Promise.allSettled(
      Array.from(cachesToSave).map(({ 0: key, 1: data }) =>
        writeCache(key, data),
      ),
    )
  }

  const fulfilledMatches = settledMatches.filter(
    (r): r is PromiseFulfilledResult<PrMatch> => r.status === 'fulfilled',
  )

  return fulfilledMatches.map(r => r.value)
}

export type PrAutoMergeState = {
  enabled: boolean
  details?: string[] | undefined
}

type SocketPrsOptions = {
  author?: string | undefined
  ghsaId?: string | undefined
  states?: 'all' | GQL_PR_STATE | GQL_PR_STATE[] | undefined
}

export async function getSocketFixPrs(
  owner: string,
  repo: string,
  options?: SocketPrsOptions | undefined,
): Promise<PrMatch[]> {
  return (await getSocketFixPrsWithContext(owner, repo, options)).map(
    d => d.match,
  )
}

type GqlPrNode = {
  author?:
    | {
        login: string
      }
    | undefined
  baseRefName: string
  headRefName: string
  mergeStateStatus: GQL_MERGE_STATE_STATUS
  number: number
  state: GQL_PR_STATE
  title: string
}

type GqlPullRequestsResponse = {
  repository: {
    pullRequests: {
      pageInfo: {
        hasNextPage: boolean
        endCursor: string | undefined
      }
      nodes: GqlPrNode[]
    }
  }
}

type ContextualPrMatch = {
  context: {
    apiType: 'graphql' | 'rest'
    cacheKey: string
    data: JsonContent
    entry: GqlPrNode
    index: number
    parent: GqlPrNode[]
  }
  match: PrMatch
}

export async function getSocketFixPrsWithContext(
  owner: string,
  repo: string,
  options?: SocketPrsOptions | undefined,
): Promise<ContextualPrMatch[]> {
  const {
    author,
    ghsaId,
    states: statesValue = 'all',
  } = {
    __proto__: null,
    ...options,
  } as SocketPrsOptions
  const branchPattern = getSocketFixBranchPattern(ghsaId)
  const checkAuthor = isNonEmptyString(author)
  const octokitGraphql = getOctokitGraphql()
  const contextualMatches: ContextualPrMatch[] = []
  const states = (
    typeof statesValue === 'string'
      ? statesValue.toLowerCase() === 'all'
        ? [GQL_PR_STATE_OPEN, GQL_PR_STATE_CLOSED, GQL_PR_STATE_MERGED]
        : [statesValue]
      : statesValue
  ).map(s => s.toUpperCase())

  try {
    let hasNextPage = true
    let cursor: string | undefined = undefined
    let pageIndex = 0
    // Include owner in cache key to avoid collisions with same repo name.
    const gqlCacheKey = `${owner}::${repo}-pr-graphql-snapshot-${states.join('-').toLowerCase()}`
    while (hasNextPage) {
      // eslint-disable-next-line no-await-in-loop
      const gqlResp = (await cacheFetch(
        `${gqlCacheKey}-page-${pageIndex}`,
        /* c8 ignore start - cacheFetch factory only fires on cache miss; tests pass mocked cached values directly */
        () =>
          octokitGraphql(
            `
              query($owner: String!, $repo: String!, $states: [PullRequestState!], $after: String) {
                repository(owner: $owner, name: $repo) {
                  pullRequests(first: 100, states: $states, after: $after, orderBy: {field: CREATED_AT, direction: DESC}) {
                    pageInfo {
                      hasNextPage
                      endCursor
                    }
                    nodes {
                      author {
                        login
                      }
                      baseRefName
                      headRefName
                      mergeStateStatus
                      number
                      state
                      title
                    }
                  }
                }
              }
              `,
            {
              owner,
              repo,
              states,
              after: cursor,
            },
          ),
        /* c8 ignore stop */
      )) as GqlPullRequestsResponse

      const { nodes, pageInfo } = gqlResp?.repository?.pullRequests ?? {
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: undefined },
      }

      for (let i = 0, { length } = nodes; i < length; i += 1) {
        const node = nodes[i]!
        const login = node.author?.login
        const matchesAuthor = checkAuthor ? login === author : true
        const matchesBranch = branchPattern.test(node.headRefName)
        if (matchesAuthor && matchesBranch) {
          contextualMatches.push({
            context: {
              apiType: 'graphql',
              cacheKey: `${gqlCacheKey}-page-${pageIndex}`,
              data: gqlResp,
              entry: node,
              index: i,
              parent: nodes,
            },
            match: {
              ...node,
              author: login ?? UNKNOWN_VALUE,
            },
          })
        }
      }

      // Continue to next page.
      hasNextPage = pageInfo.hasNextPage
      cursor = pageInfo.endCursor
      pageIndex += 1

      /* c8 ignore start - GQL_PAGE_SENTINEL safety limit; tests page through at most a few pages */
      if (pageIndex === GQL_PAGE_SENTINEL) {
        debug(
          `GraphQL pagination reached safety limit (${GQL_PAGE_SENTINEL} pages) for ${owner}/${repo}`,
        )
        break
      }
      /* c8 ignore stop */

      // Early exit optimization: if we found matches and only looking for specific GHSA,
      // we can stop pagination since we likely found what we need.
      if (contextualMatches.length > 0 && ghsaId) {
        break
      }
    }
  } catch (e) {
    // Use centralized error handling for better error messages.
    const errorResult = handleGraphqlError(
      e,
      `listing PRs for ${owner}/${repo}`,
    )
    // errorResult is always ok: false from handleGraphqlError.
    if (!errorResult.ok) {
      debug(errorResult.cause ?? errorResult.message)
    }
  }

  return contextualMatches
}

type OpenSocketFixPrOptions = {
  baseBranch?: string | undefined
  cwd?: string | undefined
  ghsaDetails?: Map<string, GhsaDetails> | undefined
  retries?: number | undefined
}

type OpenPrResult =
  | { ok: true; pr: OctokitResponse<Pr> }
  | { ok: false; reason: 'already_exists'; error: RequestError }
  | {
      ok: false
      reason: 'validation_error'
      error: RequestError
      details: string
    }
  | { ok: false; reason: 'permission_denied'; error: RequestError }
  | { ok: false; reason: 'network_error'; error: RequestError }
  | { ok: false; reason: 'unknown'; error: Error }

export async function openSocketFixPr(
  owner: string,
  repo: string,
  branch: string,
  ghsaIds: string[],
  options?: OpenSocketFixPrOptions | undefined,
): Promise<OpenPrResult> {
  const {
    baseBranch = 'main',
    ghsaDetails,
    retries = 3,
  } = {
    __proto__: null,
    ...options,
  } as OpenSocketFixPrOptions

  const provider = createPrProvider()

  try {
    const result = await provider.createPr({
      owner,
      repo,
      title: getSocketFixPullRequestTitle(ghsaIds),
      head: branch,
      base: baseBranch,
      body: getSocketFixPullRequestBody(ghsaIds, ghsaDetails),
      retries,
    })

    // Convert provider response to Octokit format for backward compatibility.
    const octokit = getOctokit()
    const prDetailsResult = await withGitHubRetry(
      () =>
        octokit.pulls.get({
          owner,
          repo,
          pull_number: result.number,
        }),
      `fetching PR #${result.number} details`,
    )

    if (!prDetailsResult.ok) {
      return {
        ok: false,
        reason: 'network_error',
        error: new Error(
          prDetailsResult.cause || prDetailsResult.message,
        ) as RequestError,
      }
    }

    return { ok: true, pr: prDetailsResult.data }
  } catch (e) {
    debug(formatErrorWithDetail('Failed to create pull request', e))
    debugDir(e)

    // Handle RequestError from Octokit/provider.
    if (e instanceof RequestError) {
      const errors = (
        e.response?.data as { errors?: unknown | undefined } | undefined
      )?.errors
      const errorMessages = Array.isArray(errors)
        ? errors.map(
            (d: {
              message?: string | undefined
              resource?: string | undefined
              field?: string | undefined
              code?: string | undefined
            }) => d.message?.trim() ?? `${d.resource}.${d.field} (${d.code})`,
          )
        : []

      // Check for "PR already exists" error.
      if (
        errorMessages.some((msg: string) =>
          msg.toLowerCase().includes('pull request already exists'),
        )
      ) {
        debug('Failed to create pull request: already exists')
        return { ok: false, reason: 'already_exists', error: e }
      }

      // Check for validation errors (e.g., no commits between branches).
      if (Array.isArray(errors) && errors.length > 0) {
        const details = errorMessages.map((d: string) => `- ${d}`).join('\n')
        debug(`Failed to create pull request:\n${details}`)
        return {
          ok: false,
          reason: 'validation_error',
          error: e,
          details,
        }
      }

      // Check HTTP status codes for permission errors.
      if (e.status === 403 || e.status === 401) {
        debug('Failed to create pull request: permission denied')
        return { ok: false, reason: 'permission_denied', error: e }
      }

      // Check for server errors.
      if (e.status && e.status >= 500) {
        debug('Failed to create pull request: network error')
        return { ok: false, reason: 'network_error', error: e }
      }
    }

    // Unknown error.
    debug(`Failed to create pull request: ${e}`)
    return { ok: false, reason: 'unknown', error: e as Error }
  }
}
