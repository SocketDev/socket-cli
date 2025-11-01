/**
 * npm registry utilities for downloading and extracting packages.
 * Provides reusable functions for bootstrap and self-update mechanisms.
 *
 * Key Functions:
 * - fetchPackageMetadata: Get package info from npm registry
 * - downloadTarball: Download package tarball
 * - extractTarball: Extract tarball contents
 * - verifyTarballIntegrity: Verify package integrity using SHA-512
 *
 * Features:
 * - Automatic redirect handling
 * - Timeout support
 * - Retry with exponential backoff
 * - Tarball path sanitization (prevents directory traversal)
 * - Integrity verification (SRI format)
 */

import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import https from 'node:https'
import path from 'node:path'

import { parseTarGzip } from 'nanotar'

import { safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

// Type helpers.
type TarFile = Awaited<ReturnType<typeof parseTarGzip>>[number]

// Constants.
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_RETRY_ATTEMPTS = 2
const DEFAULT_RETRY_BASE_DELAY_MS = 200
const DEFAULT_RETRY_BACKOFF_FACTOR = 2

/**
 * npm package metadata from registry API.
 */
export interface NpmPackageMetadata {
  name: string
  version: string
  dist: {
    tarball: string
    integrity?: string
    shasum?: string
  }
}

/**
 * Options for registry operations.
 */
export interface RegistryOptions {
  registryUrl?: string
  authToken?: string
  timeout?: number
}

/**
 * Options for retry behavior.
 */
export interface RetryOptions {
  maxRetries?: number
  baseDelayMs?: number
  backoffFactor?: number
}

/**
 * Sanitize tarball path to prevent directory traversal attacks.
 * Ensures extracted files stay within the target directory.
 */
export function sanitizeTarballPath(filePath: string): string {
  // Remove 'package/' prefix from npm tarballs (tarballs always use forward slashes).
  const withoutPrefix = filePath.replace(/^package\//, '')
  // Split path and remove any '..' or '.' segments to prevent traversal.
  const segments = withoutPrefix
    .split('/')
    .filter(seg => seg && seg !== '.' && seg !== '..')
  // Use path.join for proper path construction, then normalize to forward slashes.
  return path.join(...segments).replace(/\\/g, '/')
}

/**
 * Make an HTTPS GET request and return the response as a Buffer.
 * Handles 301/302 redirects automatically with timeout.
 */
export async function httpsGet(
  url: string,
  options: { timeout?: number; authToken?: string } = {},
): Promise<Buffer> {
  const timeout = options.timeout || DEFAULT_TIMEOUT_MS

  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'User-Agent': 'socket-cli/registry-client',
    }

    if (options.authToken) {
      headers['Authorization'] = `Bearer ${options.authToken}`
    }

    const request = https
      .get(url, { headers }, res => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          if (res.headers.location) {
            return httpsGet(res.headers.location, options).then(resolve, reject)
          }
          reject(
            new Error(
              `HTTP ${res.statusCode} redirect missing Location header`,
            ),
          )
          return
        }

        if (res.statusCode !== 200) {
          reject(
            new Error(
              `HTTP ${res.statusCode}: ${res.statusMessage || 'Request failed'}`,
            ),
          )
          return
        }

        // Capture content-length header for validation if present.
        const contentLength = res.headers['content-length']
          ? Number.parseInt(res.headers['content-length'], 10)
          : undefined

        const chunks: Buffer[] = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => {
          const buffer = Buffer.concat(chunks)
          // Validate content-length if provided to detect truncated downloads.
          if (contentLength !== undefined && buffer.length !== contentLength) {
            reject(
              new Error(
                `Download incomplete: received ${buffer.length} bytes but expected ${contentLength} bytes. Network may have been interrupted.`,
              ),
            )
            return
          }
          resolve(buffer)
        })
        res.on('error', reject)
      })
      .on('error', reject)
      .on('timeout', () => {
        request.destroy()
        reject(
          new Error(`Request timeout after ${timeout}ms while fetching ${url}`),
        )
      })

    request.setTimeout(timeout)
  })
}

/**
 * Retry a function with exponential backoff.
 * Useful for transient filesystem errors (e.g., EBUSY on Windows).
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_RETRY_ATTEMPTS
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS
  const backoffFactor = options.backoffFactor ?? DEFAULT_RETRY_BACKOFF_FACTOR

  let lastError: Error | unknown
  let delay = baseDelayMs

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      // Only retry on transient errors (EBUSY, EMFILE, ENFILE).
      const code = (error as NodeJS.ErrnoException)?.code
      if (
        attempt < maxRetries &&
        (code === 'EBUSY' || code === 'EMFILE' || code === 'ENFILE')
      ) {
        await new Promise(resolve => setTimeout(resolve, delay))
        delay *= backoffFactor
        continue
      }
      throw error
    }
  }
  throw lastError
}

/**
 * Fetch package metadata from npm registry.
 */
export async function fetchPackageMetadata(
  packageName: string,
  version: string,
  options: RegistryOptions = {},
): Promise<NpmPackageMetadata> {
  const registryUrl = options.registryUrl || 'https://registry.npmjs.org'
  const url = `${registryUrl}/${packageName}/${version}`

  try {
    const buffer = await httpsGet(url, {
      ...(options.timeout !== undefined && { timeout: options.timeout }),
      ...(options.authToken !== undefined && { authToken: options.authToken }),
    })
    const data = JSON.parse(buffer.toString()) as NpmPackageMetadata

    // Validate required fields.
    if (!data.version || typeof data.version !== 'string') {
      throw new Error('npm registry response missing or invalid version field')
    }
    if (!data.dist || !data.dist.tarball) {
      throw new Error('npm registry response missing dist.tarball field')
    }

    return data
  } catch (error) {
    throw new Error(
      `Failed to fetch package metadata for ${packageName}@${version}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Download tarball from npm registry.
 */
export async function downloadTarball(
  tarballUrl: string,
  destination: string,
  options: RegistryOptions = {},
): Promise<void> {
  try {
    const buffer = await httpsGet(tarballUrl, {
      ...(options.timeout !== undefined && { timeout: options.timeout }),
      ...(options.authToken !== undefined && { authToken: options.authToken }),
    })

    await retryWithBackoff(() => fs.writeFile(destination, buffer))
  } catch (error) {
    throw new Error(
      `Failed to download tarball from ${tarballUrl}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Extract tarball to target directory.
 * Validates tarball contents and sanitizes paths to prevent attacks.
 */
export async function extractTarball(
  tarballPath: string,
  targetDir: string,
): Promise<TarFile[]> {
  try {
    // Read tarball from disk.
    const buffer = await fs.readFile(tarballPath)

    // Parse tarball and extract files.
    const files = await parseTarGzip(buffer)

    // Validate that we got files from the tarball.
    if (!files || files.length === 0) {
      throw new Error(
        'Downloaded tarball is empty or invalid (no files extracted)',
      )
    }

    // Extract files to target directory.
    for (const file of files) {
      // Sanitize file path to prevent directory traversal attacks.
      const sanitizedPath = sanitizeTarballPath(file.name)
      const targetPath = path.join(targetDir, sanitizedPath)

      if (file.type === 'directory') {
        await retryWithBackoff(() =>
          safeMkdir(targetPath, { recursive: true }),
        ).catch(error => {
          throw new Error(
            `Failed to create directory ${targetPath}: ${error instanceof Error ? error.message : String(error)}`,
          )
        })
      } else if (file.type === 'file' && file.data) {
        // Ensure parent directory exists.
        const parentDir = path.dirname(targetPath)
        await retryWithBackoff(() =>
          safeMkdir(parentDir, { recursive: true }),
        ).catch(error => {
          const code = (error as NodeJS.ErrnoException)?.code
          if (code === 'ENOSPC') {
            throw new Error(
              `Disk full: Not enough space to extract to ${parentDir}. Free up disk space and try again.`,
            )
          }
          throw new Error(
            `Failed to create parent directory ${parentDir}: ${error instanceof Error ? error.message : String(error)}`,
          )
        })

        // Write file.
        await retryWithBackoff(() =>
          fs.writeFile(targetPath, file.data as Uint8Array<ArrayBufferLike>),
        ).catch(error => {
          const code = (error as NodeJS.ErrnoException)?.code
          if (code === 'ENOSPC') {
            throw new Error(
              `Disk full: Not enough space to write ${targetPath}. Free up disk space and try again.`,
            )
          }
          throw new Error(
            `Failed to write file ${targetPath}: ${error instanceof Error ? error.message : String(error)}`,
          )
        })

        // Set file permissions if specified in tarball.
        if (file.attrs?.mode) {
          const mode = Number.parseInt(file.attrs.mode, 8)
          // Validate mode is a valid number before attempting chmod.
          if (!Number.isNaN(mode) && mode > 0) {
            await retryWithBackoff(() => fs.chmod(targetPath, mode)).catch(
              error => {
                // Chmod failures are non-fatal - log but continue.
                logger.warn(
                  `Warning: Failed to set permissions for ${targetPath}: ${error instanceof Error ? error.message : String(error)}`,
                )
              },
            )
          }
        }
      }
    }

    return files
  } catch (error) {
    throw new Error(
      `Failed to extract tarball from ${tarballPath}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Verify tarball integrity using Subresource Integrity (SRI) format.
 * npm uses SHA-512 for package integrity.
 *
 * @param filePath - Path to tarball file
 * @param integrity - SRI string (e.g., "sha512-base64hash==")
 * @returns true if integrity matches, false otherwise
 */
export async function verifyTarballIntegrity(
  filePath: string,
  integrity?: string,
): Promise<boolean> {
  if (!integrity) {
    logger.warn(
      `Warning: No integrity value provided for ${filePath}, skipping verification`,
    )
    return true
  }

  try {
    // Parse SRI format: "sha512-base64hash=="
    const match = /^(sha\d+)-(.+)$/.exec(integrity)
    if (!match) {
      logger.warn(`Warning: Invalid integrity format: ${integrity}`)
      return false
    }

    const algorithm = match[1]
    const expectedHash = match[2]

    if (!algorithm || !expectedHash) {
      return false
    }

    // Read file and compute hash.
    const content = await fs.readFile(filePath)
    const hash = crypto.createHash(algorithm)
    hash.update(content)
    const actualHash = hash.digest('base64')

    const isValid = actualHash === expectedHash

    if (!isValid) {
      logger.error(
        `Integrity mismatch for ${filePath}: expected ${expectedHash.slice(0, 12)}..., got ${actualHash.slice(0, 12)}...`,
      )
    }

    return isValid
  } catch (error) {
    logger.error(
      `Failed to verify integrity for ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    )
    return false
  }
}

/**
 * Extract a specific binary from a downloaded tarball.
 * Useful for extracting SEA binaries from @socketbin packages.
 *
 * @param tarballPath - Path to downloaded tarball
 * @param binaryRelativePath - Relative path to binary in tarball (e.g., "bin/socket")
 * @param destination - Where to extract the binary
 * @returns Path to extracted binary
 */
export async function extractBinaryFromTarball(
  tarballPath: string,
  binaryRelativePath: string,
  destination: string,
): Promise<string> {
  try {
    // Read tarball from disk.
    const buffer = await fs.readFile(tarballPath)

    // Parse tarball.
    const files = await parseTarGzip(buffer)

    // Validate that we got files.
    if (!files || files.length === 0) {
      throw new Error('Tarball is empty or invalid')
    }

    // Find the binary file (with "package/" prefix).
    const targetPath = `package/${binaryRelativePath}`
    const binaryFile = files.find(
      file => file.name === targetPath && file.type === 'file',
    )

    if (!binaryFile || !binaryFile.data) {
      throw new Error(
        `Binary not found in tarball at ${binaryRelativePath}. Available files: ${files.map(f => f.name).join(', ')}`,
      )
    }

    // Ensure destination directory exists.
    const destDir = path.dirname(destination)
    await safeMkdir(destDir, { recursive: true })

    // Write binary to destination.
    await fs.writeFile(
      destination,
      binaryFile.data as Uint8Array<ArrayBufferLike>,
    )

    // Set executable permissions if specified in tarball.
    if (binaryFile.attrs?.mode) {
      const mode = Number.parseInt(binaryFile.attrs.mode, 8)
      if (!Number.isNaN(mode) && mode > 0) {
        await fs.chmod(destination, mode)
      }
    } else {
      // Default to executable if no mode specified.
      await fs.chmod(destination, 0o755)
    }

    return destination
  } catch (error) {
    throw new Error(
      `Failed to extract binary from ${tarballPath}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
