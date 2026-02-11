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
import { SOCKET_PUBLIC_API_TOKEN } from '@socketsecurity/lib/constants/socket'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { password } from '@socketsecurity/lib/stdio/prompts'
import { isNonEmptyString } from '@socketsecurity/lib/strings'
import { isUrl } from '@socketsecurity/lib/url'
import { pluralize } from '@socketsecurity/lib/words'
import { createUserAgentFromPkgJson, SocketSdk } from '@socketsecurity/sdk'

import {
  CONFIG_KEY_API_BASE_URL,
  CONFIG_KEY_API_PROXY,
  CONFIG_KEY_API_TOKEN,
  CONFIG_KEY_AUTH_BASE_URL,
  CONFIG_KEY_OAUTH_CLIENT_ID,
  CONFIG_KEY_OAUTH_REFRESH_TOKEN,
  CONFIG_KEY_OAUTH_SCOPES,
  CONFIG_KEY_OAUTH_TOKEN_EXPIRES_AT,
} from '../../constants/config.mts'
import ENV from '../../constants/env.mts'
import { TOKEN_PREFIX_LENGTH } from '../../constants/socket.mts'
import { getConfigValueOrUndef, updateConfigValue } from '../config.mts'
import { debugApiRequest, debugApiResponse } from '../debug.mts'
import { trackCliEvent } from '../telemetry/integration.mts'
import {
  deriveAuthBaseUrlFromApiBaseUrl,
  fetchOAuthAuthorizationServerMetadata,
  refreshOAuthAccessToken,
} from '../auth/oauth.mts'

import type { CResult } from '../../types.mts'
import type {
  FileValidationResult,
  RequestInfo,
  ResponseInfo,
} from '@socketsecurity/sdk'
const logger = getDefaultLogger()

const TOKEN_VISIBLE_LENGTH = 5

// The Socket API server that should be used for operations.
export function getDefaultApiBaseUrl(): string | undefined {
  const baseUrl =
    ENV.SOCKET_CLI_API_BASE_URL ||
    getConfigValueOrUndef(CONFIG_KEY_API_BASE_URL) ||
    undefined
  return isUrl(baseUrl) ? baseUrl : undefined
}

// The Socket API server that should be used for operations.
export function getDefaultProxyUrl(): string | undefined {
  const apiProxy =
    ENV.SOCKET_CLI_API_PROXY ||
    getConfigValueOrUndef(CONFIG_KEY_API_PROXY) ||
    undefined
  return isUrl(apiProxy) ? apiProxy : undefined
}

// This Socket API token should be stored globally for the duration of the CLI execution.
let _defaultToken: string | undefined

export function getDefaultApiToken(): string | undefined {
  if (ENV.SOCKET_CLI_NO_API_TOKEN) {
    _defaultToken = undefined
    return _defaultToken
  }

  const key =
    ENV.SOCKET_CLI_API_TOKEN ||
    getConfigValueOrUndef(CONFIG_KEY_API_TOKEN) ||
    _defaultToken

  _defaultToken = isNonEmptyString(key) ? key : undefined
  return _defaultToken
}

export function getPublicApiToken(): string {
  return (
    getDefaultApiToken() || ENV.SOCKET_CLI_API_TOKEN || SOCKET_PUBLIC_API_TOKEN
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
}

export function hasOAuthRefreshTokenConfigured(): boolean {
  const refreshToken = getConfigValueOrUndef(CONFIG_KEY_OAUTH_REFRESH_TOKEN)
  return isNonEmptyString(refreshToken)
}

export async function refreshOAuthApiTokenFromConfig(params: {
  apiBaseUrl: string | undefined
  apiProxy: string | undefined
}): Promise<CResult<{ accessToken: string }>> {
  const refreshToken = getConfigValueOrUndef(CONFIG_KEY_OAUTH_REFRESH_TOKEN)
  const clientId = getConfigValueOrUndef(CONFIG_KEY_OAUTH_CLIENT_ID)
  const storedAuthBaseUrl = getConfigValueOrUndef(CONFIG_KEY_AUTH_BASE_URL)

  if (!isNonEmptyString(refreshToken) || !isNonEmptyString(clientId)) {
    return {
      ok: false,
      message: 'Auth Error',
      cause: 'OAuth refresh token is not configured. Run `socket login`.',
    }
  }

  const derivedAuthBaseUrl = deriveAuthBaseUrlFromApiBaseUrl(params.apiBaseUrl)
  const authBaseUrl =
    (isNonEmptyString(storedAuthBaseUrl) ? storedAuthBaseUrl : undefined) ??
    derivedAuthBaseUrl

  if (!isNonEmptyString(authBaseUrl)) {
    return {
      ok: false,
      message: 'Auth Error',
      cause:
        'OAuth authBaseUrl is not configured. Run `socket login` or set SOCKET_CLI_AUTH_BASE_URL.',
    }
  }

  const metaResult = await fetchOAuthAuthorizationServerMetadata({
    authBaseUrl,
    apiProxy: params.apiProxy,
  })
  if (!metaResult.ok) {
    return {
      ok: false,
      message: metaResult.message,
      cause: metaResult.cause,
    }
  }

  const tokenEndpoint = metaResult.data.token_endpoint
  const refreshed = await refreshOAuthAccessToken({
    tokenEndpoint,
    clientId,
    refreshToken,
    apiProxy: params.apiProxy,
  })
  if (!refreshed.ok) {
    return {
      ok: false,
      message: refreshed.message,
      cause:
        refreshed.cause ||
        'OAuth refresh failed. Run `socket login` to re-authenticate.',
    }
  }

  const nextRefreshToken =
    refreshed.data.refresh_token &&
    isNonEmptyString(refreshed.data.refresh_token)
      ? refreshed.data.refresh_token
      : refreshToken

  const expiresAt = Date.now() + Math.max(0, refreshed.data.expires_in) * 1000

  updateConfigValue(CONFIG_KEY_API_TOKEN, refreshed.data.access_token)
  updateConfigValue(CONFIG_KEY_OAUTH_REFRESH_TOKEN, nextRefreshToken)
  updateConfigValue(CONFIG_KEY_OAUTH_TOKEN_EXPIRES_AT, expiresAt)

  // If scopes were not stored at login time, store whatever the server returned.
  if (!getConfigValueOrUndef(CONFIG_KEY_OAUTH_SCOPES) && refreshed.data.scope) {
    updateConfigValue(
      CONFIG_KEY_OAUTH_SCOPES,
      refreshed.data.scope.split(' ').filter(Boolean),
    )
  }

  return { ok: true, data: { accessToken: refreshed.data.access_token } }
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

  const oauthRefreshToken = getConfigValueOrUndef(
    CONFIG_KEY_OAUTH_REFRESH_TOKEN,
  )
  const oauthExpiresAt = getConfigValueOrUndef(
    CONFIG_KEY_OAUTH_TOKEN_EXPIRES_AT,
  )
  const shouldSkipOAuthRefresh =
    isNonEmptyString(opts.apiToken) ||
    isNonEmptyString(ENV.SOCKET_CLI_API_TOKEN)

  // If OAuth is configured, treat the persisted `apiToken` as a short-lived access token and
  // transparently refresh it when expired/near-expiry.
  if (!shouldSkipOAuthRefresh && isNonEmptyString(oauthRefreshToken)) {
    const now = Date.now()
    const expiresAtMs =
      typeof oauthExpiresAt === 'number' && Number.isFinite(oauthExpiresAt)
        ? oauthExpiresAt
        : null
    const isExpiredOrMissing =
      !apiToken || !expiresAtMs || expiresAtMs - now <= 60_000

    if (isExpiredOrMissing) {
      const refreshResult = await refreshOAuthApiTokenFromConfig({
        apiBaseUrl,
        apiProxy,
      })
      if (!refreshResult.ok) {
        return {
          ok: false,
          message: refreshResult.message,
          cause: refreshResult.cause,
        }
      }
      apiToken = refreshResult.data.accessToken
      _defaultToken = apiToken
    }
  }

  // Usage of HttpProxyAgent vs. HttpsProxyAgent based on the chart at:
  // https://github.com/delvedor/hpagent?tab=readme-ov-file#usage
  const ProxyAgent = apiBaseUrl?.startsWith('http:')
    ? HttpProxyAgent
    : HttpsProxyAgent

  const timeout = ENV.SOCKET_CLI_API_TIMEOUT || undefined

  const sdkOptions = {
    ...(apiProxy ? { agent: new ProxyAgent({ proxy: apiProxy }) } : {}),
    ...(apiBaseUrl ? { baseUrl: apiBaseUrl } : {}),
    ...(timeout ? { timeout } : {}),
    // Add HTTP request hooks for telemetry and debugging.
    hooks: {
      onRequest: (info: RequestInfo) => {
        // Skip tracking for telemetry submission endpoints to prevent infinite loop.
        const isTelemetryEndpoint = info.url.includes('/telemetry')

        if (ENV.SOCKET_CLI_DEBUG) {
          // Debug logging.
          debugApiRequest(info.method, info.url, info.timeout)
        }
        if (!isTelemetryEndpoint) {
          // Track API request event.
          void trackCliEvent('api_request', process.argv, {
            method: info.method,
            timeout: info.timeout,
            url: info.url,
          })
        }
      },
      onResponse: (info: ResponseInfo) => {
        // Skip tracking for telemetry submission endpoints to prevent infinite loop.
        const isTelemetryEndpoint = info.url.includes('/telemetry')

        if (!isTelemetryEndpoint) {
          // Track API response event.
          const metadata = {
            duration: info.duration,
            method: info.method,
            status: info.status,
            statusText: info.statusText,
            url: info.url,
          }

          if (info.error) {
            // Track as error event if request failed.
            void trackCliEvent('api_error', process.argv, {
              ...metadata,
              error_message: info.error.message,
              error_type: info.error.constructor.name,
            })
          } else {
            // Track as successful response.
            void trackCliEvent('api_response', process.argv, metadata)
          }
        }

        if (ENV.SOCKET_CLI_DEBUG) {
          // Debug logging.
          debugApiResponse(info.url, info.status, info.error, {
            method: info.method,
            url: info.url,
            durationMs: info.duration,
            headers: info.headers,
          })
        }
      },
    },
    onFileValidation: (
      _validPaths: string[],
      invalidPaths: string[],
      _context: {
        operation:
          | 'createDependenciesSnapshot'
          | 'createFullScan'
          | 'uploadManifestFiles'
        orgSlug?: string | undefined
        [key: string]: unknown
      },
    ): FileValidationResult => {
      if (invalidPaths.length > 0) {
        logger.warn(
          `Skipped ${invalidPaths.length} ${pluralize('file', { count: invalidPaths.length })} that could not be read`,
        )
        logger.substep(
          'This may occur with Yarn Berry PnP virtual filesystem or pnpm symlinks',
        )
      }
      // Continue with valid files.
      return { shouldContinue: true }
    },
    userAgent: createUserAgentFromPkgJson({
      name: ENV.INLINED_SOCKET_CLI_NAME || 'socket',
      version: ENV.INLINED_SOCKET_CLI_VERSION || '0.0.0',
      homepage: ENV.INLINED_SOCKET_CLI_HOMEPAGE || 'https://socket.dev/cli',
    }),
  }

  if (ENV.SOCKET_CLI_DEBUG) {
    logger.info(
      `[DEBUG] ${new Date().toISOString()} SDK options: ${JSON.stringify(sdkOptions)}`,
    )
  }

  const sdk = new SocketSdk(apiToken, sdkOptions)

  return {
    ok: true,
    data: sdk,
  }
}
