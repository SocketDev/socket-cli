/* max-file-lines: legitimate — tracks one cohesive module domain; splitting would scatter tightly coupled helpers. */
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
import { getSocketCliApiBaseUrl } from '@socketsecurity/lib-stable/env/socket-cli'
import { messageWithCauses } from '@socketsecurity/lib-stable/errors'
import { httpRequest } from '@socketsecurity/lib-stable/http-request/request'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'
import { getDefaultSpinner } from '@socketsecurity/lib-stable/spinner/registry'
import { isNonEmptyString } from '@socketsecurity/lib-stable/strings/predicates'

import { getDefaultApiToken, getExtraCaCerts } from './sdk.mts'

import type { HttpRequestOptions } from '@socketsecurity/lib-stable/http-request/request-types'
import type { HttpResponse } from '@socketsecurity/lib-stable/http-request/response-types'
import { CONFIG_KEY_API_BASE_URL } from '../../constants/config.mts'
import { API_V0_URL } from '../../constants/socket.mts'
import { getConfigValueOrUndef } from '../config.mts'
import { debugApiResponse } from '../debug.mts'
import {
  ConfigError,
  buildErrorCause,
  getNetworkErrorDiagnostics,
} from '../error/errors.mts'

import type { CResult } from '../../types.mts'
import type { SpinnerInstance } from '@socketsecurity/lib-stable/spinner/types'
import type {
  SocketSdkErrorResult,
  SocketSdkOperations,
  SocketSdkSuccessResult,
} from '@socketsecurity/sdk-stable'

const logger = getDefaultLogger()

const NO_ERROR_MESSAGE = 'No error message returned'

// User-facing error messages + permission-requirements logging
// extracted to keep this file under the 1000-line File-size cap.
import {
  getCommandRequirements,
  getErrorMessageForHttpStatusCode,
  logPermissionsFor403,
} from './api-error-messages.mts'

export {
  getCommandRequirements,
  getErrorMessageForHttpStatusCode,
  logPermissionsFor403,
}

export type { CommandRequirements } from './api-error-messages.mts'

// The Socket API server that should be used for operations.
export function getDefaultApiBaseUrl(): string | undefined {
  const baseUrl =
    getSocketCliApiBaseUrl() || getConfigValueOrUndef(CONFIG_KEY_API_BASE_URL)
  if (isNonEmptyString(baseUrl)) {
    return baseUrl
  }
  return API_V0_URL
}

type HandleApiCallOptions = {
  description?: string | undefined
  spinner?: SpinnerInstance | undefined
  commandPath?: string | undefined
}

type ApiCallResult<T extends SocketSdkOperations> = CResult<
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
    spinner?.start(`Requesting ${description} from API...`)
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

export async function queryApi(path: string, apiToken: string) {
  const baseUrl = getDefaultApiBaseUrl()
  /* c8 ignore start - getDefaultApiBaseUrl returns API_V0_URL by default; only undefined when env is misconfigured */
  if (!baseUrl) {
    throw new ConfigError(
      'Socket API base URL is not configured.',
      CONFIG_KEY_API_BASE_URL,
    )
  }
  /* c8 ignore stop */

  return await socketHttpRequest(
    `${baseUrl}${baseUrl.endsWith('/') ? '' : '/'}${path}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Basic ${btoa(`${apiToken}:`)}`,
      },
      timeout: 30_000,
    },
  )
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
  } catch (_e) {
    return {
      ok: false,
      message: 'Server returned invalid JSON',
      cause: `Please report this. JSON.parse threw an error over the following response: \`${(result.data?.slice?.(0, 100) || '').trim() + (result.data?.length > 100 ? '…' : '')}\``,
    }
  }
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

  const spinner = getDefaultSpinner()

  if (description) {
    spinner?.start(`Requesting ${description} from API...`)
  }

  const baseUrl = getDefaultApiBaseUrl()
  const fullUrl = `${baseUrl}${baseUrl?.endsWith('/') ? '' : '/'}${path}`
  const startTime = Date.now()
  const requestedAt = new Date(startTime).toISOString()

  // eslint-disable-next-line typescript-eslint/no-explicit-any -- HTTP response shape (status/ok/headers/text/json/data) is dynamically narrowed below; typing here would require a discriminated union for every status code.
  let result: any
  try {
    result = await queryApi(path, apiToken)
    const durationMs = Date.now() - startTime
    if (description) {
      spinner?.successAndStop(
        `Received Socket API response (after requesting ${description}).`,
      )
    }
    // Log success for debugging.
    debugApiResponse(description || 'Query API', result.status, undefined, {
      method: 'GET',
      url: fullUrl,
      durationMs,
      requestedAt,
      headers: { Authorization: '[REDACTED]' },
    })
  } catch (e) {
    const durationMs = Date.now() - startTime
    if (description) {
      spinner?.failAndStop(
        `An error was thrown while requesting ${description}.`,
      )
    }

    debug('Query API request failed')
    debugApiResponse(description || 'Query API', undefined, e, {
      method: 'GET',
      url: fullUrl,
      durationMs,
      requestedAt,
      headers: { Authorization: '[REDACTED]' },
    })

    // Provide detailed network diagnostics for fetch errors.
    const networkDiagnostics = getNetworkErrorDiagnostics(e, durationMs)
    const message = 'API request failed'

    return {
      ok: false,
      message,
      cause: `${networkDiagnostics} (path: ${path})`,
    }
  }

  if (!result.ok) {
    const { status } = result
    const durationMs = Date.now() - startTime
    // Include response headers (for cf-ray) and a truncated body so
    // support tickets have everything needed to file against Cloudflare
    // or backend teams.
    debugApiResponse(description || 'Query API', status, undefined, {
      method: 'GET',
      url: fullUrl,
      durationMs,
      requestedAt,
      headers: { Authorization: '[REDACTED]' },
      responseHeaders: result.headers,
      responseBody: tryReadResponseText(result),
    })
    // Log required permissions for 403 errors when in a command context.
    if (commandPath && status === 403) {
      logPermissionsFor403(commandPath)
    }
    return {
      ok: false,
      message: 'Socket API error',
      cause: `${result.statusText} (reason: ${await getErrorMessageForHttpStatusCode(status)}) (path: ${path})`,
      data: {
        code: status,
      },
    }
  }

  try {
    const data = result.text()
    return {
      ok: true,
      data,
    }
  } catch (e) {
    debug('Failed to read API response text')
    debugDir(e)

    return {
      ok: false,
      message: 'API request failed',
      cause: `Unexpected error reading response text (path: ${path})`,
    }
  }
}

type SendApiRequestOptions = {
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
  /* c8 ignore start - getDefaultApiBaseUrl returns API_V0_URL by default; only undefined when env is misconfigured */
  if (!baseUrl) {
    return {
      ok: false,
      message: 'Configuration Error',
      cause:
        'Socket API endpoint is not configured. Please check your environment configuration.',
    }
  }
  /* c8 ignore stop */

  const { body, commandPath, description, method } = {
    __proto__: null,
    ...options,
  } as SendApiRequestOptions
  const spinner = getDefaultSpinner()

  if (description) {
    spinner?.start(`Requesting ${description} from API...`)
  }

  const fullUrl = `${baseUrl}${baseUrl.endsWith('/') ? '' : '/'}${path}`
  const startTime = Date.now()
  const requestedAt = new Date(startTime).toISOString()

  // eslint-disable-next-line typescript-eslint/no-explicit-any -- HTTP response shape (status/ok/headers/text/json/data) is dynamically narrowed below; typing here would require a discriminated union for every status code.
  let result: any
  try {
    result = await socketHttpRequest(fullUrl, {
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        Authorization: `Basic ${btoa(`${apiToken}:`)}`,
        'Content-Type': 'application/json',
      },
      method,
      timeout: 60_000,
    })
    const durationMs = Date.now() - startTime
    if (description) {
      spinner?.successAndStop(
        `Received Socket API response (after requesting ${description}).`,
      )
    }
    // Log success for debugging.
    debugApiResponse(
      description || 'Send API Request',
      result.status,
      undefined,
      {
        method,
        url: fullUrl,
        durationMs,
        requestedAt,
        headers: {
          Authorization: '[REDACTED]',
          'Content-Type': 'application/json',
        },
      },
    )
  } catch (e) {
    const durationMs = Date.now() - startTime
    if (description) {
      spinner?.failAndStop(
        `An error was thrown while requesting ${description}.`,
      )
    }

    debug(`API ${method} request failed`)
    debugApiResponse(description || 'Send API Request', undefined, e, {
      method,
      url: fullUrl,
      durationMs,
      requestedAt,
      headers: {
        Authorization: '[REDACTED]',
        'Content-Type': 'application/json',
      },
    })

    // Provide detailed network diagnostics for fetch errors.
    const networkDiagnostics = getNetworkErrorDiagnostics(e, durationMs)
    const message = 'API request failed'

    return {
      ok: false,
      message,
      cause: `${networkDiagnostics} (path: ${path})`,
    }
  }

  if (!result.ok) {
    const { status } = result
    const durationMs = Date.now() - startTime
    // Include response headers (for cf-ray) and a truncated body so
    // support tickets have everything needed to file against Cloudflare
    // or backend teams.
    debugApiResponse(description || 'Send API Request', status, undefined, {
      method,
      url: fullUrl,
      durationMs,
      requestedAt,
      headers: {
        Authorization: '[REDACTED]',
        'Content-Type': 'application/json',
      },
      responseHeaders: result.headers,
      responseBody: tryReadResponseText(result),
    })
    // Log required permissions for 403 errors when in a command context.
    if (commandPath && status === 403) {
      logPermissionsFor403(commandPath)
    }
    return {
      ok: false,
      message: 'Socket API error',
      cause: `${result.statusText} (reason: ${await getErrorMessageForHttpStatusCode(status)}) (path: ${path})`,
      data: {
        code: status,
      },
    }
  }

  try {
    const data = result.json()
    return {
      ok: true,
      data: data as T,
    }
  } catch (e) {
    debug('Failed to parse API response JSON')
    debugDir(e)
    return {
      ok: false,
      message: 'API request failed',
      cause: `Unexpected error parsing response JSON (path: ${path})`,
    }
  }
}

// Wraps httpRequest with extra CA certificates from SSL_CERT_FILE.
export async function socketHttpRequest(
  url: string,
  options?: HttpRequestOptions | undefined,
): Promise<HttpResponse> {
  const ca = getExtraCaCerts()
  /* c8 ignore start - SSL_CERT_FILE not set in tests; getExtraCaCerts returns undefined */
  if (ca) {
    return await httpRequest(url, { ...(options ?? {}), ca })
  }
  /* c8 ignore stop */
  return await httpRequest(url, options)
}

// Safe wrapper for `response.text()` in error-handling code paths.
// `text()` can throw (e.g. already consumed, malformed body), which
// would blow past the `ok: false` CResult return and break the
// error-handling contract of callers like `queryApiSafeText`.
export function tryReadResponseText(result: HttpResponse): string | undefined {
  try {
    return result.text?.()
    /* c8 ignore start - defensive fallback when response.text() throws (e.g. already consumed body) */
  } catch {
    return undefined
  }
  /* c8 ignore stop */
}
