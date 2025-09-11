import { HttpProxyAgent, HttpsProxyAgent } from 'hpagent'

import isInteractive from '@socketregistry/is-interactive/index.cjs'
import { password } from '@socketsecurity/registry/lib/prompts'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'
import { isUrl } from '@socketsecurity/registry/lib/url'
import { SocketSdk, createUserAgentFromPkgJson } from '@socketsecurity/sdk'

import { getConfigValueOrUndef } from './config.mts'
import constants from '../constants.mts'

import type { CResult } from '../types.mts'

const TOKEN_PREFIX = 'sktsec_'

const TOKEN_PREFIX_LENGTH = TOKEN_PREFIX.length

const TOKEN_VISIBLE_LENGTH = 5

// The Socket API server that should be used for operations.
export function getDefaultApiBaseUrl(): string | undefined {
  const baseUrl =
    constants.ENV.SOCKET_CLI_API_BASE_URL || getConfigValueOrUndef('apiBaseUrl')
  return isUrl(baseUrl) ? baseUrl : undefined
}

// The Socket API server that should be used for operations.
export function getDefaultProxyUrl(): string | undefined {
  const apiProxy =
    constants.ENV.SOCKET_CLI_API_PROXY || getConfigValueOrUndef('apiProxy')
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
    getConfigValueOrUndef('apiToken') ||
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
      agent: apiProxy ? new ProxyAgent({ proxy: apiProxy }) : undefined,
      baseUrl: apiBaseUrl,
      timeout: constants.ENV.SOCKET_CLI_API_TIMEOUT,
      userAgent: createUserAgentFromPkgJson({
        name: constants.ENV.INLINED_SOCKET_CLI_NAME,
        version: constants.ENV.INLINED_SOCKET_CLI_VERSION,
        homepage: constants.ENV.INLINED_SOCKET_CLI_HOMEPAGE,
      }),
    }),
  }
}
