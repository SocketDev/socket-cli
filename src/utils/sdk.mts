import { HttpProxyAgent, HttpsProxyAgent } from 'hpagent'

import isInteractive from '@socketregistry/is-interactive/index.cjs'
import { password } from '@socketsecurity/registry/lib/prompts'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'
import { SocketSdk, createUserAgentFromPkgJson } from '@socketsecurity/sdk'

import { getConfigValueOrUndef } from './config.mts'
import constants from '../constants.mts'

import type { CResult } from '../types.mts'

const TOKEN_PREFIX = 'sktsec_'

const { length: TOKEN_PREFIX_LENGTH } = TOKEN_PREFIX

// The API server that should be used for operations.
function getDefaultApiBaseUrl(): string | undefined {
  const baseUrl =
    // Lazily access constants.ENV.SOCKET_CLI_API_BASE_URL.
    constants.ENV.SOCKET_CLI_API_BASE_URL || getConfigValueOrUndef('apiBaseUrl')
  return isUrl(baseUrl) ? baseUrl : undefined
}

// The API server that should be used for operations.
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

// This API key should be stored globally for the duration of the CLI execution.
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
    ? apiToken.slice(TOKEN_PREFIX_LENGTH, TOKEN_PREFIX_LENGTH + 5)
    : ''
}

export function hasDefaultToken(): boolean {
  return !!getDefaultToken()
}

export function getPublicToken(): string {
  return (
    // Lazily access constants.ENV.SOCKET_CLI_API_TOKEN.
    (constants.ENV.SOCKET_CLI_API_TOKEN || getDefaultToken()) ??
    // Lazily access constants.SOCKET_PUBLIC_API_TOKEN.
    constants.SOCKET_PUBLIC_API_TOKEN
  )
}

export async function setupSdk(
  apiToken: string | undefined = getDefaultToken(),
  apiBaseUrl: string | undefined = getDefaultApiBaseUrl(),
  proxy: string | undefined,
): Promise<CResult<SocketSdk>> {
  if (typeof apiToken !== 'string' && isInteractive()) {
    apiToken = await password({
      message:
        'Enter your Socket.dev API key (not saved, use socket login to persist)',
    })
    _defaultToken = apiToken
  }
  if (!apiToken) {
    return {
      ok: false,
      message: 'Auth Error',
      cause: 'You need to provide an API Token. Run `socket login` first.',
    }
  }
  if (!isUrl(proxy)) {
    proxy = getDefaultProxyUrl()
  }

  const ProxyAgent = proxy?.startsWith('http:')
    ? HttpProxyAgent
    : HttpsProxyAgent

  return {
    ok: true,
    data: new SocketSdk(apiToken, {
      agent: proxy
        ? new ProxyAgent({
            proxy,
          })
        : undefined,
      baseUrl: apiBaseUrl,
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
