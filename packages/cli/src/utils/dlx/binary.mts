/**
 * DLX binary execution utilities for Socket CLI.
 * Downloads and executes arbitrary binaries from URLs with caching.
 *
 * Key Functions:
 * - cleanDlxCache: Clean expired binary cache entries
 * - dlxBinary: Download and execute binary from URL with caching
 * - getDlxCachePath: Get the cache directory path for binaries
 * - getSocketHomePath: Get the base .socket directory path
 * - listDlxCache: Get information about cached binaries
 *
 * Cache Management:
 * - Stores binaries in ~/.socket/_dlx (POSIX)
 * - Stores binaries in %USERPROFILE%\.socket\_dlx (Windows)
 * - Uses npm/npx approach: first 16 chars of SHA-512 (shorter Windows paths)
 * - Cache key input: URL + binary name for uniqueness
 * - Supports TTL-based cache expiration
 * - Verifies checksums for security
 *
 * Platform Support:
 * - Handles Windows, macOS, and Linux
 * - Manages executable permissions automatically
 * - Supports architecture-specific binary selection
 */

import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { generateCacheKey } from '@socketsecurity/lib/dlx'
import { readJson, safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { normalizePath } from '@socketsecurity/lib/path'
import { getSocketDlxDir } from '@socketsecurity/lib/paths'
import { spawn } from '@socketsecurity/lib/spawn'

import { DLX_BINARY_CACHE_TTL } from '../../constants/cache.mjs'
import { InputError } from '../error/errors.mts'

import type { SpawnExtra, SpawnOptions } from '@socketsecurity/lib/spawn'

/**
 * Metadata structure for cached binaries (.dlx-metadata.json).
 * Unified schema shared across TypeScript (dlxBinary) and C++ (socket_macho_decompress).
 * Canonical documentation: @socketsecurity/lib/src/dlx-binary.ts (DlxMetadata interface)
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
 *
 * Example (C++ decompression):
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
 */
interface DlxMetadata {
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

export interface DlxBinaryOptions {
  /** URL to download the binary from. */
  url: string
  /** Optional name for the cached binary (defaults to URL hash). */
  name?: string
  /** Expected checksum (sha512) for verification. */
  checksum?: string
  /** Cache TTL in milliseconds (default: 7 days). */
  cacheTtl?: number
  /** Force re-download even if cached. */
  force?: boolean
  /** Platform override (defaults to current platform). */
  platform?: NodeJS.Platform
  /** Architecture override (defaults to current arch). */
  arch?: string
  /** Additional spawn options. */
  spawnOptions?: SpawnOptions
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
  try {
    const metaPath = getMetadataPath(cacheEntryPath)
    if (!existsSync(metaPath)) {
      return false
    }

    const metadata = (await readJson(metaPath, {
      throws: false,
    })) as DlxMetadata | null
    if (!metadata || !metadata.timestamp) {
      return false
    }
    const now = Date.now()
    const age = now - metadata.timestamp

    return age < cacheTtl
  } catch {
    return false
  }
}

/**
 * Download a file from a URL with integrity checking.
 */
async function downloadBinary(
  url: string,
  destPath: string,
  checksum?: string,
): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new InputError(
      `Failed to download binary: ${response.status} ${response.statusText}`,
    )
  }

  // Create a temporary file first.
  const tempPath = `${destPath}.download`
  const hasher = createHash('sha512')

  try {
    // Ensure directory exists.
    await safeMkdir(path.dirname(destPath), { recursive: true })

    // Get the response as a buffer and compute hash.
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Compute hash.
    hasher.update(buffer)
    const actualChecksum = hasher.digest('hex')

    // Verify checksum if provided.
    if (checksum && actualChecksum !== checksum) {
      throw new InputError(
        `Checksum mismatch: expected ${checksum}, got ${actualChecksum}`,
      )
    }

    // Write to temp file.
    await fs.writeFile(tempPath, buffer)

    // Make executable on POSIX systems.
    if (os.platform() !== 'win32') {
      await fs.chmod(tempPath, 0o755)
    }

    // Move temp file to final location.
    await fs.rename(tempPath, destPath)

    return actualChecksum
  } catch (error) {
    // Clean up temp file on error.
    try {
      await fs.unlink(tempPath)
    } catch {
      // Ignore cleanup errors.
    }
    throw error
  }
}

/**
 * Write metadata for a cached binary.
 */
async function writeMetadata(
  cacheEntryPath: string,
  cacheKey: string,
  url: string,
  checksum: string,
  size: number,
): Promise<void> {
  const metaPath = getMetadataPath(cacheEntryPath)
  const metadata: DlxMetadata = {
    version: '1.0.0',
    cache_key: cacheKey,
    timestamp: Date.now(),
    checksum,
    checksum_algorithm: 'sha512',
    platform: os.platform(),
    arch: os.arch(),
    size,
    source: {
      type: 'download',
      url,
    },
  }
  await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2))
}

/**
 * Clean expired entries from the DLX cache.
 */
export async function cleanDlxCache(
  maxAge: number = DLX_BINARY_CACHE_TTL,
): Promise<number> {
  const cacheDir = getDlxCachePath()

  if (!existsSync(cacheDir)) {
    return 0
  }

  let cleaned = 0
  const now = Date.now()
  const entries = await fs.readdir(cacheDir)

  for (const entry of entries) {
    const entryPath = path.join(cacheDir, entry)
    const metaPath = getMetadataPath(entryPath)

    try {
      // eslint-disable-next-line no-await-in-loop
      const stats = await fs.stat(entryPath)
      if (!stats.isDirectory()) {
        continue
      }

      // eslint-disable-next-line no-await-in-loop
      const metadata = (await readJson(metaPath, {
        throws: false,
      })) as DlxMetadata | null
      if (!metadata) {
        continue
      }
      const age = now - metadata.timestamp

      if (age > maxAge) {
        // Remove entire cache entry directory.
        // eslint-disable-next-line no-await-in-loop
        await safeDelete(entryPath)
        cleaned += 1
      }
    } catch {
      // If we can't read metadata, check if directory is empty or corrupted.
      try {
        // eslint-disable-next-line no-await-in-loop
        const contents = await fs.readdir(entryPath)
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
  args: string[] | readonly string[],
  options?: DlxBinaryOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxBinaryResult> {
  const {
    arch = os.arch(),
    cacheTtl = DLX_BINARY_CACHE_TTL,
    checksum,
    force = false,
    name,
    platform = os.platform(),
    spawnOptions,
    url,
  } = { __proto__: null, ...options } as DlxBinaryOptions

  // Generate cache paths similar to pnpm/npx structure.
  const cacheDir = getDlxCachePath()
  const platformKey = `${platform}-${arch}`
  const binaryName =
    name || `binary-${platformKey}${platform === 'win32' ? '.exe' : ''}`
  // Use shared generateCacheKey from @socketsecurity/lib/dlx.
  // Spec format for binaries: `${url}:${binaryName}`.
  const cacheKey = generateCacheKey(`${url}:${binaryName}`)
  const cacheEntryDir = path.join(cacheDir, cacheKey)
  const binaryPath = path.join(cacheEntryDir, binaryName)

  let downloaded = false
  let computedChecksum = checksum

  // Check if we need to download.
  if (
    !force &&
    existsSync(cacheEntryDir) &&
    (await isCacheValid(cacheEntryDir, cacheTtl))
  ) {
    // Binary is cached and valid, read the checksum from metadata.
    try {
      const metaPath = getMetadataPath(cacheEntryDir)
      const metadata = (await readJson(metaPath, {
        throws: false,
      })) as DlxMetadata | null
      if (metadata && typeof metadata.checksum === 'string') {
        computedChecksum = metadata.checksum
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
    // Ensure cache directory exists.
    await safeMkdir(cacheEntryDir, { recursive: true })

    // Download the binary.
    computedChecksum = await downloadBinary(url, binaryPath, checksum)

    // Get file size for metadata.
    const stats = await fs.stat(binaryPath)
    await writeMetadata(
      cacheEntryDir,
      cacheKey,
      url,
      computedChecksum || '',
      stats.size,
    )
  }

  // Execute the binary.
  const spawnPromise = spawn(binaryPath, args, spawnOptions, spawnExtra)

  return {
    binaryPath,
    downloaded,
    spawnPromise,
  }
}

/**
 * Get the DLX binary cache directory path.
 * Returns normalized path for cross-platform compatibility.
 * Uses getSocketDlxDir from socket-lib for correct path: ~/.socket/_dlx
 */
export function getDlxCachePath(): string {
  return getSocketDlxDir()
}

/**
 * Get the base .socket directory path.
 * Uses %USERPROFILE% on Windows, $HOME on POSIX systems.
 * Returns normalized path for cross-platform compatibility.
 */
export function getSocketHomePath(): string {
  const homedir = os.homedir()
  if (!homedir) {
    throw new InputError('Unable to determine home directory')
  }
  return normalizePath(path.join(homedir, '.socket'))
}

/**
 * Get information about cached binaries.
 */
export async function listDlxCache(): Promise<
  Array<{
    name: string
    url: string
    size: number
    age: number
    platform: string
    arch: string
    checksum: string
  }>
> {
  const cacheDir = getDlxCachePath()

  if (!existsSync(cacheDir)) {
    return []
  }

  const results = []
  const now = Date.now()
  const entries = await fs.readdir(cacheDir)

  for (const entry of entries) {
    const entryPath = path.join(cacheDir, entry)
    try {
      // eslint-disable-next-line no-await-in-loop
      const stats = await fs.stat(entryPath)
      if (!stats.isDirectory()) {
        continue
      }

      const metaPath = getMetadataPath(entryPath)
      // eslint-disable-next-line no-await-in-loop
      const metadata = (await readJson(metaPath, {
        throws: false,
      })) as DlxMetadata | null
      if (!metadata || !metadata.timestamp) {
        continue
      }

      // Get URL from source field for unified schema.
      const url = metadata.source?.url || ''
      if (!url) {
        continue
      }

      // Find the binary file in the directory.
      // eslint-disable-next-line no-await-in-loop
      const files = await fs.readdir(entryPath)
      const binaryFile = files.find(f => !f.startsWith('.'))

      if (binaryFile) {
        const binaryPath = path.join(entryPath, binaryFile)
        // eslint-disable-next-line no-await-in-loop
        const binaryStats = await fs.stat(binaryPath)

        results.push({
          name: binaryFile,
          url,
          size: binaryStats.size,
          age: now - metadata.timestamp,
          platform: metadata.platform || 'unknown',
          arch: metadata.arch || 'unknown',
          checksum: metadata.checksum || '',
        })
      }
    } catch {}
  }

  return results
}
