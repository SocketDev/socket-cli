/**
 * @file First-party GitHub Actions cache-service client — the v2 twirp
 *   protocol the `@actions/cache` npm package speaks, reimplemented over
 *   socket-lib http + spawn so the fleet carries no @actions/* dependency
 *   (and none of its @azure/* + protobuf tree). v2-only by design: the fleet
 *   runs on github.com runners, where ACTIONS_RESULTS_URL and
 *   ACTIONS_RUNTIME_TOKEN are always injected — a missing variable is a loud
 *   error, never a v1 fallback. The wire contract (twirp method names,
 *   snake_case request fields, the '1.0' version salt, tar/zstd flags) is
 *   copied from @actions/cache@6.2.0, the behavioral reference pinned at
 *   upstream/actions-toolkit. This file owns the contract-level pieces —
 *   version hash, key/path validation, the single-PUT upload, and the
 *   restoreCache/saveCache flows the fleet cache CLIs (restore.mts /
 *   save.mts) inject — and composes two leaves it re-exports in full:
 *   ./twirp.mts (service config + wire protocol) and ./tar-archive.mts
 *   (compression detection + tar create/extract). Consumers import from
 *   this file only. Service errors THROW — the CLIs own the exit code —
 *   except the reserve conflict, which throws an Error named
 *   'ReserveCacheError' so the save CLI can keep treating an already-saved
 *   key as a no-op.
 */

export * from './tar-archive.mts'
export * from './twirp.mts'

import crypto from 'node:crypto'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { httpRequest } from '@socketsecurity/lib-stable/http-request'
import { httpDownload } from '@socketsecurity/lib-stable/http-request/download'

import {
  cacheArchiveFileName,
  createCacheArchive,
  createCacheScratchDirectory,
  detectCompressionMethod,
  extractCacheArchive,
  removeArchiveQuietly,
} from './tar-archive.mts'
import {
  buildCreateCacheEntryRequest,
  buildFinalizeCacheEntryUploadRequest,
  buildGetCacheEntryDownloadUrlRequest,
  cacheTwirpPost,
  isCacheMissResponse,
  readCacheServiceConfig,
  readCreateCacheEntryResponse,
  readFinalizeCacheEntryUploadResponse,
  readGetCacheEntryDownloadUrlResponse,
} from './twirp.mts'

import type { CacheCompressionMethod } from './tar-archive.mts'

// Load-bearing hash salt — upstream appends it to every version-hash input
// (cacheUtils.getCacheVersion), so dropping or changing it would orphan every
// existing cache entry.
export const CACHE_VERSION_SALT = '1.0'

// Key limits enforced by upstream checkKey/restoreCache before any RPC.
export const CACHE_KEY_MAX_LENGTH = 512
export const CACHE_KEYS_MAX_COUNT = 10

// Azure Put Blob accepts a single upload up to 5000 MiB; the client uploads
// in ONE put (the chunked block upload the Azure SDK does is an optimization,
// not a protocol requirement), so a larger archive is a loud error.
export const CACHE_SINGLE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024 * 1024

// Archive transfer timeouts — generous because a warm pnpm store or cargo
// target dir runs to hundreds of MB.
export const CACHE_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000
export const CACHE_UPLOAD_TIMEOUT_MS = 30 * 60 * 1000

// The error name the save CLI treats as an idempotent no-op (the key is
// already saved or another job holds the reservation) — the same name
// @actions/cache used, matched by name so no class crosses the seam.
export const RESERVE_CACHE_ERROR_NAME = 'ReserveCacheError'

/**
 * The reserve-conflict error saveCache throws when CreateCacheEntry refuses
 * the reservation. Carries the service detail so the CLI's note names it.
 */
export function reserveConflictError(key: string, detail: string): Error {
  const err = new Error(
    `Unable to reserve cache with key ${key} — another job may have saved or reserved it. Saw: ${detail}`,
  )
  err.name = RESERVE_CACHE_ERROR_NAME
  return err
}

/**
 * Validate the path list the way upstream checkPaths does: at least one
 * entry. Existence is checked at archive time, not here — restore paths need
 * not exist yet.
 */
export function validateCachePaths(paths: readonly string[]): void {
  if (paths.length === 0) {
    throw new Error(
      'No cache paths given. Where: the paths argument. Saw: an empty list; wanted at least one directory or file path. Fix: pass every path the cache entry should carry.',
    )
  }
}

/**
 * Validate one cache key the way upstream checkKey does: at most 512
 * characters and no commas — the service reserves the comma as a list
 * separator.
 */
export function validateCacheKey(key: string): void {
  if (key.length > CACHE_KEY_MAX_LENGTH) {
    throw new Error(
      `The cache key is too long. Where: key '${key}'. Saw: ${key.length} characters; wanted at most ${CACHE_KEY_MAX_LENGTH}. Fix: shorten the key composition.`,
    )
  }
  if (key.includes(',')) {
    throw new Error(
      `The cache key contains a comma. Where: key '${key}'. Saw: a ',' — the service reserves it as a separator; wanted a comma-free key. Fix: drop or replace the comma.`,
    )
  }
}

/**
 * Validate the primary + restore key set the way upstream restoreCache does:
 * at most 10 keys total, each individually valid.
 */
export function validateCacheKeySet(keys: readonly string[]): void {
  if (keys.length > CACHE_KEYS_MAX_COUNT) {
    throw new Error(
      `Too many cache keys. Where: the primary key plus restore keys. Saw: ${keys.length}; wanted at most ${CACHE_KEYS_MAX_COUNT}. Fix: trim the restore-key list.`,
    )
  }
  for (let i = 0, { length } = keys; i < length; i += 1) {
    validateCacheKey(keys[i]!)
  }
}

export interface CacheVersionOptions {
  crossOsArchive?: boolean | undefined
  platform?: NodeJS.Platform | undefined
}

/**
 * The cache-entry version hash — upstream cacheUtils.getCacheVersion
 * byte-for-byte: sha256 hex of the paths (order preserved), the compression
 * method when present, 'windows-only' on win32 unless the archive is
 * cross-OS, and the '1.0' salt, joined with '|'. Two jobs only share an
 * entry when this hash matches, so any drift here silently cold-starts every
 * cache in the fleet.
 */
export function cacheVersion(
  paths: readonly string[],
  compressionMethod?: CacheCompressionMethod | undefined,
  options?: CacheVersionOptions | undefined,
): string {
  const opts = { __proto__: null, ...options }
  const platform = opts.platform ?? process.platform
  const components = [...paths]
  if (compressionMethod) {
    components.push(compressionMethod)
  }
  if (platform === 'win32' && !opts.crossOsArchive) {
    components.push('windows-only')
  }
  components.push(CACHE_VERSION_SALT)
  return crypto.createHash('sha256').update(components.join('|')).digest('hex')
}

/**
 * Upload the archive to the signed Azure blob URL in one PUT — the SAS URL
 * carries the auth, `x-ms-blob-type: BlockBlob` names the blob kind.
 */
export async function uploadCacheArchive(
  signedUploadUrl: string,
  archivePath: string,
  sizeBytes: number,
): Promise<void> {
  if (sizeBytes > CACHE_SINGLE_UPLOAD_MAX_BYTES) {
    throw new Error(
      `The cache archive is too large for a single upload. Where: ${archivePath}. Saw: ${sizeBytes} bytes; wanted at most ${CACHE_SINGLE_UPLOAD_MAX_BYTES} (the Azure single-put limit). Fix: cache fewer/smaller paths, or split the entry into multiple keys.`,
    )
  }
  await httpRequest(signedUploadUrl, {
    body: createReadStream(archivePath),
    headers: {
      'content-length': String(sizeBytes),
      'x-ms-blob-type': 'BlockBlob',
    },
    method: 'PUT',
    throwOnError: true,
    timeout: CACHE_UPLOAD_TIMEOUT_MS,
  })
}

/**
 * Restore the given paths from the cache service. Returns the matched key on
 * a hit (exact or restore-key prefix) after extraction, undefined on a clean
 * miss; every other failure throws — the CLI owns the exit code.
 */
export async function restoreCache(
  paths: string[],
  primaryKey: string,
  restoreKeys?: string[] | undefined,
): Promise<string | undefined> {
  validateCachePaths(paths)
  const keys = [primaryKey, ...(restoreKeys ?? [])]
  validateCacheKeySet(keys)
  const config = readCacheServiceConfig()
  const compressionMethod = await detectCompressionMethod()
  const version = cacheVersion(paths, compressionMethod)
  let responseJson: unknown
  try {
    responseJson = await cacheTwirpPost(
      config,
      'GetCacheEntryDownloadURL',
      buildGetCacheEntryDownloadUrlRequest(
        primaryKey,
        restoreKeys ?? [],
        version,
      ),
    )
  } catch (e) {
    if (isCacheMissResponse(e)) {
      return undefined
    }
    throw e
  }
  const entry = readGetCacheEntryDownloadUrlResponse(responseJson)
  if (!entry.ok || !entry.signedDownloadUrl) {
    return undefined
  }
  const archivePath = path.join(
    createCacheScratchDirectory(),
    cacheArchiveFileName(compressionMethod),
  )
  try {
    await httpDownload(entry.signedDownloadUrl, archivePath, {
      retries: 1,
      timeout: CACHE_DOWNLOAD_TIMEOUT_MS,
    })
    await extractCacheArchive(archivePath, compressionMethod)
  } finally {
    removeArchiveQuietly(archivePath)
  }
  return entry.matchedKey
}

/**
 * Save the given paths under one key. Returns the service's numeric entry id;
 * a reserve conflict throws the ReserveCacheError-named error (the save CLI
 * treats it as an idempotent no-op) and every other failure throws plainly.
 */
export async function saveCache(paths: string[], key: string): Promise<number> {
  validateCachePaths(paths)
  validateCacheKey(key)
  const config = readCacheServiceConfig()
  const compressionMethod = await detectCompressionMethod()
  const version = cacheVersion(paths, compressionMethod)
  const { archivePath, sizeBytes } = await createCacheArchive(
    paths,
    compressionMethod,
  )
  try {
    let createJson: unknown
    try {
      createJson = await cacheTwirpPost(
        config,
        'CreateCacheEntry',
        buildCreateCacheEntryRequest(key, version),
      )
    } catch (e) {
      throw reserveConflictError(key, errorMessage(e))
    }
    const created = readCreateCacheEntryResponse(createJson)
    if (!created.ok || !created.signedUploadUrl) {
      throw reserveConflictError(
        key,
        created.message || 'the service refused the reservation',
      )
    }
    await uploadCacheArchive(created.signedUploadUrl, archivePath, sizeBytes)
    const finalized = readFinalizeCacheEntryUploadResponse(
      await cacheTwirpPost(
        config,
        'FinalizeCacheEntryUpload',
        buildFinalizeCacheEntryUploadRequest(key, version, sizeBytes),
      ),
    )
    if (!finalized.ok) {
      throw new Error(
        `Finalizing the cache upload failed. Where: the FinalizeCacheEntryUpload twirp call for key '${key}'. Saw: ${finalized.message || 'ok=false with no detail'}; wanted an acknowledged entry. Fix: re-run the job; if it persists, check GitHub Actions cache service status.`,
      )
    }
    if (finalized.entryId === undefined) {
      throw new Error(
        `The finalize response carries no entry id. Where: the FinalizeCacheEntryUpload twirp response for key '${key}'. Saw: no parseable entryId; wanted the numeric cache entry id. Fix: re-run the job; if it persists, check GitHub Actions cache service status.`,
      )
    }
    return finalized.entryId
  } finally {
    removeArchiveQuietly(archivePath)
  }
}
