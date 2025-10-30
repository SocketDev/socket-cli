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
import { logger } from '@socketsecurity/lib/logger'
import { password } from '@socketsecurity/lib/prompts'
import { isNonEmptyString } from '@socketsecurity/lib/strings'
import { isUrl } from '@socketsecurity/lib/url'
import { pluralize } from '@socketsecurity/lib/words'
import { createUserAgentFromPkgJson, SocketSdk } from '@socketsecurity/sdk'

import {
  CONFIG_KEY_API_BASE_URL,
  CONFIG_KEY_API_PROXY,
  CONFIG_KEY_API_TOKEN,
} from '../../constants/config.mts'
import ENV from '../../constants/env.mts'
import { TOKEN_PREFIX_LENGTH } from '../../constants/socket.mts'
import { getConfigValueOrUndef } from '../config.mts'

import type { CResult } from '../../types.mts'
import type { FileValidationResult } from '@socketsecurity/sdk'

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

  const timeout = ENV.SOCKET_CLI_API_TIMEOUT || undefined

  return {
    ok: true,
    data: new SocketSdk(apiToken, {
      ...(apiProxy ? { agent: new ProxyAgent({ proxy: apiProxy }) } : {}),
      ...(apiBaseUrl ? { baseUrl: apiBaseUrl } : {}),
      ...(timeout ? { timeout } : {}),
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
    }),
  }
}
