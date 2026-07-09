/**
 * Write-side Socket API helper. Sends POST/PUT requests to the Socket API
 * with JSON body encoding and the same network-error diagnostics and
 * permission-logging behavior as the read-side query helpers.
 */

import { debug, debugDir } from '@socketsecurity/lib-stable/debug/output'
import { getDefaultSpinner } from '@socketsecurity/lib-stable/spinner/default'

import { debugApiResponse } from '../debug.mts'
import { getNetworkErrorDiagnostics } from '../error/errors.mts'

import {
  getErrorMessageForHttpStatusCode,
  logPermissionsFor403,
} from './api-error-messages.mts'
import {
  getDefaultApiBaseUrl,
  socketHttpRequest,
  tryReadResponseText,
} from './api-http.mts'
import { getDefaultApiToken } from './sdk.mts'

import type { CResult } from '../../types.mts'

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
    spinner?.start(`Requesting ${description} from API…`)
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
