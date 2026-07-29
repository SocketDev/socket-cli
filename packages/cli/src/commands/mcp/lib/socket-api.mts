/**
 * Socket API access for the MCP tools, routed through the CLI's own SDK
 * plumbing (`setupSdk`) so every call inherits the configured API base URL,
 * proxy, timeout, CA bundle, and user agent. Tools never build their own HTTP
 * client for the API.
 *
 * One SDK instance is memoized per token: stdio mode reuses a single client,
 * HTTP + OAuth mode gets one per distinct caller token.
 */

import { setupSdk } from '../../../util/socket/sdk.mts'

import type { SocketSdk } from '@socketsecurity/sdk-stable'

export interface SocketApiFailureResult {
  cause?: string | undefined
  data?: undefined
  error: string
  status: number
  success: false
}

export interface SocketApiSuccessResult<T> {
  cause?: undefined
  data: T
  error?: undefined
  status: number
  success: true
}

export type SocketApiResult<T> =
  | SocketApiFailureResult
  | SocketApiSuccessResult<T>

const sdkCache = new Map<string, SocketSdk>()

/**
 * Build the query string for the org alerts endpoint. Only set values are
 * included; the caller's page size is clamped by the tool's input schema.
 */
export function buildSocketAlertsQuery(filters: {
  alertType?: string | undefined
  artifactName?: string | undefined
  artifactType?: string | undefined
  category?: string | undefined
  cursor?: string | undefined
  perPage?: number | undefined
  repoSlug?: string | undefined
  severity?: string | undefined
  status?: string | undefined
}): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.severity) {
    params.set('filters.alertSeverity', filters.severity)
  }
  if (filters.status) {
    params.set('filters.alertStatus', filters.status)
  }
  if (filters.category) {
    params.set('filters.alertCategory', filters.category)
  }
  if (filters.artifactType) {
    params.set('filters.artifactType', filters.artifactType)
  }
  if (filters.artifactName) {
    params.set('filters.artifactName', filters.artifactName)
  }
  if (filters.alertType) {
    params.set('filters.alertType', filters.alertType)
  }
  if (filters.repoSlug) {
    params.set('filters.repoSlug', filters.repoSlug)
  }
  if (typeof filters.perPage === 'number') {
    params.set('per_page', String(filters.perPage))
  }
  if (filters.cursor) {
    params.set('startAfterCursor', filters.cursor)
  }
  return params
}

export async function fetchSocketAlerts(
  apiToken: string,
  orgSlug: string,
  filters: Parameters<typeof buildSocketAlertsQuery>[0],
): Promise<unknown> {
  const sdk = await resolveSocketSdkForToken(apiToken)
  const query = buildSocketAlertsQuery(filters).toString()
  const path = `orgs/${encodeURIComponent(orgSlug)}/alerts${query ? `?${query}` : ''}`
  const result = await sdk.getApi<unknown>(path, {
    responseType: 'json',
    throws: false,
  })
  return unwrapSocketApiResult(
    toSocketApiResult(result),
    'Listing Socket alerts',
    `GET /v0/${path}`,
  )
}

export async function fetchSocketOrganizations(
  apiToken: string,
): Promise<unknown> {
  const sdk = await resolveSocketSdkForToken(apiToken)
  const result = await sdk.listOrganizations()
  return unwrapSocketApiResult(
    result,
    'Listing Socket organizations',
    'GET /v0/organizations',
  )
}

export async function fetchSocketPackageFileList(
  apiToken: string,
  purl: string,
): Promise<unknown> {
  const sdk = await resolveSocketSdkForToken(apiToken)
  const path = `purl/file-list/${encodeURIComponent(purl)}`
  const result = await sdk.getApi<unknown>(path, {
    responseType: 'json',
    throws: false,
  })
  return unwrapSocketApiResult(
    toSocketApiResult(result),
    'Listing package files',
    `GET /v0/${path}`,
  )
}

export async function fetchSocketThreatFeed(
  apiToken: string,
  orgSlug: string,
  queryParams: Record<string, unknown>,
): Promise<unknown> {
  const sdk = await resolveSocketSdkForToken(apiToken)
  const result = await sdk.getOrgThreatFeedItems(orgSlug, queryParams)
  return unwrapSocketApiResult(
    result,
    'Reading the Socket threat feed',
    `GET /v0/orgs/${orgSlug}/threat-feed`,
  )
}

export async function resolveSocketSdkForToken(
  apiToken: string,
): Promise<SocketSdk> {
  const cached = sdkCache.get(apiToken)
  if (cached) {
    return cached
  }
  const result = await setupSdk({ apiToken })
  if (!result.ok) {
    throw new Error(
      result.cause || result.message || 'Failed to set up the Socket SDK',
    )
  }
  sdkCache.set(apiToken, result.data)
  return result.data
}

/**
 * Compose the What / Where / Saw / Fix message for a non-2xx Socket API reply.
 */
export function socketApiErrorMessage(
  what: string,
  where: string,
  status: number | undefined,
  cause: string | undefined,
): string {
  const saw =
    status === undefined
      ? 'no HTTP status'
      : `HTTP ${status}${cause ? ` (${cause})` : ''}`
  let fix =
    'Fix: retry, and report the status and path to Socket support if it persists.'
  if (status === 401) {
    fix =
      'Fix: run `socket login` (or refresh SOCKET_API_TOKEN) and retry with a valid token.'
  } else if (status === 403) {
    fix =
      'Fix: re-authenticate with an account that holds the required organization permissions, then retry.'
  } else if (status === 404) {
    fix =
      'Fix: confirm the organization slug with the `organizations` tool, then retry.'
  }
  return `${what} failed. Where: ${where}. Saw: ${saw}, wanted HTTP 200. ${fix}`
}

/**
 * Narrow `getApi`'s `T | SocketSdkGenericResult<T>` union. With `throws: false`
 * the SDK returns the result envelope, but the static type keeps both arms, so
 * the envelope is re-derived field by field rather than asserted — an
 * unrecognized shape becomes a failure instead of a silently trusted success.
 */
export function toSocketApiResult(value: unknown): SocketApiResult<unknown> {
  if (typeof value === 'object' && value !== null && 'success' in value) {
    const status =
      'status' in value && typeof value.status === 'number' ? value.status : 0
    if (value.success === true) {
      return {
        data: 'data' in value ? value.data : undefined,
        status,
        success: true,
      }
    }
    return {
      cause:
        'cause' in value && typeof value.cause === 'string'
          ? value.cause
          : undefined,
      error:
        'error' in value && typeof value.error === 'string'
          ? value.error
          : 'Socket API reported a failure with no error text',
      status,
      success: false,
    }
  }
  return {
    error: 'Socket API returned an unrecognized response envelope',
    status: 0,
    success: false,
  }
}

export function unwrapSocketApiResult<T>(
  result: SocketApiResult<T>,
  what: string,
  where: string,
): T {
  if (!result.success) {
    throw new Error(
      socketApiErrorMessage(
        what,
        where,
        result.status,
        result.cause || result.error,
      ),
    )
  }
  return result.data
}
