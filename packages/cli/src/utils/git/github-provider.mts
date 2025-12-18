import { UNKNOWN_VALUE } from '@socketsecurity/lib/constants/core'
import { debug, debugDir } from '@socketsecurity/lib/debug'
import { isNonEmptyString } from '@socketsecurity/lib/strings'

import {
  cacheFetch,
  getOctokit,
  getOctokitGraphql,
  withGitHubRetry,
} from './github.mts'
import { gitDeleteRemoteBranch } from './operations.mts'
import {
  GQL_PAGE_SENTINEL,
  GQL_PR_STATE_CLOSED,
  GQL_PR_STATE_MERGED,
  GQL_PR_STATE_OPEN,
} from '../../constants/github.mts'
import { formatErrorWithDetail } from '../error/errors.mts'

import type {
  AddCommentOptions,
  CreatePrOptions,
  ListPrsOptions,
  PrMatch,
  PrProvider,
  PrResponse,
  UpdatePrOptions,
} from './provider.mts'

type GqlPrNode = {
  author?: {
    login: string
  }
  baseRefName: string
  headRefName: string
  mergeStateStatus:
    | 'BEHIND'
    | 'BLOCKED'
    | 'CLEAN'
    | 'DIRTY'
    | 'DRAFT'
    | 'HAS_HOOKS'
    | 'UNKNOWN'
    | 'UNSTABLE'
  number: number
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  title: string
}

type GqlPullRequestsResponse = {
  repository: {
    pullRequests: {
      pageInfo: {
        endCursor: string | null
        hasNextPage: boolean
      }
      nodes: GqlPrNode[]
    }
  }
}

/**
 * GitHub provider for Pull Request operations.
 *
 * Implements the PrProvider interface using GitHub's REST and GraphQL APIs via Octokit.
 */
export class GitHubProvider implements PrProvider {
  async createPr(options: CreatePrOptions): Promise<PrResponse> {
    const { base, body, head, owner, repo, retries = 3, title } = options

    const octokit = getOctokit()
    const octokitPullsCreateParams = { base, body, head, owner, repo, title }
    debugDir({ octokitPullsCreateParams })

    const result = await withGitHubRetry(
      async () => {
        const response = await octokit.pulls.create(octokitPullsCreateParams)
        return response
      },
      `creating pull request for ${owner}/${repo}`,
      retries,
    )

    if (!result.ok) {
      throw new Error(result.cause ?? result.message)
    }

    const response = result.data
    return {
      number: response.data.number,
      state: response.data.merged_at
        ? 'merged'
        : response.data.state === 'closed'
          ? 'closed'
          : 'open',
      url: response.data.html_url,
    }
  }

  async updatePr(options: UpdatePrOptions): Promise<void> {
    const { base, head, owner, prNumber, repo } = options

    const octokit = getOctokit()

    // Merge the base branch into the head branch to update the PR.
    const mergeResult = await withGitHubRetry(
      () =>
        octokit.repos.merge({
          // The target branch (source).
          head: base,
          owner,
          repo,
          // The PR branch (destination).
          base: head,
        }),
      `updating PR #${prNumber}`,
    )

    if (!mergeResult.ok) {
      throw new Error(mergeResult.cause || mergeResult.message)
    }

    debug(`pr: updating stale PR #${prNumber}`)

    // Check if update resulted in conflicts.
    const prDetailsResult = await withGitHubRetry(
      () =>
        octokit.pulls.get({
          owner,
          pull_number: prNumber,
          repo,
        }),
      `fetching PR #${prNumber} details`,
    )

    if (!prDetailsResult.ok) {
      throw new Error(prDetailsResult.cause || prDetailsResult.message)
    }

    if (prDetailsResult.data.data.mergeable_state === 'dirty') {
      debug(`pr: PR #${prNumber} has conflicts after update`)

      // Add comment explaining conflict.
      const commentResult = await withGitHubRetry(
        () =>
          octokit.issues.createComment({
            body:
              'This PR has merge conflicts after updating from the base branch. ' +
              'Please resolve conflicts manually or close this PR and re-run `socket fix` ' +
              'to generate a new fix.',
            issue_number: prNumber,
            owner,
            repo,
          }),
        `adding conflict comment to PR #${prNumber}`,
      )

      if (commentResult.ok) {
        debug(`pr: added conflict comment to PR #${prNumber}`)
      }
    }
  }

  async listPrs(options: ListPrsOptions): Promise<PrMatch[]> {
    const { author, ghsaId, owner, repo, states: statesValue = 'all' } = options
    const checkAuthor = isNonEmptyString(author)
    const octokitGraphql = getOctokitGraphql()
    const matches: PrMatch[] = []
    const states = (
      typeof statesValue === 'string'
        ? statesValue.toLowerCase() === 'all'
          ? [GQL_PR_STATE_OPEN, GQL_PR_STATE_CLOSED, GQL_PR_STATE_MERGED]
          : [statesValue]
        : [statesValue]
    ).map(s => s.toUpperCase())

    try {
      let cursor: string | null = null
      let hasNextPage = true
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
                after: cursor,
                owner,
                repo,
                states,
              },
            ),
        )) as GqlPullRequestsResponse

        const { nodes, pageInfo } = gqlResp?.repository?.pullRequests ?? {
          nodes: [],
          pageInfo: { endCursor: null, hasNextPage: false },
        }

        for (let i = 0, { length } = nodes; i < length; i += 1) {
          const node = nodes[i]!
          const login = node.author?.login
          const matchesAuthor = checkAuthor ? login === author : true
          // Note: Branch pattern matching removed - caller should filter.
          if (matchesAuthor) {
            matches.push({
              ...node,
              author: login ?? UNKNOWN_VALUE,
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
        if (matches.length > 0 && ghsaId) {
          break
        }
      }
    } catch (e) {
      debug(`GraphQL pagination failed for ${owner}/${repo}`)
      debugDir(e)
    }

    return matches
  }

  async deleteBranch(branch: string): Promise<boolean> {
    try {
      const success = await gitDeleteRemoteBranch(branch)
      if (success) {
        debug(`pr: deleted merged branch ${branch}`)
      } else {
        debug(`pr: failed to delete branch ${branch}`)
      }
      return success
    } catch (e) {
      // Don't treat this as a hard error - branch might already be deleted.
      debug(formatErrorWithDetail(`pr: failed to delete branch ${branch}`, e))
      debugDir(e)
      return false
    }
  }

  async addComment(options: AddCommentOptions): Promise<void> {
    const { body, owner, prNumber, repo } = options
    const octokit = getOctokit()

    const result = await withGitHubRetry(
      () =>
        octokit.issues.createComment({
          body,
          issue_number: prNumber,
          owner,
          repo,
        }),
      `adding comment to PR #${prNumber}`,
    )

    if (!result.ok) {
      throw new Error(result.cause || result.message)
    }

    debug(`pr: added comment to PR #${prNumber}`)
  }

  getProviderName(): 'github' {
    return 'github'
  }

  supportsGraphQL(): boolean {
    return true
  }
}
