/**
 * GitHub utilities for Socket CLI. Provides GitHub API integration for
 * repository operations and GHSA vulnerability data.
 *
 * Authentication:
 *
 * - GetGitHubToken: Retrieve GitHub token from env/git config
 * - GetOctokit: Get authenticated Octokit instance
 * - GetOctokitGraphql: Get authenticated GraphQL client
 *
 * Caching:
 *
 * - 5-minute TTL for API responses
 * - Automatic cache invalidation
 * - Persistent cache in node_modules/.cache
 *
 * GHSA Operations:
 *
 * - CacheFetch: Cache API responses with TTL
 * - FetchGhsaDetails: Fetch GitHub Security Advisory details
 * - GetGhsaUrl: Generate GHSA advisory URL
 * - ReadCache/writeCache: Persistent cache operations
 *
 * Repository Operations:
 *
 * - GraphQL queries for complex operations
 * - Integration with Octokit REST API
 * - Support for GitHub Actions environment variables
 */

import {
  graphql as OctokitGraphql,
  GraphqlResponseError,
} from '@octokit/graphql'
import { Octokit } from '@octokit/rest'

import { isDebugNs } from '@socketsecurity/lib-stable/debug/namespace'
import { debugDirNs, debugNs } from '@socketsecurity/lib-stable/debug/output'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { parseUrl } from '@socketsecurity/lib-stable/url/parse'

import { cacheFetch } from './github-cache.mts'
import { GITHUB_API_URL } from '../../env/github-api-url.mts'
import { GITHUB_SERVER_URL } from '../../env/github-server-url.mts'
import { SOCKET_CLI_GITHUB_TOKEN } from '../../env/socket-cli-github-token.mts'
import { formatErrorWithDetail } from '../error/errors.mts'

import type { components } from '@octokit/openapi-types'
import type { SpawnOptions } from '@socketsecurity/lib-stable/process/spawn/types'

export type { CacheEntry } from './github-cache.mts'
export { cacheFetch, readCache, writeCache } from './github-cache.mts'
export {
  GITHUB_ERR_ABUSE_DETECTION,
  GITHUB_ERR_AUTH_FAILED,
  GITHUB_ERR_GRAPHQL_RATE_LIMIT,
  GITHUB_ERR_RATE_LIMIT,
  handleGitHubApiError,
  handleGraphqlError,
  isGraphqlRateLimitError,
  withGitHubRetry,
} from './github-errors.mts'

export type Pr = components['schemas']['pull-request']

let octokit: Octokit | undefined

let octokitGraphql: typeof OctokitGraphql | undefined

export type PrAutoMergeState = {
  enabled: boolean
  details?: string[] | undefined
}

export async function enablePrAutoMerge({
  node_id: prId,
}: Pr): Promise<PrAutoMergeState> {
  const graphqlClient = getOctokitGraphql()
  try {
    const gqlResp = await graphqlClient<{
      enablePullRequestAutoMerge?:
        | {
            pullRequest?: { number?: number | undefined } | undefined
          }
        | undefined
    }>(
      `
      mutation EnableAutoMerge($pullRequestId: ID!) {
        enablePullRequestAutoMerge(input: {
          pullRequestId: $pullRequestId,
          mergeMethod: SQUASH
        }) {
          pullRequest {
            number
          }
        }
      }`,
      { pullRequestId: prId },
    )
    const respPrNumber =
      gqlResp?.enablePullRequestAutoMerge?.pullRequest?.number
    /* c8 ignore start - GraphQL success path requires a successful enablePullRequestAutoMerge response; tests mock the call to fail */
    if (respPrNumber) {
      return { enabled: true }
    }
    /* c8 ignore stop */
  } catch (e) {
    /* c8 ignore start - GraphqlResponseError with structured .errors requires the GitHub GraphQL endpoint to respond with that exact shape; tests cover the generic catch path */
    if (
      e instanceof GraphqlResponseError &&
      Array.isArray(e.errors) &&
      e.errors.length
    ) {
      const details = e.errors.map(({ message: m }) => m.trim())
      return { enabled: false, details }
    }
    /* c8 ignore stop */
  }
  return { enabled: false }
}

export type GhsaDetails = {
  ghsaId: string
  cveId?: string | undefined
  summary: string
  severity: string
  publishedAt: string
  withdrawnAt?: string | undefined
  references: Array<{
    url: string
  }>
  vulnerabilities: {
    nodes: Array<{
      package: {
        ecosystem: string
        name: string
      }
      vulnerableVersionRange: string
    }>
  }
}

export async function fetchGhsaDetails(
  ids: string[],
): Promise<Map<string, GhsaDetails>> {
  const results = new Map<string, GhsaDetails>()
  if (!ids.length) {
    return results
  }

  const graphqlClient = getOctokitGraphql()
  try {
    // Use '::' delimiter to avoid collisions (GHSA IDs contain hyphens).
    const gqlCacheKey = `${ids.join('::')}-graphql-snapshot`

    const aliases = ids
      .map(
        (id, index) =>
          `advisory${index}: securityAdvisory(ghsaId: "${id}") {
        ghsaId
        summary
        severity
        publishedAt
        withdrawnAt
        vulnerabilities(first: 10) {
          nodes {
            package {
              ecosystem
              name
            }
            vulnerableVersionRange
          }
        }
      }`,
      )
      .join('\n')

    const gqlResp = await cacheFetch(gqlCacheKey, () =>
      graphqlClient<Record<string, GhsaDetails | undefined>>(`
        query {
          ${aliases}
        }
      `),
    )

    /* c8 ignore start - GQL response loop; cacheFetch wraps the call so the inner factory only fires on cache miss, which tests don't trigger */
    for (let i = 0, { length } = ids; i < length; i += 1) {
      const id = ids[i]!
      const advisoryKey = `advisory${i}`
      const advisory = gqlResp?.[advisoryKey]
      if (advisory?.ghsaId) {
        results.set(id, advisory)
      } else {
        debugNs('notice', `miss: no advisory found for ${id}`)
      }
    }
    /* c8 ignore stop */
  } catch (e) {
    debugNs('error', formatErrorWithDetail('Failed to fetch GHSA details', e))
    debugDirNs('error', e)
  }

  return results
}

export function getOctokit(): Octokit {
  if (octokit === undefined) {
    if (!SOCKET_CLI_GITHUB_TOKEN) {
      debugNs('notice', 'miss: SOCKET_CLI_GITHUB_TOKEN env var')
    }
    const octokitOptions = {
      ...(SOCKET_CLI_GITHUB_TOKEN ? { auth: SOCKET_CLI_GITHUB_TOKEN } : {}),
      ...(GITHUB_API_URL ? { baseUrl: GITHUB_API_URL } : {}),
    }
    debugDirNs('inspect', { octokitOptions })
    octokit = new Octokit(octokitOptions)
  }
  return octokit
}

export function getOctokitGraphql(): typeof OctokitGraphql {
  if (!octokitGraphql) {
    if (!SOCKET_CLI_GITHUB_TOKEN) {
      debugNs('notice', 'miss: SOCKET_CLI_GITHUB_TOKEN env var')
    }
    octokitGraphql = OctokitGraphql.defaults({
      headers: {
        authorization: `token ${SOCKET_CLI_GITHUB_TOKEN}`,
      },
    })
  }
  return octokitGraphql
}

export async function setGitRemoteGithubRepoUrl(
  owner: string,
  repo: string,
  token: string,
  cwd = process.cwd(),
): Promise<boolean> {
  const urlObj = parseUrl(GITHUB_SERVER_URL || '')
  const host = urlObj?.host
  /* c8 ignore start - GITHUB_SERVER_URL defaults to a parseable URL; only fires when env var is malformed */
  if (!host) {
    debugNs('error', 'invalid: GITHUB_SERVER_URL env var')
    debugDirNs('inspect', { GITHUB_SERVER_URL })
    return false
  }
  /* c8 ignore stop */
  const url = `https://x-access-token:${token}@${host}/${owner}/${repo}`
  const stdioIgnoreOptions: SpawnOptions = {
    cwd,
    stdio: isDebugNs('stdio') ? 'inherit' : 'ignore',
  }
  // Redact the access token from the debug line — the real URL is still
  // passed to spawn, but the token must never reach logs.
  const redactedUrl = `https://x-access-token:***@${host}/${owner}/${repo}`
  const quotedCmd = `\`git remote set-url origin ${redactedUrl}\``
  debugNs('stdio', `spawn: ${quotedCmd}`)
  try {
    await spawn('git', ['remote', 'set-url', 'origin', url], stdioIgnoreOptions)
    return true
    /* c8 ignore start - git command failure path; tests run in real cwd with valid git */
  } catch (e) {
    debugNs('error', `Git command failed: ${quotedCmd}`)
    debugDirNs('inspect', { cmd: quotedCmd })
    debugDirNs('error', e)
  }
  return false
  /* c8 ignore stop */
}
