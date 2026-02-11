/**
 * Trivy version getter function.
 * Uses direct process.env access so esbuild define can inline values.
 * IMPORTANT: esbuild's define plugin can only replace direct process.env['KEY'] references.
 * If we imported from env modules, esbuild couldn't inline the values at build time.
 * This is critical for embedding version info into the binary.
 */

import process from 'node:process'

export function getTrivyVersion(): string {
  const version = process.env['INLINED_SOCKET_CLI_TRIVY_VERSION']
  if (!version) {
    throw new Error(
      'INLINED_SOCKET_CLI_TRIVY_VERSION not found. Please ensure trivy is properly configured in external-tools.json.',
    )
  }
  return version
}
