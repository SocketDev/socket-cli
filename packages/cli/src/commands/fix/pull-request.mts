import { UNKNOWN_VALUE } from '@socketsecurity/lib/constants/core'
import { debug, debugDir } from '@socketsecurity/lib/debug'
import { isNonEmptyString } from '@socketsecurity/lib/strings'

import {
  getSocketFixBranchPattern,
  getSocketFixPullRequestBody,
  getSocketFixPullRequestTitle,
} from './git.mts'
import { logPrEvent } from './pr-lifecycle-getDefaultLogger().mts'
import {
  GQL_PAGE_SENTINEL,
  GQL_PR_STATE_CLOSED,
  GQL_PR_STATE_MERGED,
  GQL_PR_STATE_OPEN,
} from '../../constants/github.mts'
import { formatErrorWithDetail } from '../../utils/error/errors.mjs'
import {
  cacheFetch,
  type GhsaDetails,
  getOctokit,
  getOctokitGraphql,
  type Pr,
  writeCache,
} from '../../utils/git/github.mts'
import { createPrProvider } from '../../utils/git/provider-factory.mts'

import type { OctokitResponse } from '@octokit/types'
import type { JsonContent } from '@socketsecurity/lib/fs'

export type OpenSocketFixPrOptions = {
  baseBranch?: string | undefined
  cwd?: string | undefined
  ghsaDetails?: Map<string, GhsaDetails> | undefined
  retries?: number | undefined
}

export async function openSocketFixPr(
  owner: string,
  repo: string,
  branch: string,
  ghsaIds: string[],
  options?: OpenSocketFixPrOptions | undefined,
): Promise<OctokitResponse<Pr> | undefined> {
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
    const prDetails = await octokit.pulls.get({
      owner,
      repo,
      pull_number: result.number,
    })

    return prDetails
  } catch (e) {
    debug(formatErrorWithDetail('Failed to create pull request', e))
    debugDir(e)
    return undefined
  }
}

export type GQL_MERGE_STATE_STATUS =
  | 'BEHIND'
  | 'BLOCKED'
  | 'CLEAN'
  | 'DIRTY'
  | 'DRAFT'
  | 'HAS_HOOKS'
  | 'UNKNOWN'
  | 'UNSTABLE'

export type GQL_PR_STATE = 'OPEN' | 'CLOSED' | 'MERGED'

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
          } else {
            debug(
              `pr: failed to delete branch ${match.headRefName} for ${prRef}`,
            )
          }
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

export type SocketPrsOptions = {
  author?: string | undefined
  ghsaId?: string | undefined
  states?: 'all' | GQL_PR_STATE | GQL_PR_STATE[]
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
  author?: {
    login: string
  }
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
        endCursor: string | null
      }
      nodes: GqlPrNode[]
    }
  }
}

type ContextualPrMatch = {
  context: {
    apiType: 'graphql' | 'rest'
    cacheKey: string
    data: any
    entry: any
    index: number
    parent: any[]
  }
  match: PrMatch
}

async function getSocketFixPrsWithContext(
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
    let cursor: string | null = null
    let pageIndex = 0
    const gqlCacheKey = `${repo}-pr-graphql-snapshot-${states.join('-').toLowerCase()}`
    while (hasNextPage) {
      // eslint-disable-next-line no-await-in-loop
      const gqlResp = (await cacheFetch(
        `${gqlCacheKey}-page-${pageIndex}`,
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
      )) as GqlPullRequestsResponse

      const { nodes, pageInfo } = gqlResp?.repository?.pullRequests ?? {
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
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

      // Safety limit to prevent infinite loops.
      if (pageIndex === GQL_PAGE_SENTINEL) {
        debug(
          `GraphQL pagination reached safety limit (${GQL_PAGE_SENTINEL} pages) for ${owner}/${repo}`,
        )
        break
      }

      // Early exit optimization: if we found matches and only looking for specific GHSA,
      // we can stop pagination since we likely found what we need.
      if (contextualMatches.length > 0 && ghsaId) {
        break
      }
    }
  } catch (e) {
    debug(`GraphQL pagination failed for ${owner}/${repo}`)
    debugDir(e)
  }

  return contextualMatches
}
