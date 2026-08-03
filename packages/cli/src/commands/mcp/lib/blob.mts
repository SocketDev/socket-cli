/**
 * Content-addressed blob reads against Socket's user-content host.
 *
 * Blob hashes come from `package_files` output. A `Q` prefix names a single
 * blob; an `S` prefix names a chunked file whose manifest lives at the
 * `Q`-swapped hash and lists the chunk hashes to concatenate.
 *
 * Bytes are decoded as strict UTF-8 so binary content is detected and refused
 * rather than shipped to a model, and anything past `maxBytes` is dropped.
 */

import { createUserAgentFromPkgJson } from '@socketsecurity/sdk-stable'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { httpRequest } from '@socketsecurity/lib-stable/http-request/request'
import { assertSafeHttpUrl } from '@socketsecurity/lib-stable/url/assert-safe'

import { getCliHomepage } from '../../../env/cli-homepage.mts'
import { getCliName } from '../../../env/cli-name.mts'
import { getCliVersion } from '../../../env/cli-version.mts'

// Socket's public user-content host. Fixed rather than env-overridable: the
// only value of a knob here would be to point the fetch somewhere else, which
// is the SSRF the guard below exists to prevent.
export const SOCKET_USER_CONTENT_URL = 'https://socketusercontent.com'

export const DEFAULT_BLOB_MAX_BYTES = 1024 * 1024

export interface BlobResult {
  binary: boolean
  bytes: number
  contentType: string | undefined
  text: string
  truncated: boolean
}

export interface ChunkedBlobResult {
  // Concatenated chunk bytes, possibly fewer than `totalSize` when the read
  // stopped early at the byte cap.
  bytes: Uint8Array
  // File size the manifest claims, whatever was actually fetched.
  totalSize: number
}

export interface FetchBlobOptions {
  maxBytes?: number | undefined
}

export interface RawBlobResult {
  bytes: Uint8Array
  contentType: string | undefined
}

let cachedUserAgent: string | undefined

/**
 * Decode bytes as strict UTF-8. Returns undefined when the bytes are not valid
 * UTF-8 or carry a NUL, both of which mark the content as binary.
 */
export function decodeUtf8Text(bytes: Uint8Array): string | undefined {
  // A NUL in the first 4 KB is a cheap, reliable binary tell.
  const probeEnd = Math.min(bytes.length, 4096)
  for (let i = 0; i < probeEnd; i += 1) {
    if (bytes[i] === 0) {
      return undefined
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

/**
 * Fetch one blob and decode it. Chunked (`S`-prefixed) hashes are reassembled
 * from their manifest first.
 */
export async function fetchSocketBlob(
  hash: string,
  options?: FetchBlobOptions | undefined,
): Promise<BlobResult> {
  const opts = { __proto__: null, ...options } as FetchBlobOptions
  if (!hash) {
    throw new Error(
      'Reading a package file failed. Where: blob fetch. Saw: an empty blob hash, wanted the hash printed by `package_files`. Fix: call `package_files` and pass one of the hashes it lists.',
    )
  }
  const maxBytes = opts.maxBytes ?? DEFAULT_BLOB_MAX_BYTES

  let buf: Uint8Array
  let contentType: string | undefined
  let originalSize: number

  if (hash[0] === 'S') {
    const chunked = await fetchSocketChunkedBlobBytes(hash, maxBytes)
    buf = chunked.bytes
    originalSize = chunked.totalSize
  } else {
    const raw = await fetchSocketRawBlobBytes(hash)
    buf = raw.bytes
    originalSize = buf.length
    contentType = raw.contentType
  }

  const truncated = originalSize > maxBytes
  const bodyBytes = buf.length > maxBytes ? buf.subarray(0, maxBytes) : buf
  const decoded = decodeUtf8Text(bodyBytes)

  return {
    binary: decoded === undefined,
    bytes: originalSize,
    contentType,
    text: decoded ?? '',
    truncated,
  }
}

/**
 * Reassemble an `S`-prefixed chunked blob. The manifest's `offset` array, when
 * it is complete and numeric, lets the read stop at the first chunk starting
 * past the cap instead of pulling the whole file.
 */
export async function fetchSocketChunkedBlobBytes(
  chunkedHash: string,
  maxBytes: number,
): Promise<ChunkedBlobResult> {
  const manifestHash = `Q${chunkedHash.slice(1)}`
  const manifestRaw = await fetchSocketRawBlobBytes(manifestHash)

  let manifest: unknown
  try {
    manifest = JSON.parse(new TextDecoder('utf-8').decode(manifestRaw.bytes))
  } catch (e) {
    throw new Error(
      `Reading a chunked package file failed. Where: manifest ${manifestHash}. Saw: ${errorMessage(e)}, wanted JSON. Fix: re-run \`package_files\` to get a current hash.`,
    )
  }
  if (typeof manifest !== 'object' || manifest === null) {
    throw new Error(
      `Reading a chunked package file failed. Where: manifest ${manifestHash}. Saw: a non-object manifest, wanted a JSON object. Fix: re-run \`package_files\` to get a current hash.`,
    )
  }
  const rawChunks = 'chunks' in manifest ? manifest.chunks : undefined
  if (!isStringArray(rawChunks) || rawChunks.some(c => !c)) {
    throw new Error(
      `Reading a chunked package file failed. Where: manifest ${manifestHash}. Saw: no usable 'chunks' array, wanted an array of chunk hashes. Fix: re-run \`package_files\` to get a current hash.`,
    )
  }
  const rawSize = 'size' in manifest ? manifest.size : undefined
  const totalSize = typeof rawSize === 'number' ? rawSize : -1
  const rawOffset = 'offset' in manifest ? manifest.offset : undefined
  // Offsets are usable only when every entry is numeric AND there is one per
  // chunk, so a single bad entry skips the optimization instead of producing a
  // short, mismatched read.
  const offsets =
    Array.isArray(rawOffset) &&
    rawOffset.length === rawChunks.length &&
    rawOffset.every(n => typeof n === 'number')
      ? rawOffset
      : undefined

  let needed = rawChunks.length
  if (offsets) {
    needed = 0
    for (let i = 0; i < rawChunks.length; i += 1) {
      if (offsets[i]! >= maxBytes) {
        break
      }
      needed = i + 1
    }
  }

  const chunkBuffers = await Promise.all(
    rawChunks
      .slice(0, needed)
      .map(async c => (await fetchSocketRawBlobBytes(c)).bytes),
  )

  let total = 0
  for (const cb of chunkBuffers) {
    total += cb.length
  }
  const concat = new Uint8Array(total)
  let pos = 0
  for (const cb of chunkBuffers) {
    concat.set(cb, pos)
    pos += cb.length
  }

  return {
    bytes: concat,
    totalSize: totalSize >= 0 ? totalSize : total,
  }
}

/**
 * Single GET against `/blob/<hash>` on the user-content host, with no prefix
 * handling. The composed URL runs through the shared SSRF guard so a hash can
 * never steer the request off that host.
 */
export async function fetchSocketRawBlobBytes(
  hash: string,
): Promise<RawBlobResult> {
  const url = assertSafeHttpUrl(
    `${SOCKET_USER_CONTENT_URL}/blob/${encodeURIComponent(hash)}`,
    { label: 'Socket blob URL' },
  ).href

  let res
  try {
    res = await httpRequest(url, {
      headers: { 'user-agent': getBlobUserAgent() },
    })
  } catch (e) {
    throw new Error(
      `Reading a package file failed. Where: GET ${url}. Saw: ${errorMessage(e)}, wanted a 200 response. Fix: check network access to socketusercontent.com and retry.`,
    )
  }
  if (!res.ok) {
    throw new Error(
      `Reading a package file failed. Where: GET ${url}. Saw: HTTP ${res.status}, wanted 200. Fix: re-run \`package_files\` to get a current hash and retry.`,
    )
  }

  const contentTypeHeader = res.headers['content-type']
  return {
    bytes: new Uint8Array(res.arrayBuffer()),
    contentType:
      typeof contentTypeHeader === 'string' ? contentTypeHeader : undefined,
  }
}

export function getBlobUserAgent(): string {
  if (cachedUserAgent === undefined) {
    cachedUserAgent = createUserAgentFromPkgJson({
      homepage: getCliHomepage(),
      name: getCliName(),
      version: getCliVersion(),
    })
  }
  return cachedUserAgent
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(v => typeof v === 'string')
}
