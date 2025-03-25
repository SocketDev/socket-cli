import process from 'node:process'

import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'

import { getConfigValue } from './config'
import { AuthError } from './errors'
import constants from '../constants'

import type {
  SocketSdkErrorType,
  SocketSdkOperations
} from '@socketsecurity/sdk'

const { SOCKET_SECURITY_API_BASE_URL } = constants

export function handleUnsuccessfulApiResponse<T extends SocketSdkOperations>(
  _name: T,
  sockSdkError: SocketSdkErrorType<T>
): never {
  const message = sockSdkError.error || 'No error message returned'
  const { status } = sockSdkError
  if (status === 401 || status === 403) {
    // Lazily access constants.spinner.
    const { spinner } = constants

    spinner.stop()

    throw new AuthError(message)
  }
  logger.fail(
    `${colors.bgRed(colors.white('API returned an error:'))} ${message}`
  )
  process.exit(1)
}

export async function handleApiCall<T>(
  value: T,
  description: string
): Promise<T> {
  let result: T
  try {
    result = await value
  } catch (cause) {
    throw new Error(`Failed ${description}`, { cause })
  }
  return result
}

export async function handleApiError(code: number) {
  if (code === 400) {
    return 'One of the options passed might be incorrect.'
  } else if (code === 403) {
    return 'You might be trying to access an organization that is not linked to the API key you are logged in with.'
  } else {
    ;`Server responded with status code ${code}`
  }
}

export function getLastFiveOfApiToken(token: string): string {
  // Get the last 5 characters of the API token before the trailing "_api".
  return token.slice(-9, -4)
}

// The API server that should be used for operations.
export function getDefaultApiBaseUrl(): string | undefined {
  const baseUrl =
    // Lazily access constants.ENV[SOCKET_SECURITY_API_BASE_URL].
    constants.ENV[SOCKET_SECURITY_API_BASE_URL] || getConfigValue('apiBaseUrl')
  return isNonEmptyString(baseUrl) ? baseUrl : undefined
}

export async function queryApi(path: string, apiToken: string) {
  const API_V0_URL = getDefaultApiBaseUrl()
  return await fetch(`${API_V0_URL}/${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${btoa(`${apiToken}:`)}`
    }
  })
}
