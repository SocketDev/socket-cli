import { debugLog } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'

import { getConfigValueOrUndef } from './config.mts'
import { AuthError } from './errors.mts'
import constants from '../constants.mts'
import { failMsgWithBadge } from './fail-msg-with-badge.mts'
import { getDefaultToken } from './sdk.mts'

import type { CResult } from '../types.mts'
import type {
  SocketSdkErrorType,
  SocketSdkOperations,
  SocketSdkResultType,
  SocketSdkReturnType,
} from '@socketsecurity/sdk'

// TODO: this function is removed after v1.0.0
export function handleUnsuccessfulApiResponse<T extends SocketSdkOperations>(
  _name: T,
  error: string,
  cause: string,
  status: number,
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

export async function handleApiCall<T extends SocketSdkOperations>(
  value: Promise<SocketSdkResultType<T>>,
  fetchingDesc: string,
): Promise<CResult<SocketSdkReturnType<T>['data']>> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start(`Requesting ${fetchingDesc} from API...`)

  let result: SocketSdkResultType<T>
  try {
    result = await value

    // TODO: info, not success (looks weird when response is non-200)
    spinner.successAndStop(
      `Received API response (after requesting ${fetchingDesc}).`,
    )
  } catch (e) {
    spinner.failAndStop(`An error was thrown while requesting ${fetchingDesc}`)

    debugLog(`handleApiCall(${fetchingDesc}) threw error:\n`, e)

    const message = `${e || 'No error message returned'}`
    const cause = `${e || 'No error message returned'}`

    return {
      ok: false,
      message: 'Socket API returned an error',
      cause: `${message}${cause ? ` ( Reason: ${cause} )` : ''}`,
    }
  } finally {
    spinner.stop()
  }

  // Note: TS can't narrow down the type of result due to generics
  if (result.success === false) {
    const err = result as SocketSdkErrorType<T>
    const message = `${err.error || 'No error message returned'}`
    debugLog(`handleApiCall(${fetchingDesc}) bad response:\n`, err)

    return {
      ok: false,
      message: 'Socket API returned an error',
      cause: `${message}${err.cause ? ` ( Reason: ${err.cause} )` : ''}`,
      data: {
        code: result.status,
      },
    }
  } else {
    const ok = result as SocketSdkReturnType<T>
    return {
      ok: true,
      data: ok.data,
    }
  }
}

export async function handleApiCallNoSpinner<T extends SocketSdkOperations>(
  value: Promise<SocketSdkResultType<T>>,
  description: string,
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
      cause: `${message}${cause ? ` ( Reason: ${cause} )` : ''}`,
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
        code: result.status,
      },
    }
  } else {
    const ok = result as SocketSdkReturnType<T>
    return {
      ok: true,
      data: ok.data,
    }
  }
}

export async function getErrorMessageForHttpStatusCode(code: number) {
  if (code === 400) {
    return 'One of the options passed might be incorrect'
  }
  if (code === 403 || code === 401) {
    return 'Your API token may not have the required permissions for this command or you might be trying to access (data from) an organization that is not linked to the API key you are logged in with'
  }
  if (code === 404) {
    return 'The requested Socket API endpoint was not found (404) or there was no result for the requested parameters. If unexpected, this could be a temporary problem caused by an incident or a bug in the CLI. If the problem persists please let us know.'
  }
  if (code === 500) {
    return 'There was an unknown server side problem with your request. This ought to be temporary. Please let us know if this problem persists.'
  }
  return `Server responded with status code ${code}`
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
      'API endpoint is not set and default was empty. Request is likely to fail.',
    )
  }
  return await fetch(`${baseUrl}${baseUrl.endsWith('/') ? '' : '/'}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${btoa(`${apiToken}:`)}`,
    },
  })
}

export async function queryApiSafeText(
  path: string,
  fetchSpinnerDesc?: string,
): Promise<CResult<string>> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    return {
      ok: false,
      message: 'Authentication Error',
      cause:
        'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.',
    }
  }

  if (fetchSpinnerDesc) {
    // Lazily access constants.spinner.
    const { spinner } = constants

    spinner.start(`Requesting ${fetchSpinnerDesc} from API...`)
  }

  let result
  try {
    result = await queryApi(path, apiToken)
    if (fetchSpinnerDesc) {
      // Lazily access constants.spinner.
      const { spinner } = constants

      spinner.successAndStop(
        `Received API response (after requesting ${fetchSpinnerDesc}).`,
      )
    }
  } catch (e) {
    if (fetchSpinnerDesc) {
      // Lazily access constants.spinner.
      const { spinner } = constants

      spinner.failAndStop(
        `An error was thrown while requesting ${fetchSpinnerDesc}`,
      )
    }
    debugLog('Error thrown trying to await queryApi():')
    debugLog(e)

    const msg = (e as undefined | { message: string })?.message

    return {
      ok: false,
      message: 'API Request failed to complete',
      ...(msg ? { cause: msg } : {}),
    }
  }

  if (!result.ok) {
    const cause = await getErrorMessageForHttpStatusCode(result.status)
    return {
      ok: false,
      message: 'Socket API returned an error',
      cause: `${result.statusText}${cause ? ` (cause: ${cause})` : ''}`,
    }
  }

  try {
    const data = await result.text()

    return {
      ok: true,
      data,
    }
  } catch (e) {
    debugLog('Error thrown trying to await result.text():')
    debugLog(e)

    return {
      ok: false,
      message: 'API Request failed to complete',
      cause: 'There was an unexpected error trying to read the response text',
    }
  }
}

export async function queryApiSafeJson<T>(
  path: string,
  fetchSpinnerDesc = '',
): Promise<CResult<T>> {
  const result = await queryApiSafeText(path, fetchSpinnerDesc)

  if (!result.ok) {
    return result
  }

  try {
    return {
      ok: true,
      data: JSON.parse(result.data) as T,
    }
  } catch (e) {
    return {
      ok: false,
      message: 'Server returned invalid JSON',
      cause: `Please report this. JSON.parse threw an error over the following response: \`${(result.data?.slice?.(0, 100) || '<empty>').trim() + (result.data?.length > 100 ? '...' : '')}\``,
    }
  }
}
