import { HttpsProxyAgent } from 'hpagent'

import isInteractive from '@socketregistry/is-interactive/index.cjs'
import { password } from '@socketsecurity/registry/lib/prompts'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'
import { SocketSdk, createUserAgentFromPkgJson } from '@socketsecurity/sdk'

import { getConfigValueOrUndef } from './config.mts'
import { AuthError } from './errors.mts'
import constants from '../constants.mts'

const { SOCKET_PUBLIC_API_TOKEN } = constants

// The API server that should be used for operations.
function getDefaultApiBaseUrl(): string | undefined {
  const baseUrl =
    // Lazily access constants.ENV.SOCKET_SECURITY_API_BASE_URL.
    constants.ENV.SOCKET_SECURITY_API_BASE_URL ||
    getConfigValueOrUndef('apiBaseUrl')
  return isNonEmptyString(baseUrl) ? baseUrl : undefined
}

// The API server that should be used for operations.
function getDefaultHttpProxy(): string | undefined {
  const apiProxy =
    // Lazily access constants.ENV.SOCKET_SECURITY_API_PROXY.
    constants.ENV.SOCKET_SECURITY_API_PROXY || getConfigValueOrUndef('apiProxy')
  return isNonEmptyString(apiProxy) ? apiProxy : undefined
}

// This API key should be stored globally for the duration of the CLI execution.
let _defaultToken: string | undefined
export function getDefaultToken(): string | undefined {
  // Lazily access constants.ENV.SOCKET_CLI_NO_API_TOKEN.
  if (constants.ENV.SOCKET_CLI_NO_API_TOKEN) {
    _defaultToken = undefined
  } else {
    const key =
      // Lazily access constants.ENV.SOCKET_SECURITY_API_TOKEN.
      constants.ENV.SOCKET_SECURITY_API_TOKEN ||
      getConfigValueOrUndef('apiToken') ||
      _defaultToken
    _defaultToken = isNonEmptyString(key) ? key : undefined
  }
  return _defaultToken
}

export function getVisibleTokenPrefix(): string {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    return ''
  }

  const PREFIX = 'sktsec_'
  return apiToken.slice(PREFIX.length, PREFIX.length + 5)
}

export function hasDefaultToken(): boolean {
  return !!getDefaultToken()
}

export function getPublicToken(): string {
  return (
    // Lazily access constants.ENV.SOCKET_SECURITY_API_TOKEN.
    (constants.ENV.SOCKET_SECURITY_API_TOKEN || getDefaultToken()) ??
    SOCKET_PUBLIC_API_TOKEN
  )
}

export async function setupSdk(
  apiToken: string | undefined = getDefaultToken(),
  apiBaseUrl: string | undefined = getDefaultApiBaseUrl(),
  proxy: string | undefined = getDefaultHttpProxy()
): Promise<SocketSdk> {
  if (typeof apiToken !== 'string' && isInteractive()) {
    apiToken = await password({
      message:
        'Enter your Socket.dev API key (not saved, use socket login to persist)'
    })
    _defaultToken = apiToken
  }
  if (!apiToken) {
    // TODO: eliminate this throw in favor of CResult (or anything else)
    throw new AuthError('You need to provide an API key')
  }
  return new SocketSdk(apiToken, {
    agent: proxy ? new HttpsProxyAgent({ proxy }) : undefined,
    baseUrl: apiBaseUrl,
    userAgent: createUserAgentFromPkgJson({
      // Lazily access constants.ENV.INLINED_SOCKET_CLI_NAME.
      name: constants.ENV.INLINED_SOCKET_CLI_NAME,
      // Lazily access constants.ENV.INLINED_SOCKET_CLI_VERSION.
      version: constants.ENV.INLINED_SOCKET_CLI_VERSION,
      // Lazily access constants.ENV.INLINED_SOCKET_CLI_HOMEPAGE.
      homepage: constants.ENV.INLINED_SOCKET_CLI_HOMEPAGE
    })
  })
}
