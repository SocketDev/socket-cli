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
import {
  SocketSdk,
  createGetRequest,
  createUserAgentFromPkgJson,
  getResponseJson,
  isResponseOk,
} from '@socketsecurity/sdk'

import { getConfigValueOrUndef } from './config.mts'
import constants, {
  CONFIG_KEY_API_BASE_URL,
  CONFIG_KEY_API_PROXY,
  CONFIG_KEY_API_TOKEN,
  TOKEN_PREFIX_LENGTH,
} from '../constants.mts'

import type { CResult } from '../types.mts'
import type { IncomingMessage } from 'node:http'

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

  return {
    ok: true,
    data: new SocketSdk(apiToken, {
      ...(apiProxy ? { agent: new ProxyAgent({ proxy: apiProxy }) } : {}),
      ...(apiBaseUrl ? { baseUrl: apiBaseUrl } : {}),
      timeout: constants.ENV.SOCKET_CLI_API_TIMEOUT,
      userAgent: createUserAgentFromPkgJson({
        name: constants.ENV.INLINED_SOCKET_CLI_NAME,
        version: constants.ENV.INLINED_SOCKET_CLI_VERSION,
        homepage: constants.ENV.INLINED_SOCKET_CLI_HOMEPAGE,
      }),
    }),
  }
}

/**
 * Query Socket API endpoint and parse JSON response.
 * Helper function to replicate SDK's removed queryApiJson method.
 */
export async function queryApiJson<T = unknown>(
  sdk: SocketSdk,
  path: string,
  options?: { throws?: boolean; description?: string } | undefined,
): Promise<CResult<T>> {
  const opts = { __proto__: null, throws: true, ...options }
  try {
    // Access SDK's private baseUrl and reqOptions through a workaround.
    // The SDK stores these as private fields, so we need to construct the request manually.
    const baseUrl = getDefaultApiBaseUrl() || 'https://api.socket.dev/v0/'
    const apiToken = getDefaultApiToken() || constants.SOCKET_PUBLIC_API_TOKEN

    const response = await createGetRequest(baseUrl, path, {
      headers: {
        Authorization: `Basic ${btoa(`${apiToken}:`)}`,
        'User-Agent': createUserAgentFromPkgJson({
          name: constants.ENV.INLINED_SOCKET_CLI_NAME,
          version: constants.ENV.INLINED_SOCKET_CLI_VERSION,
          homepage: constants.ENV.INLINED_SOCKET_CLI_HOMEPAGE,
        }),
      },
      timeout: constants.ENV.SOCKET_CLI_API_TIMEOUT,
    })

    if (!isResponseOk(response)) {
      const statusCode = response.statusCode
      const message = `Failed to fetch ${opts.description || 'data'}: ${statusCode}`
      if (opts.throws) {
        throw new Error(message)
      }
      return { ok: false, message }
    }

    const data = (await getResponseJson(response)) as T
    return { ok: true, data }
  } catch (e) {
    const message = `Error fetching ${opts.description || 'data'}: ${e instanceof Error ? e.message : String(e)}`
    if (opts.throws) {
      throw new Error(message, { cause: e })
    }
    return { ok: false, message }
  }
}

/**
 * Query Socket API endpoint and return text response.
 * Helper function to replicate SDK's removed queryApiText method.
 */
export async function queryApiText(
  sdk: SocketSdk,
  path: string,
  options?: { throws?: boolean; description?: string } | undefined,
): Promise<CResult<string>> {
  const opts = { __proto__: null, throws: true, ...options }
  try {
    const baseUrl = getDefaultApiBaseUrl() || 'https://api.socket.dev/v0/'
    const apiToken = getDefaultApiToken() || constants.SOCKET_PUBLIC_API_TOKEN

    const response = await createGetRequest(baseUrl, path, {
      headers: {
        Authorization: `Basic ${btoa(`${apiToken}:`)}`,
        'User-Agent': createUserAgentFromPkgJson({
          name: constants.ENV.INLINED_SOCKET_CLI_NAME,
          version: constants.ENV.INLINED_SOCKET_CLI_VERSION,
          homepage: constants.ENV.INLINED_SOCKET_CLI_HOMEPAGE,
        }),
      },
      timeout: constants.ENV.SOCKET_CLI_API_TIMEOUT,
    })

    if (!isResponseOk(response)) {
      const statusCode = response.statusCode
      const message = `Failed to fetch ${opts.description || 'data'}: ${statusCode}`
      if (opts.throws) {
        throw new Error(message)
      }
      return { ok: false, message }
    }

    // Read response as text.
    const chunks: Buffer[] = []
    for await (const chunk of response as unknown as AsyncIterable<Buffer>) {
      chunks.push(chunk)
    }
    const data = Buffer.concat(chunks).toString('utf8')
    return { ok: true, data }
  } catch (e) {
    const message = `Error fetching ${opts.description || 'data'}: ${e instanceof Error ? e.message : String(e)}`
    if (opts.throws) {
      throw new Error(message, { cause: e })
    }
    return { ok: false, message }
  }
}
