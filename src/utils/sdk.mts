/**
 * Socket SDK utilities for Socket CLI.
 * Manages SDK initialization and configuration for API communication.
 *
 * Authentication:
 * - Interactive password prompt for missing tokens
 * - Supports environment variable (SOCKET_CLI_API_TOKEN)
 * - Validates token format and presence
 *
 * Proxy Support:
 * - Automatic proxy agent selection
 * - HTTP/HTTPS proxy configuration
 * - Respects SOCKET_CLI_API_PROXY environment variable
 *
 * SDK Setup:
 * - createSocketSdk: Create configured SDK instance
 * - getDefaultApiToken: Retrieve API token from config/env
 * - getDefaultProxyUrl: Retrieve proxy URL from config/env
 * - getPublicApiToken: Get public API token constant
 * - setupSdk: Initialize Socket SDK with authentication
 *
 * User Agent:
 * - Automatic user agent generation from package.json
 * - Includes CLI version and platform information
 */

import { HttpProxyAgent, HttpsProxyAgent } from 'hpagent'

import isInteractive from '@socketregistry/is-interactive/index.cjs'
import { password } from '@socketsecurity/registry/lib/prompts'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'
import { isUrl } from '@socketsecurity/registry/lib/url'
import { SocketSdk, createUserAgentFromPkgJson } from '@socketsecurity/sdk'

import { getConfigValueOrUndef } from './config.mts'
import constants, {
  CONFIG_KEY_API_BASE_URL,
  CONFIG_KEY_API_PROXY,
  CONFIG_KEY_API_TOKEN,
  CONFIG_KEY_CACHE_ENABLED,
  CONFIG_KEY_CACHE_TTL,
  TOKEN_PREFIX_LENGTH,
} from '../constants.mts'

import type { CResult } from '../types.mts'
import type {
  SocketSdkOperations,
  SocketSdkResult,
  SocketSdkSuccessResult,
} from '@socketsecurity/sdk'

const TOKEN_VISIBLE_LENGTH = 5

/**
 * Get the API base URL for Socket API operations.
 * Checks environment variable and config file, falls back to production API.
 *
 * @returns API base URL or undefined if not configured (uses default)
 *
 * @example
 * const baseUrl = getDefaultApiBaseUrl()
 * // Returns: 'https://api.socket.dev/v0' or custom URL
 */
export function getDefaultApiBaseUrl(): string | undefined {
  const baseUrl =
    constants.ENV['SOCKET_CLI_API_BASE_URL'] ||
    getConfigValueOrUndef(CONFIG_KEY_API_BASE_URL)
  if (isUrl(baseUrl)) {
    return baseUrl
  }
  const API_V0_URL = constants.API_V0_URL
  return API_V0_URL
}

/**
 * Check if API response caching is enabled.
 * Caching is opt-in (disabled by default) for predictable behavior.
 *
 * Priority: Environment variable > Config file > Default (false)
 *
 * @returns true if caching is enabled, false otherwise
 *
 * @example
 * if (getDefaultCacheEnabled()) {
 *   // Use cached responses when available
 * }
 */
export function getDefaultCacheEnabled(): boolean {
  const envValue = constants.ENV['SOCKET_CLI_CACHE_ENABLED']
  if (envValue !== undefined) {
    return envValue === '1' || envValue === 'true'
  }
  const configValue = getConfigValueOrUndef(CONFIG_KEY_CACHE_ENABLED)
  if (typeof configValue === 'boolean') {
    return configValue
  }
  // Default: cache disabled (opt-in)
  return false
}

/**
 * Get cache TTL (time-to-live) in milliseconds.
 * Determines how long cached API responses remain valid.
 *
 * Priority: Environment variable > Config file > Default (5 minutes)
 *
 * @returns TTL in milliseconds (default: 300000 = 5 minutes)
 *
 * @example
 * const ttl = getDefaultCacheTtl()
 * console.log(`Cache TTL: ${ttl / 1000} seconds`)
 */
export function getDefaultCacheTtl(): number {
  const envValue = constants.ENV['SOCKET_CLI_CACHE_TTL']
  if (envValue !== undefined) {
    const parsed = parseInt(envValue, 10)
    if (!isNaN(parsed) && parsed > 0) {
      return parsed
    }
  }
  const configValue = getConfigValueOrUndef(CONFIG_KEY_CACHE_TTL)
  if (typeof configValue === 'number' && configValue > 0) {
    return configValue
  }
  // Default: 5 minutes
  return 5 * 60 * 1000
}

/**
 * Get the HTTP/HTTPS proxy URL for API requests.
 * Checks environment variable and config file.
 *
 * @returns Proxy URL or undefined if not configured
 *
 * @example
 * const proxy = getDefaultProxyUrl()
 * // Returns: 'http://proxy.company.com:8080' or undefined
 */
export function getDefaultProxyUrl(): string | undefined {
  const apiProxy =
    constants.ENV['SOCKET_CLI_API_PROXY'] ||
    getConfigValueOrUndef(CONFIG_KEY_API_PROXY)
  return isUrl(apiProxy) ? apiProxy : undefined
}

// This Socket API token should be stored globally for the duration of the CLI execution.
let _defaultToken: string | undefined
export function getDefaultApiToken(): string | undefined {
  // In test mode: Ignore .env tokens and config file tokens to ensure
  // consistent snapshots. Tests must explicitly pass tokens via --config flag.
  // This prevents .env files from affecting test snapshots.
  // Note: Use process.env directly (not constants.ENV) to check at runtime,
  // since constants.ENV['VITEST'] is inlined at build time.
  if (process.env['VITEST'] === '1') {
    return undefined
  }

  // When SOCKET_CLI_NO_API_TOKEN=1: Ignore environment variable tokens and only
  // check config file. This forces the token to be explicitly set via config.
  // Otherwise: Check environment variables first, then config file.
  const key = constants.ENV['SOCKET_CLI_NO_API_TOKEN']
    ? getConfigValueOrUndef(CONFIG_KEY_API_TOKEN) || _defaultToken
    : constants.ENV['SOCKET_CLI_API_TOKEN'] ||
      getConfigValueOrUndef(CONFIG_KEY_API_TOKEN) ||
      _defaultToken

  _defaultToken = isNonEmptyString(key) ? key : undefined
  return _defaultToken
}

export function getPublicApiToken(): string {
  return (
    getDefaultApiToken() ||
    constants.ENV['SOCKET_CLI_API_TOKEN'] ||
    constants.SOCKET_PUBLIC_API_TOKEN
  )
}

export function getVisibleTokenPrefix(): string {
  const apiToken = getDefaultApiToken()
  return apiToken
    ? apiToken.slice(
        TOKEN_PREFIX_LENGTH,
        TOKEN_PREFIX_LENGTH + TOKEN_VISIBLE_LENGTH,
      )
    : ''
}

export function hasDefaultApiToken(): boolean {
  return !!getDefaultApiToken()
}

export type SetupSdkOptions = {
  apiBaseUrl?: string | undefined
  apiProxy?: string | undefined
  apiToken?: string | undefined
  cache?: boolean | undefined
  cacheTtl?: number | undefined
}

export async function setupSdk(
  options?: SetupSdkOptions | undefined,
): Promise<CResult<SocketSdk>> {
  const opts = { __proto__: null, ...options } as SetupSdkOptions
  let { apiToken = getDefaultApiToken() } = opts

  if (typeof apiToken !== 'string' && isInteractive()) {
    apiToken = await password({
      message:
        'Enter your Socket.dev API token (not saved, use socket login to persist)',
    })
    _defaultToken = apiToken
  }

  if (!apiToken) {
    return {
      ok: false,
      message: 'Auth Error',
      cause: 'You need to provide an API token. Run `socket login` first.',
    }
  }

  let { apiProxy } = opts
  if (!isUrl(apiProxy)) {
    apiProxy = getDefaultProxyUrl()
  }

  const { apiBaseUrl = getDefaultApiBaseUrl() } = opts

  // Get cache configuration with defaults
  const cache = opts.cache !== undefined ? opts.cache : getDefaultCacheEnabled()
  const cacheTtl =
    opts.cacheTtl !== undefined ? opts.cacheTtl : getDefaultCacheTtl()

  // Usage of HttpProxyAgent vs. HttpsProxyAgent based on the chart at:
  // https://github.com/delvedor/hpagent?tab=readme-ov-file#usage
  const ProxyAgent = apiBaseUrl?.startsWith('http:')
    ? HttpProxyAgent
    : HttpsProxyAgent

  return {
    ok: true,
    data: new SocketSdk(apiToken, {
      ...(apiProxy ? { agent: new ProxyAgent({ proxy: apiProxy }) } : {}),
      ...(apiBaseUrl ? { baseUrl: apiBaseUrl } : {}),
      cache,
      cacheTtl,
      timeout: constants.ENV['SOCKET_CLI_API_TIMEOUT'],
      userAgent: createUserAgentFromPkgJson({
        name: constants.ENV['INLINED_SOCKET_CLI_NAME'],
        version: constants.ENV['INLINED_SOCKET_CLI_VERSION'],
        homepage: constants.ENV['INLINED_SOCKET_CLI_HOMEPAGE'],
      }),
    }),
  }
}

/**
 * Execute SDK operation with automatic setup and error handling.
 * Consolidates the repetitive pattern of SDK initialization and API call handling.
 */
export async function withSdk<T extends SocketSdkOperations>(
  operation: (sdk: SocketSdk) => Promise<SocketSdkResult<T>>,
  description: string,
  options?: { sdkOpts?: SetupSdkOptions | undefined } | undefined,
): Promise<CResult<SocketSdkSuccessResult<T>['data']>> {
  const { sdkOpts } = { __proto__: null, ...options } as {
    sdkOpts?: SetupSdkOptions | undefined
  }

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }

  // Import handleApiCall - using dynamic import to avoid circular dependency
  const { handleApiCall } = await import('./api.mts')
  return await handleApiCall(operation(sockSdkCResult.data), { description })
}

/**
 * Query Socket API endpoint and parse JSON response.
 */
export async function queryApiJson<T = unknown>(
  sdk: SocketSdk,
  path: string,
  options?: { throws?: boolean; description?: string } | undefined,
): Promise<CResult<T>> {
  const opts = { __proto__: null, throws: false, ...options }
  try {
    const result = await sdk.getApi<CResult<T>>(path, {
      responseType: 'json',
      throws: opts.throws,
    })

    if (result && typeof result === 'object' && 'ok' in result) {
      return result as CResult<T>
    }

    // SDK returned direct data when throws: true succeeds.
    return { ok: true, data: result as T }
  } catch (e) {
    const message = `Error fetching ${opts.description || 'data'}: ${e instanceof Error ? e.message : String(e)}`
    return { ok: false, message }
  }
}

/**
 * Query Socket API endpoint and return text response.
 */
export async function queryApiText(
  sdk: SocketSdk,
  path: string,
  options?: { throws?: boolean; description?: string } | undefined,
): Promise<CResult<string>> {
  const opts = { __proto__: null, throws: false, ...options }
  try {
    // SDK 1.9.0+ returns data directly when throws: true, or result object when throws: false.
    // Always throw on error, we'll wrap in CResult.
    const result = await sdk.getApi<string>(path, {
      responseType: 'text',
      throws: true,
    })

    // Wrap in CResult for backward compatibility
    return { ok: true, data: result as string }
  } catch (e) {
    const message = `Error fetching ${opts.description || 'data'}: ${e instanceof Error ? e.message : String(e)}`
    return { ok: false, message }
  }
}
