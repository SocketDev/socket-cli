import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SocketSdk, createUserAgentFromPkgJson } from '@socketsecurity/sdk'
import isInteractive from 'is-interactive'
import prompts from 'prompts'

import { AuthError } from './errors.js'
import { getSetting } from './settings.js'

export const FREE_API_KEY = 'sktsec_t_--RAN5U4ivauy4w37-6aoKyYPDt5ZbaT5JBVMqiwKo_api'

/**
 * This API key should be stored globally for the duration of the CLI execution
 *
 * @type {string | undefined}
 */
let defaultKey

/** @returns {string | undefined} */
export function getDefaultKey () {
  defaultKey = process.env['SOCKET_SECURITY_API_KEY'] || getSetting('apiKey') || defaultKey
  return defaultKey
}

/**
 * @param {string} [apiKey]
 * @returns {Promise<import('@socketsecurity/sdk').SocketSdk>}
 */
export async function setupSdk (apiKey = getDefaultKey()) {
  if (apiKey == null && isInteractive()) {
    /**
     * @type {{ apiKey: string }}
     */
    const input = await prompts({
      type: 'password',
      name: 'apiKey',
      message: 'Enter your Socket.dev API key (not saved, use socket login to persist)',
    })

    apiKey = defaultKey = input.apiKey
  }

  if (!apiKey) {
    throw new AuthError('You need to provide an API key')
  }

  /** @type {import('@socketsecurity/sdk').SocketSdkOptions["agent"]} */
  let agent

  if (process.env['SOCKET_SECURITY_API_PROXY']) {
    const { HttpProxyAgent, HttpsProxyAgent } = await import('hpagent')
    agent = {
      http: new HttpProxyAgent({ proxy: process.env['SOCKET_SECURITY_API_PROXY'] }),
      https: new HttpsProxyAgent({ proxy: process.env['SOCKET_SECURITY_API_PROXY'] }),
    }
  }
  const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), '../../package.json')
  const packageJson = await readFile(packageJsonPath, 'utf8')

  /** @type {import('@socketsecurity/sdk').SocketSdkOptions} */
  const sdkOptions = {
    agent,
    baseUrl: process.env['SOCKET_SECURITY_API_BASE_URL'],
    userAgent: createUserAgentFromPkgJson(JSON.parse(packageJson))
  }

  return new SocketSdk(apiKey || '', sdkOptions)
}
