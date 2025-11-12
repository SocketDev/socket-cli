/**
 * CLI name getter function.
 * Uses direct process.env access so esbuild define can inline values.
 * IMPORTANT: esbuild's define plugin can only replace direct process.env['KEY'] references.
 * If we imported from env modules, esbuild couldn't inline the values at build time.
 * This is critical for embedding build metadata into the binary.
 */

import process from 'node:process'

export function getCliName(): string {
  return process.env['INLINED_SOCKET_CLI_NAME']!
}
