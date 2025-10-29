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

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import {
  GraphqlResponseError,
  graphql as OctokitGraphql,
} from '@octokit/graphql'
import { Octokit } from '@octokit/rest'

import {
  debugDir,
  debugDirNs,
  debugNs,
  isDebugNs,
} from '@socketsecurity/lib/debug'
import { readJson, safeStatsSync, writeJson } from '@socketsecurity/lib/fs'
import { spawn } from '@socketsecurity/lib/spawn'
import { parseUrl } from '@socketsecurity/lib/url'

import ENV from '../../constants/env.mts'
import { getGithubCachePath } from '../../constants/paths.mts'
import { formatErrorWithDetail } from '../error/errors.mts'

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
    await fs.mkdir(githubCachePath, { recursive: true })
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
    debugDir('inspect', { octokitOptions })
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
    debugDir('inspect', { GITHUB_SERVER_URL })
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
