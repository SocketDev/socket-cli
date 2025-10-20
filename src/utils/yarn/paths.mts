import { logger } from '@socketsecurity/lib/logger'
import { YARN_CLASSIC } from '@socketsecurity/registry/constants/agents'

const YARN = YARN_CLASSIC
import { findBinPathDetailsSync } from '../fs/path-resolve.mts'

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
