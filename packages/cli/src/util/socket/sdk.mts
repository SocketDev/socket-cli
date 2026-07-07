/**
 * Socket SDK utilities for Socket CLI. Manages SDK initialization and
 * configuration for API communication.
 *
 * Authentication:
 *
 * - Interactive password prompt for missing tokens
 * - Supports environment variable (SOCKET_CLI_API_TOKEN)
 * - Validates token format and presence
 *
 * Proxy Support:
 *
 * - Automatic proxy agent selection
 * - HTTP/HTTPS proxy configuration
 * - Respects SOCKET_CLI_API_PROXY environment variable
 *
 * SDK Setup:
 *
 * - CreateSocketSdk: Create configured SDK instance
 * - GetDefaultApiToken: Retrieve API token from config/env
 * - GetDefaultProxyUrl: Retrieve proxy URL from config/env
 * - GetPublicApiToken: Get public API token constant
 * - SetupSdk: Initialize Socket SDK with authentication
 *
 * User Agent:
 *
 * - Automatic user agent generation from package.json
 * - Includes CLI version and platform information
 */

import { readFileSync } from 'node:fs'
import { Agent as HttpsAgent } from 'node:https'
import { rootCertificates } from 'node:tls'

import { HttpProxyAgent, HttpsProxyAgent } from 'hpagent'

import { debug as debugLib } from '@socketsecurity/lib-stable/debug/output'
import isInteractive from '@socketregistry/is-interactive/index.cjs'
import { getSocketApiToken } from '@socketsecurity/lib-stable/env/socket'
import {
  getSocketCliApiBaseUrl,
  getSocketCliApiProxy,
  getSocketCliApiTimeout,
  getSocketCliNoApiToken,
} from '@socketsecurity/lib-stable/env/socket-cli'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { password } from '@socketsecurity/lib-stable/stdio/prompts'
import { isNonEmptyString } from '@socketsecurity/lib-stable/strings/predicates'
import { isUrl } from '@socketsecurity/lib-stable/url/predicates'
import { pluralize } from '@socketsecurity/lib-stable/words/pluralize'
import {
  createUserAgentFromPkgJson,
  SocketSdk,
} from '@socketsecurity/sdk-stable'

import {
  CONFIG_KEY_API_BASE_URL,
  CONFIG_KEY_API_PROXY,
  CONFIG_KEY_API_TOKEN,
} from '../../constants/config.mts'
import { getCliHomepage } from '../../env/cli-homepage.mts'
import { getCliName } from '../../env/cli-name.mts'
import { getCliVersion } from '../../env/cli-version.mts'
import { SOCKET_CLI_DEBUG } from '../../env/socket-cli-debug.mts'
import { TOKEN_PREFIX_LENGTH } from '../../constants/socket.mts'
import { getConfigValueOrUndef } from '../config.mts'
import { debugApiRequest, debugApiResponse } from '../debug.mts'
import { trackCliEvent } from '../telemetry/integration.mts'

import type { CResult } from '../../types.mts'
import type {
  FileValidationResult,
  RequestInfo,
  ResponseInfo,
} from '@socketsecurity/sdk-stable'
const logger = getDefaultLogger()

const TOKEN_VISIBLE_LENGTH = 5

// Cached extra CA certificates for SSL_CERT_FILE support.
let extraCaCerts: string[] | undefined

let extraCaCertsResolved = false

// This Socket API token should be stored globally for the duration of the CLI execution.
let defaultToken: string | undefined

// The Socket API server that should be used for operations.
export function getDefaultApiBaseUrl(): string | undefined {
  const baseUrl =
    getSocketCliApiBaseUrl() ||
    getConfigValueOrUndef(CONFIG_KEY_API_BASE_URL) ||
    undefined
  return isUrl(baseUrl) ? baseUrl : undefined
}

export function getDefaultApiToken(): string | undefined {
  if (getSocketCliNoApiToken()) {
    defaultToken = undefined
    return defaultToken
  }

  const key =
    getSocketApiToken() ||
    getConfigValueOrUndef(CONFIG_KEY_API_TOKEN) ||
    defaultToken

  defaultToken = isNonEmptyString(key) ? key : undefined
  return defaultToken
}

// The Socket API server that should be used for operations.
export function getDefaultProxyUrl(): string | undefined {
  const apiProxy =
    getSocketCliApiProxy() ||
    getConfigValueOrUndef(CONFIG_KEY_API_PROXY) ||
    undefined
  return isUrl(apiProxy) ? apiProxy : undefined
}

// Returns combined root and extra CA certificates when SSL_CERT_FILE is set
// but NODE_EXTRA_CA_CERTS is not. Node.js loads NODE_EXTRA_CA_CERTS at process
// startup, so setting SSL_CERT_FILE alone does not affect the current process.
// This function reads the certificate file manually and combines it with the
// default root certificates for use in HTTPS agents.
export function getExtraCaCerts(): string[] | undefined {
  if (extraCaCertsResolved) {
    return extraCaCerts
  }
  extraCaCertsResolved = true
  // Node.js already loaded extra CA certs at startup.
  if (process.env['NODE_EXTRA_CA_CERTS']) {
    return undefined
  }
  const certPath = process.env['SSL_CERT_FILE']
  if (!certPath) {
    return undefined
  }
  /* c8 ignore start - SSL_CERT_FILE is not set in tests; this entire CA-cert loader is unreachable */
  try {
    const extraCerts = readFileSync(certPath, 'utf-8')
    // Combine default root certificates with extra certificates. Specifying ca
    // in an agent replaces the default trust store, so both must be included.
    extraCaCerts = [...rootCertificates, extraCerts]
    return extraCaCerts
  } catch (e) {
    debugLib(`Failed to read certificate file: ${certPath}`)
    return undefined
  }
  /* c8 ignore stop */
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

export function invalidateDefaultApiToken(): void {
  defaultToken = undefined
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

  /* c8 ignore start - interactive password prompt only fires in TTY mode; tests are non-interactive */
  if (typeof apiToken !== 'string' && isInteractive()) {
    apiToken = await password({
      message:
        'Enter your Socket.dev API token (not saved, use socket login to persist)',
    })
    defaultToken = apiToken
  }
  /* c8 ignore stop */

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

  const timeout = getSocketCliApiTimeout() || undefined

  // Load extra CA certificates for SSL_CERT_FILE support when
  // NODE_EXTRA_CA_CERTS was not set at process startup.
  const ca = getExtraCaCerts()

  const sdkOptions = {
    ...(apiProxy
      ? {
          agent: new ProxyAgent({
            proxy: apiProxy,
            ...(ca ? { ca, proxyConnectOptions: { ca } } : {}),
          }),
        }
      : ca
        ? { agent: new HttpsAgent({ ca }) }
        : {}),
    ...(apiBaseUrl ? { baseUrl: apiBaseUrl } : {}),
    ...(timeout ? { timeout } : {}),
    // Add HTTP request hooks for telemetry and debugging.
    hooks: {
      onRequest: (info: RequestInfo) => {
        // Skip tracking for telemetry submission endpoints to prevent infinite loop.
        const isTelemetryEndpoint = info.url.includes('/telemetry')

        /* c8 ignore start - SOCKET_CLI_DEBUG not set in tests */
        if (SOCKET_CLI_DEBUG) {
          debugApiRequest(info.method, info.url, info.timeout)
        }
        /* c8 ignore stop */
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

        /* c8 ignore start - SOCKET_CLI_DEBUG not set in tests */
        if (SOCKET_CLI_DEBUG) {
          debugApiResponse(info.url, info.status, info.error, {
            method: info.method,
            url: info.url,
            durationMs: info.duration,
            headers: info.headers,
          })
        }
        /* c8 ignore stop */
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
      name: getCliName(),
      version: getCliVersion(),
      homepage: getCliHomepage(),
    }),
  }

  /* c8 ignore start - SOCKET_CLI_DEBUG not set in tests */
  if (SOCKET_CLI_DEBUG) {
    logger.info(
      `[DEBUG] ${new Date().toISOString()} SDK options: ${JSON.stringify(sdkOptions)}`,
    )
  }
  /* c8 ignore stop */

  const sdk = new SocketSdk(apiToken, sdkOptions)

  return {
    ok: true,
    data: sdk,
  }
}
