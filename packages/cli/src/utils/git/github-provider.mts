import { RequestError } from '@octokit/request-error'

import { UNKNOWN_VALUE } from '@socketsecurity/lib/constants/core'
import { debug, debugDir } from '@socketsecurity/lib/debug'
import { isNonEmptyString } from '@socketsecurity/lib/strings'

import {
  GQL_PAGE_SENTINEL,
  GQL_PR_STATE_CLOSED,
  GQL_PR_STATE_MERGED,
  GQL_PR_STATE_OPEN,
} from '../../constants/github.mts'
import { formatErrorWithDetail } from '../error/errors.mts'
import { gitDeleteRemoteBranch } from './operations.mts'
import { cacheFetch, getOctokit, getOctokitGraphql } from './github.mts'

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

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const octokitPullsCreateParams = {
          base,
          body,
          head,
          owner,
          repo,
          title,
        }
        debugDir({ attempt, octokitPullsCreateParams })
        // eslint-disable-next-line no-await-in-loop
        const response = await octokit.pulls.create(octokitPullsCreateParams)
        return {
          number: response.data.number,
          state: response.data.merged_at
            ? 'merged'
            : response.data.state === 'closed'
              ? 'closed'
              : 'open',
          url: response.data.html_url,
        }
      } catch (e) {
        let message = `Failed to open pull request (attempt ${attempt}/${retries})`
        const errors =
          e instanceof RequestError
            ? (e.response?.data as any)?.errors
            : undefined

        if (Array.isArray(errors) && errors.length) {
          const details = errors
            .map(
              d =>
                `- ${d.message?.trim() ?? `${d.resource}.${d.field} (${d.code})`}`,
            )
            .join('\n')
          message += `:\n${details}`
        } else if (e instanceof Error) {
          message += `: ${e.message}`
        }

        debug(message)
        debugDir(e)

        // Don't retry on validation errors (422).
        if (e instanceof RequestError && e.status === 422) {
          break
        }

        // Retry on 5xx errors or network failures.
        if (attempt < retries) {
          const delay = Math.min(1000 * 2 ** (attempt - 1), 10_000)
          debug(`pr: retrying in ${delay}ms...`)
          // eslint-disable-next-line no-await-in-loop
          await sleep(delay)
        }
      }
    }

    throw new Error(
      `Failed to create pull request after ${retries} attempts: ${owner}/${repo}#${head}`,
    )
  }

  async updatePr(options: UpdatePrOptions): Promise<void> {
    const { base, head, owner, prNumber, repo } = options

    const octokit = getOctokit()

    try {
      // Merge the base branch into the head branch to update the PR.
      await octokit.repos.merge({
        // The target branch (source).
        head: base,
        owner,
        repo,
        // The PR branch (destination).
        base: head,
      })
      debug(`pr: updating stale PR #${prNumber}`)

      // Check if update resulted in conflicts.
      const prDetails = await octokit.pulls.get({
        owner,
        pull_number: prNumber,
        repo,
      })

      if (prDetails.data.mergeable_state === 'dirty') {
        debug(`pr: PR #${prNumber} has conflicts after update`)

        // Add comment explaining conflict.
        await octokit.issues.createComment({
          body:
            'This PR has merge conflicts after updating from the base branch. ' +
            'Please resolve conflicts manually or close this PR and re-run `socket fix` ' +
            'to generate a new fix.',
          issue_number: prNumber,
          owner,
          repo,
        })

        debug(`pr: added conflict comment to PR #${prNumber}`)
      }
    } catch (e) {
      throw new Error(
        formatErrorWithDetail(`Failed to update PR #${prNumber}`, e),
      )
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
    try {
      await octokit.issues.createComment({
        body,
        issue_number: prNumber,
        owner,
        repo,
      })
      debug(`pr: added comment to PR #${prNumber}`)
    } catch (e) {
      throw new Error(
        formatErrorWithDetail(`Failed to add comment to PR #${prNumber}`, e),
      )
    }
  }

  getProviderName(): 'github' {
    return 'github'
  }

  supportsGraphQL(): boolean {
    return true
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
