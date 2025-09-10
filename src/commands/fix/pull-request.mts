import { RequestError } from '@octokit/request-error'

import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'

import {
  getSocketFixBranchPattern,
  getSocketFixPullRequestBody,
  getSocketFixPullRequestTitle,
} from './git.mts'
import {
  GQL_PR_STATE_CLOSED,
  GQL_PR_STATE_MERGED,
  GQL_PR_STATE_OPEN,
  GRAPHQL_PAGE_SENTINEL,
  UNKNOWN_ERROR,
  UNKNOWN_VALUE,
} from '../../constants.mts'
import { gitDeleteRemoteBranch } from '../../utils/git.mts'
import {
  type GhsaDetails,
  type Pr,
  cacheFetch,
  getOctokit,
  getOctokitGraphql,
  writeCache,
} from '../../utils/github.mts'

import type { OctokitResponse } from '@octokit/types'
import type { JsonContent } from '@socketsecurity/registry/lib/fs'

export type OpenSocketFixPrOptions = {
  baseBranch?: string | undefined
  cwd?: string | undefined
  ghsaDetails?: Map<string, GhsaDetails> | undefined
}

export async function openSocketFixPr(
  owner: string,
  repo: string,
  branch: string,
  ghsaIds: string[],
  options?: OpenSocketFixPrOptions | undefined,
): Promise<OctokitResponse<Pr> | null> {
  const { baseBranch = 'main', ghsaDetails } = {
    __proto__: null,
    ...options,
  } as OpenSocketFixPrOptions

  const octokit = getOctokit()

  try {
    const octokitPullsCreateParams = {
      owner,
      repo,
      title: getSocketFixPullRequestTitle(ghsaIds),
      head: branch,
      base: baseBranch,
      body: getSocketFixPullRequestBody(ghsaIds, ghsaDetails),
    }
    debugDir('inspect', { octokitPullsCreateParams })
    return await octokit.pulls.create(octokitPullsCreateParams)
  } catch (e) {
    let message = `Failed to open pull request`
    const errors =
      e instanceof RequestError
        ? (e.response?.data as any)?.['errors']
        : undefined
    if (Array.isArray(errors) && errors.length) {
      const details = errors
        .map(
          d =>
            `- ${d.message?.trim() ?? `${d.resource}.${d.field} (${d.code})`}`,
        )
        .join('\n')
      message += `:\n${details}`
    }
    debugFn('error', message)
  }
  return null
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
  const octokit = getOctokit()

  const settledMatches = await Promise.allSettled(
    contextualMatches.map(async ({ context, match }) => {
      // Update stale PRs.
      // https://docs.github.com/en/graphql/reference/enums#mergestatestatus
      if (match.mergeStateStatus === 'BEHIND') {
        const { number: prNum } = match
        const prRef = `PR #${prNum}`
        try {
          // Merge the base branch into the head branch to update the PR.
          await octokit.repos.merge({
            owner,
            repo,
            // The PR branch (destination).
            base: match.headRefName,
            // The target branch (source).
            head: match.baseRefName,
          })
          debugFn('notice', `pr: updating stale ${prRef}`)
          // Update cache entry - only GraphQL is used now.
          context.entry.mergeStateStatus = 'CLEAN'
          // Mark cache to be saved.
          cachesToSave.set(context.cacheKey, context.data)
        } catch (e) {
          const message = (e as Error)?.message || UNKNOWN_ERROR
          debugFn('error', `pr: failed to update ${prRef} - ${message}`)
        }
      }

      // Clean up merged PR branches.
      if (match.state === GQL_PR_STATE_MERGED) {
        const { number: prNum } = match
        const prRef = `PR #${prNum}`
        try {
          const success = await gitDeleteRemoteBranch(match.headRefName)
          if (success) {
            debugFn(
              'notice',
              `pr: deleted merged branch ${match.headRefName} for ${prRef}`,
            )
          } else {
            debugFn(
              'warn',
              `pr: failed to delete branch ${match.headRefName} for ${prRef}`,
            )
          }
        } catch (e) {
          const message = (e as Error)?.message || UNKNOWN_ERROR
          // Don't treat this as a hard error - branch might already be deleted.
          debugFn(
            'warn',
            `pr: failed to delete branch ${match.headRefName} for ${prRef} - ${message}`,
          )
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
  details?: string[]
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
    const gqlCacheKey = `${repo}-pr-graphql-snapshot`
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
      if (pageIndex === GRAPHQL_PAGE_SENTINEL) {
        debugFn(
          'warn',
          `GraphQL pagination reached safety limit (${GRAPHQL_PAGE_SENTINEL} pages) for ${owner}/${repo}`,
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
    debugFn('error', `GraphQL pagination failed for ${owner}/${repo}:`, e)
  }

  return contextualMatches
}
