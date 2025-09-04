import { RequestError } from '@octokit/request-error'

import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'

import {
  getSocketFixBranchPattern,
  getSocketFixPullRequestBody,
  getSocketFixPullRequestTitle,
} from './git.mts'
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

export async function cleanupPrs(
  owner: string,
  repo: string,
  ghsaId: string,
): Promise<PrMatch[]> {
  const contextualMatches = await getSocketPrsWithContext(owner, repo, {
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
          await octokit.repos.merge({
            owner,
            repo,
            base: match.headRefName,
            head: match.baseRefName,
          })
          debugFn('notice', `pr: updating stale ${prRef}`)
          // Update entry entry.
          if (context.apiType === 'graphql') {
            context.entry.mergeStateStatus = 'CLEAN'
          } else if (context.apiType === 'rest') {
            context.entry.mergeable_state = 'clean'
          }
          // Mark cache to be saved.
          cachesToSave.set(context.cacheKey, context.data)
        } catch (e) {
          const message = (e as Error)?.message || 'Unknown error'
          debugFn('error', `pr: failed to update ${prRef} - ${message}`)
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
    r => r.status === 'fulfilled' && r.value,
  ) as unknown as Array<PromiseFulfilledResult<ContextualPrMatch>>

  return fulfilledMatches.map(r => r.value.match)
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

export async function getSocketPrs(
  owner: string,
  repo: string,
  options?: SocketPrsOptions | undefined,
): Promise<PrMatch[]> {
  return (await getSocketPrsWithContext(owner, repo, options)).map(d => d.match)
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

async function getSocketPrsWithContext(
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
  const octokit = getOctokit()
  const octokitGraphql = getOctokitGraphql()
  const contextualMatches: ContextualPrMatch[] = []
  const states = (
    typeof statesValue === 'string'
      ? statesValue.toLowerCase() === 'all'
        ? ['OPEN', 'CLOSED', 'MERGED']
        : [statesValue]
      : statesValue
  ).map(s => s.toUpperCase())
  try {
    // Optimistically fetch only the first 50 open PRs using GraphQL to minimize
    // API quota usage. Fallback to REST if no matching PRs are found.
    const gqlCacheKey = `${repo}-pr-graphql-snapshot`
    const gqlResp = await cacheFetch(gqlCacheKey, () =>
      octokitGraphql(
        `
          query($owner: String!, $repo: String!, $states: [PullRequestState!]) {
            repository(owner: $owner, name: $repo) {
              pullRequests(first: 50, states: $states, orderBy: {field: CREATED_AT, direction: DESC}) {
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
        },
      ),
    )

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

    const nodes: GqlPrNode[] =
      (gqlResp as any)?.repository?.pullRequests?.nodes ?? []
    for (let i = 0, { length } = nodes; i < length; i += 1) {
      const node = nodes[i]!
      const login = node.author?.login
      const matchesAuthor = checkAuthor ? login === author : true
      const matchesBranch = branchPattern.test(node.headRefName)
      if (matchesAuthor && matchesBranch) {
        contextualMatches.push({
          context: {
            apiType: 'graphql',
            cacheKey: gqlCacheKey,
            data: gqlResp,
            entry: node,
            index: i,
            parent: nodes,
          },
          match: {
            ...node,
            author: login ?? '<unknown>',
          },
        })
      }
    }
  } catch {}

  if (contextualMatches.length) {
    return contextualMatches
  }

  // Fallback to REST if GraphQL found no matching PRs.
  let allPrs: Pr[] | undefined
  const cacheKey = `${repo}-pull-requests`
  try {
    allPrs = await cacheFetch(
      cacheKey,
      async () =>
        (await octokit.paginate(octokit.pulls.list, {
          owner,
          repo,
          state: 'all',
          per_page: 100,
        })) as Pr[],
    )
  } catch {}

  if (!allPrs) {
    return contextualMatches
  }

  for (let i = 0, { length } = allPrs; i < length; i += 1) {
    const pr = allPrs[i]!
    const login = pr.user?.login
    const headRefName = pr.head.ref
    const matchesAuthor = checkAuthor ? login === author : true
    const matchesBranch = branchPattern.test(headRefName)
    if (matchesAuthor && matchesBranch) {
      // Upper cased mergeable_state is equivalent to mergeStateStatus.
      // https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28#get-a-pull-request
      const mergeStateStatus = (pr.mergeable_state?.toUpperCase?.() ??
        'UNKNOWN') as GQL_MERGE_STATE_STATUS
      // The REST API does not have a distinct merged state for pull requests.
      // Instead, a merged pull request is represented as a closed pull request
      // with a non-null merged_at timestamp.
      const state = (
        pr.merged_at ? 'MERGED' : pr.state.toUpperCase()
      ) as GQL_PR_STATE
      contextualMatches.push({
        context: {
          apiType: 'rest',
          cacheKey,
          data: allPrs,
          entry: pr,
          index: i,
          parent: allPrs,
        },
        match: {
          author: login ?? '<unknown>',
          baseRefName: pr.base.ref,
          headRefName,
          mergeStateStatus,
          number: pr.number,
          state,
          title: pr.title,
        },
      })
    }
  }
  return contextualMatches
}
