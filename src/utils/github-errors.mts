/**
 * GitHub API error detection for the raw-fetch `socket scan github` flow.
 *
 * The `socket scan github` command talks to the GitHub REST API directly
 * through `apiFetch` (see utils/api.mts) rather than Octokit. That path used
 * to read every response body and JSON-parse it without ever inspecting the
 * HTTP status, so a rate-limit response (`403` with `x-ratelimit-remaining: 0`,
 * `429`, or a secondary-limit body) was misread as "repo has no default
 * branch / no manifests" and the run reported a silent success. See Linear
 * ASK-167.
 *
 * This module centralizes:
 * - Classifying a GitHub response as a blocking error (rate limit / abuse
 *   detection / auth) with a clear, actionable message.
 * - A bounded-retry request wrapper that respects `Retry-After` /
 *   `x-ratelimit-reset` for short reset windows and retries transient 5xx /
 *   network failures with capped exponential backoff.
 */

import { debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { apiFetch } from './api.mts'
import { debugApiRequest, debugApiResponse } from './debug.mts'
import { formatErrorWithDetail } from './errors.mts'
import {
  HTTP_STATUS_FORBIDDEN,
  HTTP_STATUS_INTERNAL_SERVER_ERROR,
  HTTP_STATUS_UNAUTHORIZED,
} from '../constants.mts'

import type { ApiFetchInit } from './api.mts'
import type { CResult } from '../types.mts'

// GitHub returns 429 for some secondary rate limits; there is no shared
// constant for it in constants.mts, so define it locally.
const HTTP_STATUS_TOO_MANY_REQUESTS = 429

// Retry at most this many times for transient (5xx / network) failures,
// counting the initial attempt.
const MAX_TRANSIENT_ATTEMPTS = 3

// Cap for exponential backoff between transient retries.
const MAX_BACKOFF_MS = 10_000

// Only wait-and-retry a rate-limited response when the reset window is at
// most this many seconds. The usual primary-limit reset is up to an hour
// away, which is not worth blocking a CLI run on — those surface immediately.
const CHEAP_RATE_LIMIT_WAIT_MAX_SECONDS = 30

// Canonical `message` values returned for blocking conditions. Exported so
// the scan loop can short-circuit on them without matching free-form strings.
export const GITHUB_ERR_ABUSE_DETECTION = 'GitHub abuse detection triggered'
export const GITHUB_ERR_AUTH_FAILED = 'GitHub authentication failed'
export const GITHUB_ERR_RATE_LIMIT = 'GitHub rate limit exceeded'

// A blocking error means every subsequent repo will fail for the same
// reason, so the scan loop should stop and surface it rather than silently
// reporting "0 manifests".
const BLOCKING_ERROR_MESSAGES = new Set<string>([
  GITHUB_ERR_ABUSE_DETECTION,
  GITHUB_ERR_AUTH_FAILED,
  GITHUB_ERR_RATE_LIMIT,
])

/**
 * Whether a CResult `message` is one of the blocking GitHub conditions
 * (rate limit / abuse detection / auth) that should stop a multi-repo scan.
 */
export function isGitHubBlockingError(message: string): boolean {
  return BLOCKING_ERROR_MESSAGES.has(message)
}

/**
 * Seconds to wait before a rate-limited request could succeed, derived from
 * the `Retry-After` header (seconds) or the `x-ratelimit-reset` header (an
 * epoch-seconds timestamp). Returns undefined when neither is usable.
 */
export function getRateLimitWaitSeconds(headers: Headers): number | undefined {
  const retryAfter = headers.get('retry-after')
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10)
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds
    }
  }
  const reset = headers.get('x-ratelimit-reset')
  if (reset) {
    const resetEpochSeconds = Number.parseInt(reset, 10)
    if (Number.isFinite(resetEpochSeconds)) {
      return Math.max(0, resetEpochSeconds - Math.floor(Date.now() / 1000))
    }
  }
  return undefined
}

/**
 * Classify a GitHub API response as a blocking error (rate limit / abuse
 * detection / auth). Returns undefined when the response is not one of those
 * conditions, so the caller can continue its normal parsing (including its
 * own handling of 404s, empty repos, etc.).
 */
export function classifyGitHubResponse(
  status: number,
  headers: Headers,
  bodyText: string,
  context: string,
): CResult<never> | undefined {
  const lowerBody = bodyText.toLowerCase()

  // Secondary / abuse rate limit. Check first since it is more specific than
  // the standard rate limit and shares the 403 status.
  if (
    status === HTTP_STATUS_FORBIDDEN &&
    (lowerBody.includes('secondary rate limit') ||
      lowerBody.includes('abuse detection'))
  ) {
    return {
      ok: false,
      message: GITHUB_ERR_ABUSE_DETECTION,
      cause:
        `GitHub abuse detection triggered while ${context}. ` +
        'This happens when too many requests are made in a short period. ' +
        'Wait a minute before retrying, and reduce the number of repos ' +
        'scanned at once.',
    }
  }

  // Standard rate limit: 429, or 403 with the quota exhausted
  // (x-ratelimit-remaining: 0) or a rate-limit message in the body.
  const remaining = headers.get('x-ratelimit-remaining')
  if (
    status === HTTP_STATUS_TOO_MANY_REQUESTS ||
    (status === HTTP_STATUS_FORBIDDEN &&
      (remaining === '0' || lowerBody.includes('rate limit')))
  ) {
    const waitSeconds = getRateLimitWaitSeconds(headers)
    const resetHint =
      waitSeconds === undefined
        ? 'Try again in a few minutes.'
        : `Try again in ${waitSeconds} second${waitSeconds === 1 ? '' : 's'}.`
    return {
      ok: false,
      message: GITHUB_ERR_RATE_LIMIT,
      cause:
        `GitHub API rate limit exceeded on the supplied token while ${context}. ` +
        `${resetHint} ` +
        'Authenticated requests get a far higher rate limit than ' +
        'unauthenticated ones — set a valid GITHUB_TOKEN (or pass ' +
        '--github-token) if you have not already.',
    }
  }

  // Authentication failure. The token is invalid/expired or lacks scopes;
  // retrying with the same token will not help.
  if (status === HTTP_STATUS_UNAUTHORIZED) {
    return {
      ok: false,
      message: GITHUB_ERR_AUTH_FAILED,
      cause:
        `GitHub authentication failed while ${context}. ` +
        'The token may be invalid, expired, or missing required scopes ' +
        '(read access to repository contents). Provide a valid GITHUB_TOKEN ' +
        '(or pass --github-token) and retry.',
    }
  }

  return undefined
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), MAX_BACKOFF_MS)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

/**
 * Perform a GitHub REST request through `apiFetch`, detecting rate-limit /
 * auth / abuse-detection responses up front and applying bounded retries.
 *
 * On success returns the response together with its already-read body text
 * (the body stream can only be consumed once). On a blocking or exhausted
 * transient failure returns a typed CResult error. Non-blocking non-2xx
 * responses (e.g. 404, or GitHub's "empty repository" 200) are returned as
 * successes so the caller keeps its existing body-parsing logic.
 *
 * Retry policy:
 * - Rate limit / abuse: wait once for the reset window, but only when it is
 *   short (<= CHEAP_RATE_LIMIT_WAIT_MAX_SECONDS); otherwise surface the error
 *   immediately. Long primary-limit resets are not worth blocking on.
 * - Auth: never retried.
 * - 5xx / network: capped exponential backoff, MAX_TRANSIENT_ATTEMPTS total.
 */
export async function githubApiRequest(
  url: string,
  init: ApiFetchInit,
  context: string,
  // Injectable request implementation. Defaults to the real `apiFetch`;
  // tests pass a fake so the retry/backoff logic can be exercised without
  // touching the network.
  fetchImpl: (url: string, init: ApiFetchInit) => Promise<Response> = apiFetch,
): Promise<CResult<{ response: Response; bodyText: string }>> {
  const method = init.method || 'GET'
  let rateLimitWaitUsed = false
  for (let attempt = 1; ; attempt += 1) {
    debugApiRequest(method, url)
    let response: Response
    try {
      // eslint-disable-next-line no-await-in-loop
      response = await fetchImpl(url, init)
      debugApiResponse(method, url, response.status)
    } catch (e) {
      debugApiResponse(method, url, undefined, e)
      // Network-level failure (DNS, connection reset, timeout). Retry a few
      // times with bounded backoff before giving up.
      if (attempt < MAX_TRANSIENT_ATTEMPTS) {
        debugFn('notice', `retry: network error while ${context}`, attempt)
        // eslint-disable-next-line no-await-in-loop
        await sleep(backoffMs(attempt))
        continue
      }
      return {
        ok: false,
        message: 'Network error connecting to GitHub',
        cause: formatErrorWithDetail(`Network error while ${context}`, e),
      }
    }

    // eslint-disable-next-line no-await-in-loop
    const bodyText = await response.text()

    const blocking = classifyGitHubResponse(
      response.status,
      response.headers,
      bodyText,
      context,
    )
    if (blocking) {
      // Auth failures never succeed on retry.
      if (blocking.message === GITHUB_ERR_AUTH_FAILED) {
        return blocking
      }
      // Rate limit / abuse: retry once, but only when the reset window is
      // short enough to be worth waiting on.
      const waitSeconds = getRateLimitWaitSeconds(response.headers)
      if (
        !rateLimitWaitUsed &&
        waitSeconds !== undefined &&
        waitSeconds <= CHEAP_RATE_LIMIT_WAIT_MAX_SECONDS
      ) {
        rateLimitWaitUsed = true
        logger.info(
          `GitHub rate limit hit while ${context}; waiting ${waitSeconds}s before one retry...`,
        )
        // Add a second of slack so we retry just past the reset boundary.
        // eslint-disable-next-line no-await-in-loop
        await sleep((waitSeconds + 1) * 1000)
        continue
      }
      return blocking
    }

    // Transient server errors: retry with bounded backoff, then surface.
    if (response.status >= HTTP_STATUS_INTERNAL_SERVER_ERROR) {
      if (attempt < MAX_TRANSIENT_ATTEMPTS) {
        debugFn(
          'notice',
          `retry: GitHub ${response.status} while ${context}`,
          attempt,
        )
        // eslint-disable-next-line no-await-in-loop
        await sleep(backoffMs(attempt))
        continue
      }
      return {
        ok: false,
        message: 'GitHub server error',
        cause:
          `GitHub server error (${response.status}) while ${context}. ` +
          'GitHub may be experiencing issues; try again shortly.',
      }
    }

    return { ok: true, data: { response, bodyText } }
  }
}
