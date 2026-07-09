/**
 * Low-level HTTP request helpers for the Socket API. Resolves the configured
 * API base URL and wraps httpRequest with extra CA certificate support and
 * safe response-text reading.
 */

import { getSocketCliApiBaseUrl } from '@socketsecurity/lib-stable/env/socket-cli'
import { httpRequest } from '@socketsecurity/lib-stable/http-request/request'
import { isNonEmptyString } from '@socketsecurity/lib-stable/strings/predicates'

import { CONFIG_KEY_API_BASE_URL } from '../../constants/config.mts'
import { API_V0_URL } from '../../constants/socket.mts'
import { getConfigValueOrUndef } from '../config.mts'

import { getExtraCaCerts } from './sdk.mts'

import type { HttpRequestOptions } from '@socketsecurity/lib-stable/http-request/request-types'
import type { HttpResponse } from '@socketsecurity/lib-stable/http-request/response-types'

// The Socket API server that should be used for operations.
export function getDefaultApiBaseUrl(): string | undefined {
  const baseUrl =
    getSocketCliApiBaseUrl() || getConfigValueOrUndef(CONFIG_KEY_API_BASE_URL)
  if (isNonEmptyString(baseUrl)) {
    return baseUrl
  }
  return API_V0_URL
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
