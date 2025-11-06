/**
 * @fileoverview GitHub utilities for Socket projects.
 * Provides GitHub API integration for repository operations.
 *
 * Authentication:
 * - getGitHubToken: Retrieve GitHub token from environment variables
 * - fetchGitHub: Authenticated GitHub API requests with rate limit handling
 *
 * Ref Resolution:
 * - resolveRefToSha: Convert tags/branches to commit SHAs (with memoization and persistent cache)
 * - clearRefCache: Clear the in-memory memoization cache
 *
 * Caching:
 * - Uses cacache for persistent storage with in-memory memoization
 * - Two-tier caching: in-memory (Map) for hot data, persistent (cacache) for durability
 * - Default TTL: 5 minutes
 * - Disable with DISABLE_GITHUB_CACHE env var
 *
 * Rate Limiting:
 * - Automatic rate limit detection and error messages
 * - Cache to minimize API calls
 */

import type { TtlCache } from './cache-with-ttl'
import { createTtlCache } from './cache-with-ttl'
import { getGhToken, getGithubToken } from '#env/github'
import { getSocketCliGithubToken } from '#env/socket-cli'
import { httpRequest } from './http-request'
import type { SpawnOptions } from './spawn'
import { spawn } from './spawn'

// GitHub API base URL constant (inlined for coverage mode compatibility).
const GITHUB_API_BASE_URL = 'https://api.github.com'

// 5 minutes.
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000

// Create TTL cache instance for GitHub ref resolution.
// Uses cacache for persistent storage with in-memory memoization.
let _githubCache: TtlCache | undefined

/**
 * Get or create the GitHub cache instance.
 * Lazy initializes the cache with default TTL and memoization enabled.
 * Used internally for caching GitHub API responses.
 *
 * @returns The singleton cache instance
 */
function getGithubCache(): TtlCache {
  if (_githubCache === undefined) {
    _githubCache = createTtlCache({
      memoize: true,
      prefix: 'github-refs',
      ttl: DEFAULT_CACHE_TTL_MS,
    })
  }
  return _githubCache
}

/**
 * Options for GitHub API fetch requests.
 */
export interface GitHubFetchOptions {
  /**
   * GitHub authentication token.
   * If not provided, will attempt to use token from environment variables.
   */
  token?: string | undefined
  /**
   * Additional HTTP headers to include in the request.
   * Will be merged with default headers (Accept, User-Agent, Authorization).
   */
  headers?: Record<string, string> | undefined
}

/**
 * Error thrown when GitHub API rate limit is exceeded.
 * Extends the standard Error with additional rate limit information.
 */
export interface GitHubRateLimitError extends Error {
  /** HTTP status code (always 403 for rate limit errors) */
  status: number
  /**
   * Date when the rate limit will reset.
   * Undefined if reset time is not available in response headers.
   */
  resetTime?: Date | undefined
}

/**
 * Get GitHub authentication token from environment variables.
 * Checks multiple environment variable names in priority order.
 *
 * Environment variables checked (in order):
 * 1. `GITHUB_TOKEN` - Standard GitHub token variable
 * 2. `GH_TOKEN` - Alternative GitHub CLI token variable
 * 3. `SOCKET_CLI_GITHUB_TOKEN` - Socket-specific token variable
 *
 * @returns The first available GitHub token, or `undefined` if none found
 *
 * @example
 * ```ts
 * const token = getGitHubToken()
 * if (!token) {
 *   console.warn('No GitHub token found')
 * }
 * ```
 */
export function getGitHubToken(): string | undefined {
  return (
    getGithubToken() || getGhToken() || getSocketCliGithubToken() || undefined
  )
}

/**
 * Fetch data from GitHub API with automatic authentication and rate limit handling.
 * Makes authenticated requests to the GitHub REST API with proper error handling.
 *
 * Features:
 * - Automatic token injection from environment if not provided
 * - Rate limit detection with helpful error messages
 * - Standard GitHub API headers (Accept, User-Agent)
 * - JSON response parsing
 *
 * @template T - Expected response type (defaults to `unknown`)
 * @param url - Full GitHub API URL (e.g., 'https://api.github.com/repos/owner/repo')
 * @param options - Fetch options including token and custom headers
 * @returns Parsed JSON response of type `T`
 *
 * @throws {GitHubRateLimitError} When API rate limit is exceeded (status 403)
 * @throws {Error} For other API errors with status code and message
 *
 * @example
 * ```ts
 * // Fetch repository information
 * interface Repo {
 *   name: string
 *   full_name: string
 *   default_branch: string
 * }
 * const repo = await fetchGitHub<Repo>(
 *   'https://api.github.com/repos/owner/repo'
 * )
 * console.log(`Default branch: ${repo.default_branch}`)
 * ```
 *
 * @example
 * ```ts
 * // With custom token and headers
 * const data = await fetchGitHub(
 *   'https://api.github.com/user',
 *   {
 *     token: 'ghp_customtoken',
 *     headers: { 'X-Custom-Header': 'value' }
 *   }
 * )
 * ```
 *
 * @example
 * ```ts
 * // Handle rate limit errors
 * try {
 *   await fetchGitHub('https://api.github.com/repos/owner/repo')
 * } catch (error) {
 *   if (error.status === 403 && error.resetTime) {
 *     console.error(`Rate limited until ${error.resetTime}`)
 *   }
 * }
 * ```
 */
export async function fetchGitHub<T = unknown>(
  url: string,
  options?: GitHubFetchOptions | undefined,
): Promise<T> {
  const opts = { __proto__: null, ...options } as GitHubFetchOptions
  const token = opts.token || getGitHubToken()

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'socket-registry-github-client',
    ...opts.headers,
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await httpRequest(url, { headers })

  if (!response.ok) {
    if (response.status === 403) {
      const rateLimit = response.headers['x-ratelimit-remaining']
      const rateLimitStr =
        typeof rateLimit === 'string' ? rateLimit : rateLimit?.[0]
      if (rateLimitStr === '0') {
        const resetTime = response.headers['x-ratelimit-reset']
        const resetTimeStr =
          typeof resetTime === 'string' ? resetTime : resetTime?.[0]
        const resetDate = resetTimeStr
          ? new Date(Number(resetTimeStr) * 1000)
          : undefined
        const error = new Error(
          `GitHub API rate limit exceeded${resetDate ? `. Resets at ${resetDate.toLocaleString()}` : ''}. Use GITHUB_TOKEN environment variable to increase rate limit.`,
        ) as GitHubRateLimitError
        error.status = 403
        error.resetTime = resetDate
        throw error
      }
    }
    throw new Error(
      `GitHub API error ${response.status}: ${response.statusText}`,
    )
  }

  return JSON.parse(response.body.toString('utf8')) as T
}

/**
 * GitHub ref object returned by the API.
 * Represents a git reference (tag or branch).
 */
export interface GitHubRef {
  /** The object this ref points to */
  object: {
    /** SHA of the commit or tag object */
    sha: string
    /** Type of object ('commit' or 'tag') */
    type: string
    /** API URL to fetch the full object details */
    url: string
  }
  /** Full ref path (e.g., 'refs/tags/v1.0.0' or 'refs/heads/main') */
  ref: string
  /** API URL for this ref */
  url: string
}

/**
 * GitHub annotated tag object returned by the API.
 * Represents a git tag with metadata.
 */
export interface GitHubTag {
  /** Tag annotation message */
  message: string
  /** The commit this tag points to */
  object: {
    /** SHA of the commit */
    sha: string
    /** Type of object (usually 'commit') */
    type: string
    /** API URL to fetch the commit details */
    url: string
  }
  /** SHA of this tag object itself */
  sha: string
  /** Tag name (e.g., 'v1.0.0') */
  tag: string
  /**
   * Information about who created the tag.
   * Undefined for lightweight tags.
   */
  tagger?: {
    /** Tag creation date in ISO 8601 format */
    date: string
    /** Tagger's email address */
    email: string
    /** Tagger's name */
    name: string
  }
  /** API URL for this tag object */
  url: string
}

/**
 * GitHub commit object returned by the API.
 * Represents a git commit with metadata.
 */
export interface GitHubCommit {
  /** Full commit SHA */
  sha: string
  /** API URL for this commit */
  url: string
  /** Commit details */
  commit: {
    /** Commit message */
    message: string
    /** Author information */
    author: {
      /** Commit author date in ISO 8601 format */
      date: string
      /** Author's email address */
      email: string
      /** Author's name */
      name: string
    }
  }
}

/**
 * Options for resolving git refs to commit SHAs.
 */
export interface ResolveRefOptions {
  /**
   * GitHub authentication token.
   * If not provided, will attempt to use token from environment variables.
   */
  token?: string | undefined
}

/**
 * Resolve a git ref (tag, branch, or commit SHA) to its full commit SHA.
 * Handles tags (annotated and lightweight), branches, and commit SHAs.
 * Results are cached in-memory and on disk (with TTL) to minimize API calls.
 *
 * Resolution strategy:
 * 1. Try as a tag (refs/tags/{ref})
 * 2. If tag is annotated, dereference to get the commit SHA
 * 3. If not a tag, try as a branch (refs/heads/{ref})
 * 4. If not a branch, try as a commit SHA directly
 *
 * Caching behavior:
 * - In-memory cache (Map) for immediate lookups
 * - Persistent disk cache (cacache) for durability across runs
 * - Default TTL: 5 minutes
 * - Disable caching with `DISABLE_GITHUB_CACHE` env var
 *
 * @param owner - Repository owner (user or organization name)
 * @param repo - Repository name
 * @param ref - Git reference to resolve (tag name, branch name, or commit SHA)
 * @param options - Resolution options including authentication token
 * @returns The full commit SHA (40-character hex string)
 *
 * @throws {Error} When ref cannot be resolved after trying all strategies
 * @throws {GitHubRateLimitError} When API rate limit is exceeded
 *
 * @example
 * ```ts
 * // Resolve a tag to commit SHA
 * const sha = await resolveRefToSha('owner', 'repo', 'v1.0.0')
 * console.log(sha) // 'a1b2c3d4e5f6...'
 * ```
 *
 * @example
 * ```ts
 * // Resolve a branch to latest commit SHA
 * const sha = await resolveRefToSha('owner', 'repo', 'main')
 * console.log(sha) // Latest commit on main branch
 * ```
 *
 * @example
 * ```ts
 * // Resolve with custom token
 * const sha = await resolveRefToSha(
 *   'owner',
 *   'repo',
 *   'develop',
 *   { token: 'ghp_customtoken' }
 * )
 * ```
 *
 * @example
 * ```ts
 * // Commit SHA passes through unchanged (but validates it exists)
 * const sha = await resolveRefToSha('owner', 'repo', 'a1b2c3d4')
 * console.log(sha) // Full 40-char SHA
 * ```
 */
export async function resolveRefToSha(
  owner: string,
  repo: string,
  ref: string,
  options?: ResolveRefOptions | undefined,
): Promise<string> {
  const opts = {
    __proto__: null,
    ...options,
  } as ResolveRefOptions

  const cacheKey = `${owner}/${repo}@${ref}`

  // Optionally disable cache.
  if (process.env['DISABLE_GITHUB_CACHE']) {
    return await fetchRefSha(owner, repo, ref, opts)
  }

  // Use TTL cache for persistent storage and in-memory memoization.
  const cache = getGithubCache()
  return await cache.getOrFetch(cacheKey, async () => {
    return await fetchRefSha(owner, repo, ref, opts)
  })
}

/**
 * Fetch the SHA for a git ref from GitHub API.
 * Internal helper that implements the multi-strategy ref resolution logic.
 * Tries tags, branches, and direct commit lookups in sequence.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param ref - Git reference to resolve
 * @param options - Resolution options with authentication token
 * @returns The full commit SHA
 *
 * @throws {Error} When ref cannot be resolved after all strategies fail
 */
async function fetchRefSha(
  owner: string,
  repo: string,
  ref: string,
  options: ResolveRefOptions,
): Promise<string> {
  const fetchOptions: GitHubFetchOptions = {
    token: options.token,
  }

  try {
    // Try as a tag first.
    const tagUrl = `${GITHUB_API_BASE_URL}/repos/${owner}/${repo}/git/refs/tags/${ref}`
    const tagData = await fetchGitHub<GitHubRef>(tagUrl, fetchOptions)

    // Tag might point to a tag object or directly to a commit.
    if (tagData.object.type === 'tag') {
      // Dereference the tag object to get the commit.
      const tagObject = await fetchGitHub<GitHubTag>(
        tagData.object.url,
        fetchOptions,
      )
      return tagObject.object.sha
    }
    return tagData.object.sha
  } catch {
    // Not a tag, try as a branch.
    try {
      const branchUrl = `${GITHUB_API_BASE_URL}/repos/${owner}/${repo}/git/refs/heads/${ref}`
      const branchData = await fetchGitHub<GitHubRef>(branchUrl, fetchOptions)
      return branchData.object.sha
    } catch {
      // Try without refs/ prefix (for commit SHAs or other refs).
      try {
        const commitUrl = `${GITHUB_API_BASE_URL}/repos/${owner}/${repo}/commits/${ref}`
        const commitData = await fetchGitHub<GitHubCommit>(
          commitUrl,
          fetchOptions,
        )
        return commitData.sha
      } catch (e) {
        throw new Error(
          `failed to resolve ref "${ref}" for ${owner}/${repo}: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
    }
  }
}

/**
 * Clear the ref resolution cache (in-memory only).
 * Clears the in-memory memoization cache without affecting the persistent disk cache.
 * Useful for testing or when you need fresh data from the API.
 *
 * Note: This only clears the in-memory cache. The persistent cacache storage
 * remains intact and will be used to rebuild the in-memory cache on next access.
 *
 * @returns Promise that resolves when cache is cleared
 *
 * @example
 * ```ts
 * // Clear cache to force fresh API calls
 * await clearRefCache()
 * const sha = await resolveRefToSha('owner', 'repo', 'main')
 * // This will hit the persistent cache or API, not in-memory cache
 * ```
 */
export async function clearRefCache(): Promise<void> {
  if (_githubCache) {
    await _githubCache.clear({ memoOnly: true })
  }
}

/**
 * Get GitHub authentication token from git config.
 * Reads the `github.token` configuration value from git config.
 * This is a fallback method when environment variables don't contain a token.
 *
 * @param options - Spawn options for git command execution
 * @returns GitHub token from git config, or `undefined` if not configured
 *
 * @example
 * ```ts
 * const token = await getGitHubTokenFromGitConfig()
 * if (token) {
 *   console.log('Found token in git config')
 * }
 * ```
 *
 * @example
 * ```ts
 * // With custom working directory
 * const token = await getGitHubTokenFromGitConfig({
 *   cwd: '/path/to/repo'
 * })
 * ```
 */
export async function getGitHubTokenFromGitConfig(
  options?: SpawnOptions | undefined,
): Promise<string | undefined> {
  try {
    const result = await spawn('git', ['config', 'github.token'], {
      ...options,
      stdio: 'pipe',
    })
    if (result.code === 0 && result.stdout) {
      return result.stdout.toString().trim()
    }
  } catch {
    // Ignore errors - git config may not have token.
  }
  return undefined
}

/**
 * Get GitHub authentication token from all available sources.
 * Checks environment variables first, then falls back to git config.
 * This is the recommended way to get a GitHub token with maximum compatibility.
 *
 * Priority order:
 * 1. Environment variables (GITHUB_TOKEN, GH_TOKEN, SOCKET_CLI_GITHUB_TOKEN)
 * 2. Git config (github.token)
 *
 * @returns GitHub token from first available source, or `undefined` if none found
 *
 * @example
 * ```ts
 * const token = await getGitHubTokenWithFallback()
 * if (!token) {
 *   throw new Error('GitHub token required')
 * }
 * ```
 */
export async function getGitHubTokenWithFallback(): Promise<
  string | undefined
> {
  return getGitHubToken() || (await getGitHubTokenFromGitConfig())
}

/**
 * GitHub Security Advisory (GHSA) details.
 * Represents a complete security advisory from GitHub's database.
 */
export interface GhsaDetails {
  /** GHSA identifier (e.g., 'GHSA-xxxx-yyyy-zzzz') */
  ghsaId: string
  /** Short summary of the vulnerability */
  summary: string
  /** Detailed description of the vulnerability */
  details: string
  /** Severity level ('low', 'moderate', 'high', 'critical') */
  severity: string
  /** Alternative identifiers (CVE IDs, etc.) */
  aliases: string[]
  /** ISO 8601 timestamp when advisory was published */
  publishedAt: string
  /** ISO 8601 timestamp when advisory was last updated */
  updatedAt: string
  /**
   * ISO 8601 timestamp when advisory was withdrawn.
   * `null` if advisory is still active.
   */
  withdrawnAt: string | null
  /** External reference URLs for more information */
  references: Array<{ url: string }>
  /** Affected packages and version ranges */
  vulnerabilities: Array<{
    /** Package information */
    package: {
      /** Ecosystem (e.g., 'npm', 'pip', 'maven') */
      ecosystem: string
      /** Package name */
      name: string
    }
    /** Version range expression for vulnerable versions */
    vulnerableVersionRange: string
    /**
     * First patched version that fixes the vulnerability.
     * `null` if no patched version exists yet.
     */
    firstPatchedVersion: { identifier: string } | null
  }>
  /**
   * CVSS (Common Vulnerability Scoring System) information.
   * `null` if CVSS score is not available.
   */
  cvss: {
    /** CVSS score (0.0-10.0) */
    score: number
    /** CVSS vector string describing the vulnerability characteristics */
    vectorString: string
  } | null
  /** CWE (Common Weakness Enumeration) categories */
  cwes: Array<{
    /** CWE identifier (e.g., 'CWE-79') */
    cweId: string
    /** Human-readable CWE name */
    name: string
    /** Description of the weakness category */
    description: string
  }>
}

/**
 * Generate GitHub Security Advisory URL from GHSA ID.
 * Constructs the public advisory URL for a given GHSA identifier.
 *
 * @param ghsaId - GHSA identifier (e.g., 'GHSA-xxxx-yyyy-zzzz')
 * @returns Full URL to the advisory page
 *
 * @example
 * ```ts
 * const url = getGhsaUrl('GHSA-1234-5678-90ab')
 * console.log(url) // 'https://github.com/advisories/GHSA-1234-5678-90ab'
 * ```
 */
export function getGhsaUrl(ghsaId: string): string {
  return `https://github.com/advisories/${ghsaId}`
}

/**
 * Fetch GitHub Security Advisory details from the API.
 * Retrieves complete advisory information including severity, affected packages,
 * CVSS scores, and CWE classifications.
 *
 * @param ghsaId - GHSA identifier to fetch (e.g., 'GHSA-xxxx-yyyy-zzzz')
 * @param options - Fetch options including authentication token
 * @returns Complete advisory details with normalized field names
 *
 * @throws {Error} If advisory cannot be found or API request fails
 * @throws {GitHubRateLimitError} When API rate limit is exceeded
 *
 * @example
 * ```ts
 * const advisory = await fetchGhsaDetails('GHSA-1234-5678-90ab')
 * console.log(`Severity: ${advisory.severity}`)
 * console.log(`Affects: ${advisory.vulnerabilities.length} packages`)
 * if (advisory.cvss) {
 *   console.log(`CVSS Score: ${advisory.cvss.score}`)
 * }
 * ```
 *
 * @example
 * ```ts
 * // Check if vulnerability is patched
 * const advisory = await fetchGhsaDetails('GHSA-xxxx-yyyy-zzzz')
 * for (const vuln of advisory.vulnerabilities) {
 *   if (vuln.firstPatchedVersion) {
 *     console.log(
 *       `Patched in ${vuln.package.name}@${vuln.firstPatchedVersion.identifier}`
 *     )
 *   }
 * }
 * ```
 */
export async function fetchGhsaDetails(
  ghsaId: string,
  options?: GitHubFetchOptions | undefined,
): Promise<GhsaDetails> {
  const url = `https://api.github.com/advisories/${ghsaId}`
  const data = await fetchGitHub<{
    aliases?: string[]
    cvss: unknown
    cwes?: Array<{ cweId: string; name: string; description: string }>
    details: string
    ghsa_id: string
    published_at: string
    references?: Array<{ url: string }>
    severity: string
    summary: string
    updated_at: string
    vulnerabilities?: Array<{
      package: { ecosystem: string; name: string }
      vulnerableVersionRange: string
      firstPatchedVersion: { identifier: string } | null
    }>
    withdrawn_at: string
  }>(url, options)

  return {
    ghsaId: data.ghsa_id,
    summary: data.summary,
    details: data.details,
    severity: data.severity,
    aliases: data.aliases || [],
    publishedAt: data.published_at,
    updatedAt: data.updated_at,
    withdrawnAt: data.withdrawn_at,
    references: data.references || [],
    vulnerabilities: data.vulnerabilities || [],
    cvss: data.cvss as { score: number; vectorString: string } | null,
    cwes: data.cwes || [],
  }
}

/**
 * Fetch GitHub Security Advisory details with caching.
 * Retrieves advisory information with two-tier caching (in-memory + persistent).
 * Cached results are stored with the default TTL (5 minutes).
 *
 * Caching behavior:
 * - Checks in-memory cache first for immediate response
 * - Falls back to persistent disk cache if not in memory
 * - Fetches from API only if not cached
 * - Stores result in both cache tiers
 * - Respects `DISABLE_GITHUB_CACHE` env var
 *
 * @param ghsaId - GHSA identifier to fetch
 * @param options - Fetch options including authentication token
 * @returns Complete advisory details
 *
 * @throws {Error} If advisory cannot be found or API request fails
 * @throws {GitHubRateLimitError} When API rate limit is exceeded
 *
 * @example
 * ```ts
 * // First call hits API
 * const advisory = await cacheFetchGhsa('GHSA-1234-5678-90ab')
 *
 * // Second call within 5 minutes returns cached data
 * const cached = await cacheFetchGhsa('GHSA-1234-5678-90ab')
 * ```
 *
 * @example
 * ```ts
 * // Disable caching for fresh data
 * process.env.DISABLE_GITHUB_CACHE = '1'
 * const advisory = await cacheFetchGhsa('GHSA-xxxx-yyyy-zzzz')
 * ```
 */
export async function cacheFetchGhsa(
  ghsaId: string,
  options?: GitHubFetchOptions | undefined,
): Promise<GhsaDetails> {
  const cache = getGithubCache()
  const key = `ghsa:${ghsaId}`

  // Check cache first.
  if (!process.env['DISABLE_GITHUB_CACHE']) {
    const cached = await cache.get(key)
    if (cached) {
      return JSON.parse(cached as string) as GhsaDetails
    }
  }

  // Fetch and cache.
  const data = await fetchGhsaDetails(ghsaId, options)
  await cache.set(key, JSON.stringify(data))
  return data
}
