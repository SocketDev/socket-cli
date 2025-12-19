/**
 * GitHub utilities for Socket CLI.
 * Provides GitHub API integration for repository operations and GHSA vulnerability data.
 *
 * Authentication:
 * - getGitHubToken: Retrieve GitHub token from env/git config
 * - getOctokit: Get authenticated Octokit instance
 * - getOctokitGraphql: Get authenticated GraphQL client
 *
 * Caching:
 * - 5-minute TTL for API responses
 * - Automatic cache invalidation
 * - Persistent cache in node_modules/.cache
 *
 * GHSA Operations:
 * - cacheFetch: Cache API responses with TTL
 * - fetchGhsaDetails: Fetch GitHub Security Advisory details
 * - getGhsaUrl: Generate GHSA advisory URL
 * - readCache/writeCache: Persistent cache operations
 *
 * Repository Operations:
 * - GraphQL queries for complex operations
 * - Integration with Octokit REST API
 * - Support for GitHub Actions environment variables
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import {
  GraphqlResponseError,
  graphql as OctokitGraphql,
} from '@octokit/graphql'
import { RequestError } from '@octokit/request-error'
import { Octokit } from '@octokit/rest'

import { debugDirNs, debugNs, isDebugNs } from '@socketsecurity/lib/debug'
import {
  readJson,
  safeMkdir,
  safeStatsSync,
  writeJson,
} from '@socketsecurity/lib/fs'
import { spawn } from '@socketsecurity/lib/spawn'
import { parseUrl } from '@socketsecurity/lib/url'

import ENV from '../../constants/env.mts'
import { getGithubCachePath } from '../../constants/paths.mts'
import { formatErrorWithDetail } from '../error/errors.mts'

import type { CResult } from '../../types.mts'
import type { components } from '@octokit/openapi-types'
import type { JsonContent } from '@socketsecurity/lib/fs'
import type { SpawnOptions } from '@socketsecurity/lib/spawn'

export type Pr = components['schemas']['pull-request']

async function readCache(
  key: string,
  // 5 minute in milliseconds time to live (TTL).
  ttlMs = 5 * 60 * 1000,
): Promise<JsonContent | undefined> {
  const githubCachePath = getGithubCachePath()
  const cacheJsonPath = path.join(githubCachePath, `${key}.json`)
  const stat = safeStatsSync(cacheJsonPath)
  if (stat) {
    const isExpired = Date.now() - Number(stat.mtimeMs) > ttlMs
    if (!isExpired) {
      return await readJson(cacheJsonPath)
    }
  }
  return undefined
}

export async function writeCache(
  key: string,
  data: JsonContent,
): Promise<void> {
  const githubCachePath = getGithubCachePath()
  const cacheJsonPath = path.join(githubCachePath, `${key}.json`)
  if (!existsSync(githubCachePath)) {
    await safeMkdir(githubCachePath, { recursive: true })
  }
  await writeJson(cacheJsonPath, data as JsonContent)
}

export async function cacheFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs?: number | undefined,
): Promise<T> {
  // Optionally disable cache.
  if (ENV.DISABLE_GITHUB_CACHE) {
    return await fetcher()
  }
  let data = (await readCache(key, ttlMs)) as T
  if (!data) {
    data = await fetcher()
    await writeCache(key, data as JsonContent)
  }
  return data
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

  const octokitGraphql = getOctokitGraphql()
  try {
    const gqlCacheKey = `${ids.join('-')}-graphql-snapshot`

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
      octokitGraphql(`
        query {
          ${aliases}
        }
      `),
    )

    for (let i = 0, { length } = ids; i < length; i += 1) {
      const id = ids[i]!
      const advisoryKey = `advisory${i}`
      const advisory = (gqlResp as any)?.[advisoryKey]
      if (advisory?.ghsaId) {
        results.set(id, advisory as GhsaDetails)
      } else {
        debugNs('notice', `miss: no advisory found for ${id}`)
      }
    }
  } catch (e) {
    debugNs('error', formatErrorWithDetail('Failed to fetch GHSA details', e))
    debugDirNs('error', e)
  }

  return results
}

let _octokit: Octokit | undefined
export function getOctokit(): Octokit {
  if (_octokit === undefined) {
    const { SOCKET_CLI_GITHUB_TOKEN } = ENV
    if (!SOCKET_CLI_GITHUB_TOKEN) {
      debugNs('notice', 'miss: SOCKET_CLI_GITHUB_TOKEN env var')
    }
    const octokitOptions = {
      ...(SOCKET_CLI_GITHUB_TOKEN ? { auth: SOCKET_CLI_GITHUB_TOKEN } : {}),
      ...(ENV.GITHUB_API_URL ? { baseUrl: ENV.GITHUB_API_URL } : {}),
    }
    debugDirNs('inspect', { octokitOptions })
    _octokit = new Octokit(octokitOptions)
  }
  return _octokit
}

let _octokitGraphql: typeof OctokitGraphql | undefined
export function getOctokitGraphql(): typeof OctokitGraphql {
  if (!_octokitGraphql) {
    const { SOCKET_CLI_GITHUB_TOKEN } = ENV
    if (!SOCKET_CLI_GITHUB_TOKEN) {
      debugNs('notice', 'miss: SOCKET_CLI_GITHUB_TOKEN env var')
    }
    _octokitGraphql = OctokitGraphql.defaults({
      headers: {
        authorization: `token ${SOCKET_CLI_GITHUB_TOKEN}`,
      },
    })
  }
  return _octokitGraphql
}

export type PrAutoMergeState = {
  enabled: boolean
  details?: string[] | undefined
}

export async function enablePrAutoMerge({
  node_id: prId,
}: Pr): Promise<PrAutoMergeState> {
  const octokitGraphql = getOctokitGraphql()
  try {
    const gqlResp = await octokitGraphql(
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
    const respPrNumber = (gqlResp as any)?.enablePullRequestAutoMerge
      ?.pullRequest?.number
    if (respPrNumber) {
      return { enabled: true }
    }
  } catch (e) {
    if (
      e instanceof GraphqlResponseError &&
      Array.isArray(e.errors) &&
      e.errors.length
    ) {
      const details = e.errors.map(({ message: m }) => m.trim())
      return { enabled: false, details }
    }
  }
  return { enabled: false }
}

export async function prExistForBranch(
  owner: string,
  repo: string,
  branch: string,
): Promise<boolean> {
  const octokit = getOctokit()
  try {
    const { data: prs } = await octokit.pulls.list({
      owner,
      repo,
      head: `${owner}:${branch}`,
      state: 'all',
      per_page: 1,
    })
    return prs.length > 0
  } catch {}
  return false
}

export async function setGitRemoteGithubRepoUrl(
  owner: string,
  repo: string,
  token: string,
  cwd = process.cwd(),
): Promise<boolean> {
  const { GITHUB_SERVER_URL } = ENV
  const urlObj = parseUrl(GITHUB_SERVER_URL || '')
  const host = urlObj?.host
  if (!host) {
    debugNs('error', 'invalid: GITHUB_SERVER_URL env var')
    debugDirNs('inspect', { GITHUB_SERVER_URL })
    return false
  }
  const url = `https://x-access-token:${token}@${host}/${owner}/${repo}`
  const stdioIgnoreOptions: SpawnOptions = {
    cwd,
    stdio: isDebugNs('stdio') ? 'inherit' : 'ignore',
  }
  const quotedCmd = `\`git remote set-url origin ${url}\``
  debugNs('stdio', `spawn: ${quotedCmd}`)
  try {
    await spawn('git', ['remote', 'set-url', 'origin', url], stdioIgnoreOptions)
    return true
  } catch (e) {
    debugNs('error', `Git command failed: ${quotedCmd}`)
    debugDirNs('inspect', { cmd: quotedCmd })
    debugDirNs('error', e)
  }
  return false
}

/**
 * Check if a GraphQL error is a rate limit error.
 */
export function isGraphqlRateLimitError(e: unknown): boolean {
  if (e instanceof GraphqlResponseError && Array.isArray(e.errors)) {
    return e.errors.some(
      err =>
        err.type === 'RATE_LIMITED' ||
        err.message?.toLowerCase().includes('rate limit'),
    )
  }
  return false
}

/**
 * Convert GraphQL errors to user-friendly CResult failures.
 * Handles rate limits and authentication errors with actionable messages.
 */
export function handleGraphqlError(
  e: unknown,
  context: string,
): CResult<never> {
  debugNs('error', formatErrorWithDetail(`GraphQL error: ${context}`, e))
  debugDirNs('error', e)

  if (e instanceof GraphqlResponseError) {
    const errorMessages = Array.isArray(e.errors)
      ? e.errors.map(err => err.message).filter(Boolean)
      : []

    // Check for rate limit errors.
    if (isGraphqlRateLimitError(e)) {
      return {
        ok: false,
        message: 'GitHub GraphQL rate limit exceeded',
        cause:
          `GitHub GraphQL rate limit exceeded while ${context}. ` +
          'Try again in a few minutes.\n\n' +
          'To increase your rate limit:\n' +
          '- Set GITHUB_TOKEN environment variable with a valid token\n' +
          '- In GitHub Actions, GITHUB_TOKEN is automatically available',
      }
    }

    // Return the GraphQL error details.
    return {
      ok: false,
      message: 'GitHub GraphQL error',
      cause:
        `GitHub GraphQL error while ${context}` +
        (errorMessages.length ? `:\n- ${errorMessages.join('\n- ')}` : ''),
    }
  }

  // Fall back to REST error handler for non-GraphQL errors.
  return handleGitHubApiError(e, context)
}

/**
 * Convert GitHub API errors to user-friendly CResult failures.
 * Handles rate limits, authentication, and network errors with actionable messages.
 */
export function handleGitHubApiError(
  e: unknown,
  context: string,
): CResult<never> {
  debugNs('error', formatErrorWithDetail(`GitHub API error: ${context}`, e))
  debugDirNs('error', e)

  if (e instanceof RequestError) {
    const { status } = e

    // Abuse detection rate limit - check first since it's more specific than standard rate limit.
    if (status === 403 && e.message.includes('secondary rate limit')) {
      return {
        ok: false,
        message: 'GitHub abuse detection triggered',
        cause:
          `GitHub abuse detection triggered while ${context}. ` +
          'This happens when making too many requests in a short period. ' +
          'Wait a few minutes before retrying.\n\n' +
          'To avoid this:\n' +
          '- Reduce the number of concurrent operations\n' +
          '- Add delays between bulk operations',
      }
    }

    // Standard rate limit errors (403 with rate limit message or 429).
    if (status === 429 || (status === 403 && e.message.includes('rate limit'))) {
      const retryAfter = e.response?.headers?.['retry-after']
      const resetHeader = e.response?.headers?.['x-ratelimit-reset']
      let waitTime: number | undefined

      if (retryAfter) {
        waitTime = parseInt(String(retryAfter), 10)
      } else if (resetHeader) {
        const resetTimestamp = parseInt(String(resetHeader), 10)
        waitTime = Math.max(0, resetTimestamp - Math.floor(Date.now() / 1000))
      }

      return {
        ok: false,
        message: 'GitHub rate limit exceeded',
        cause:
          `GitHub API rate limit exceeded while ${context}. ` +
          (waitTime
            ? `Try again in ${waitTime} seconds.`
            : 'Try again in a few minutes.') +
          '\n\n' +
          'To increase your rate limit:\n' +
          '- Set GITHUB_TOKEN environment variable with a valid token\n' +
          '- In GitHub Actions, GITHUB_TOKEN is automatically available\n' +
          '- Personal access tokens provide higher rate limits than unauthenticated requests',
      }
    }

    // Authentication errors.
    if (status === 401) {
      return {
        ok: false,
        message: 'GitHub authentication failed',
        cause:
          `GitHub authentication failed while ${context}. ` +
          'Your token may be invalid, expired, or missing required permissions.\n\n' +
          'To resolve:\n' +
          '- Verify your GitHub token is valid and not expired\n' +
          '- Set GITHUB_TOKEN environment variable\n' +
          '- Ensure the token has required scopes (repo, read:org)',
      }
    }

    // Permission denied (valid token but insufficient permissions).
    if (status === 403 && !e.message.includes('rate limit')) {
      return {
        ok: false,
        message: 'GitHub permission denied',
        cause:
          `GitHub permission denied while ${context}. ` +
          'Your token does not have access to this resource.\n\n' +
          'Ensure your token has the required scopes:\n' +
          '- repo: Full control of private repositories\n' +
          '- read:org: Read org membership (for org repos)',
      }
    }

    // Not found errors.
    if (status === 404) {
      return {
        ok: false,
        message: 'GitHub resource not found',
        cause:
          `GitHub resource not found while ${context}. ` +
          'The repository, branch, or file may not exist, or you may not have access to it.\n\n' +
          'Verify:\n' +
          '- The repository name and owner are correct\n' +
          '- The branch exists\n' +
          '- Your token has access to the repository',
      }
    }

    // Server errors (5xx).
    if (status >= 500) {
      return {
        ok: false,
        message: 'GitHub server error',
        cause:
          `GitHub server error (${status}) while ${context}. ` +
          'GitHub may be experiencing issues.\n\n' +
          'To resolve:\n' +
          '- Check https://www.githubstatus.com for service status\n' +
          '- Try again in a few moments',
      }
    }

    // Other request errors.
    return {
      ok: false,
      message: `GitHub API error (${status})`,
      cause: `GitHub API error while ${context}: ${e.message}`,
    }
  }

  // Network errors (ECONNREFUSED, ETIMEDOUT, etc.).
  if (e instanceof Error) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
      return {
        ok: false,
        message: 'Network error connecting to GitHub',
        cause:
          `Network error while ${context}: ${e.message}\n\n` +
          'To resolve:\n' +
          '- Check your internet connection\n' +
          '- Verify GitHub API is accessible from your network\n' +
          '- Check if a proxy or firewall is blocking the connection',
      }
    }
  }

  // Generic fallback.
  return {
    ok: false,
    message: 'GitHub API error',
    cause: `Unexpected error while ${context}: ${e instanceof Error ? e.message : String(e)}`,
  }
}

/**
 * Execute a GitHub API call with retry logic for transient failures.
 * Retries on 5xx errors and network failures with exponential backoff.
 */
export async function withGitHubRetry<T>(
  operation: () => Promise<T>,
  context: string,
  maxRetries = 3,
): Promise<CResult<T>> {
  let lastError: unknown

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await operation()
      return { ok: true, data: result }
    } catch (e) {
      lastError = e
      debugNs(
        'notice',
        `GitHub API attempt ${attempt}/${maxRetries} failed for ${context}`,
      )
      debugDirNs('error', e)

      // Don't retry on client errors (4xx) except rate limits.
      if (e instanceof RequestError) {
        const { status } = e
        // Rate limits: return immediately with helpful message.
        if (
          status === 429 ||
          (status === 403 && e.message.includes('rate limit'))
        ) {
          return handleGitHubApiError(e, context)
        }
        // Don't retry other 4xx errors.
        if (status >= 400 && status < 500) {
          return handleGitHubApiError(e, context)
        }
      }

      // Retry on 5xx or network errors.
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * 2 ** (attempt - 1), 10_000)
        debugNs('notice', `Retrying in ${delay}ms...`)
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  return handleGitHubApiError(lastError, context)
}
