import { HttpProxyAgent, HttpsProxyAgent } from 'hpagent'
import isInteractive from 'is-interactive'

import { password } from '@socketsecurity/registry/lib/prompts'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'
import { SocketSdk, createUserAgentFromPkgJson } from '@socketsecurity/sdk'

import { AuthError } from './errors'
import { getSetting } from './settings'
import constants from '../constants'

import type { SocketSdkOptions } from '@socketsecurity/sdk'

const { rootPkgJsonPath } = constants

// This API key should be stored globally for the duration of the CLI execution.
let defaultKey: string | undefined

export function getDefaultKey(): string | undefined {
  const key =
    process.env['SOCKET_SECURITY_API_KEY'] || getSetting('apiKey') || defaultKey
  defaultKey = isNonEmptyString(key) ? key : undefined
  return defaultKey
}

// The API server that should be used for operations.
function getDefaultAPIBaseUrl(): string | undefined {
  const baseUrl =
    process.env['SOCKET_SECURITY_API_BASE_URL'] || getSetting('apiBaseUrl')
  return isNonEmptyString(baseUrl) ? baseUrl : undefined
}

// The API server that should be used for operations.
function getDefaultHTTPProxy(): string | undefined {
  const apiProxy =
    process.env['SOCKET_SECURITY_API_PROXY'] || getSetting('apiProxy')
  return isNonEmptyString(apiProxy) ? apiProxy : undefined
}

export async function setupSdk(
  apiKey: string | undefined = getDefaultKey(),
  apiBaseUrl: string | undefined = getDefaultAPIBaseUrl(),
  proxy: string | undefined = getDefaultHTTPProxy()
): Promise<SocketSdk> {
  if (typeof apiKey !== 'string' && isInteractive()) {
    apiKey = await password({
      message:
        'Enter your Socket.dev API key (not saved, use socket login to persist)'
    })
    defaultKey = apiKey
  }

  if (!apiKey) {
    throw new AuthError('You need to provide an API key')
  }

  let agent: SocketSdkOptions['agent'] | undefined
  if (proxy) {
    agent = {
      http: new HttpProxyAgent({ proxy }),
      https: new HttpsProxyAgent({ proxy })
    }
  }

  const sdkOptions: SocketSdkOptions = {
    agent,
    baseUrl: apiBaseUrl,
    userAgent: createUserAgentFromPkgJson(require(rootPkgJsonPath))
  }

  return new SocketSdk(apiKey || '', sdkOptions)
}
