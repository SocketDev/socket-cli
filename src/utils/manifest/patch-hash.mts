/**
 * Patch Hash Utilities
 *
 * Handles hash format detection, validation, and conversion for Socket patches.
 * Supports both:
 * - ssri format (sha256-base64, sha512-base64) - current standard
 * - git-sha256 format (git-sha256-hex) - legacy format for GitHub compatibility
 *
 * Note: "git-sha256" format name refers to Git's SHA hashing algorithm (not the
 * algorithm version). Git objects are hashed with a "blob <size>\0" prefix.
 * The format supports both SHA-1 (40 hex chars) and SHA-256 (64 hex chars).
 *
 * Key Functions:
 * - detectHashFormat: Identifies hash format from string
 * - validateHash: Validates content against expected hash
 * - convertToSsri: Converts legacy git-sha256 to ssri format
 * - computeSsri: Computes ssri hash from content
 */

import crypto from 'node:crypto'

// @ts-expect-error - ssri does not have type definitions.
import ssri from 'ssri'

export type HashFormat = 'ssri' | 'git-sha256' | 'unknown'

export type SsriAlgorithm = 'sha256' | 'sha512'

/**
 * Detects the format of a hash string.
 *
 * @param hash - Hash string to detect
 * @returns Hash format type
 *
 * @example
 * detectHashFormat('sha256-abc123...') // 'ssri'
 * detectHashFormat('git-sha256-abc123...') // 'git-sha256'
 * detectHashFormat('invalid') // 'unknown'
 */
export function detectHashFormat(hash: string): HashFormat {
  if (!hash || typeof hash !== 'string') {
    return 'unknown'
  }

  // Check for ssri format: algorithm-base64hash
  if (hash.startsWith('sha256-') || hash.startsWith('sha512-')) {
    // Validate base64 portion exists
    const [, base64Hash] = hash.split('-', 2)
    if (base64Hash && base64Hash.length > 0) {
      return 'ssri'
    }
  }

  // Check for legacy git-sha256 format: git-sha256-hexhash
  // Support both SHA-1 (40 chars) and SHA-256 (64 chars)
  if (hash.startsWith('git-sha256-')) {
    const [, , hexHash] = hash.split('-', 3)
    // SHA-1 produces 40 hex chars, SHA-256 produces 64 hex chars
    if (
      hexHash &&
      (hexHash.length === 40 || hexHash.length === 64) &&
      /^[a-f0-9]+$/i.test(hexHash)
    ) {
      return 'git-sha256'
    }
  }

  return 'unknown'
}

/**
 * Validates content against a git-sha256 hash.
 * Git SHA format includes "blob <size>\0" prefix before hashing.
 *
 * @param content - Content buffer to validate
 * @param expectedGitSha - Expected hash in format "git-sha256-<hex>"
 * @returns True if content matches hash
 */
export function validateGitSha(
  content: Buffer,
  expectedGitSha: string,
): boolean {
  try {
    // Extract hex portion: "git-sha256-abc..." -> "abc..."
    const [, , hexHash] = expectedGitSha.split('-', 3)
    if (!hexHash) {
      return false
    }

    // Compute git SHA: hash of "blob <size>\0<content>"
    const header = Buffer.from(`blob ${content.length}\0`)
    const data = Buffer.concat([header, content])
    const actualHash = crypto.createHash('sha256').update(data).digest('hex')

    return actualHash === hexHash
  } catch {
    return false
  }
}

/**
 * Validates content against an ssri hash.
 *
 * @param content - Content buffer to validate
 * @param expectedSsri - Expected hash in format "algorithm-base64hash"
 * @returns True if content matches hash
 */
export function validateSsri(content: Buffer, expectedSsri: string): boolean {
  try {
    // Use ssri.checkData to validate content against integrity string
    // Returns Integrity object if valid, false if invalid
    const result = ssri.checkData(content, expectedSsri)
    return result !== false
  } catch {
    return false
  }
}

/**
 * Validates content against expected hash, auto-detecting format.
 *
 * @param content - Content buffer to validate
 * @param expectedHash - Expected hash in any supported format
 * @returns True if content matches hash
 *
 * @example
 * validateHash(buffer, 'sha256-abc123...')
 * validateHash(buffer, 'git-sha256-abc123...')
 */
export function validateHash(content: Buffer, expectedHash: string): boolean {
  const format = detectHashFormat(expectedHash)

  switch (format) {
    case 'ssri':
      return validateSsri(content, expectedHash)
    case 'git-sha256':
      return validateGitSha(content, expectedHash)
    default:
      return false
  }
}

/**
 * Computes ssri hash from content.
 *
 * @param content - Content to hash
 * @param algorithm - Hash algorithm to use (default: sha256)
 * @returns Hash in ssri format "algorithm-base64hash"
 *
 * @example
 * computeSsri(buffer) // 'sha256-abc123...'
 * computeSsri(buffer, 'sha512') // 'sha512-abc123...'
 */
export function computeSsri(
  content: Buffer,
  algorithm: SsriAlgorithm = 'sha256',
): string {
  // Use ssri.fromData to compute integrity string
  const integrity = ssri.fromData(content, { algorithms: [algorithm] })
  return integrity.toString()
}

/**
 * Converts legacy git-sha256 hash to ssri format by recomputing from content.
 *
 * IMPORTANT: Cannot reverse git-sha256 to get original content hash due to
 * git's "blob <size>\0" prefix. Must have original content to compute ssri.
 *
 * @param content - Original content buffer
 * @param gitShaHash - Legacy git-sha256 hash (for validation)
 * @param algorithm - Target ssri algorithm (default: sha256)
 * @returns ssri hash computed from content
 * @throws Error if gitShaHash doesn't match content
 *
 * @example
 * convertToSsri(buffer, 'git-sha256-abc123...')
 * // Returns: 'sha256-xyz789...'
 */
export function convertToSsri(
  content: Buffer,
  gitShaHash: string,
  algorithm: SsriAlgorithm = 'sha256',
): string {
  // First validate that the git-sha256 matches the content
  if (!validateGitSha(content, gitShaHash)) {
    throw new Error(
      `Content does not match provided git-sha256 hash: ${gitShaHash}`,
    )
  }

  // Compute fresh ssri from content
  return computeSsri(content, algorithm)
}

/**
 * Normalizes any supported hash format to ssri.
 * If already ssri, returns as-is. If git-sha256, converts to ssri.
 *
 * @param content - Content buffer (required for git-sha256 conversion)
 * @param hash - Hash in any supported format
 * @param algorithm - Target ssri algorithm (default: sha256)
 * @returns Hash in ssri format
 * @throws Error if hash format is unknown or validation fails
 *
 * @example
 * normalizeToSsri(buffer, 'sha256-abc...') // Returns same
 * normalizeToSsri(buffer, 'git-sha256-abc...') // Converts to ssri
 */
export function normalizeToSsri(
  content: Buffer,
  hash: string,
  algorithm: SsriAlgorithm = 'sha256',
): string {
  const format = detectHashFormat(hash)

  switch (format) {
    case 'ssri':
      // Already ssri, validate and return
      if (!validateSsri(content, hash)) {
        throw new Error(`Content does not match provided ssri hash: ${hash}`)
      }
      return hash

    case 'git-sha256':
      // Convert legacy format to ssri
      return convertToSsri(content, hash, algorithm)

    default:
      throw new Error(`Unknown or unsupported hash format: ${hash}`)
  }
}
