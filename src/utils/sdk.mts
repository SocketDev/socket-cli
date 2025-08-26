import { HttpProxyAgent, HttpsProxyAgent } from 'hpagent'

import isInteractive from '@socketregistry/is-interactive/index.cjs'
import { password } from '@socketsecurity/registry/lib/prompts'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'
import { SocketSdk, createUserAgentFromPkgJson } from '@socketsecurity/sdk'

import { getConfigValueOrUndef } from './config.mts'
import constants from '../constants.mts'

import type { CResult } from '../types.mts'

const TOKEN_PREFIX = 'sktsec_'

const TOKEN_PREFIX_LENGTH = TOKEN_PREFIX.length

const TOKEN_VISIBLE_LENGTH = 5

// The Socket API server that should be used for operations.
function getDefaultApiBaseUrl(): string | undefined {
  const baseUrl =
    // Lazily access constants.ENV.SOCKET_CLI_API_BASE_URL.
    constants.ENV.SOCKET_CLI_API_BASE_URL || getConfigValueOrUndef('apiBaseUrl')
  return isUrl(baseUrl) ? baseUrl : undefined
}

// The Socket API server that should be used for operations.
function getDefaultProxyUrl(): string | undefined {
  const apiProxy =
    // Lazily access constants.ENV.SOCKET_CLI_API_PROXY.
    constants.ENV.SOCKET_CLI_API_PROXY || getConfigValueOrUndef('apiProxy')
  return isUrl(apiProxy) ? apiProxy : undefined
}

function isUrl(value: any): value is string {
  if (isNonEmptyString(value)) {
    try {
      // eslint-disable-next-line no-new
      new URL(value)
      return true
    } catch {}
  }
  return false
}

// This Socket API token should be stored globally for the duration of the CLI execution.
let _defaultToken: string | undefined
export function getDefaultToken(): string | undefined {
  // Lazily access constants.ENV.SOCKET_CLI_NO_API_TOKEN.
  if (constants.ENV.SOCKET_CLI_NO_API_TOKEN) {
    _defaultToken = undefined
  } else {
    const key =
      // Lazily access constants.ENV.SOCKET_CLI_API_TOKEN.
      constants.ENV.SOCKET_CLI_API_TOKEN ||
      getConfigValueOrUndef('apiToken') ||
      _defaultToken
    _defaultToken = isNonEmptyString(key) ? key : undefined
  }
  return _defaultToken
}

export function getVisibleTokenPrefix(): string {
  const apiToken = getDefaultToken()
  return apiToken
    ? apiToken.slice(
        TOKEN_PREFIX_LENGTH,
        TOKEN_PREFIX_LENGTH + TOKEN_VISIBLE_LENGTH,
      )
    : ''
}

export function hasDefaultToken(): boolean {
  return !!getDefaultToken()
}

export function getPublicToken(): string {
  return (
    getDefaultToken() ||
    // Lazily access constants.ENV.SOCKET_CLI_API_TOKEN.
    constants.ENV.SOCKET_CLI_API_TOKEN ||
    // Lazily access constants.SOCKET_PUBLIC_API_TOKEN.
    constants.SOCKET_PUBLIC_API_TOKEN
  )
}

export type SetupSdkOptions = {
  apiToken?: string | undefined
  apiBaseUrl?: string | undefined
  apiProxy?: string | undefined
}

export async function setupSdk(
  options?: SetupSdkOptions | undefined,
): Promise<CResult<SocketSdk>> {
  const opts = { __proto__: null, ...options } as SetupSdkOptions
  let { apiToken = getDefaultToken() } = opts

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
  const ProxyAgent = apiProxy?.startsWith('http:')
    ? HttpProxyAgent
    : HttpsProxyAgent

  return {
    ok: true,
    data: new SocketSdk(apiToken, {
      agent: apiProxy ? new ProxyAgent({ proxy: apiProxy }) : undefined,
      baseUrl: apiBaseUrl,
      // Lazily access constants.ENV.SOCKET_CLI_API_TIMEOUT.
      timeout: constants.ENV.SOCKET_CLI_API_TIMEOUT,
      userAgent: createUserAgentFromPkgJson({
        // Lazily access constants.ENV.INLINED_SOCKET_CLI_NAME.
        name: constants.ENV.INLINED_SOCKET_CLI_NAME,
        // Lazily access constants.ENV.INLINED_SOCKET_CLI_VERSION.
        version: constants.ENV.INLINED_SOCKET_CLI_VERSION,
        // Lazily access constants.ENV.INLINED_SOCKET_CLI_HOMEPAGE.
        homepage: constants.ENV.INLINED_SOCKET_CLI_HOMEPAGE,
      }),
    }),
  }
}
