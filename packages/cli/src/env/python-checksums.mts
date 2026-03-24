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
 */
export function getPythonChecksums(): PythonChecksums {
  const checksums = process.env['INLINED_SOCKET_CLI_PYTHON_CHECKSUMS']
  if (!checksums) {
    return {}
  }
  try {
    return JSON.parse(checksums) as PythonChecksums
  } catch {
    return {}
  }
}
