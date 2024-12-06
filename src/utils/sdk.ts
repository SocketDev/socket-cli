import { password } from '@inquirer/prompts'
import { HttpProxyAgent, HttpsProxyAgent } from 'hpagent'
import isInteractive from 'is-interactive'

import { SocketSdk, createUserAgentFromPkgJson } from '@socketsecurity/sdk'

import { rootPkgJsonPath } from '../constants'
import { AuthError } from './errors'
import { getSetting } from './settings'

import type { SocketSdkOptions } from '@socketsecurity/sdk'

export const FREE_API_KEY =
  'sktsec_t_--RAN5U4ivauy4w37-6aoKyYPDt5ZbaT5JBVMqiwKo_api'

// This API key should be stored globally for the duration of the CLI execution
let defaultKey: string | undefined

export function getDefaultKey(): string | undefined {
  defaultKey =
    process.env['SOCKET_SECURITY_API_KEY'] || getSetting('apiKey') || defaultKey
  return defaultKey
}

// The API server that should be used for operations
let defaultAPIBaseUrl: string | undefined

function getDefaultAPIBaseUrl(): string | undefined {
  defaultAPIBaseUrl =
    process.env['SOCKET_SECURITY_API_BASE_URL'] ||
    getSetting('apiBaseUrl') ||
    undefined
  return defaultAPIBaseUrl
}

// The API server that should be used for operations
let defaultApiProxy: string | undefined

function getDefaultHTTPProxy(): string | undefined {
  defaultApiProxy =
    process.env['SOCKET_SECURITY_API_PROXY'] ||
    getSetting('apiProxy') ||
    undefined
  return defaultApiProxy
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
