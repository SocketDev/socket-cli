import { YARN_CLASSIC } from '@socketsecurity/lib-stable/constants/package-managers'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { findBinPathDetailsSync } from '../fs/path-resolve.mts'
const logger = getDefaultLogger()

const YARN = YARN_CLASSIC

export function exitWithBinPathError(binName: string): never {
  logger.fail(
    `Socket unable to locate ${binName}; ensure it is available in the PATH environment variable`,
  )
  // The exit code 127 indicates that the command or binary being executed
  // could not be found.
  process.exit(127)
  // This line is never reached in production, but helps tests.
  throw new Error('process.exit called')
}

let yarnBinPath: string | undefined
export function getYarnBinPath(): string {
  if (yarnBinPath === undefined) {
    yarnBinPath = getYarnBinPathDetails().path
    if (!yarnBinPath) {
      exitWithBinPathError(YARN)
    }
  }
  return yarnBinPath
}

let yarnBinPathDetails: ReturnType<typeof findBinPathDetailsSync> | undefined
export function getYarnBinPathDetails(): ReturnType<
  typeof findBinPathDetailsSync
> {
  if (yarnBinPathDetails === undefined) {
    yarnBinPathDetails = findBinPathDetailsSync(YARN)
  }
  return yarnBinPathDetails
}
