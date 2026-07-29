/**
 * API utilities for Socket CLI.
 * Provides consistent API communication with error handling and permissions management.
 *
 * Key Functions:
 * - getDefaultApiBaseUrl: Get configured API endpoint
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
 * - Respects SOCKET_CLI_API_BASE_URL environment variable
 * - Falls back to configured apiBaseUrl or default API_V0_URL
 */

import { Agent as HttpsAgent, request as httpsRequest } from 'node:https'
import { ReadableStream } from 'node:stream/web'

import { messageWithCauses } from 'pony-cause'

import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'

import { getConfigValueOrUndef } from './config.mts'
import { debugApiRequest, debugApiResponse } from './debug.mts'
import constants, {
  CONFIG_KEY_API_BASE_URL,
  EMPTY_VALUE,
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_FORBIDDEN,
  HTTP_STATUS_INTERNAL_SERVER_ERROR,
  HTTP_STATUS_NOT_FOUND,
  HTTP_STATUS_UNAUTHORIZED,
} from '../constants.mts'
import { getRequirements, getRequirementsKey } from './requirements.mts'
import { getCliUserAgent, getDefaultApiToken, getExtraCaCerts } from './sdk.mts'

import type { CResult } from '../types.mts'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

const MAX_REDIRECTS = 20
const NO_ERROR_MESSAGE = 'No error message returned'

// Cached HTTPS agent for direct API calls. Undefined only until the first
// getHttpsAgent() call lazily creates it.
let _httpsAgent: HttpsAgent | undefined

// Returns an explicit HTTPS agent for direct API calls, carrying extra CA
// certificates when SSL_CERT_FILE is set but NODE_EXTRA_CA_CERTS is not. An
// explicit agent is always returned. Node >=19's global agent enables keepAlive
// with a 5s socket timeout that Node applies as a per-socket inactivity
// timeout. A request made without an explicit agent inherits it and is torn
// down after 5s of socket inactivity, prematurely dropping slow or idle-gapped
// requests (e.g. streaming full-scan responses, large downloads) even when no
// timeout was requested. A fresh Agent carries no timeout.
function getHttpsAgent(): HttpsAgent {
  if (_httpsAgent) {
    return _httpsAgent
  }
  const ca = getExtraCaCerts()
  const agent = ca ? new HttpsAgent({ ca }) : new HttpsAgent()
  _httpsAgent = agent
  return agent
}

// All outbound API requests use node:https.request rather than global fetch.
// This ensures no body timeout is applied — large streaming ND-JSON responses
// (e.g. full scan results) can transfer without a hard deadline. An explicit
// HttpsAgent is always passed (carrying extra CA certificates when
// SSL_CERT_FILE is configured) so requests do not inherit Node's global-agent
// keepAlive socket timeout.
export type ApiFetchInit = {
  body?: string | undefined
  headers?: Record<string, string> | undefined
  method?: string | undefined
}

// Internal httpsRequest-based fetch with redirect support.
function _httpsRequestFetch(
  url: string,
  init: ApiFetchInit,
  agent: HttpsAgent,
  redirectCount: number,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...init.headers }
    // Set Content-Length for request bodies to avoid chunked transfer encoding.
    if (init.body) {
      headers['content-length'] = String(Buffer.byteLength(init.body))
    }
    const req = httpsRequest(
      url,
      {
        method: init.method || 'GET',
        headers,
        agent,
      },
      res => {
        const { statusCode } = res
        // Follow redirects to match fetch() behavior.
        if (
          statusCode &&
          statusCode >= 300 &&
          statusCode < 400 &&
          res.headers['location']
        ) {
          // Consume the response body to free up memory.
          res.resume()
          if (redirectCount >= MAX_REDIRECTS) {
            reject(new Error('Maximum redirect limit reached'))
            return
          }
          const redirectUrl = new URL(res.headers['location'], url).href
          // Strip sensitive headers on cross-origin redirects to match
          // fetch() behavior per the Fetch spec.
          const originalOrigin = new URL(url).origin
          const redirectOrigin = new URL(redirectUrl).origin
          let redirectHeaders = init.headers
          if (originalOrigin !== redirectOrigin && redirectHeaders) {
            redirectHeaders = { ...redirectHeaders }
            for (const key of Object.keys(redirectHeaders)) {
              const lower = key.toLowerCase()
              if (
                lower === 'authorization' ||
                lower === 'cookie' ||
                lower === 'proxy-authorization'
              ) {
                delete redirectHeaders[key]
              }
            }
          }
          // 307 and 308 preserve the original method and body.
          const preserveMethod = statusCode === 307 || statusCode === 308
          resolve(
            _httpsRequestFetch(
              redirectUrl,
              preserveMethod
                ? { ...init, headers: redirectHeaders }
                : { headers: redirectHeaders, method: 'GET' },
              agent,
              redirectCount + 1,
            ),
          )
          return
        }
        // Build response headers immediately on receipt.
        const responseHeaders = new Headers()
        for (const [key, value] of Object.entries(res.headers)) {
          if (typeof value === 'string') {
            responseHeaders.set(key, value)
          } else if (Array.isArray(value)) {
            for (const v of value) {
              responseHeaders.append(key, v)
            }
          }
        }
        // Resolve with a streaming body as soon as headers are available,
        // matching fetch() semantics. Callers that pipe response.body (e.g.
        // streamDownloadWithFetch) receive a live ReadableStream rather than
        // a fully-buffered Buffer.
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            res.on('data', (chunk: Buffer) => {
              controller.enqueue(chunk)
            })
            res.on('end', () => {
              controller.close()
            })
            res.on('error', (err: Error) => {
              controller.error(err)
            })
          },
          cancel() {
            res.destroy()
          },
        })
        resolve(
          new Response(body, {
            status: statusCode ?? 0,
            statusText: res.statusMessage ?? '',
            headers: responseHeaders,
          }),
        )
      },
    )
    if (init.body) {
      req.write(init.body)
    }
    req.on('error', reject)
    req.end()
  })
}

export async function apiFetch(
  url: string,
  init: ApiFetchInit = {},
): Promise<Response> {
  return await _httpsRequestFetch(url, init, getHttpsAgent(), 0)
}

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
  const key = getRequirementsKey(cmdPath)
  return (requirements.api as any)[key] || undefined
}

/**
 * Log required permissions for a command when encountering 403 errors.
 */
function logPermissionsFor403(cmdPath?: string | undefined): void {
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
    constants.ENV.SOCKET_CLI_API_BASE_URL ||
    getConfigValueOrUndef(CONFIG_KEY_API_BASE_URL)
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
  if (code === HTTP_STATUS_BAD_REQUEST) {
    return 'One of the options passed might be incorrect'
  }
  if (code === HTTP_STATUS_UNAUTHORIZED) {
    return 'Your Socket API token appears to be invalid, expired, or revoked. Please verify your token is correct and active'
  }
  if (code === HTTP_STATUS_FORBIDDEN) {
    return 'Your Socket API token may not have the required permissions for this command or you might be trying to access (data from) an organization that is not linked to the API token you are logged in with'
  }
  if (code === HTTP_STATUS_NOT_FOUND) {
    return 'The requested Socket API endpoint was not found (404) or there was no result for the requested parameters. If unexpected, this could be a temporary problem caused by an incident or a bug in the CLI. If the problem persists please let us know.'
  }
  if (code === HTTP_STATUS_INTERNAL_SERVER_ERROR) {
    return 'There was an unknown server side problem with your request. This ought to be temporary. Please let us know if this problem persists.'
  }
  return `Server responded with status code ${code}`
}

export type HandleApiCallOptions = {
  description?: string | undefined
  spinner?: Spinner | undefined
  silence?: boolean | undefined
  commandPath?: string | undefined
}

/**
 * The subset of a Socket SDK result that {@link handleApiCall} reads. Both the
 * OpenAPI-derived `SocketSdkResult<T>` family and the SDK 4.x strict result
 * types (`OrganizationsResult`, `RepositoryResult`, `DeleteResult`, ...)
 * structurally satisfy this shape, so a caller can pass whichever result a
 * given SDK method returns without forcing a (sometimes stale) operation-key
 * shape onto the strict return types.
 */
export type SocketSdkReturnedResult =
  | {
      cause?: undefined
      data: unknown
      error?: undefined
      status: number
      success: true
    }
  | {
      cause?: string | undefined
      data?: undefined
      error: string
      status: number
      success: false
      url?: string | undefined
    }

/**
 * The success `data` type carried by a Socket SDK result union `R`. The
 * conditional distributes over `R`'s members, so only the success member(s)
 * contribute their `data`; the error member resolves to `never` and drops out.
 * Inferring the whole result `R` and extracting here (rather than inferring a
 * bare `Data` from a `Promise<{ data: Data } | ...>`) avoids `Data` absorbing
 * the error branch's `data?: undefined` — which would otherwise widen every
 * result to `CResult<Data | undefined>`.
 */
export type ApiCallSuccessData<R> = R extends {
  success: true
  data: infer Data
}
  ? Data
  : never

export type ApiCallResult<R extends SocketSdkReturnedResult> = CResult<
  ApiCallSuccessData<R>
>

/**
 * Handle Socket SDK API calls with error handling and permission logging.
 */
export async function handleApiCall<R extends SocketSdkReturnedResult>(
  value: Promise<R>,
  options?: HandleApiCallOptions | undefined,
): Promise<ApiCallResult<R>> {
  const {
    commandPath,
    description,
    silence = false,
    spinner,
  } = {
    __proto__: null,
    ...options,
  } as HandleApiCallOptions

  if (!silence) {
    if (description) {
      spinner?.start(`Requesting ${description} from API...`)
    } else {
      spinner?.start()
    }
  }

  let sdkResult: R
  try {
    sdkResult = await value
    if (!silence) {
      spinner?.stop()
    }
    // Only log the message if spinner is provided (silence mode passes undefined).
    if (description && !silence) {
      const message = `Received Socket API response (after requesting ${description}).`
      if (!silence) {
        if (sdkResult.success) {
          logger.success(message)
        } else {
          logger.info(message)
        }
      }
    }
  } catch (e) {
    spinner?.stop()
    const socketSdkErrorResult: ApiCallResult<R> = {
      ok: false,
      message: 'Socket API error',
      cause: messageWithCauses(e as Error),
    }
    // Only log the message if spinner is provided (silence mode passes undefined).
    if (description && !silence) {
      logger.fail(`An error was thrown while requesting ${description}`)
    }
    debugDir('inspect', { socketSdkErrorResult })
    return socketSdkErrorResult
  }

  // The `success` discriminant is a concrete boolean literal in both branches,
  // so this narrows the result to its error branch regardless of `R`.
  if (sdkResult.success === false) {
    const endpoint = description || 'Socket API'
    debugApiResponse('API', endpoint, sdkResult.status)
    debugDir('inspect', { sdkResult })

    const errStr = sdkResult.error ? String(sdkResult.error).trim() : ''
    const message = errStr || NO_ERROR_MESSAGE
    const reason = sdkResult.cause || NO_ERROR_MESSAGE
    const baseCause =
      reason && message !== reason ? `${message} (reason: ${reason})` : message
    const cause = sdkResult.url
      ? `${baseCause} (url: ${sdkResult.url})`
      : baseCause
    const socketSdkErrorResult: ApiCallResult<R> = {
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
  // Narrowing a type parameter by its `success` discriminant resolves `.data`
  // through the constraint's success branch (`unknown`); re-apply the precise
  // per-call success type the return contract already guarantees.
  const socketSdkSuccessResult: ApiCallResult<R> = {
    ok: true,
    data: sdkResult.data as ApiCallSuccessData<R>,
  }
  return socketSdkSuccessResult
}

export async function handleApiCallNoSpinner<R extends SocketSdkReturnedResult>(
  value: Promise<R>,
  description: string,
): Promise<ApiCallResult<R>> {
  let sdkResult: R
  try {
    sdkResult = await value
  } catch (e) {
    debugFn('error', `API request failed: ${description}`)
    debugDir('error', e)

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

  // The `success` discriminant is a concrete boolean literal in both branches,
  // so this narrows the result to its error branch regardless of `R`.
  if (sdkResult.success === false) {
    debugFn('error', `fail: ${description} bad response`)
    debugDir('inspect', { sdkResult })

    const errStr = sdkResult.error ? String(sdkResult.error).trim() : ''
    const message = errStr || NO_ERROR_MESSAGE
    const reason = sdkResult.cause || NO_ERROR_MESSAGE
    const baseCause =
      reason && message !== reason ? `${message} (reason: ${reason})` : message
    const cause = sdkResult.url
      ? `${baseCause} (url: ${sdkResult.url})`
      : baseCause

    return {
      ok: false,
      message: 'Socket API error',
      cause,
      data: {
        code: sdkResult.status,
      },
    }
  } else {
    // Narrowing a type parameter by its `success` discriminant resolves `.data`
    // through the constraint's success branch (`unknown`); re-apply the precise
    // per-call success type the return contract already guarantees.
    return {
      ok: true,
      data: sdkResult.data as ApiCallSuccessData<R>,
    }
  }
}

async function queryApi(path: string, apiToken: string) {
  const baseUrl = getDefaultApiBaseUrl()
  if (!baseUrl) {
    throw new Error('Socket API base URL is not configured.')
  }

  const url = `${baseUrl}${baseUrl.endsWith('/') ? '' : '/'}${path}`
  const result = await apiFetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${btoa(`${apiToken}:`)}`,
      'User-Agent': getCliUserAgent(),
    },
  })
  return result
}

export type ApiTextResult = {
  status: number
  text: string
}

/**
 * Query a Socket API endpoint and return the HTTP status alongside the text
 * body, with error handling. Unlike queryApiSafeText this surfaces the status
 * on success (including 2xx statuses like 202 Accepted), so callers can drive
 * status-dependent flows such as the cached-scan 202 poll loop.
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

  const { spinner } = constants

  if (description) {
    spinner.start(`Requesting ${description} from API...`)
    debugApiRequest('GET', path, constants.ENV.SOCKET_CLI_API_TIMEOUT)
  }

  let result
  const startTime = Date.now()
  try {
    result = await queryApi(path, apiToken)
    const duration = Date.now() - startTime
    debugApiResponse(
      'GET',
      path,
      result.status,
      undefined,
      duration,
      Object.fromEntries(result.headers.entries()),
    )
    if (description) {
      spinner.successAndStop(
        `Received Socket API response (after requesting ${description}).`,
      )
    }
  } catch (e) {
    const duration = Date.now() - startTime
    if (description) {
      spinner.failAndStop(
        `An error was thrown while requesting ${description}.`,
      )
      debugApiResponse('GET', path, undefined, e, duration)
    }

    debugFn('error', 'Query API request failed')
    debugDir('error', e)

    const errStr = e ? String(e).trim() : ''
    const message = 'API request failed'
    const rawCause = errStr || NO_ERROR_MESSAGE
    const baseCause = message !== rawCause ? rawCause : ''
    const cause = baseCause ? `${baseCause} (path: ${path})` : `(path: ${path})`

    return {
      ok: false,
      message,
      cause,
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
      cause: `${result.statusText} (reason: ${await getErrorMessageForHttpStatusCode(status)}) (path: ${path})`,
      data: {
        code: status,
      },
    }
  }

  try {
    const text = await result.text()
    return {
      ok: true,
      data: {
        status: result.status,
        text,
      },
    }
  } catch (e) {
    debugFn('error', 'Failed to read API response text')
    debugDir('error', e)

    return {
      ok: false,
      message: 'API request failed',
      cause: `Unexpected error reading response text (path: ${path})`,
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
        'User-Agent': getCliUserAgent(),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }

    result = await apiFetch(
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

    debugFn('error', `API ${method} request failed`)
    debugDir('error', e)

    const errStr = e ? String(e).trim() : ''
    const message = 'API request failed'
    const rawCause = errStr || NO_ERROR_MESSAGE
    const baseCause = message !== rawCause ? rawCause : ''
    const cause = baseCause ? `${baseCause} (path: ${path})` : `(path: ${path})`

    return {
      ok: false,
      message,
      cause,
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
      cause: `${result.statusText} (reason: ${await getErrorMessageForHttpStatusCode(status)}) (path: ${path})`,
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
    debugDir('error', e)
    return {
      ok: false,
      message: 'API request failed',
      cause: `Unexpected error parsing response JSON (path: ${path})`,
    }
  }
}
