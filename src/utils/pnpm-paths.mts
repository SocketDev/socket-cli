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

import { logger } from '@socketsecurity/registry/lib/logger'

import { findBinPathDetailsSync } from './path-resolve.mts'

class BinaryNotFoundError extends Error {
  public readonly code = 127
  constructor(binName: string) {
    super(`Socket unable to locate ${binName}; ensure it is available in the PATH environment variable`)
    this.name = 'BinaryNotFoundError'
  }
}

function exitWithBinPathError(binName: string): never {
  logger.fail(
    `Socket unable to locate ${binName}; ensure it is available in the PATH environment variable`,
  )
  // The exit code 127 indicates that the command or binary being executed
  // could not be found.
  throw new BinaryNotFoundError(binName)
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
