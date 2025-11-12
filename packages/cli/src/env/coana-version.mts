/**
 * Coana version getter function.
 * Uses direct process.env access so esbuild define can inline values.
 * IMPORTANT: esbuild's define plugin can only replace direct process.env['KEY'] references.
 * If we imported from env modules, esbuild couldn't inline the values at build time.
 * This is critical for embedding version info into the binary.
 */

import { createRequire } from 'node:module'
import process from 'node:process'

const require = createRequire(import.meta.url)

function getPackageJsonExternalToolVersion(toolName: string): string {
  const packageJson = require('../../package.json')
  return packageJson.externalTools?.[toolName] ?? ''
}

export function getCoanaVersion(): string {
  return (
    process.env['INLINED_SOCKET_CLI_COANA_VERSION'] ??
    getPackageJsonExternalToolVersion('coana')
  )
}
