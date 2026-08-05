/**
 * @file Wire-protocol leaf of the first-party cache-service client — the v2
 *   twirp transport: service config read from the runner environment, the
 *   endpoint URL builder, the JSON request builders and response readers,
 *   and the retrying POST. The wire contract is copied from the
 *   `@actions/cache` 6.2.0 sources: requests carry proto snake_case field
 *   names (useProtoFieldName), int64 fields travel as JSON strings, and
 *   empty repeated fields are omitted. ./client.mts composes these into the
 *   restore/save flows and re-exports everything here, so consumers import
 *   from client.mts only.
 */

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import {
  httpJson,
  HttpResponseError,
} from '@socketsecurity/lib-stable/http-request'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

// The twirp service every cache RPC posts to:
// POST {ACTIONS_RESULTS_URL}/twirp/{service}/{method}.
export const CACHE_TWIRP_SERVICE = 'github.actions.results.api.v1.CacheService'

// Twirp retry posture mirrors upstream's CacheServiceClient defaults in
// spirit: a few attempts with a seconds-scale delay, 5xx-only.
export const CACHE_TWIRP_RETRIES = 2
export const CACHE_TWIRP_RETRY_DELAY_MS = 3000

export interface CacheServiceConfig {
  baseUrl: string
  token: string
}

/**
 * Read the v2 cache-service wiring from the environment. Throws loud on a
 * missing variable — the client is v2-only, with no v1 fallback to hide
 * behind.
 */
export function readCacheServiceConfig(
  env: Record<string, string | undefined> = process.env,
): CacheServiceConfig {
  const baseUrl = env['ACTIONS_RESULTS_URL']
  if (!baseUrl) {
    throw new Error(
      'The cache-service URL is missing. Where: the ACTIONS_RESULTS_URL environment variable. Saw: unset or empty; wanted the v2 cache-service base URL the GitHub Actions runner injects into every job. Fix: run this inside a GitHub Actions job — local runs have no cache service to talk to.',
    )
  }
  const token = env['ACTIONS_RUNTIME_TOKEN']
  if (!token) {
    throw new Error(
      'The cache-service auth token is missing. Where: the ACTIONS_RUNTIME_TOKEN environment variable. Saw: unset or empty; wanted the runtime token the GitHub Actions runner injects into every job. Fix: run this inside a GitHub Actions job — the runner sets the token automatically.',
    )
  }
  return { baseUrl, token }
}

/**
 * The twirp endpoint URL for one CacheService method.
 */
export function cacheTwirpUrl(baseUrl: string, method: string): string {
  return new URL(`/twirp/${CACHE_TWIRP_SERVICE}/${method}`, baseUrl).href
}

// Request field names are the proto snake_case names — the upstream client
// serializes with useProtoFieldName: true — and int64 fields travel as JSON
// strings. Empty repeated fields are omitted (emitDefaultValues: false).
export interface GetCacheEntryDownloadUrlRequest {
  key: string
  restore_keys?: string[] | undefined
  version: string
}

export interface CreateCacheEntryRequest {
  key: string
  version: string
}

export interface FinalizeCacheEntryUploadRequest {
  key: string
  size_bytes: string
  version: string
}

export function buildGetCacheEntryDownloadUrlRequest(
  key: string,
  restoreKeys: readonly string[],
  version: string,
): GetCacheEntryDownloadUrlRequest {
  const request: GetCacheEntryDownloadUrlRequest = { key, version }
  if (restoreKeys.length > 0) {
    request.restore_keys = [...restoreKeys]
  }
  return request
}

export function buildCreateCacheEntryRequest(
  key: string,
  version: string,
): CreateCacheEntryRequest {
  return { key, version }
}

export function buildFinalizeCacheEntryUploadRequest(
  key: string,
  version: string,
  sizeBytes: number,
): FinalizeCacheEntryUploadRequest {
  return { key, size_bytes: String(sizeBytes), version }
}

/**
 * Narrow a twirp response body to a plain record, loud on anything else.
 */
export function asTwirpResponseRecord(
  json: unknown,
  method: string,
): Record<string, unknown> {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error(
      `The cache service answered with a non-object body. Where: the ${method} twirp response. Saw: ${JSON.stringify(json)}; wanted a JSON object. Fix: re-run the job; if it persists, check GitHub Actions cache service status.`,
    )
  }
  return json as Record<string, unknown>
}

/**
 * Read a string field from a twirp JSON response, accepting both the proto
 * snake_case name and the camelCase JSON name — proto3 JSON parsers accept
 * either, so the service may emit either.
 */
export function readTwirpStringField(
  record: Record<string, unknown>,
  protoName: string,
  jsonName: string,
): string | undefined {
  const value = record[jsonName] ?? record[protoName]
  return typeof value === 'string' ? value : undefined
}

export interface CacheEntryDownloadUrlResult {
  matchedKey: string | undefined
  ok: boolean
  signedDownloadUrl: string | undefined
}

export function readGetCacheEntryDownloadUrlResponse(
  json: unknown,
): CacheEntryDownloadUrlResult {
  const record = asTwirpResponseRecord(json, 'GetCacheEntryDownloadURL')
  return {
    matchedKey: readTwirpStringField(record, 'matched_key', 'matchedKey'),
    ok: record['ok'] === true,
    signedDownloadUrl: readTwirpStringField(
      record,
      'signed_download_url',
      'signedDownloadUrl',
    ),
  }
}

export interface CreateCacheEntryResult {
  message: string | undefined
  ok: boolean
  signedUploadUrl: string | undefined
}

export function readCreateCacheEntryResponse(
  json: unknown,
): CreateCacheEntryResult {
  const record = asTwirpResponseRecord(json, 'CreateCacheEntry')
  return {
    message: readTwirpStringField(record, 'message', 'message'),
    ok: record['ok'] === true,
    signedUploadUrl: readTwirpStringField(
      record,
      'signed_upload_url',
      'signedUploadUrl',
    ),
  }
}

export interface FinalizeCacheEntryUploadResult {
  entryId: number | undefined
  message: string | undefined
  ok: boolean
}

export function readFinalizeCacheEntryUploadResponse(
  json: unknown,
): FinalizeCacheEntryUploadResult {
  const record = asTwirpResponseRecord(json, 'FinalizeCacheEntryUpload')
  // entry_id is a proto int64, so it arrives as a JSON string (or a number
  // from a lenient serializer).
  const raw = record['entryId'] ?? record['entry_id']
  let entryId: number | undefined
  if (typeof raw === 'number') {
    entryId = raw
  } else if (typeof raw === 'string' && raw !== '') {
    const parsed = Number.parseInt(raw, 10)
    entryId = Number.isNaN(parsed) ? undefined : parsed
  }
  return {
    entryId,
    message: readTwirpStringField(record, 'message', 'message'),
    ok: record['ok'] === true,
  }
}

/**
 * True when a thrown twirp/HTTP error must NOT be retried: any 4xx —
 * upstream retries only 5xx server errors.
 */
export function isNonRetryableTwirpError(thrown: unknown): boolean {
  return thrown instanceof HttpResponseError && thrown.response.status < 500
}

/**
 * True for the twirp not-found answer to a lookup — a cache miss, not a
 * failure.
 */
export function isCacheMissResponse(thrown: unknown): boolean {
  return thrown instanceof HttpResponseError && thrown.response.status === 404
}

/**
 * POST one twirp method. Throws HttpResponseError on non-2xx (5xx retried,
 * 4xx immediate); resolves with the parsed JSON body.
 */
export async function cacheTwirpPost(
  config: CacheServiceConfig,
  method: string,
  body: object,
): Promise<unknown> {
  return await httpJson(cacheTwirpUrl(config.baseUrl, method), {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
    onRetry: (attempt: number, thrown: unknown, delay: number) => {
      if (isNonRetryableTwirpError(thrown)) {
        return false
      }
      logger.info(
        `Cache-service ${method} attempt ${attempt} failed: ${errorMessage(thrown)}. Retrying in ${delay} ms.`,
      )
      return undefined
    },
    retries: CACHE_TWIRP_RETRIES,
    retryDelay: CACHE_TWIRP_RETRY_DELAY_MS,
    throwOnError: true,
  })
}
