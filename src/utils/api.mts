/**
 * API utilities for Socket CLI.
 * Provides consistent API communication with error handling and permissions management.
 *
 * Key Functions:
 * - getErrorMessageForHttpStatusCode: User-friendly HTTP error messages
 * - handleApiCall: Execute Socket SDK API calls with error handling
 * - handleApiCallNoSpinner: Execute API calls without UI spinner
 * - queryApi: Execute raw API queries with text response
 *
 * Error Handling:
 * - Automatic permission requirement logging for 403 errors
 * - Detailed error messages for common HTTP status codes
 * - Integration with debug helpers for API response logging
 *
 * Configuration:
 * - API base URL resolved via sdk.mts getDefaultApiBaseUrl()
 */

import { messageWithCauses } from 'pony-cause'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'
import { withSpinner } from '@socketsecurity/registry/lib/spinner'

import {
  debugApiResponse,
  debugDir,
  debugFn,
  debugHttpError,
} from './debug.mts'
import { buildErrorCause } from './errors.mts'
import { githubRepoLink, webLink } from './terminal-link.mts'
import constants, {
  EMPTY_VALUE,
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_FORBIDDEN,
  HTTP_STATUS_INTERNAL_SERVER_ERROR,
  HTTP_STATUS_NOT_FOUND,
  HTTP_STATUS_TOO_MANY_REQUESTS,
  HTTP_STATUS_UNAUTHORIZED,
} from '../constants.mts'
import { getRequirements, getRequirementsKey } from './requirements.mts'
import { getDefaultApiBaseUrl, getDefaultApiToken } from './sdk.mts'

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
  permissions?: string[] | undefined
  quota?: number | undefined
}

/**
 * Get command requirements from requirements.json based on command path.
 */
function getCommandRequirements(
  cmdPath?: string | undefined,
): CommandRequirements | undefined {
  if (!cmdPath) {
    return undefined
  }

  const requirements = getRequirements()
  const keys = getRequirementsKey(cmdPath)

  // Aggregate requirements from multiple SDK methods
  let totalQuota = 0
  const allPermissions = new Set<string>()
  let foundAny = false

  for (const key of keys) {
    const req = requirements.api[key]
    if (req) {
      foundAny = true
      if (req.quota) {
        totalQuota += req.quota
      }
      if (req.permissions) {
        for (const perm of req.permissions) {
          allPermissions.add(perm)
        }
      }
    }
  }

  if (!foundAny) {
    return undefined
  }

  return {
    quota: totalQuota || undefined,
    permissions:
      allPermissions.size > 0 ? Array.from(allPermissions) : undefined,
  }
}

/**
 * Log required permissions for a command when encountering 403 errors with actionable guidance.
 */
function logPermissionsFor403(cmdPath?: string | undefined): void {
  const requirements = getCommandRequirements(cmdPath)
  if (!requirements?.permissions?.length) {
    return
  }

  logger.error('')
  logger.error(`🔐 ${colors.yellow('Required API Permissions')}:`)
  for (const permission of requirements.permissions) {
    logger.error(`   • ${colors.cyan(permission)}`)
  }
  logger.error('')
  logger.error(`💡 ${colors.cyan('To fix this')}:`)
  logger.error(
    `   1. Visit ${webLink('https://socket.dev/settings/api-tokens')}`,
  )
  logger.error(
    '   2. Edit your API token to grant the permissions listed above',
  )
  logger.error('   3. Re-run your command')
  logger.error('')
}

/**
 * Get user-friendly error message for HTTP status codes with actionable guidance.
 */
export async function getErrorMessageForHttpStatusCode(code: number) {
  if (code === HTTP_STATUS_BAD_REQUEST) {
    return (
      `❌ ${colors.red('Invalid request')}: One of the options or parameters may be incorrect.\n` +
      `💡 ${colors.cyan('Try')}: Check your command syntax and parameter values.`
    )
  }
  if (code === HTTP_STATUS_FORBIDDEN || code === HTTP_STATUS_UNAUTHORIZED) {
    return (
      `❌ ${colors.red('Access denied')}: Your API token lacks required permissions or organization access.\n` +
      `💡 ${colors.cyan('Try')}:\n` +
      `  • Run ${colors.bold('socket whoami')} to verify your account and organization\n` +
      `  • Check your API token permissions at ${webLink('https://socket.dev/settings/api-tokens')}\n` +
      `  • Ensure you're accessing the correct organization with ${colors.bold('--org')} flag\n` +
      `  • Verify your plan includes this feature at ${webLink('https://socket.dev/pricing')}`
    )
  }
  if (code === HTTP_STATUS_NOT_FOUND) {
    return (
      `❌ ${colors.red('Not found')}: The requested endpoint or resource doesn't exist.\n` +
      `💡 ${colors.cyan('Try')}:\n` +
      '  • Verify resource names (package, repository, organization)\n' +
      '  • Check if the resource was deleted or moved\n' +
      `  • Update to the latest CLI version: ${colors.bold('socket self-update')} (SEA) or ${colors.bold('npm update -g socket')}\n` +
      `  • Report persistent issues at ${githubRepoLink('SocketDev', 'socket-cli', 'issues')}`
    )
  }
  if (code === HTTP_STATUS_TOO_MANY_REQUESTS) {
    return (
      `❌ ${colors.red('Rate limit exceeded')}: Too many API requests.\n` +
      `💡 ${colors.cyan('Try')}:\n` +
      `  • ${colors.yellow('Free plan')}: Wait a few minutes for quota reset or upgrade at ${webLink('https://socket.dev/pricing')}\n` +
      `  • ${colors.yellow('Paid plan')}: Contact support if rate limits seem incorrect\n` +
      `  • Check current quota: ${colors.bold('socket organization quota')}\n` +
      '  • Reduce request frequency or batch operations'
    )
  }
  if (code === HTTP_STATUS_INTERNAL_SERVER_ERROR) {
    return (
      `❌ ${colors.red('Server error')}: Socket API encountered an internal problem (HTTP 500).\n` +
      `💡 ${colors.cyan('Try')}:\n` +
      '  • Wait a few minutes and retry your command\n' +
      `  • Check Socket status: ${webLink('https://status.socket.dev')}\n` +
      `  • Report persistent issues: ${githubRepoLink('SocketDev', 'socket-cli', 'issues')}`
    )
  }
  return (
    `❌ ${colors.red(`HTTP ${code}`)}: Server responded with unexpected status code.\n` +
    `💡 ${colors.cyan('Try')}: Check Socket status at ${webLink('https://status.socket.dev')} or report the issue.`
  )
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

  const spinnerMessage = description
    ? `Requesting ${description} from API...`
    : 'Requesting from API...'

  let sdkResult: SocketSdkResult<T>
  try {
    sdkResult = await withSpinner({
      message: spinnerMessage,
      operation: async () => {
        return await value
      },
      spinner,
    })

    if (description) {
      const message = `Received Socket API response (after requesting ${description}).`
      if (sdkResult.success) {
        logger.success(message)
      } else {
        logger.info(message)
      }
    }
  } catch (e) {
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
    debugDir('inspect', { socketSdkErrorResult })
    return socketSdkErrorResult
  }

  // Note: TS can't narrow down the type of result due to generics.
  if (sdkResult.success === false) {
    const endpoint = description || 'Socket API'
    debugApiResponse(endpoint, sdkResult.status as number)
    debugDir('inspect', { sdkResult })

    const errCResult = sdkResult as SocketSdkErrorResult<T>
    const errStr = errCResult.error ? String(errCResult.error).trim() : ''
    const message = errStr || NO_ERROR_MESSAGE
    const reason = errCResult.cause || NO_ERROR_MESSAGE

    const cause = await buildErrorCause(
      sdkResult.status as number,
      message,
      reason,
    )

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
    debugFn('error', `API request failed: ${description}`)
    debugHttpError(e)

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

    const cause = await buildErrorCause(
      sdkResult.status as number,
      message,
      reason,
    )

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

  // Add timeout support with AbortController
  // Default to 30 seconds, configurable via SOCKET_CLI_API_TIMEOUT environment variable
  const timeoutMs = constants.ENV.SOCKET_CLI_API_TIMEOUT || 30000

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(`${baseUrl}${baseUrl.endsWith('/') ? '' : '/'}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${btoa(`${apiToken}:`)}`,
      },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
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

  const { spinner } = constants
  const spinnerMessage = description
    ? `Requesting ${description} from API...`
    : 'Requesting from API...'

  let result
  try {
    result = await withSpinner({
      message: spinnerMessage,
      operation: async () => await queryApi(path, apiToken),
      spinner,
    })

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

    debugFn('error', 'Query API request failed')
    debugHttpError(e)

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
    debugFn('error', 'Failed to read API response text')
    debugHttpError(e)

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

  const spinnerMessage = description
    ? `Requesting ${description} from API...`
    : 'Requesting from API...'

  let result
  try {
    // Add timeout support with AbortController
    const timeoutMs = constants.ENV.SOCKET_CLI_API_TIMEOUT || 30000

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    const fetchOptions = {
      method,
      headers: {
        Authorization: `Basic ${btoa(`${apiToken}:`)}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      ...(body ? { body: JSON.stringify(body) } : {}),
    }

    result = await withSpinner({
      message: spinnerMessage,
      operation: async () => {
        try {
          return await fetch(
            `${baseUrl}${baseUrl.endsWith('/') ? '' : '/'}${path}`,
            fetchOptions,
          )
        } finally {
          clearTimeout(timeoutId)
        }
      },
      spinner,
    })

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

    debugFn('error', `API ${method} request failed`)
    debugHttpError(e)

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
    debugFn('error', 'Failed to parse API response JSON')
    debugHttpError(e)
    return {
      ok: false,
      message: 'API request failed',
      cause: 'Unexpected error parsing response JSON',
    }
  }
}
