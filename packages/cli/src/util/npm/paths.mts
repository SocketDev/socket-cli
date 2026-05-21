import { existsSync } from 'node:fs'
import Module from 'node:module'
import path from 'node:path'

import { NPM } from '@socketsecurity/lib-stable/constants/agents'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

import { SOCKET_CLI_NPM_PATH } from '../../env/socket-cli-npm-path.mts'
import { NODE_MODULES } from '../../constants/packages.mts'
import { SOCKET_CLI_ISSUES_URL } from '../../constants/socket.mts'
import {
  findBinPathDetailsSync,
  findNpmDirPathSync,
} from '../fs/path-resolve.mts'

const logger = getDefaultLogger()

export function exitWithBinPathError(binName: string): never {
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

let npmDirPath: string | undefined
export function getNpmDirPath() {
  if (npmDirPath === undefined) {
    const npmBinPath = getNpmBinPath()
    npmDirPath = npmBinPath ? findNpmDirPathSync(npmBinPath) : undefined
    if (!npmDirPath) {
      npmDirPath = SOCKET_CLI_NPM_PATH || undefined
    }
    if (!npmDirPath) {
      let message = 'Unable to find npm CLI install directory.'
      if (npmBinPath) {
        message += `\nSearched parent directories of ${path.dirname(npmBinPath)}.`
      }
      message +=
        '\n\nThis is may be a bug with socket-npm related to changes to the npm CLI.'
      message += `\nPlease report to ${SOCKET_CLI_ISSUES_URL}.`
      logger.fail(message)
      // The exit code 127 indicates that the command or binary being executed
      // could not be found.
      // eslint-disable-next-line n/no-process-exit
      process.exit(127)
      // This line is never reached in production, but helps tests.
      throw new Error('process.exit called')
    }
  }
  return npmDirPath
}

let npmRequire: NodeJS.Require | undefined
export function getNpmRequire(): NodeJS.Require {
  if (npmRequire === undefined) {
    const npmDirPath = getNpmDirPath()
    const npmNmPath = path.join(npmDirPath, `${NODE_MODULES}/npm`)
    npmRequire = Module.createRequire(
      path.join(
        existsSync(npmNmPath) ? npmNmPath : npmDirPath,
        '<placeholder-basename>',
      ),
    )
  }
  return npmRequire
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
