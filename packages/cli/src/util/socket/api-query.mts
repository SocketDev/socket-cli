/**
 * Read-side Socket API query helpers. Executes GET requests against the
 * Socket API and normalizes the response into a CResult, with text and JSON
 * variants plus rich network-error diagnostics.
 */

import { debug, debugDir } from '@socketsecurity/lib-stable/debug/output'
import { getDefaultSpinner } from '@socketsecurity/lib-stable/spinner/default'

import { CONFIG_KEY_API_BASE_URL } from '../../constants/config.mts'
import { debugApiResponse } from '../debug.mts'
import { ConfigError, getNetworkErrorDiagnostics } from '../error/errors.mts'

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
  const result = await queryApiSafeTextWithStatus(
    path,
    description,
    commandPath,
  )
  return result.ok ? { ok: true, data: result.data.text } : result
}

export type ApiTextResult = {
  status: number
  text: string
}

/**
 * Query Socket API endpoint and return the response text together with the
 * HTTP status code, so callers can react to non-200 success codes like the
 * 202 "still processing" reply from cached-scan endpoints.
 */
export async function queryApiSafeTextWithStatus(
  path: string,
  description?: string | undefined,
  commandPath?: string | undefined,
): Promise<CResult<ApiTextResult>> {
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
    spinner?.start(`Requesting ${description} from API…`)
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
    const text = result.text()
    return {
      ok: true,
      data: { status: result.status as number, text },
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
