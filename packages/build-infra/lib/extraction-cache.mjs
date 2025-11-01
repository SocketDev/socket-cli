/**
 * Hash-based extraction caching utilities.
 *
 * Provides a DRY pattern for build scripts that extract/transform source files.
 * Uses SHA256 content hashing to detect source changes and skip regeneration.
 *
 * @module extraction-cache
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

/**
 * Check if extraction is needed based on source content hash.
 *
 * Compares the SHA256 hash of the source file(s) against the hash
 * stored in the output file. Returns true if extraction is needed.
 *
 * @param {object} options - Extraction cache options
 * @param {string|string[]} options.sourcePaths - Source file path(s) to hash
 * @param {string} options.outputPath - Output file path to check
 * @param {RegExp} options.hashPattern - Pattern to extract hash from output (default: /Source hash: ([a-f0-9]{64})/)
 * @param {function} [options.validateOutput] - Optional function to validate output content
 * @returns {Promise<boolean>} True if extraction needed, false if cached
 */
export async function shouldExtract({
  sourcePaths,
  outputPath,
  hashPattern = /Source hash: ([a-f0-9]{64})/,
  validateOutput,
}) {
  // Normalize to array.
  const sources = Array.isArray(sourcePaths) ? sourcePaths : [sourcePaths]

  // Check if output exists.
  if (!existsSync(outputPath)) {
    return true
  }

  // Check if all sources exist.
  for (const sourcePath of sources) {
    if (!existsSync(sourcePath)) {
      return true
    }
  }

  try {
    const existing = readFileSync(outputPath, 'utf-8')

    // Validate output if validator provided.
    if (validateOutput && !validateOutput(existing)) {
      return true
    }

    // Extract cached hash from output.
    const hashMatch = existing.match(hashPattern)
    if (!hashMatch) {
      return true
    }

    const cachedSourceHash = hashMatch[1]

    // Compute current source hash.
    const currentSourceHash = await computeSourceHash(sources)

    // Compare hashes.
    if (cachedSourceHash !== currentSourceHash) {
      return true
    }

    // Cache hit!
    getDefaultLogger().log(`✓ Using cached ${outputPath}`)
    return false
  } catch {
    // Any error, regenerate.
    return true
  }
}

/**
 * Compute SHA256 hash of source file(s).
 *
 * For multiple sources, concatenates content and hashes together.
 *
 * @param {string[]} sourcePaths - Source file paths to hash
 * @returns {Promise<string>} SHA256 hash (hex)
 */
export async function computeSourceHash(sourcePaths) {
  const hash = createHash('sha256')

  for (const sourcePath of sourcePaths) {
    const content = readFileSync(sourcePath, 'utf-8')
    hash.update(content)
  }

  return hash.digest('hex')
}

/**
 * Generate source hash comment for embedding in output.
 *
 * @param {string|string[]} sourcePaths - Source file path(s)
 * @returns {Promise<string>} Comment with hash (e.g., "Source hash: abc123...")
 */
export async function generateHashComment(sourcePaths) {
  const sources = Array.isArray(sourcePaths) ? sourcePaths : [sourcePaths]
  const hash = await computeSourceHash(sources)
  return `Source hash: ${hash}`
}

/**
 * Ensure output directory exists.
 *
 * @param {string} outputPath - Output file path
 */
export function ensureOutputDir(outputPath) {
  mkdirSync(path.dirname(outputPath), { recursive: true })
}
