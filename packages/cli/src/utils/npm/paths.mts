import { existsSync } from 'node:fs'
import Module from 'node:module'
import path from 'node:path'

import { NPM } from '@socketsecurity/lib/constants/agents'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import ENV from '../../constants/env.mts'
import { NODE_MODULES } from '../../constants/packages.mts'
import { SOCKET_CLI_ISSUES_URL } from '../../constants/socket.mts'
import {
  findBinPathDetailsSync,
  findNpmDirPathSync,
} from '../fs/path-resolve.mts'

const logger = getDefaultLogger()

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

let _npmBinPath: string | undefined
export function getNpmBinPath(): string {
  if (_npmBinPath === undefined) {
    _npmBinPath = getNpmBinPathDetails().path
    if (!_npmBinPath) {
      exitWithBinPathError(NPM)
    }
  }
  return _npmBinPath
}

let _npmBinPathDetails: ReturnType<typeof findBinPathDetailsSync> | undefined
function getNpmBinPathDetails(): ReturnType<typeof findBinPathDetailsSync> {
  if (_npmBinPathDetails === undefined) {
    _npmBinPathDetails = findBinPathDetailsSync(NPM)
  }
  return _npmBinPathDetails
}

let _npmDirPath: string | undefined
export function getNpmDirPath() {
  if (_npmDirPath === undefined) {
    const npmBinPath = getNpmBinPath()
    _npmDirPath = npmBinPath ? findNpmDirPathSync(npmBinPath) : undefined
    if (!_npmDirPath) {
      _npmDirPath = ENV.SOCKET_CLI_NPM_PATH || undefined
    }
    if (!_npmDirPath) {
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
  return _npmDirPath
}

let _npmRequire: NodeJS.Require | undefined
export function getNpmRequire(): NodeJS.Require {
  if (_npmRequire === undefined) {
    const npmDirPath = getNpmDirPath()
    const npmNmPath = path.join(npmDirPath, `${NODE_MODULES}/npm`)
    _npmRequire = Module.createRequire(
      path.join(
        existsSync(npmNmPath) ? npmNmPath : npmDirPath,
        '<dummy-basename>',
      ),
    )
  }
  return _npmRequire
}

let _npxBinPath: string | undefined
export function getNpxBinPath(): string {
  if (_npxBinPath === undefined) {
    _npxBinPath = getNpxBinPathDetails().path
    if (!_npxBinPath) {
      exitWithBinPathError('npx')
    }
  }
  return _npxBinPath
}

let _npxBinPathDetails: ReturnType<typeof findBinPathDetailsSync> | undefined
function getNpxBinPathDetails(): ReturnType<typeof findBinPathDetailsSync> {
  if (_npxBinPathDetails === undefined) {
    _npxBinPathDetails = findBinPathDetailsSync('npx')
  }
  return _npxBinPathDetails
}

export function isNpmBinPathShadowed() {
  return getNpmBinPathDetails().shadowed
}

export function isNpxBinPathShadowed() {
  return getNpxBinPathDetails().shadowed
}
