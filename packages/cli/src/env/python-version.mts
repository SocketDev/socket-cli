/**
 * Python version getter functions.
 * Uses direct process.env access so esbuild define can inline values.
 * IMPORTANT: esbuild's define plugin can only replace direct process.env['KEY'] references.
 * If we imported from env modules, esbuild couldn't inline the values at build time.
 * This is critical for embedding version info into the binary.
 */

import process from 'node:process'

/**
 * Get the full Python version (e.g., "3.11.14").
 */
export function getPythonVersion(): string {
  return process.env['INLINED_SOCKET_CLI_PYTHON_VERSION']!
}

/**
 * Get the Python major.minor version for site-packages path (e.g., "3.11").
 * Used to construct: python/lib/python3.11/site-packages/
 */
export function getPythonMajorMinor(): string {
  const version = getPythonVersion()
  const parts = version.split('.')
  return `${parts[0]}.${parts[1]}`
}
