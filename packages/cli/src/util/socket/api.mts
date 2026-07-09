/**
 * API utilities for Socket CLI. Provides consistent API communication with
 * error handling and permissions management.
 *
 * Key Functions:
 *
 * - GetDefaultApiBaseUrl: Get configured API endpoint
 * - GetErrorMessageForHttpStatusCode: User-friendly HTTP error messages
 * - HandleApiCall: Execute Socket SDK API calls with error handling
 * - HandleApiCallNoSpinner: Execute API calls without UI spinner
 * - QueryApi: Execute raw API queries with text response
 *
 * Error Handling:
 *
 * - Automatic permission requirement logging for 403 errors
 * - Detailed error messages for common HTTP status codes
 * - Integration with debug helpers for API response logging
 *
 * Configuration:
 *
 * - Respects SOCKET_CLI_API_BASE_URL environment variable
 * - Falls back to configured apiBaseUrl or default API_V0_URL
 */

import { debug, debugDir } from '@socketsecurity/lib-stable/debug/output'
import { messageWithCauses } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { debugApiResponse } from '../debug.mts'
import { buildErrorCause } from '../error/errors.mts'

import { logPermissionsFor403 } from './api-error-messages.mts'

import type { CResult } from '../../types.mts'
import type { SpinnerInstance } from '@socketsecurity/lib-stable/spinner/types'
import type {
  SocketSdkErrorResult,
  SocketSdkOperations,
  SocketSdkSuccessResult,
} from '@socketsecurity/sdk-stable'

const logger = getDefaultLogger()

const NO_ERROR_MESSAGE = 'No error message returned'

// User-facing error messages + permission-requirements logging live in
// api-error-messages.mts; the read/write HTTP call helpers live in
// api-http.mts, api-query.mts, and api-send.mts — split out to keep this
// file under the File-size cap.
export {
  getCommandRequirements,
  getErrorMessageForHttpStatusCode,
  logPermissionsFor403,
} from './api-error-messages.mts'
export type { CommandRequirements } from './api-error-messages.mts'

export {
  getDefaultApiBaseUrl,
  socketHttpRequest,
  tryReadResponseText,
} from './api-http.mts'

export { queryApi, queryApiSafeJson, queryApiSafeText } from './api-query.mts'

export { sendApiRequest } from './api-send.mts'
export type { SendApiRequestOptions } from './api-send.mts'

export type HandleApiCallOptions = {
  description?: string | undefined
  spinner?: SpinnerInstance | undefined
  commandPath?: string | undefined
}

export type ApiCallResult<T extends SocketSdkOperations> = CResult<
  SocketSdkSuccessResult<T>['data']
>

/**
 * Handle Socket SDK API calls with error handling and permission logging.
 */
export async function handleApiCall<T extends SocketSdkOperations>(
  value: Promise<unknown>,
  options?: HandleApiCallOptions | undefined,
): Promise<ApiCallResult<T>> {
  const { commandPath, description, spinner } = {
    __proto__: null,
    ...options,
  } as HandleApiCallOptions

  if (description) {
    spinner?.start(`Requesting ${description} from API…`)
  } else {
    spinner?.start()
  }

  // eslint-disable-next-line typescript-eslint/no-explicit-any -- value is `Promise<unknown>`; sdkResult shape is narrowed inline via `success`/`status`/`error`/`cause` discriminants below.
  let sdkResult: any
  try {
    sdkResult = await value
    spinner?.stop()
    // Only log success messages if a spinner was provided (opt-in to output).
    if (description && spinner) {
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
      debugApiResponse(description, undefined, e)
    } else {
      debugApiResponse('Socket API', undefined, e)
    }
    debugDir({ socketSdkErrorResult })
    return socketSdkErrorResult
  }

  // Note: TS can't narrow down the type of result due to generics.
  if (sdkResult.success === false) {
    const endpoint = description || 'Socket API'
    debugApiResponse(endpoint, sdkResult.status as number)
    debugDir({ sdkResult })

    const errCResult = sdkResult as SocketSdkErrorResult<T>
    const errStr = errCResult.error ? String(errCResult.error).trim() : ''
    const message = errStr || NO_ERROR_MESSAGE
    const reason = errCResult.cause || NO_ERROR_MESSAGE

    const cause = await buildErrorCause(
      sdkResult.status as number,
      message,
      reason,
    )

    const causeWithEndpoint = description
      ? `${cause} (endpoint: ${description})`
      : cause

    const socketSdkErrorResult: ApiCallResult<T> = {
      ok: false,
      message: 'Socket API error',
      cause: causeWithEndpoint,
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
  value: Promise<unknown>,
  description: string,
): Promise<CResult<SocketSdkSuccessResult<T>['data']>> {
  // eslint-disable-next-line typescript-eslint/no-explicit-any -- value is `Promise<unknown>`; sdkResult shape is narrowed inline via `success`/`status`/`error`/`cause` discriminants below.
  let sdkResult: any
  try {
    sdkResult = await value
  } catch (e) {
    debug(`API request failed: ${description}`)
    debugDir(e)

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
    debug(`fail: ${description} bad response`)
    debugDir({ sdkResult })

    const sdkErrorResult = sdkResult as SocketSdkErrorResult<T>
    const errStr = sdkErrorResult.error
      ? String(sdkErrorResult.error).trim()
      : ''
    const message = errStr || NO_ERROR_MESSAGE
    const reason = sdkErrorResult.cause || NO_ERROR_MESSAGE

    const cause = await buildErrorCause(
      sdkResult.status as number,
      message,
      reason,
    )

    const causeWithEndpoint = description
      ? `${cause} (endpoint: ${description})`
      : cause

    return {
      ok: false,
      message: 'Socket API error',
      cause: causeWithEndpoint,
      data: {
        code: sdkResult.status,
      },
    }
  }
  const sdkSuccessResult = sdkResult as SocketSdkSuccessResult<T>
  return {
    ok: true,
    data: sdkSuccessResult.data,
  }
}
