import { debugLog } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'

import { getConfigValueOrUndef } from './config.mts'
import { AuthError } from './errors.mts'
import constants from '../constants.mts'
import { failMsgWithBadge } from './fail-msg-with-badge.mts'

import type { CResult } from '../types.mts'
import type {
  SocketSdkErrorType,
  SocketSdkOperations,
  SocketSdkResultType,
  SocketSdkReturnType
} from '@socketsecurity/sdk'

// TODO: this function is removed after v1.0.0
export function handleUnsuccessfulApiResponse<T extends SocketSdkOperations>(
  _name: T,
  error: string,
  cause: string,
  status: number
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
): CResult<never> {
  const message = `${error || 'No error message returned'}`
  // logger.error(failMsgWithBadge('Socket API returned an error', message))
  return {
    ok: false,
    message: 'Socket API returned an error',
    cause: `${message}${cause ? ` ( Reason: ${cause} )` : ''}`
  }
}

export async function handleApiCall<T extends SocketSdkOperations>(
  value: Promise<SocketSdkResultType<T>>,
  spinnerBefore: string,
  spinnerAfterOk: string,
  spinnerAfterError: string,
  description: string
): Promise<CResult<SocketSdkReturnType<T>['data']>> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start(spinnerBefore)

  let result: SocketSdkResultType<T>
  try {
    result = await value

    spinner.successAndStop(spinnerAfterOk)
  } catch (e) {
    spinner.failAndStop(spinnerAfterError)

    debugLog(`handleApiCall(${description}) threw error:\n`, e)

    const message = `${e || 'No error message returned'}`
    const cause = `${e || 'No error message returned'}`

    return {
      ok: false,
      message: 'Socket API returned an error',
      cause: `${message}${cause ? ` ( Reason: ${cause} )` : ''}`
    }
  } finally {
    spinner.stop()
  }

  // Note: TS can't narrow down the type of result due to generics
  if (result.success === false) {
    const err = result as SocketSdkErrorType<T>
    const message = `${err.error || 'No error message returned'}`
    debugLog(`handleApiCall(${description}) bad response:\n`, err)

    return {
      ok: false,
      message: 'Socket API returned an error',
      cause: `${message}${err.cause ? ` ( Reason: ${err.cause} )` : ''}`,
      data: {
        code: result.status
      }
    }
  } else {
    const ok = result as SocketSdkReturnType<T>
    return {
      ok: true,
      data: ok.data
    }
  }
}

export async function tmpHandleApiCall<T>(
  value: Promise<T>,
  description: string
): Promise<Awaited<T>> {
  try {
    return await value
  } catch (e) {
    debugLog(`handleApiCall[${description}] error:\n`, e)
    // TODO: eliminate this throw in favor of CResult (or anything else)
    throw new Error(`Failed ${description}`, { cause: e })
  }
}

export async function handleApiCallNoSpinner<T extends SocketSdkOperations>(
  value: Promise<SocketSdkResultType<T>>,
  description: string
): Promise<CResult<SocketSdkReturnType<T>['data']>> {
  let result: SocketSdkResultType<T>
  try {
    result = await value
  } catch (e) {
    debugLog(`handleApiCall(${description}) threw error:\n`, e)

    const message = `${e || 'No error message returned'}`
    const cause = `${e || 'No error message returned'}`

    return {
      ok: false,
      message: 'Socket API returned an error',
      cause: `${message}${cause ? ` ( Reason: ${cause} )` : ''}`
    }
  }

  // Note: TS can't narrow down the type of result due to generics
  if (result.success === false) {
    const err = result as SocketSdkErrorType<T>
    const message = `${err.error || 'No error message returned'}`
    debugLog(`handleApiCall(${description}) bad response:\n`, err)

    return {
      ok: false,
      message: 'Socket API returned an error',
      cause: `${message}${err.cause ? ` ( Reason: ${err.cause} )` : ''}`,
      data: {
        code: result.status
      }
    }
  } else {
    const ok = result as SocketSdkReturnType<T>
    return {
      ok: true,
      data: ok.data
    }
  }
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
  // Lazily access constants.ENV.SOCKET_SECURITY_API_BASE_URL.
  const SOCKET_SECURITY_API_BASE_URL =
    constants.ENV.SOCKET_SECURITY_API_BASE_URL
  const baseUrl =
    SOCKET_SECURITY_API_BASE_URL || getConfigValueOrUndef('apiBaseUrl')
  if (isNonEmptyString(baseUrl)) {
    return baseUrl
  }
  // Lazily access constants.API_V0_URL.
  const API_V0_URL = constants.API_V0_URL
  return API_V0_URL
}

export async function queryApi(path: string, apiToken: string) {
  const baseUrl = getDefaultApiBaseUrl() || ''
  if (!baseUrl) {
    logger.warn(
      'API endpoint is not set and default was empty. Request is likely to fail.'
    )
  }
  return await fetch(`${baseUrl}${baseUrl.endsWith('/') ? '' : '/'}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${btoa(`${apiToken}:`)}`
    }
  })
}
