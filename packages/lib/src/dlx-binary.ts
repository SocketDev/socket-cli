/** @fileoverview DLX binary execution utilities for Socket ecosystem. */

import { createHash } from 'crypto'

import os from 'os'

import path from 'path'

import { WIN32 } from '#constants/platform'

import { generateCacheKey } from './dlx'
import { dlxManifest } from './dlx-manifest'
import { httpDownload } from './http-request'
import { isDir, readJson, safeDelete, safeMkdir } from './fs'
import { isObjectObject } from './objects'
import { normalizePath } from './path'
import { getSocketDlxDir } from './paths'
import { processLock } from './process-lock'
import type { SpawnExtra, SpawnOptions } from './spawn'
import { spawn } from './spawn'

let _fs: typeof import('fs') | undefined
/**
 * Lazily load the fs module to avoid Webpack errors.
 * Uses non-'node:' prefixed require to prevent Webpack bundling issues.
 *
 * @returns The Node.js fs module
 * @private
 */
/*@__NO_SIDE_EFFECTS__*/
function getFs() {
  if (_fs === undefined) {
    // Use non-'node:' prefixed require to avoid Webpack errors.

    _fs = /*@__PURE__*/ require('node:fs')
  }
  return _fs as typeof import('fs')
}

export interface DlxBinaryOptions {
  /**
   * URL to download the binary from.
   */
  url: string

  /**
   * Optional name for the cached binary (defaults to URL hash).
   */
  name?: string | undefined

  /**
   * Expected checksum (sha256) for verification.
   */
  checksum?: string | undefined

  /**
   * Cache TTL in milliseconds (default: 7 days).
   */
  cacheTtl?: number | undefined

  /**
   * Force re-download even if cached.
   * Aligns with npm/npx --force flag.
   */
  force?: boolean | undefined

  /**
   * Skip confirmation prompts (auto-approve).
   * Aligns with npx --yes/-y flag.
   */
  yes?: boolean | undefined

  /**
   * Suppress output (quiet mode).
   * Aligns with npx --quiet/-q and pnpm --silent/-s flags.
   */
  quiet?: boolean | undefined

  /**
   * Additional spawn options.
   */
  spawnOptions?: SpawnOptions | undefined
}

export interface DlxBinaryResult {
  /** Path to the cached binary. */
  binaryPath: string
  /** Whether the binary was newly downloaded. */
  downloaded: boolean
  /** The spawn promise for the running process. */
  spawnPromise: ReturnType<typeof spawn>
}

/**
 * Metadata structure for cached binaries (.dlx-metadata.json).
 * Unified schema shared across TypeScript (dlxBinary) and C++ (socket_macho_decompress).
 *
 * Core Fields (present in all implementations):
 * - version: Schema version (currently "1.0.0")
 * - cache_key: First 16 chars of SHA-512 hash (matches directory name)
 * - timestamp: Unix timestamp in milliseconds
 * - checksum: Full hash of cached binary (SHA-512 for C++, SHA-256 for TypeScript)
 * - checksum_algorithm: "sha512" or "sha256"
 * - platform: "darwin" | "linux" | "win32"
 * - arch: "x64" | "arm64"
 * - size: Size of cached binary in bytes
 * - source: Origin information
 *   - type: "download" (from URL) or "decompression" (from embedded binary)
 *   - url: Download URL (if type is "download")
 *   - path: Source binary path (if type is "decompression")
 *
 * Extra Fields (implementation-specific):
 * - For C++ decompression:
 *   - compressed_size: Size of compressed data in bytes
 *   - compression_algorithm: Brotli level (numeric)
 *   - compression_ratio: original_size / compressed_size
 *
 * Example (TypeScript download):
 * ```json
 * {
 *   "version": "1.0.0",
 *   "cache_key": "a1b2c3d4e5f67890",
 *   "timestamp": 1730332800000,
 *   "checksum": "sha256-abc123...",
 *   "checksum_algorithm": "sha256",
 *   "platform": "darwin",
 *   "arch": "arm64",
 *   "size": 15000000,
 *   "source": {
 *     "type": "download",
 *     "url": "https://example.com/binary"
 *   }
 * }
 * ```
 *
 * Example (C++ decompression):
 * ```json
 * {
 *   "version": "1.0.0",
 *   "cache_key": "0123456789abcdef",
 *   "timestamp": 1730332800000,
 *   "checksum": "sha512-def456...",
 *   "checksum_algorithm": "sha512",
 *   "platform": "darwin",
 *   "arch": "arm64",
 *   "size": 13000000,
 *   "source": {
 *     "type": "decompression",
 *     "path": "/usr/local/bin/socket"
 *   },
 *   "extra": {
 *     "compressed_size": 1700000,
 *     "compression_algorithm": 3,
 *     "compression_ratio": 7.647
 *   }
 * }
 * ```
 *
 * @internal This interface documents the metadata file format.
 */
export interface DlxMetadata {
  version: string
  cache_key: string
  timestamp: number
  checksum: string
  checksum_algorithm: string
  platform: string
  arch: string
  size: number
  source?: {
    type: 'download' | 'decompression'
    url?: string
    path?: string
  }
  extra?: Record<string, unknown>
}

/**
 * Get metadata file path for a cached binary.
 */
function getMetadataPath(cacheEntryPath: string): string {
  return path.join(cacheEntryPath, '.dlx-metadata.json')
}

/**
 * Check if a cached binary is still valid.
 */
async function isCacheValid(
  cacheEntryPath: string,
  cacheTtl: number,
): Promise<boolean> {
  const fs = getFs()
  try {
    const metaPath = getMetadataPath(cacheEntryPath)
    if (!fs.existsSync(metaPath)) {
      return false
    }

    const metadata = await readJson(metaPath, { throws: false })
    if (!isObjectObject(metadata)) {
      return false
    }
    const now = Date.now()
    const timestamp = (metadata as Record<string, unknown>)['timestamp']
    // If timestamp is missing or invalid, cache is invalid
    if (typeof timestamp !== 'number' || timestamp <= 0) {
      return false
    }
    const age = now - timestamp

    return age < cacheTtl
  } catch {
    return false
  }
}

/**
 * Download a file from a URL with integrity checking and concurrent download protection.
 * Uses processLock to prevent multiple processes from downloading the same binary simultaneously.
 * Internal helper function for downloading binary files.
 */
async function downloadBinaryFile(
  url: string,
  destPath: string,
  checksum?: string | undefined,
): Promise<string> {
  // Use process lock to prevent concurrent downloads.
  // Lock is placed in the cache entry directory as 'concurrency.lock'.
  const cacheEntryDir = path.dirname(destPath)
  const lockPath = path.join(cacheEntryDir, 'concurrency.lock')

  return await processLock.withLock(
    lockPath,
    async () => {
      const fs = getFs()
      // Check if file was downloaded while waiting for lock.
      if (fs.existsSync(destPath)) {
        const stats = await fs.promises.stat(destPath)
        if (stats.size > 0) {
          // File exists, compute and return checksum.
          const fileBuffer = await fs.promises.readFile(destPath)
          const hasher = createHash('sha256')
          hasher.update(fileBuffer)
          return hasher.digest('hex')
        }
      }

      // Download the file.
      try {
        await httpDownload(url, destPath)
      } catch (e) {
        throw new Error(
          `Failed to download binary from ${url}\n` +
            `Destination: ${destPath}\n` +
            'Check your internet connection or verify the URL is accessible.',
          { cause: e },
        )
      }

      // Compute checksum of downloaded file.
      const fileBuffer = await fs.promises.readFile(destPath)
      const hasher = createHash('sha256')
      hasher.update(fileBuffer)
      const actualChecksum = hasher.digest('hex')

      // Verify checksum if provided.
      if (checksum && actualChecksum !== checksum) {
        // Clean up invalid file.
        await safeDelete(destPath)
        throw new Error(
          `Checksum mismatch: expected ${checksum}, got ${actualChecksum}`,
        )
      }

      // Make executable on POSIX systems.
      if (!WIN32) {
        await fs.promises.chmod(destPath, 0o755)
      }

      return actualChecksum
    },
    {
      // Align with npm npx locking strategy.
      staleMs: 5000,
      touchIntervalMs: 2000,
    },
  )
}

/**
 * Write metadata for a cached binary.
 * Writes to both per-directory metadata file (for backward compatibility)
 * and global manifest (~/.socket/_dlx/.dlx-manifest.json).
 * Uses unified schema shared with C++ decompressor and CLI dlxBinary.
 * Schema documentation: See DlxMetadata interface in this file (exported).
 * Core fields: version, cache_key, timestamp, checksum, checksum_algorithm, platform, arch, size, source
 * Note: This implementation uses SHA-256 checksums instead of SHA-512.
 */
async function writeMetadata(
  cacheEntryPath: string,
  cacheKey: string,
  url: string,
  binaryName: string,
  checksum: string,
  size: number,
): Promise<void> {
  // Write per-directory metadata file for backward compatibility.
  const metaPath = getMetadataPath(cacheEntryPath)
  const metadata = {
    version: '1.0.0',
    cache_key: cacheKey,
    timestamp: Date.now(),
    checksum,
    checksum_algorithm: 'sha256',
    platform: os.platform(),
    arch: os.arch(),
    size,
    source: {
      type: 'download',
      url,
    },
  }
  const fs = getFs()
  await fs.promises.writeFile(metaPath, JSON.stringify(metadata, null, 2))

  // Write to global manifest.
  try {
    const spec = `${url}:${binaryName}`
    await dlxManifest.setBinaryEntry(spec, cacheKey, {
      checksum,
      checksum_algorithm: 'sha256',
      platform: os.platform(),
      arch: os.arch(),
      size,
      source: {
        type: 'download',
        url,
      },
    })
  } catch {
    // Silently ignore manifest write errors - not critical.
    // The per-directory metadata is the source of truth for now.
  }
}

/**
 * Clean expired entries from the DLX cache.
 */
export async function cleanDlxCache(
  maxAge: number = /*@__INLINE__*/ require('#constants/time').DLX_BINARY_CACHE_TTL,
): Promise<number> {
  const cacheDir = getDlxCachePath()
  const fs = getFs()

  if (!fs.existsSync(cacheDir)) {
    return 0
  }

  let cleaned = 0
  const now = Date.now()
  const entries = await fs.promises.readdir(cacheDir)

  for (const entry of entries) {
    const entryPath = path.join(cacheDir, entry)
    const metaPath = getMetadataPath(entryPath)

    try {
      // eslint-disable-next-line no-await-in-loop
      if (!(await isDir(entryPath))) {
        continue
      }

      // eslint-disable-next-line no-await-in-loop
      const metadata = await readJson(metaPath, { throws: false })
      if (
        !metadata ||
        typeof metadata !== 'object' ||
        Array.isArray(metadata)
      ) {
        continue
      }
      const timestamp = (metadata as Record<string, unknown>)['timestamp']
      // If timestamp is missing or invalid, treat as expired (age = infinity)
      const age =
        typeof timestamp === 'number' && timestamp > 0
          ? now - timestamp
          : Number.POSITIVE_INFINITY

      if (age > maxAge) {
        // Remove entire cache entry directory.
        // eslint-disable-next-line no-await-in-loop
        await safeDelete(entryPath, { force: true, recursive: true })
        cleaned += 1
      }
    } catch {
      // If we can't read metadata, check if directory is empty or corrupted.
      try {
        // eslint-disable-next-line no-await-in-loop
        const contents = await fs.promises.readdir(entryPath)
        if (!contents.length) {
          // Remove empty directory.
          // eslint-disable-next-line no-await-in-loop
          await safeDelete(entryPath)
          cleaned += 1
        }
      } catch {}
    }
  }

  return cleaned
}

/**
 * Download and execute a binary from a URL with caching.
 */
export async function dlxBinary(
  args: readonly string[] | string[],
  options?: DlxBinaryOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxBinaryResult> {
  const {
    cacheTtl = /*@__INLINE__*/ require('#constants/time').DLX_BINARY_CACHE_TTL,
    checksum,
    force: userForce = false,
    name,
    spawnOptions,
    url,
    yes,
  } = { __proto__: null, ...options } as DlxBinaryOptions

  // Map --yes flag to force behavior (auto-approve/skip prompts)
  const force = yes === true ? true : userForce

  // Generate cache paths similar to pnpm/npx structure.
  const cacheDir = getDlxCachePath()
  const binaryName = name || `binary-${process.platform}-${os.arch()}`
  // Create spec from URL and binary name for unique cache identity.
  const spec = `${url}:${binaryName}`
  const cacheKey = generateCacheKey(spec)
  const cacheEntryDir = path.join(cacheDir, cacheKey)
  const binaryPath = normalizePath(path.join(cacheEntryDir, binaryName))
  const fs = getFs()

  let downloaded = false
  let computedChecksum = checksum

  // Check if we need to download.
  if (
    !force &&
    fs.existsSync(cacheEntryDir) &&
    (await isCacheValid(cacheEntryDir, cacheTtl))
  ) {
    // Binary is cached and valid, read the checksum from metadata.
    try {
      const metaPath = getMetadataPath(cacheEntryDir)
      const metadata = await readJson(metaPath, { throws: false })
      if (
        metadata &&
        typeof metadata === 'object' &&
        !Array.isArray(metadata) &&
        typeof (metadata as Record<string, unknown>)['checksum'] === 'string'
      ) {
        computedChecksum = (metadata as Record<string, unknown>)[
          'checksum'
        ] as string
      } else {
        // If metadata is invalid, re-download.
        downloaded = true
      }
    } catch {
      // If we can't read metadata, re-download.
      downloaded = true
    }
  } else {
    downloaded = true
  }

  if (downloaded) {
    // Ensure cache directory exists before downloading.
    try {
      await safeMkdir(cacheEntryDir)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'EACCES' || code === 'EPERM') {
        throw new Error(
          `Permission denied creating binary cache directory: ${cacheEntryDir}\n` +
            'Please check directory permissions or run with appropriate access.',
          { cause: e },
        )
      }
      if (code === 'EROFS') {
        throw new Error(
          `Cannot create binary cache directory on read-only filesystem: ${cacheEntryDir}\n` +
            'Ensure the filesystem is writable or set SOCKET_DLX_DIR to a writable location.',
          { cause: e },
        )
      }
      throw new Error(
        `Failed to create binary cache directory: ${cacheEntryDir}`,
        { cause: e },
      )
    }

    // Download the binary.
    computedChecksum = await downloadBinaryFile(url, binaryPath, checksum)

    // Get file size for metadata.
    const stats = await fs.promises.stat(binaryPath)
    await writeMetadata(
      cacheEntryDir,
      cacheKey,
      url,
      binaryName,
      computedChecksum || '',
      stats.size,
    )
  }

  // Execute the binary.
  // On Windows, script files (.bat, .cmd, .ps1) require shell: true because
  // they are not executable on their own and must be run through cmd.exe.
  // Note: .exe files are actual binaries and don't need shell mode.
  const needsShell = WIN32 && /\.(?:bat|cmd|ps1)$/i.test(binaryPath)
  // Windows cmd.exe PATH resolution behavior:
  // When shell: true on Windows with .cmd/.bat/.ps1 files, spawn will automatically
  // strip the full path down to just the basename without extension (e.g.,
  // C:\cache\test.cmd becomes just "test"). Windows cmd.exe then searches for "test"
  // in directories listed in PATH, trying each extension from PATHEXT environment
  // variable (.COM, .EXE, .BAT, .CMD, etc.) until it finds a match.
  //
  // Since our binaries are downloaded to a custom cache directory that's not in PATH
  // (unlike system package managers like npm/pnpm/yarn which are already in PATH),
  // we must prepend the cache directory to PATH so cmd.exe can locate the binary.
  //
  // This approach is consistent with how other tools handle Windows command execution:
  // - npm's promise-spawn: uses which.sync() to find commands in PATH
  // - cross-spawn: spawns cmd.exe with escaped arguments
  // - Node.js spawn with shell: true: delegates to cmd.exe which uses PATH
  const finalSpawnOptions = needsShell
    ? {
        ...spawnOptions,
        env: {
          ...spawnOptions?.env,
          PATH: `${cacheEntryDir}${path.delimiter}${process.env['PATH'] || ''}`,
        },
        shell: true,
      }
    : spawnOptions
  const spawnPromise = spawn(binaryPath, args, finalSpawnOptions, spawnExtra)

  return {
    binaryPath,
    downloaded,
    spawnPromise,
  }
}

/**
 * Download a binary from a URL with caching (without execution).
 * Similar to downloadPackage from dlx-package.
 *
 * @returns Object containing the path to the cached binary and whether it was downloaded
 */
export async function downloadBinary(
  options: Omit<DlxBinaryOptions, 'spawnOptions'>,
): Promise<{ binaryPath: string; downloaded: boolean }> {
  const {
    cacheTtl = /*@__INLINE__*/ require('#constants/time').DLX_BINARY_CACHE_TTL,
    checksum,
    force = false,
    name,
    url,
  } = { __proto__: null, ...options } as DlxBinaryOptions

  // Generate cache paths similar to pnpm/npx structure.
  const cacheDir = getDlxCachePath()
  const binaryName = name || `binary-${process.platform}-${os.arch()}`
  // Create spec from URL and binary name for unique cache identity.
  const spec = `${url}:${binaryName}`
  const cacheKey = generateCacheKey(spec)
  const cacheEntryDir = path.join(cacheDir, cacheKey)
  const binaryPath = normalizePath(path.join(cacheEntryDir, binaryName))
  const fs = getFs()

  let downloaded = false

  // Check if we need to download.
  if (
    !force &&
    fs.existsSync(cacheEntryDir) &&
    (await isCacheValid(cacheEntryDir, cacheTtl))
  ) {
    // Binary is cached and valid.
    downloaded = false
  } else {
    // Ensure cache directory exists before downloading.
    try {
      await safeMkdir(cacheEntryDir)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'EACCES' || code === 'EPERM') {
        throw new Error(
          `Permission denied creating binary cache directory: ${cacheEntryDir}\n` +
            'Please check directory permissions or run with appropriate access.',
          { cause: e },
        )
      }
      if (code === 'EROFS') {
        throw new Error(
          `Cannot create binary cache directory on read-only filesystem: ${cacheEntryDir}\n` +
            'Ensure the filesystem is writable or set SOCKET_DLX_DIR to a writable location.',
          { cause: e },
        )
      }
      throw new Error(
        `Failed to create binary cache directory: ${cacheEntryDir}`,
        { cause: e },
      )
    }

    // Download the binary.
    const computedChecksum = await downloadBinaryFile(url, binaryPath, checksum)

    // Get file size for metadata.
    const stats = await fs.promises.stat(binaryPath)
    await writeMetadata(
      cacheEntryDir,
      cacheKey,
      url,
      binaryName,
      computedChecksum || '',
      stats.size,
    )
    downloaded = true
  }

  return {
    binaryPath,
    downloaded,
  }
}

/**
 * Execute a cached binary without re-downloading.
 * Similar to executePackage from dlx-package.
 * Binary must have been previously downloaded via downloadBinary or dlxBinary.
 *
 * @param binaryPath Path to the cached binary (from downloadBinary result)
 * @param args Arguments to pass to the binary
 * @param spawnOptions Spawn options for execution
 * @param spawnExtra Extra spawn configuration
 * @returns The spawn promise for the running process
 */
export function executeBinary(
  binaryPath: string,
  args: readonly string[] | string[],
  spawnOptions?: SpawnOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): ReturnType<typeof spawn> {
  // On Windows, script files (.bat, .cmd, .ps1) require shell: true because
  // they are not executable on their own and must be run through cmd.exe.
  // Note: .exe files are actual binaries and don't need shell mode.
  const needsShell = WIN32 && /\.(?:bat|cmd|ps1)$/i.test(binaryPath)

  // Windows cmd.exe PATH resolution behavior:
  // When shell: true on Windows with .cmd/.bat/.ps1 files, spawn will automatically
  // strip the full path down to just the basename without extension. Windows cmd.exe
  // then searches for the binary in directories listed in PATH.
  //
  // Since our binaries are downloaded to a custom cache directory that's not in PATH,
  // we must prepend the cache directory to PATH so cmd.exe can locate the binary.
  const cacheEntryDir = path.dirname(binaryPath)
  const finalSpawnOptions = needsShell
    ? {
        ...spawnOptions,
        env: {
          ...spawnOptions?.env,
          PATH: `${cacheEntryDir}${path.delimiter}${process.env['PATH'] || ''}`,
        },
        shell: true,
      }
    : spawnOptions

  return spawn(binaryPath, args, finalSpawnOptions, spawnExtra)
}

/**
 * Get the DLX binary cache directory path.
 * Returns normalized path for cross-platform compatibility.
 * Uses same directory as dlx-package for unified DLX storage.
 */
export function getDlxCachePath(): string {
  return getSocketDlxDir()
}

/**
 * Get information about cached binaries.
 */
export async function listDlxCache(): Promise<
  Array<{
    age: number
    arch: string
    checksum: string
    name: string
    platform: string
    size: number
    url: string
  }>
> {
  const cacheDir = getDlxCachePath()
  const fs = getFs()

  if (!fs.existsSync(cacheDir)) {
    return []
  }

  const results = []
  const now = Date.now()
  const entries = await fs.promises.readdir(cacheDir)

  for (const entry of entries) {
    const entryPath = path.join(cacheDir, entry)
    try {
      // eslint-disable-next-line no-await-in-loop
      if (!(await isDir(entryPath))) {
        continue
      }

      const metaPath = getMetadataPath(entryPath)
      // eslint-disable-next-line no-await-in-loop
      const metadata = await readJson(metaPath, { throws: false })
      if (
        !metadata ||
        typeof metadata !== 'object' ||
        Array.isArray(metadata)
      ) {
        continue
      }

      const metaObj = metadata as Record<string, unknown>

      // Get URL from unified schema (source.url) or legacy schema (url).
      // Allow empty URL for backward compatibility with partial metadata.
      const source = metaObj['source'] as Record<string, unknown> | undefined
      const url =
        (source?.['url'] as string) || (metaObj['url'] as string) || ''

      // Find the binary file in the directory.
      // eslint-disable-next-line no-await-in-loop
      const files = await fs.promises.readdir(entryPath)
      const binaryFile = files.find(f => !f.startsWith('.'))

      if (binaryFile) {
        const binaryPath = path.join(entryPath, binaryFile)
        // eslint-disable-next-line no-await-in-loop
        const binaryStats = await fs.promises.stat(binaryPath)

        results.push({
          age: now - ((metaObj['timestamp'] as number) || 0),
          arch: (metaObj['arch'] as string) || 'unknown',
          checksum: (metaObj['checksum'] as string) || '',
          name: binaryFile,
          platform: (metaObj['platform'] as string) || 'unknown',
          size: binaryStats.size,
          url,
        })
      }
    } catch {}
  }

  return results
}
