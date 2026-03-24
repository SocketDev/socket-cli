/**
 * Python SHA-256 checksums getter function.
 * Uses direct process.env access so esbuild define can inline values.
 * IMPORTANT: esbuild's define plugin can only replace direct process.env['KEY'] references.
 * If we imported from env modules, esbuild couldn't inline the values at build time.
 * This is critical for embedding checksums into the binary for integrity verification.
 */

import process from 'node:process'

import type { PythonChecksums } from '../types.mjs'

/**
 * Get Python checksums from inlined environment variable.
 * Returns a map of asset filename to SHA-256 hex checksum.
 *
 * @throws Error if checksums are missing in production builds.
 */
export function getPythonChecksums(): PythonChecksums {
  const checksums = process.env['INLINED_SOCKET_CLI_PYTHON_CHECKSUMS']
  if (!checksums) {
    // In development mode (not inlined), return empty object.
    // Build validation will catch missing checksums at build time.
    return {}
  }
  try {
    return JSON.parse(checksums) as PythonChecksums
  } catch {
    throw new Error(
      'Failed to parse Python checksums. This indicates a build configuration error.',
    )
  }
}

/**
 * Lookup a Python checksum by asset name.
 * In production builds (checksums inlined), throws a hard error if asset is missing.
 * In dev mode (checksums not inlined), returns undefined to allow development.
 *
 * @param assetName - The asset filename to look up.
 * @returns The SHA-256 hex checksum, or undefined in dev mode.
 * @throws Error if checksum is not found in production builds.
 */
export function requirePythonChecksum(assetName: string): string | undefined {
  const checksums = getPythonChecksums()

  // In dev mode, checksums are not inlined so the object is empty.
  // Allow downloads without verification during development.
  if (Object.keys(checksums).length === 0) {
    return undefined
  }

  // In production mode, checksums are inlined.
  // Require checksum for every asset - missing checksum is a HARD ERROR.
  const sha256 = checksums[assetName]
  if (!sha256) {
    throw new Error(
      `Missing SHA-256 checksum for Python asset: ${assetName}. ` +
        'This is a security requirement. Please update external-tools.json with the correct checksum.',
    )
  }
  return sha256
}
