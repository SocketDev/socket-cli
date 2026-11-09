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

import { Agent as HttpAgent } from 'node:http'
import { Agent as HttpsAgent } from 'node:https'

import { HttpProxyAgent, HttpsProxyAgent } from 'hpagent'

import { logger } from '@socketsecurity/registry/lib/logger'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'
import { isUrl } from '@socketsecurity/registry/lib/url'
import { SocketSdk, createUserAgentFromPkgJson } from '@socketsecurity/sdk'

import { getExtraCaCerts } from './api-transport.mts'
import { getConfigValueOrUndef, isConfigFromFlag } from './config.mts'
import { debugApiRequest, debugApiResponse } from './debug.mts'
import {
  readOAuthCredentials,
  resolveOAuthAccessToken,
} from './oauth.mts'
import constants, {
  CONFIG_KEY_API_BASE_URL,
  CONFIG_KEY_API_PROXY,
  CONFIG_KEY_API_TOKEN,
  CONFIG_KEY_AUTH_TYPE,
} from '../constants.mts'
import { trackCliEvent } from './telemetry/integration.mts'

import type { CResult } from '../types.mts'
import type { RequestInfo, ResponseInfo } from '@socketsecurity/sdk'

// SDK v4 rejects request timeouts outside this range (see the SDK's
// MIN_HTTP_TIMEOUT / MAX_HTTP_TIMEOUT). The SDK does not re-export those
// constants, so the bounds are mirrored here.
const MIN_API_TIMEOUT_MS = 5_000
const MAX_API_TIMEOUT_MS = 300_000

// Clamp a SOCKET_CLI_API_TIMEOUT value into the SDK's accepted range. The SDK
// throws a TypeError on out-of-range timeouts, so an out-of-range user value
// would otherwise make every API call fail; clamping preserves intent (a small
// value maps to the floor, a huge value to the ceiling) while staying valid.
export function clampApiTimeout(timeout: number): number {
  return Math.min(Math.max(timeout, MIN_API_TIMEOUT_MS), MAX_API_TIMEOUT_MS)
}

// Lazy-evaluated full CLI user agent for direct (non-SDK) API calls.
// Includes the CLI product token, Node.js version, and OS platform/arch.
// e.g. "socket/1.1.96 node/v22.0.0 linux/arm64"
let _cliUserAgent: string | undefined
export function getCliUserAgent(): string {
  if (!_cliUserAgent) {
    const name = constants.ENV.INLINED_SOCKET_CLI_NAME.replace('@', '').replace(
      '/',
      '-',
    )
    const version = constants.ENV.INLINED_SOCKET_CLI_VERSION
    _cliUserAgent = [
      `${name}/${version}`,
      `node/${process.version}`,
      `${process.platform}/${process.arch}`,
    ].join(' ')
  }
  return _cliUserAgent
}

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

export { getExtraCaCerts }

export function getDefaultApiToken(): string | undefined {
  if (constants.ENV.SOCKET_CLI_NO_API_TOKEN) {
    return undefined
  }

  const environmentToken = constants.ENV.SOCKET_CLI_API_TOKEN
  if (isNonEmptyString(environmentToken)) {
    return environmentToken
  }
  if (getConfigValueOrUndef(CONFIG_KEY_AUTH_TYPE) === 'oauth') {
    return undefined
  }
  const key = getConfigValueOrUndef(CONFIG_KEY_API_TOKEN)

  return isNonEmptyString(key) ? key : undefined
}

export function getPublicApiToken(): string {
  if (
    !isConfigFromFlag() &&
    !constants.ENV.SOCKET_CLI_NO_API_TOKEN &&
    !constants.ENV.SOCKET_CLI_API_TOKEN &&
    getConfigValueOrUndef(CONFIG_KEY_AUTH_TYPE) === 'oauth'
  ) {
    throw new Error(
      'OAuth credentials must be resolved asynchronously before launching a Socket helper.',
    )
  }
  return (
    getDefaultApiToken() ||
    constants.SOCKET_PUBLIC_API_TOKEN
  )
}

export async function resolvePublicApiToken(options?: {
  apiBaseUrl?: string | undefined
  apiProxy?: string | undefined
  signal?: AbortSignal | undefined
}): Promise<string> {
  const token = await resolveDefaultApiToken(options)
  if (token) {
    return token
  }
  if (
    !constants.ENV.SOCKET_CLI_NO_API_TOKEN &&
    getConfigValueOrUndef(CONFIG_KEY_AUTH_TYPE) === 'oauth'
  ) {
    throw new Error(
      'Browser sign-in has no usable access token. Run `socket login` to sign in again.',
    )
  }
  return constants.SOCKET_PUBLIC_API_TOKEN
}

export function getVisibleTokenPrefix(): string {
  if (
    !constants.ENV.SOCKET_CLI_NO_API_TOKEN &&
    getConfigValueOrUndef(CONFIG_KEY_AUTH_TYPE) === 'oauth' &&
    !constants.ENV.SOCKET_CLI_API_TOKEN
  ) {
    return 'oauth'
  }
  const apiToken = getDefaultApiToken()
  return apiToken
    ? apiToken.slice(
        TOKEN_PREFIX_LENGTH,
        TOKEN_PREFIX_LENGTH + TOKEN_VISIBLE_LENGTH,
      )
    : ''
}

export function hasDefaultApiToken(): boolean {
  if (getDefaultApiToken()) {
    return true
  }
  const directory = constants.socketAppDataPath
  return Boolean(
    !isConfigFromFlag() &&
      !constants.ENV.SOCKET_CLI_NO_API_TOKEN &&
      !constants.ENV.SOCKET_CLI_API_TOKEN &&
      getConfigValueOrUndef(CONFIG_KEY_AUTH_TYPE) === 'oauth' &&
      directory && hasOAuthCredentialFile(directory),
  )
}

function hasOAuthCredentialFile(directory: string): boolean {
  try {
    return Boolean(readOAuthCredentials(directory))
  } catch {
    // Keep preflight from crashing; async token resolution reports a useful
    // error and must not fall back to another credential.
    return true
  }
}

export async function resolveDefaultApiToken(options?: {
  apiBaseUrl?: string | undefined
  apiProxy?: string | undefined
  signal?: AbortSignal | undefined
}): Promise<string | undefined> {
  if (constants.ENV.SOCKET_CLI_NO_API_TOKEN) {
    return undefined
  }
  const environmentToken = constants.ENV.SOCKET_CLI_API_TOKEN
  if (isNonEmptyString(environmentToken)) {
    return environmentToken
  }
  if (getConfigValueOrUndef(CONFIG_KEY_AUTH_TYPE) !== 'oauth') {
    const configured = getConfigValueOrUndef(CONFIG_KEY_API_TOKEN)
    return isNonEmptyString(configured) ? configured : undefined
  }

  // Explicit config is read-only and must never consult persisted OAuth state.
  if (isConfigFromFlag()) {
    return undefined
  }

  const directory = constants.socketAppDataPath
  if (!directory) {
    throw new Error(
      'OAuth credentials are unavailable in this environment. Run `socket login` in a supported user session.',
    )
  }
  const credentials = readOAuthCredentials(directory)
  if (!credentials) {
    throw new Error(
      'Browser sign-in is selected but its credentials are missing or invalid. Run `socket login` to sign in again.',
    )
  }
  const apiBaseUrl = options?.apiBaseUrl ?? getDefaultApiBaseUrl()
  if (apiBaseUrl) {
    let origin: string
    try {
      origin = new URL(apiBaseUrl).origin
    } catch {
      throw new Error('The configured Socket API URL is invalid for OAuth.')
    }
    if (origin !== credentials.apiOrigin) {
      throw new Error(
        'Browser sign-in can only be used with Socket’s trusted API origin. Use `socket login --api-token` for a custom API URL.',
      )
    }
  }
  return await resolveOAuthAccessToken(directory, {
    apiProxy: options?.apiProxy ?? getDefaultProxyUrl(),
    signal: options?.signal,
  })
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
  const apiToken =
    opts.apiToken ??
    (await resolveDefaultApiToken({
      apiBaseUrl: opts.apiBaseUrl,
      apiProxy: opts.apiProxy,
    }))

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
  const isHttp = apiBaseUrl?.startsWith('http:')
  const ProxyAgent = isHttp ? HttpProxyAgent : HttpsProxyAgent

  // Load extra CA certificates for SSL_CERT_FILE support when
  // NODE_EXTRA_CA_CERTS was not set at process startup.
  const ca = getExtraCaCerts()

  // Always pass an explicit agent. Node >=19's global agent enables keepAlive
  // with a 5s socket timeout that Node applies as a per-socket inactivity
  // timeout. A request made without an explicit agent inherits it and is torn
  // down after 5s of socket inactivity, even when SOCKET_CLI_API_TIMEOUT is
  // unset. This breaks slow endpoints like upload-manifest-files, which streams
  // a chunked multipart body while the server parses auth/multipart before
  // sending any response byte. A fresh Agent carries no timeout, so a request
  // is bounded only by a real SOCKET_CLI_API_TIMEOUT (applied below via the
  // SDK's timeout option) or until interrupted.
  const sdkOptions = {
    agent: apiProxy
      ? new ProxyAgent({
          proxy: apiProxy,
          ...(ca ? { ca, proxyConnectOptions: { ca } } : {}),
        })
      : isHttp
        ? new HttpAgent()
        : new HttpsAgent(ca ? { ca } : undefined),
    ...(apiBaseUrl ? { baseUrl: apiBaseUrl } : {}),
    // SDK v4 validates the request timeout to be within [5000, 300000] ms and
    // throws otherwise. Only forward a truthy timeout; when unset (0) omit it
    // so the SDK applies its own default instead of rejecting the value. A
    // truthy-but-out-of-range value is clamped into the accepted range rather
    // than forwarded, which would make every SDK call throw.
    ...(constants.ENV.SOCKET_CLI_API_TIMEOUT
      ? { timeout: clampApiTimeout(constants.ENV.SOCKET_CLI_API_TIMEOUT) }
      : {}),
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
