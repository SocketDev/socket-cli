import { NPM } from '@socketsecurity/lib-stable/constants/agents'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

import { SOCKET_CLI_ISSUES_URL } from '../../constants/socket.mts'
import { findBinPathDetailsSync } from '../fs/path-resolve.mts'

const logger = getDefaultLogger()

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

let npmBinPath: string | undefined
export function getNpmBinPath(): string {
  if (npmBinPath === undefined) {
    npmBinPath = getNpmBinPathDetails().path
    if (!npmBinPath) {
      exitWithBinPathError(NPM)
    }
  }
  return npmBinPath
}

let npmBinPathDetails: ReturnType<typeof findBinPathDetailsSync> | undefined
export function getNpmBinPathDetails(): ReturnType<
  typeof findBinPathDetailsSync
> {
  if (npmBinPathDetails === undefined) {
    npmBinPathDetails = findBinPathDetailsSync(NPM)
  }
  return npmBinPathDetails
}


let npxBinPath: string | undefined
export function getNpxBinPath(): string {
  if (npxBinPath === undefined) {
    npxBinPath = getNpxBinPathDetails().path
    if (!npxBinPath) {
      exitWithBinPathError('npx')
    }
  }
  return npxBinPath
}

let npxBinPathDetails: ReturnType<typeof findBinPathDetailsSync> | undefined
export function getNpxBinPathDetails(): ReturnType<
  typeof findBinPathDetailsSync
> {
  if (npxBinPathDetails === undefined) {
    npxBinPathDetails = findBinPathDetailsSync('npx')
  }
  return npxBinPathDetails
}
