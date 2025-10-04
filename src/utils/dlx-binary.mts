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
 * - Stores binaries in ~/.socket/_dlx (shared directory across Socket tools)
 * - Uses content-addressed storage with SHA256 hashes
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

import { downloadWithLock } from '@socketsecurity/registry/lib/download-lock'
import { readJson, remove } from '@socketsecurity/registry/lib/fs'
import { getSocketDlxDir } from '@socketsecurity/registry/lib/paths'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../constants.mts'
import { InputError } from './errors.mts'

import type {
  SpawnExtra,
  SpawnOptions,
} from '@socketsecurity/registry/lib/spawn'

export interface DlxBinaryOptions {
  /** URL to download the binary from. */
  url: string
  /** Optional name for the cached binary (defaults to URL hash). */
  name?: string | undefined
  /** Expected checksum (sha256) for verification. */
  checksum?: string | undefined
  /** Cache TTL in milliseconds (default: 7 days). */
  cacheTtl?: number | undefined
  /** Force re-download even if cached. */
  force?: boolean | undefined
  /** Platform override (defaults to current platform). */
  platform?: NodeJS.Platform | undefined
  /** Architecture override (defaults to current arch). */
  arch?: string | undefined
  /** Additional spawn options. */
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

const { DLX_BINARY_CACHE_TTL } = constants

/**
 * Generate a cache directory name from URL, similar to pnpm/npx.
 * Uses SHA256 hash to create content-addressed storage.
 */
function generateCacheKey(url: string): string {
  return createHash('sha256').update(url).digest('hex')
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

    const metadata = await readJson(metaPath, { throws: false })
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return false
    }
    const now = Date.now()
    const age = now - ((metadata['timestamp'] as number) || 0)

    return age < cacheTtl
  } catch {
    return false
  }
}

/**
 * Download a file from a URL with integrity checking and download locking.
 * Uses registry's downloadWithLock to prevent concurrent downloads.
 */
async function downloadBinary(
  url: string,
  destPath: string,
  checksum?: string,
): Promise<string> {
  // Create a temporary file first for integrity checking.
  const tempPath = `${destPath}.download`

  try {
    // Ensure directory exists.
    await fs.mkdir(path.dirname(destPath), { recursive: true })

    // Download with locking and automatic retries.
    // This prevents concurrent downloads and provides retry logic.
    await downloadWithLock(url, tempPath, {
      lockTimeout: 120_000, // Wait up to 2 minutes for concurrent downloads
      retries: 3, // Retry up to 3 times with exponential backoff
      retryDelay: 1000, // Start with 1 second delay
      timeout: 300_000, // 5 minute timeout per attempt
    })

    // Read file for checksum verification.
    const buffer = await fs.readFile(tempPath)
    const hasher = createHash('sha256')
    hasher.update(buffer)
    const actualChecksum = hasher.digest('hex')

    // Verify checksum if provided.
    if (checksum && actualChecksum !== checksum) {
      throw new InputError(
        `Checksum mismatch: expected ${checksum}, got ${actualChecksum}`,
      )
    }

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
      await remove(tempPath)
    } catch {
      // Ignore cleanup errors.
    }
    throw error instanceof Error
      ? error
      : new InputError(`Failed to download binary: ${String(error)}`)
  }
}

/**
 * Write metadata for a cached binary.
 */
async function writeMetadata(
  cacheEntryPath: string,
  url: string,
  checksum: string,
): Promise<void> {
  const metaPath = getMetadataPath(cacheEntryPath)
  const metadata = {
    url,
    checksum,
    timestamp: Date.now(),
    platform: os.platform(),
    arch: os.arch(),
    version: '1.0.0',
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
      const metadata = await readJson(metaPath, { throws: false })
      if (
        !metadata ||
        typeof metadata !== 'object' ||
        Array.isArray(metadata)
      ) {
        continue
      }
      const age = now - ((metadata['timestamp'] as number) || 0)

      if (age > maxAge) {
        // Remove entire cache entry directory.
        // eslint-disable-next-line no-await-in-loop
        await remove(entryPath, { recursive: true, force: true })
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
          await fs.rmdir(entryPath)
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
  const cacheKey = generateCacheKey(url)
  const cacheEntryDir = path.join(cacheDir, cacheKey)
  const platformKey = `${platform}-${arch}`
  const binaryName =
    name || `binary-${platformKey}${platform === 'win32' ? '.exe' : ''}`
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
      const metadata = await readJson(metaPath, { throws: false })
      if (
        metadata &&
        typeof metadata === 'object' &&
        !Array.isArray(metadata) &&
        typeof metadata['checksum'] === 'string'
      ) {
        computedChecksum = metadata['checksum']
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
    await fs.mkdir(cacheEntryDir, { recursive: true })

    // Download the binary.
    computedChecksum = await downloadBinary(url, binaryPath, checksum)
    await writeMetadata(cacheEntryDir, url, computedChecksum || '')
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
 * Uses the shared ~/.socket/_dlx directory for binary downloads.
 * Returns normalized path for cross-platform compatibility.
 */
export function getDlxCachePath(): string {
  return getSocketDlxDir()
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
      const metadata = await readJson(metaPath, { throws: false })
      if (
        !metadata ||
        typeof metadata !== 'object' ||
        Array.isArray(metadata)
      ) {
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
          url: (metadata['url'] as string) || '',
          size: binaryStats.size,
          age: now - ((metadata['timestamp'] as number) || 0),
          platform: (metadata['platform'] as string) || 'unknown',
          arch: (metadata['arch'] as string) || 'unknown',
          checksum: (metadata['checksum'] as string) || '',
        })
      }
    } catch {}
  }

  return results
}
