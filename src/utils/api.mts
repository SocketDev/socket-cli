import { messageWithCauses } from 'pony-cause'

import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'

import { getConfigValueOrUndef } from './config.mts'
import { AuthError } from './errors.mts'
import constants from '../constants.mts'
import { failMsgWithBadge } from './fail-msg-with-badge.mts'
import { getDefaultToken } from './sdk.mts'

import type { CResult } from '../types.mts'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'
import type {
  SocketSdkErrorResult,
  SocketSdkOperations,
  SocketSdkResult,
  SocketSdkSuccessResult,
} from '@socketsecurity/sdk'

const NO_ERROR_MESSAGE = 'No error message returned'

// TODO: this function is removed after v1.0.0
export function handleUnsuccessfulApiResponse<T extends SocketSdkOperations>(
  _name: T,
  error: string,
  cause: string,
  status: number,
): never {
  const message = `${error || NO_ERROR_MESSAGE}${cause ? ` (reason: ${cause})` : ''}`
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

export type HandleApiCallOptions = {
  desc?: string | undefined
  spinner?: Spinner | undefined
}

export async function handleApiCall<T extends SocketSdkOperations>(
  value: Promise<SocketSdkResult<T>>,
  options?: HandleApiCallOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<T>['data']>> {
  const { desc, spinner } = {
    __proto__: null,
    ...options,
  } as HandleApiCallOptions

  if (desc) {
    spinner?.start(`Requesting ${desc} from API...`)
  } else {
    spinner?.start()
  }

  let sdkResult: SocketSdkResult<T>
  try {
    sdkResult = await value
    if (desc) {
      // TODO: info, not success (looks weird when response is non-200)
      spinner?.successAndStop(
        `Received API response (after requesting ${desc}).`,
      )
    } else {
      spinner?.stop()
    }
  } catch (e) {
    if (desc) {
      spinner?.failAndStop(`An error was thrown while requesting ${desc}`)
      debugFn('error', `caught: ${desc} error`)
    } else {
      spinner?.stop()
      debugFn('error', `caught: error`)
    }
    debugDir('inspect', { error: e })

    return {
      ok: false,
      message: 'Socket API returned an error',
      cause: messageWithCauses(e as Error),
    }
  } finally {
    spinner?.stop()
  }

  // Note: TS can't narrow down the type of result due to generics.
  if (sdkResult.success === false) {
    const errorResult = sdkResult as SocketSdkErrorResult<T>
    const message = `${errorResult.error || NO_ERROR_MESSAGE}`
    const { cause: reason } = errorResult

    if (desc) {
      debugFn('error', `fail: ${desc} bad response`)
    } else {
      debugFn('error', 'fail: bad response')
    }
    debugDir('inspect', { sdkResult })

    return {
      ok: false,
      message: 'Socket API returned an error',
      cause: `${message}${reason ? ` ( Reason: ${reason} )` : ''}`,
      data: {
        code: sdkResult.status,
      },
    }
  } else {
    const { data } = sdkResult as SocketSdkSuccessResult<T>
    return {
      ok: true,
      data,
    }
  }
}

export async function handleApiCallNoSpinner<T extends SocketSdkOperations>(
  value: Promise<SocketSdkResult<T>>,
  description: string,
): Promise<CResult<SocketSdkSuccessResult<T>['data']>> {
  let result: SocketSdkResult<T>
  try {
    result = await value
  } catch (e) {
    const message = `${e || NO_ERROR_MESSAGE}`
    const reason = `${e || NO_ERROR_MESSAGE}`

    debugFn('error', `caught: ${description} error`)
    debugDir('inspect', { error: e })

    return {
      ok: false,
      message: 'Socket API returned an error',
      cause: `${message}${reason ? ` ( Reason: ${reason} )` : ''}`,
    }
  }

  // Note: TS can't narrow down the type of result due to generics
  if (result.success === false) {
    const error = result as SocketSdkErrorResult<T>
    const message = `${error.error || NO_ERROR_MESSAGE}`

    debugFn('error', `fail: ${description} bad response`)
    debugDir('inspect', { error })

    return {
      ok: false,
      message: 'Socket API returned an error',
      cause: `${message}${error.cause ? ` ( Reason: ${error.cause} )` : ''}`,
      data: {
        code: result.status,
      },
    }
  } else {
    const ok = result as SocketSdkSuccessResult<T>
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
  const baseUrl =
    // Lazily access constants.ENV.SOCKET_CLI_API_BASE_URL.
    constants.ENV.SOCKET_CLI_API_BASE_URL || getConfigValueOrUndef('apiBaseUrl')
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

  // Lazily access constants.spinner.
  const { spinner } = constants

  if (fetchSpinnerDesc) {
    spinner.start(`Requesting ${fetchSpinnerDesc} from API...`)
  }

  let result
  try {
    result = await queryApi(path, apiToken)
    if (fetchSpinnerDesc) {
      spinner.successAndStop(
        `Received API response (after requesting ${fetchSpinnerDesc}).`,
      )
    }
  } catch (e) {
    if (fetchSpinnerDesc) {
      spinner.failAndStop(
        `An error was thrown while requesting ${fetchSpinnerDesc}.`,
      )
    }

    const cause = (e as undefined | { message: string })?.message

    debugFn('error', 'caught: await queryApi() error')
    debugDir('inspect', { error: e })

    return {
      ok: false,
      message: 'API Request failed to complete',
      ...(cause ? { cause } : {}),
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
    debugFn('error', 'caught: await result.text() error')
    debugDir('inspect', { error: e })
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
