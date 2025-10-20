/**
 * PNPM path resolution utilities for Socket CLI.
 * Locates and caches PNPM binary paths.
 *
 * Key Functions:
 * - getPnpmBinPath: Get cached PNPM binary path
 * - getPnpmBinPathDetails: Get detailed PNPM path information
 *
 * Error Handling:
 * - Exits with code 127 if PNPM not found
 * - Provides clear error messages for missing binaries
 *
 * Caching:
 * - Caches binary path lookups for performance
 * - Prevents repeated PATH searches
 */

import { logger } from '@socketsecurity/lib/logger'

import { findBinPathDetailsSync } from '../fs/path-resolve.mjs'

function exitWithBinPathError(binName: string): never {
  logger.fail(
    `Socket unable to locate ${binName}; ensure it is available in the PATH environment variable`,
  )
  // The exit code 127 indicates that the command or binary being executed
  // could not be found.
  // eslint-disable-next-line n/no-process-exit
  process.exit(127)
  // This line is never reached in production, but helps tests.
  throw new Error('process.exit called')
}

let _pnpmBinPath: string | undefined
export function getPnpmBinPath(): string {
  if (_pnpmBinPath === undefined) {
    _pnpmBinPath = getPnpmBinPathDetails().path
    if (!_pnpmBinPath) {
      exitWithBinPathError('pnpm')
    }
  }
  return _pnpmBinPath
}

let _pnpmBinPathDetails: ReturnType<typeof findBinPathDetailsSync> | undefined
export function getPnpmBinPathDetails(): ReturnType<
  typeof findBinPathDetailsSync
> {
  if (_pnpmBinPathDetails === undefined) {
    _pnpmBinPathDetails = findBinPathDetailsSync('pnpm')
  }
  return _pnpmBinPathDetails
}

export function isPnpmBinPathShadowed(): boolean {
  return getPnpmBinPathDetails().shadowed
}
