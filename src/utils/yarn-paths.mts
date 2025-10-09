/** @fileoverview Yarn binary path resolution utilities. */

import { logger } from '@socketsecurity/registry/lib/logger'

import { YARN } from '../constants.mts'
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

let _yarnBinPath: string | undefined
export function getYarnBinPath(): string {
  if (_yarnBinPath === undefined) {
    _yarnBinPath = getYarnBinPathDetails().path
    if (!_yarnBinPath) {
      exitWithBinPathError(YARN)
    }
  }
  return _yarnBinPath
}

let _yarnBinPathDetails: ReturnType<typeof findBinPathDetailsSync> | undefined
export function getYarnBinPathDetails(): ReturnType<
  typeof findBinPathDetailsSync
> {
  if (_yarnBinPathDetails === undefined) {
    _yarnBinPathDetails = findBinPathDetailsSync(YARN)
  }
  return _yarnBinPathDetails
}

export function isYarnBinPathShadowed(): boolean {
  return getYarnBinPathDetails().shadowed
}
