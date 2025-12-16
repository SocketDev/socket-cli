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
import { logger } from '@socketsecurity/registry/lib/logger'
import { password } from '@socketsecurity/registry/lib/prompts'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'
import { isUrl } from '@socketsecurity/registry/lib/url'
import { SocketSdk, createUserAgentFromPkgJson } from '@socketsecurity/sdk'

import { getConfigValueOrUndef } from './config.mts'
import { debugApiRequest, debugApiResponse } from './debug.mts'
import constants, {
  CONFIG_KEY_API_BASE_URL,
  CONFIG_KEY_API_PROXY,
  CONFIG_KEY_API_TOKEN,
} from '../constants.mts'
import { trackCliEvent } from './telemetry/integration.mts'

import type { CResult } from '../types.mts'
import type { RequestInfo, ResponseInfo } from '@socketsecurity/sdk'

const TOKEN_PREFIX = 'sktsec_'
const TOKEN_PREFIX_LENGTH = TOKEN_PREFIX.length
const TOKEN_VISIBLE_LENGTH = 5

// The Socket API server that should be used for operations.
export function getDefaultApiBaseUrl(): string | undefined {
  const baseUrl =
    constants.ENV.SOCKET_CLI_API_BASE_URL ||
    getConfigValueOrUndef(CONFIG_KEY_API_BASE_URL)
  return isUrl(baseUrl) ? baseUrl : undefined
}

// The Socket API server that should be used for operations.
export function getDefaultProxyUrl(): string | undefined {
  const apiProxy =
    constants.ENV.SOCKET_CLI_API_PROXY ||
    getConfigValueOrUndef(CONFIG_KEY_API_PROXY)
  return isUrl(apiProxy) ? apiProxy : undefined
}

// This Socket API token should be stored globally for the duration of the CLI execution.
let _defaultToken: string | undefined

export function getDefaultApiToken(): string | undefined {
  if (constants.ENV.SOCKET_CLI_NO_API_TOKEN) {
    _defaultToken = undefined
    return _defaultToken
  }

  const key =
    constants.ENV.SOCKET_CLI_API_TOKEN ||
    getConfigValueOrUndef(CONFIG_KEY_API_TOKEN) ||
    _defaultToken

  _defaultToken = isNonEmptyString(key) ? key : undefined
  return _defaultToken
}

export function getPublicApiToken(): string {
  return (
    getDefaultApiToken() ||
    constants.ENV.SOCKET_CLI_API_TOKEN ||
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

  // Usage of HttpProxyAgent vs. HttpsProxyAgent based on the chart at:
  // https://github.com/delvedor/hpagent?tab=readme-ov-file#usage
  const ProxyAgent = apiBaseUrl?.startsWith('http:')
    ? HttpProxyAgent
    : HttpsProxyAgent

  const sdkOptions = {
    ...(apiProxy ? { agent: new ProxyAgent({ proxy: apiProxy }) } : {}),
    ...(apiBaseUrl ? { baseUrl: apiBaseUrl } : {}),
    timeout: constants.ENV.SOCKET_CLI_API_TIMEOUT,
    userAgent: createUserAgentFromPkgJson({
      name: constants.ENV.INLINED_SOCKET_CLI_NAME,
      version: constants.ENV.INLINED_SOCKET_CLI_VERSION,
      homepage: constants.ENV.INLINED_SOCKET_CLI_HOMEPAGE,
    }),
    // Add HTTP request hooks for telemetry and debugging.
    hooks: {
      onRequest: (info: RequestInfo) => {
        // Skip tracking for telemetry submission endpoints to prevent infinite loop.
        const isTelemetryEndpoint = info.url.includes('/telemetry')

        if (constants.ENV.SOCKET_CLI_DEBUG) {
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

        if (constants.ENV.SOCKET_CLI_DEBUG) {
          // Debug logging.
          debugApiResponse(
            info.method,
            info.url,
            info.status,
            info.error,
            info.duration,
            info.headers,
          )
        }
      },
    },
  }

  if (constants.ENV.SOCKET_CLI_DEBUG) {
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
