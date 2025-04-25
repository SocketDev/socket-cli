import process from 'node:process'

import { debugLog } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'

import { getConfigValue } from './config'
import { AuthError } from './errors'
import constants from '../constants'
import { failMsgWithBadge } from './fail-msg-with-badge'
import type { CliJsonResult } from '../types'

import type {
  SocketSdkErrorType,
  SocketSdkOperations
} from '@socketsecurity/sdk'

export function handleUnsuccessfulApiResponse<T extends SocketSdkOperations>(
  _name: T,
  { cause, error, status }: SocketSdkErrorType<T>
): never {
  const message = `${error || 'No error message returned'}${cause ? ` (reason: ${cause})` : ''}`
  if (status === 401 || status === 403) {
    // Lazily access constants.spinner.
    const { spinner } = constants

    spinner.stop()

    throw new AuthError(message)
  }
  logger.fail(failMsgWithBadge('Socket API returned an error', message))
  // eslint-disable-next-line n/no-process-exit
  process.exit(1)
}

export function handleFailedApiResponse<T extends SocketSdkOperations>(
  _name: T,
  { cause, error }: SocketSdkErrorType<T>
): CliJsonResult<any> {
  process.exitCode = 1
  const message = `${error || 'No error message returned'}`
  // logger.error(failMsgWithBadge('Socket API returned an error', message))
  return {
    ok: false,
    message: 'Socket API returned an error',
    data: `${message}${cause ? ` ( Reason: ${cause} )` : ''}`
  } satisfies CliJsonResult
}

export async function handleApiCall<T>(
  value: T,
  description: string
): Promise<T> {
  let result: T
  try {
    result = await value
  } catch (e) {
    debugLog(`handleApiCall[${description}] error:\n`, e)
    throw new Error(`Failed ${description}`, { cause: e })
  }
  return result
}

export async function handleApiError(code: number) {
  if (code === 400) {
    return 'One of the options passed might be incorrect'
  }
  if (code === 403) {
    return 'Your API token may not have the required permissions for this command or you might be trying to access (data from) an organization that is not linked to the API key you are logged in with'
  }
  if (code === 404) {
    return 'The requested Socket API endpoint was not found (404) or there was no result for the requested parameters. This could be a temporary problem caused by an incident or a bug in the CLI. If the problem persists please let us know.'
  }
  return `Server responded with status code ${code}`
}

export function getLastFiveOfApiToken(token: string): string {
  // Get the last 5 characters of the API token before the trailing "_api".
  return token.slice(-9, -4)
}

// The API server that should be used for operations.
export function getDefaultApiBaseUrl(): string | undefined {
  const baseUrl =
    process.env['SOCKET_SECURITY_API_BASE_URL'] || getConfigValue('apiBaseUrl')
  if (isNonEmptyString(baseUrl)) {
    return baseUrl
  }
  // Lazily access constants.API_V0_URL.
  const API_V0_URL = constants.API_V0_URL
  return API_V0_URL
}

export async function queryApi(path: string, apiToken: string) {
  const API_V0_URL = getDefaultApiBaseUrl() || ''
  if (!API_V0_URL) {
    logger.warn(
      'API endpoint is not set and default was empty. Request is likely to fail.'
    )
  }
  return await fetch(
    `${API_V0_URL}${API_V0_URL.endsWith('/') ? '' : '/'}${path}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Basic ${btoa(`${apiToken}:`)}`
      }
    }
  )
}
