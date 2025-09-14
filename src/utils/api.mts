import { messageWithCauses } from 'pony-cause'

import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'

import { getConfigValueOrUndef } from './config.mts'
import constants, { EMPTY_VALUE } from '../constants.mts'
import { getRequirements, getRequirementsKey } from './requirements.mts'
import { getDefaultApiToken } from './sdk.mts'

import type { CResult } from '../types.mts'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'
import type {
  SocketSdkErrorResult,
  SocketSdkOperations,
  SocketSdkResult,
  SocketSdkSuccessResult,
} from '@socketsecurity/sdk'

const NO_ERROR_MESSAGE = 'No error message returned'

export type CommandRequirements = {
  permissions?: string[]
  quota?: number
}

/**
 * Get command requirements from requirements.json based on command path.
 */
function getCommandRequirements(
  cmdPath?: string,
): CommandRequirements | undefined {
  if (!cmdPath) {
    return undefined
  }

  const requirements = getRequirements()
  const key = getRequirementsKey(cmdPath)
  return (requirements.api as any)[key] || undefined
}

/**
 * Log required permissions for a command when encountering 403 errors.
 */
function logPermissionsFor403(cmdPath?: string): void {
  const requirements = getCommandRequirements(cmdPath)
  if (!requirements?.permissions?.length) {
    return
  }

  logger.error('This command requires the following API permissions:')
  for (const permission of requirements.permissions) {
    logger.error(`  - ${permission}`)
  }
  logger.error('Please ensure your API token has the required permissions.')
}

// The Socket API server that should be used for operations.
export function getDefaultApiBaseUrl(): string | undefined {
  const baseUrl =
    constants.ENV.SOCKET_CLI_API_BASE_URL || getConfigValueOrUndef('apiBaseUrl')
  if (isNonEmptyString(baseUrl)) {
    return baseUrl
  }
  const API_V0_URL = constants.API_V0_URL
  return API_V0_URL
}

/**
 * Get user-friendly error message for HTTP status codes.
 */
export async function getErrorMessageForHttpStatusCode(code: number) {
  if (code === 400) {
    return 'One of the options passed might be incorrect'
  }
  if (code === 403 || code === 401) {
    return 'Your Socket API token may not have the required permissions for this command or you might be trying to access (data from) an organization that is not linked to the API token you are logged in with'
  }
  if (code === 404) {
    return 'The requested Socket API endpoint was not found (404) or there was no result for the requested parameters. If unexpected, this could be a temporary problem caused by an incident or a bug in the CLI. If the problem persists please let us know.'
  }
  if (code === 500) {
    return 'There was an unknown server side problem with your request. This ought to be temporary. Please let us know if this problem persists.'
  }
  return `Server responded with status code ${code}`
}

export type HandleApiCallOptions = {
  description?: string | undefined
  spinner?: Spinner | undefined
  commandPath?: string | undefined
}

export type ApiCallResult<T extends SocketSdkOperations> = CResult<
  SocketSdkSuccessResult<T>['data']
>

/**
 * Handle Socket SDK API calls with error handling and permission logging.
 */
export async function handleApiCall<T extends SocketSdkOperations>(
  value: Promise<SocketSdkResult<T>>,
  options?: HandleApiCallOptions | undefined,
): Promise<ApiCallResult<T>> {
  const { commandPath, description, spinner } = {
    __proto__: null,
    ...options,
  } as HandleApiCallOptions

  if (description) {
    spinner?.start(`Requesting ${description} from API...`)
  } else {
    spinner?.start()
  }

  let sdkResult: SocketSdkResult<T>
  try {
    sdkResult = await value
    spinner?.stop()
    if (description) {
      const message = `Received Socket API response (after requesting ${description}).`
      if (sdkResult.success) {
        logger.success(message)
      } else {
        logger.info(message)
      }
    }
  } catch (e) {
    spinner?.stop()
    const socketSdkErrorResult: ApiCallResult<T> = {
      ok: false,
      message: 'Socket API error',
      cause: messageWithCauses(e as Error),
    }
    if (description) {
      logger.fail(`An error was thrown while requesting ${description}`)
      debugFn('error', `caught: ${description} error`)
    } else {
      debugFn('error', `caught: Socket API request error`)
    }
    debugDir('inspect', { error: e })
    debugDir('inspect', { socketSdkErrorResult })
    return socketSdkErrorResult
  }

  // Note: TS can't narrow down the type of result due to generics.
  if (sdkResult.success === false) {
    debugFn(
      'error',
      `fail:${description ? ` ${description}` : ''} bad response`,
    )
    debugDir('inspect', { sdkResult })

    const errCResult = sdkResult as SocketSdkErrorResult<T>
    const errStr = errCResult.error ? String(errCResult.error).trim() : ''
    const message = errStr || NO_ERROR_MESSAGE
    const reason = errCResult.cause || NO_ERROR_MESSAGE
    const cause =
      reason && message !== reason ? `${message} (reason: ${reason})` : message
    const socketSdkErrorResult: ApiCallResult<T> = {
      ok: false,
      message: 'Socket API error',
      cause,
      data: {
        code: sdkResult.status,
      },
    }

    // Log required permissions for 403 errors when in a command context.
    if (commandPath && sdkResult.status === 403) {
      logPermissionsFor403(commandPath)
    }

    return socketSdkErrorResult
  }
  const socketSdkSuccessResult: ApiCallResult<T> = {
    ok: true,
    data: (sdkResult as SocketSdkSuccessResult<T>).data,
  }
  return socketSdkSuccessResult
}

export async function handleApiCallNoSpinner<T extends SocketSdkOperations>(
  value: Promise<SocketSdkResult<T>>,
  description: string,
): Promise<CResult<SocketSdkSuccessResult<T>['data']>> {
  let sdkResult: SocketSdkResult<T>
  try {
    sdkResult = await value
  } catch (e) {
    debugFn('error', `caught: ${description} error`)
    debugDir('inspect', { error: e })

    const errStr = e ? String(e).trim() : ''
    const message = 'Socket API error'
    const rawCause = errStr || NO_ERROR_MESSAGE
    const cause = message !== rawCause ? rawCause : ''

    return {
      ok: false,
      message,
      ...(cause ? { cause } : {}),
    }
  }

  // Note: TS can't narrow down the type of result due to generics
  if (sdkResult.success === false) {
    debugFn('error', `fail: ${description} bad response`)
    debugDir('inspect', { sdkResult })

    const sdkErrorResult = sdkResult as SocketSdkErrorResult<T>
    const errStr = sdkErrorResult.error
      ? String(sdkErrorResult.error).trim()
      : ''
    const message = errStr || NO_ERROR_MESSAGE
    const reason = sdkErrorResult.cause || NO_ERROR_MESSAGE
    const cause =
      reason && message !== reason ? `${message} (reason: ${reason})` : message

    return {
      ok: false,
      message: 'Socket API error',
      cause,
      data: {
        code: sdkResult.status,
      },
    }
  } else {
    const sdkSuccessResult = sdkResult as SocketSdkSuccessResult<T>
    return {
      ok: true,
      data: sdkSuccessResult.data,
    }
  }
}

export async function queryApi(path: string, apiToken: string) {
  const baseUrl = getDefaultApiBaseUrl()
  if (!baseUrl) {
    throw new Error('Socket API base URL is not configured.')
  }

  return await fetch(`${baseUrl}${baseUrl.endsWith('/') ? '' : '/'}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${btoa(`${apiToken}:`)}`,
    },
  })
}

/**
 * Query Socket API endpoint and return text response with error handling.
 */
export async function queryApiSafeText(
  path: string,
  description?: string | undefined,
  commandPath?: string | undefined,
): Promise<CResult<string>> {
  const apiToken = getDefaultApiToken()
  if (!apiToken) {
    return {
      ok: false,
      message: 'Authentication Error',
      cause:
        'User must be authenticated to run this command. Run `socket login` and enter your Socket API token.',
    }
  }

  const { spinner } = constants

  if (description) {
    spinner.start(`Requesting ${description} from API...`)
  }

  let result
  try {
    result = await queryApi(path, apiToken)
    if (description) {
      spinner.successAndStop(
        `Received Socket API response (after requesting ${description}).`,
      )
    }
  } catch (e) {
    if (description) {
      spinner.failAndStop(
        `An error was thrown while requesting ${description}.`,
      )
    }

    debugFn('error', 'caught: await queryApi() error')
    debugDir('inspect', { error: e })

    const errStr = e ? String(e).trim() : ''
    const message = 'API request failed'
    const rawCause = errStr || NO_ERROR_MESSAGE
    const cause = message !== rawCause ? rawCause : ''

    return {
      ok: false,
      message,
      ...(cause ? { cause } : {}),
    }
  }

  if (!result.ok) {
    const { status } = result
    // Log required permissions for 403 errors when in a command context.
    if (commandPath && status === 403) {
      logPermissionsFor403(commandPath)
    }
    return {
      ok: false,
      message: 'Socket API error',
      cause: `${result.statusText} (reason: ${await getErrorMessageForHttpStatusCode(status)})`,
      data: {
        code: status,
      },
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
      message: 'API request failed',
      cause: 'Unexpected error reading response text',
    }
  }
}

/**
 * Query Socket API endpoint and return parsed JSON response.
 */
export async function queryApiSafeJson<T>(
  path: string,
  description = '',
): Promise<CResult<T>> {
  const result = await queryApiSafeText(path, description)

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
      cause: `Please report this. JSON.parse threw an error over the following response: \`${(result.data?.slice?.(0, 100) || EMPTY_VALUE).trim() + (result.data?.length > 100 ? '...' : '')}\``,
    }
  }
}

export type SendApiRequestOptions = {
  method: 'POST' | 'PUT'
  body?: unknown | undefined
  description?: string | undefined
  commandPath?: string | undefined
}

/**
 * Send POST/PUT request to Socket API with JSON response handling.
 */
export async function sendApiRequest<T>(
  path: string,
  options?: SendApiRequestOptions | undefined,
): Promise<CResult<T>> {
  const apiToken = getDefaultApiToken()
  if (!apiToken) {
    return {
      ok: false,
      message: 'Authentication Error',
      cause:
        'User must be authenticated to run this command. To log in, run the command `socket login` and enter your Socket API token.',
    }
  }

  const baseUrl = getDefaultApiBaseUrl()
  if (!baseUrl) {
    return {
      ok: false,
      message: 'Configuration Error',
      cause:
        'Socket API endpoint is not configured. Please check your environment configuration.',
    }
  }

  const { body, commandPath, description, method } = {
    __proto__: null,
    ...options,
  } as SendApiRequestOptions
  const { spinner } = constants

  if (description) {
    spinner.start(`Requesting ${description} from API...`)
  }

  let result
  try {
    const fetchOptions = {
      method,
      headers: {
        Authorization: `Basic ${btoa(`${apiToken}:`)}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }

    result = await fetch(
      `${baseUrl}${baseUrl.endsWith('/') ? '' : '/'}${path}`,
      fetchOptions,
    )
    if (description) {
      spinner.successAndStop(
        `Received Socket API response (after requesting ${description}).`,
      )
    }
  } catch (e) {
    if (description) {
      spinner.failAndStop(
        `An error was thrown while requesting ${description}.`,
      )
    }

    debugFn('error', `caught: await fetch() ${method} error`)
    debugDir('inspect', { error: e })

    const errStr = e ? String(e).trim() : ''
    const message = 'API request failed'
    const rawCause = errStr || NO_ERROR_MESSAGE
    const cause = message !== rawCause ? rawCause : ''

    return {
      ok: false,
      message,
      ...(cause ? { cause } : {}),
    }
  }

  if (!result.ok) {
    const { status } = result
    // Log required permissions for 403 errors when in a command context.
    if (commandPath && status === 403) {
      logPermissionsFor403(commandPath)
    }
    return {
      ok: false,
      message: 'Socket API error',
      cause: `${result.statusText} (reason: ${await getErrorMessageForHttpStatusCode(status)})`,
      data: {
        code: status,
      },
    }
  }

  try {
    const data = await result.json()
    return {
      ok: true,
      data: data as T,
    }
  } catch (e) {
    debugFn('error', 'caught: await result.json() error')
    debugDir('inspect', { error: e })
    return {
      ok: false,
      message: 'API request failed',
      cause: 'Unexpected error parsing response JSON',
    }
  }
}
