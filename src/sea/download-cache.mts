import { createHash, randomUUID } from 'node:crypto'
import { promises as fs, constants as fsConstants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type DownloadDigestAlgorithm = 'sha256' | 'sha512'

export interface CachedDownloadOptions {
  readonly algorithm: DownloadDigestAlgorithm
  readonly digest: string
  readonly maxBytes?: number
  readonly cacheRoot?: string
  readonly lockTimeoutMs?: number
  readonly lockPollMs?: number
}

export class DownloadIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DownloadIntegrityError'
  }
}

class CacheUnavailableError extends Error {}

const DEFAULT_MAX_BYTES = 512 * 1024 * 1024
const DEFAULT_LOCK_TIMEOUT_MS = 30_000
const DEFAULT_LOCK_POLL_MS = 50

export function validateDownloadDigest(
  algorithm: DownloadDigestAlgorithm,
  value: string,
): string {
  if (algorithm !== 'sha256' && algorithm !== 'sha512') {
    throw new TypeError('Unsupported download digest algorithm')
  }
  const digest = value.toLowerCase()
  const digestLength = algorithm === 'sha256' ? 64 : 128
  if (!new RegExp(`^[a-f0-9]{${digestLength}}$`).test(digest)) {
    throw new TypeError(`Invalid ${algorithm} download digest`)
  }
  return digest
}

export function hashDownloadBytes(
  bytes: Uint8Array,
  algorithm: DownloadDigestAlgorithm,
): string {
  return createHash(algorithm).update(bytes).digest('hex')
}

function validateOptions(options: CachedDownloadOptions): {
  algorithm: DownloadDigestAlgorithm
  digest: string
  maxBytes: number
  cacheRoot: string
  lockTimeoutMs: number
  lockPollMs: number
} {
  const { algorithm } = options
  const digest = validateDownloadDigest(algorithm, options.digest)
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError('maxBytes must be a non-negative safe integer')
  }
  const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS
  const lockPollMs = options.lockPollMs ?? DEFAULT_LOCK_POLL_MS
  if (!Number.isFinite(lockTimeoutMs) || lockTimeoutMs < 0) {
    throw new TypeError('lockTimeoutMs must be a non-negative number')
  }
  if (!Number.isFinite(lockPollMs) || lockPollMs <= 0) {
    throw new TypeError('lockPollMs must be a positive number')
  }
  return {
    algorithm,
    digest,
    maxBytes,
    cacheRoot: path.resolve(
      options.cacheRoot ??
        path.join(os.homedir(), '.cache/socket-sea/downloads'),
    ),
    lockTimeoutMs,
    lockPollMs,
  }
}

function matchesDigest(
  bytes: Buffer,
  algorithm: DownloadDigestAlgorithm,
  expected: string,
  maxBytes: number,
): boolean {
  return (
    bytes.byteLength <= maxBytes &&
    hashDownloadBytes(bytes, algorithm) === expected
  )
}

function integrityCheck(
  bytes: Buffer,
  algorithm: DownloadDigestAlgorithm,
  expected: string,
  maxBytes: number,
  url: string,
): Buffer {
  const label = safeUrlLabel(url)
  if (bytes.byteLength > maxBytes) {
    throw new DownloadIntegrityError(
      `Downloaded bytes from ${label} exceed the ${maxBytes}-byte limit`,
    )
  }
  const actual = hashDownloadBytes(bytes, algorithm)
  if (actual !== expected) {
    throw new DownloadIntegrityError(
      `Download ${algorithm} digest mismatch for ${label}: expected ${expected}, got ${actual}`,
    )
  }
  return bytes
}

function safeUrlLabel(value: string): string {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return '<invalid URL>'
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}

async function ensureDirectory(directory: string): Promise<void> {
  let stat
  try {
    stat = await fs.lstat(directory)
  } catch (error) {
    if (!isMissing(error)) {
      throw error
    }
    try {
      await fs.mkdir(directory)
    } catch (mkdirError) {
      if ((mkdirError as NodeJS.ErrnoException)?.code !== 'EEXIST') {
        throw mkdirError
      }
    }
    stat = await fs.lstat(directory)
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new CacheUnavailableError(`Unsafe cache directory: ${directory}`)
  }
}

async function ensureCacheDirectories(root: string, algorithm: string) {
  try {
    await fs.mkdir(root, { recursive: true })
    const rootStat = await fs.lstat(root)
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      throw new CacheUnavailableError(`Unsafe cache root: ${root}`)
    }
    const version = path.join(root, 'v1')
    await ensureDirectory(version)
    const blobRoot = path.join(version, 'blobs')
    await ensureDirectory(blobRoot)
    const algorithmRoot = path.join(blobRoot, algorithm)
    await ensureDirectory(algorithmRoot)
    const locks = path.join(version, 'locks')
    await ensureDirectory(locks)
    const tempRoot = path.join(version, 'tmp')
    await ensureDirectory(tempRoot)
    return { blobRoot: algorithmRoot, lockRoot: locks, tempRoot }
  } catch (error) {
    if (error instanceof CacheUnavailableError) {
      throw error
    }
    throw new CacheUnavailableError('Download cache is unavailable', {
      cause: error,
    })
  }
}

async function readVerifiedBlob(
  blobPath: string,
  algorithm: DownloadDigestAlgorithm,
  digest: string,
  maxBytes: number,
): Promise<Buffer | undefined> {
  let stat
  try {
    stat = await fs.lstat(blobPath)
  } catch (error) {
    if (isMissing(error)) {
      return undefined
    }
    throw new CacheUnavailableError('Could not inspect cached download', {
      cause: error,
    })
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new CacheUnavailableError('Cached download is not a regular file')
  }
  if (stat.size > maxBytes) {
    return undefined
  }
  try {
    const bytes = await fs.readFile(blobPath)
    return matchesDigest(bytes, algorithm, digest, maxBytes) ? bytes : undefined
  } catch (error) {
    if (isMissing(error)) {
      return undefined
    }
    throw new CacheUnavailableError('Could not read cached download', {
      cause: error,
    })
  }
}

/* eslint-disable no-await-in-loop -- lock acquisition must serialize mkdir, inspect, and poll */
async function acquireLock(
  lockPath: string,
  timeoutMs: number,
  pollMs: number,
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs
  while (true) {
    try {
      await fs.mkdir(lockPath, { mode: 0o700 })
      const owner = randomUUID()
      try {
        await fs.writeFile(path.join(lockPath, '.owner'), owner, {
          flag: 'wx',
          mode: 0o600,
        })
      } catch (error) {
        await fs.unlink(path.join(lockPath, '.owner')).catch(() => undefined)
        await fs.rmdir(lockPath).catch(() => undefined)
        throw error
      }
      return owner
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') {
        throw new CacheUnavailableError('Could not acquire download lock', {
          cause: error,
        })
      }
    }
    try {
      const stat = await fs.lstat(lockPath)
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new CacheUnavailableError('Unsafe download lock entry')
      }
    } catch (error) {
      if (isMissing(error)) {
        continue
      }
      if (error instanceof CacheUnavailableError) {
        throw error
      }
      throw new CacheUnavailableError('Could not inspect download lock', {
        cause: error,
      })
    }
    if (Date.now() >= deadline) {
      return undefined
    }
    await new Promise(resolve => setTimeout(resolve, pollMs))
  }
}
/* eslint-enable no-await-in-loop */

async function removeInvalidRegularBlob(blobPath: string): Promise<void> {
  try {
    const stat = await fs.lstat(blobPath)
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new CacheUnavailableError('Unsafe cached download entry')
    }
    await fs.unlink(blobPath)
  } catch (error) {
    if (isMissing(error)) {
      return
    }
    if (error instanceof CacheUnavailableError) {
      throw error
    }
    throw new CacheUnavailableError('Could not repair cached download', {
      cause: error,
    })
  }
}

async function publishBlob(
  blobPath: string,
  tempRoot: string,
  bytes: Buffer,
): Promise<void> {
  const tempPath = path.join(tempRoot, `.download-${randomUUID()}.tmp`)
  let handle
  try {
    handle = await fs.open(
      tempPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o600,
    )
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close()
    handle = undefined
    await fs.rename(tempPath, blobPath)
  } catch (error) {
    throw new CacheUnavailableError('Could not publish cached download', {
      cause: error,
    })
  } finally {
    await handle?.close().catch(() => undefined)
    await fs.unlink(tempPath).catch(() => undefined)
  }
}

async function fetchAndVerify(
  url: string,
  fetchBytes: () => Promise<Buffer>,
  algorithm: DownloadDigestAlgorithm,
  digest: string,
  maxBytes: number,
): Promise<Buffer> {
  return integrityCheck(await fetchBytes(), algorithm, digest, maxBytes, url)
}

export async function cachedDownload(
  _url: string,
  options: CachedDownloadOptions,
  fetchBytes: () => Promise<Buffer>,
): Promise<Buffer> {
  const config = validateOptions(options)
  const fetchUncached = () =>
    fetchAndVerify(
      _url,
      fetchBytes,
      config.algorithm,
      config.digest,
      config.maxBytes,
    )
  let paths: Awaited<ReturnType<typeof ensureCacheDirectories>>
  try {
    paths = await ensureCacheDirectories(config.cacheRoot, config.algorithm)
  } catch {
    return await fetchUncached()
  }
  const blobPath = path.join(paths.blobRoot, config.digest)
  const lockPath = path.join(
    paths.lockRoot,
    `${config.algorithm}-${config.digest}.lock`,
  )
  try {
    const cached = await readVerifiedBlob(
      blobPath,
      config.algorithm,
      config.digest,
      config.maxBytes,
    )
    if (cached) {
      return cached
    }
  } catch {
    return await fetchUncached()
  }

  let owner: string | undefined
  try {
    owner = await acquireLock(lockPath, config.lockTimeoutMs, config.lockPollMs)
  } catch {
    return await fetchUncached()
  }
  if (!owner) {
    return await fetchUncached()
  }

  try {
    const cached = await readVerifiedBlob(
      blobPath,
      config.algorithm,
      config.digest,
      config.maxBytes,
    )
    if (cached) {
      return cached
    }
    await removeInvalidRegularBlob(blobPath)
    const bytes = await fetchUncached()
    try {
      await publishBlob(blobPath, paths.tempRoot, bytes)
    } catch {
      // A verified response remains usable when the local cache cannot publish.
    }
    return bytes
  } catch (error) {
    if (error instanceof DownloadIntegrityError) {
      throw error
    }
    if (error instanceof CacheUnavailableError) {
      return await fetchUncached()
    }
    throw error
  } finally {
    await releaseLock(lockPath, owner)
  }
}

async function releaseLock(lockPath: string, owner: string): Promise<void> {
  const ownerPath = path.join(lockPath, '.owner')
  try {
    const stat = await fs.lstat(lockPath)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return
    }
    if ((await fs.readFile(ownerPath, 'utf8')) !== owner) {
      return
    }
    await fs.unlink(ownerPath)
    await fs.rmdir(lockPath)
  } catch {
    // The cache lock is best effort; never remove a lock that is no longer ours.
  }
}
