/**
 * @fileoverview File integrity and validation helpers
 *
 * Utilities for verifying file checksums, generating hashes, and validating
 * build artifacts across the build system.
 *
 * Used by:
 * - build-yao-pkg-node.mjs (patch verification)
 * - build-sea.mjs (binary verification)
 * - Other build scripts requiring integrity checks
 */

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { glob } from '@socketsecurity/lib/fs'

/**
 * Verify file hash against expected value.
 *
 * @param {string} filePath - Path to file to verify
 * @param {string} expectedHash - Expected hash value
 * @param {string} [algorithm='sha256'] - Hash algorithm (sha256, sha512, md5)
 * @returns {Promise<{valid: boolean, expected?: string, actual?: string, algorithm: string}>}
 *
 * @throws {Error} If file cannot be read
 *
 * @example
 * const result = await verifyFileHash('/path/to/file', 'abc123...', 'sha256')
 * if (!result.valid) {
 *   logger.error(`Hash mismatch: expected ${result.expected}, got ${result.actual}`)
 * }
 */
export async function verifyFileHash(filePath, expectedHash, algorithm = 'sha256') {
  try {
    const content = await readFile(filePath)
    const actualHash = createHash(algorithm).update(content).digest('hex')

    if (actualHash !== expectedHash) {
      return {
        valid: false,
        expected: expectedHash,
        actual: actualHash,
        algorithm,
      }
    }

    return { valid: true, hash: actualHash, algorithm }
  } catch (e) {
    throw new Error(`Failed to verify file integrity: ${e.message}`)
  }
}

/**
 * Generate hash for a file.
 *
 * @param {string} filePath - Path to file
 * @param {string} [algorithm='sha256'] - Hash algorithm
 * @returns {Promise<string>} Hex-encoded hash
 *
 * @throws {Error} If file cannot be read
 *
 * @example
 * const hash = await generateFileHash('/path/to/file')
 * logger.log(`File hash: ${hash}`)
 */
export async function generateFileHash(filePath, algorithm = 'sha256') {
  const content = await readFile(filePath)
  return createHash(algorithm).update(content).digest('hex')
}

/**
 * Verify multiple files in parallel.
 *
 * @param {Array<{path: string, hash: string}>} files - Files to verify
 * @param {string} [algorithm='sha256'] - Hash algorithm
 * @returns {Promise<{allValid: boolean, results: Array}>} Verification results
 *
 * @example
 * const files = [
 *   { path: '/path/to/file1', hash: 'abc123...' },
 *   { path: '/path/to/file2', hash: 'def456...' }
 * ]
 * const { allValid, results } = await verifyMultipleFiles(files)
 */
export async function verifyMultipleFiles(files, algorithm = 'sha256') {
  const results = await Promise.allSettled(
    files.map(({ hash, path }) => verifyFileHash(path, hash, algorithm)),
  )

  return {
    allValid: results.every(r => r.status === 'fulfilled' && r.value.valid),
    results: results.map((r, i) => ({
      file: files[i].path,
      ...(r.status === 'fulfilled'
        ? r.value
        : { valid: false, error: r.reason.message }),
    })),
  }
}

/**
 * Create integrity manifest for a directory.
 *
 * Generates a mapping of relative file paths to their hashes.
 *
 * @param {string} directory - Directory to create manifest for
 * @param {string} [algorithm='sha256'] - Hash algorithm
 * @param {string} [pattern='**\/*'] - Glob pattern for files to include
 * @returns {Promise<Object<string, string>>} Map of file paths to hashes
 *
 * @example
 * const manifest = await createManifest('/build/output')
 * // {
 * //   'bin/cli.js': 'abc123...',
 * //   'lib/index.js': 'def456...'
 * // }
 */
export async function createManifest(
  directory,
  algorithm = 'sha256',
  pattern = '**/*',
) {
  const files = await glob(pattern, { cwd: directory, nodir: true })
  const manifest = {}

  for (const file of files) {
    const fullPath = join(directory, file)
    manifest[file] = await generateFileHash(fullPath, algorithm)
  }

  return manifest
}

/**
 * Verify directory contents against integrity manifest.
 *
 * @param {string} directory - Directory to verify
 * @param {Object<string, string>} manifest - Manifest mapping paths to hashes
 * @param {string} [algorithm='sha256'] - Hash algorithm
 * @returns {Promise<{allValid: boolean, results: Array}>} Verification results
 *
 * @example
 * const manifest = { 'bin/cli.js': 'abc123...' }
 * const { allValid, results } = await verifyAgainstManifest('/build', manifest)
 */
export async function verifyAgainstManifest(
  directory,
  manifest,
  algorithm = 'sha256',
) {
  const files = Object.entries(manifest).map(([path, hash]) => ({
    path: join(directory, path),
    hash,
  }))

  return verifyMultipleFiles(files, algorithm)
}

/**
 * Generate checksum file for a file.
 *
 * Creates a .sha256 or similar checksum file commonly used in distributions.
 *
 * @param {string} filePath - Path to file to checksum
 * @param {string} [algorithm='sha256'] - Hash algorithm
 * @returns {Promise<string>} Path to created checksum file
 *
 * @example
 * const checksumFile = await generateChecksumFile('/build/cli-v1.0.0.tar.gz')
 * // Creates /build/cli-v1.0.0.tar.gz.sha256
 */
export async function generateChecksumFile(filePath, algorithm = 'sha256') {
  const hash = await generateFileHash(filePath, algorithm)
  const checksumPath = `${filePath}.${algorithm}`

  // Format: <hash>  <filename>
  const filename = filePath.split('/').pop()
  const content = `${hash}  ${filename}\n`

  await writeFile(checksumPath, content)
  return checksumPath
}

/**
 * Verify file against checksum file.
 *
 * @param {string} filePath - Path to file to verify
 * @param {string} [checksumPath] - Path to checksum file (default: filePath.sha256)
 * @returns {Promise<{valid: boolean, hash?: string, error?: string}>} Verification result
 *
 * @example
 * const result = await verifyChecksumFile('/build/cli-v1.0.0.tar.gz')
 * if (!result.valid) {
 *   logger.error(`Checksum verification failed: ${result.error}`)
 * }
 */
export async function verifyChecksumFile(filePath, checksumPath = null) {
  try {
    // Auto-detect checksum file if not provided.
    if (!checksumPath) {
      // Try common extensions.
      const algorithms = ['sha256', 'sha512', 'md5']

      for (const algo of algorithms) {
        const path = `${filePath}.${algo}`
        try {
          await readFile(path)
          checksumPath = path
          break
        } catch {
          // Try next algorithm.
        }
      }

      if (!checksumPath) {
        throw new Error('No checksum file found')
      }
    }

    // Parse checksum file.
    const content = await readFile(checksumPath, 'utf-8')
    const match = content.match(/^([a-f0-9]+)\s+/)

    if (!match) {
      throw new Error('Invalid checksum file format')
    }

    const expectedHash = match[1]
    const algorithm = checksumPath.split('.').pop()

    // Verify hash.
    const result = await verifyFileHash(filePath, expectedHash, algorithm)

    return result
  } catch (e) {
    return {
      valid: false,
      error: e.message,
    }
  }
}
