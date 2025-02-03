import { realpathSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import constants from '../constants'
import { findBinPathDetailsSync, findNpmPathSync } from '../utils/path-resolve'

const { NODE_MODULES, NPM, NPX, SOCKET_CLI_ISSUES_URL } = constants

function exitWithBinPathError(binName: string): never {
  console.error(
    `Socket unable to locate ${binName}; ensure it is available in the PATH environment variable.`
  )
  // The exit code 127 indicates that the command or binary being executed
  // could not be found.
  process.exit(127)
}

let _npmBinPathDetails: ReturnType<typeof findBinPathDetailsSync> | undefined
function getNpmBinPathDetails(): ReturnType<typeof findBinPathDetailsSync> {
  if (_npmBinPathDetails === undefined) {
    _npmBinPathDetails = findBinPathDetailsSync(NPM)
  }
  return _npmBinPathDetails
}

let _npxBinPathDetails: ReturnType<typeof findBinPathDetailsSync> | undefined
function getNpxBinPathDetails(): ReturnType<typeof findBinPathDetailsSync> {
  if (_npxBinPathDetails === undefined) {
    _npxBinPathDetails = findBinPathDetailsSync(NPX)
  }
  return _npxBinPathDetails
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

export function isNpmBinPathShadowed() {
  return getNpmBinPathDetails().shadowed
}

let _npxBinPath: string | undefined
export function getNpxBinPath(): string {
  if (_npxBinPath === undefined) {
    _npxBinPath = getNpxBinPathDetails().path
    if (!_npxBinPath) {
      exitWithBinPathError(NPX)
    }
  }
  return _npxBinPath
}

export function isNpxBinPathShadowed() {
  return getNpxBinPathDetails().shadowed
}

let _npmPath: string | undefined
export function getNpmPath() {
  if (_npmPath === undefined) {
    const npmEntrypoint = path.dirname(realpathSync.native(getNpmBinPath()))
    _npmPath = findNpmPathSync(npmEntrypoint)
    if (!_npmPath) {
      console.error(
        `Unable to find npm CLI install directory.
    Searched parent directories of ${npmEntrypoint}.

    This is may be a bug with socket-npm related to changes to the npm CLI.
    Please report to ${SOCKET_CLI_ISSUES_URL}.`
      )
      // The exit code 127 indicates that the command or binary being executed
      // could not be found.
      process.exit(127)
    }
  }
  return _npmPath
}

let _npmNmPath: string | undefined
export function getNpmNodeModulesPath() {
  if (_npmNmPath === undefined) {
    _npmNmPath = path.join(getNpmPath(), NODE_MODULES)
  }
  return _npmNmPath
}

let _arboristPkgPath: string | undefined
export function getArboristPackagePath() {
  if (_arboristPkgPath === undefined) {
    _arboristPkgPath = path.join(getNpmNodeModulesPath(), '@npmcli/arborist')
  }
  return _arboristPkgPath
}

let _arboristClassPath: string | undefined
export function getArboristClassPath() {
  if (_arboristClassPath === undefined) {
    _arboristClassPath = path.join(
      getArboristPackagePath(),
      'lib/arborist/index.js'
    )
  }
  return _arboristClassPath
}

let _arboristDepValidPath: string | undefined
export function getArboristDepValidPath() {
  if (_arboristDepValidPath === undefined) {
    _arboristDepValidPath = path.join(
      getArboristPackagePath(),
      'lib/dep-valid.js'
    )
  }
  return _arboristDepValidPath
}

let _arboristEdgeClassPath: string | undefined
export function getArboristEdgeClassPath() {
  if (_arboristEdgeClassPath === undefined) {
    _arboristEdgeClassPath = path.join(getArboristPackagePath(), 'lib/edge.js')
  }
  return _arboristEdgeClassPath
}

let _arboristNodeClassPath: string | undefined
export function getArboristNodeClassPath() {
  if (_arboristNodeClassPath === undefined) {
    _arboristNodeClassPath = path.join(getArboristPackagePath(), 'lib/node.js')
  }
  return _arboristNodeClassPath
}

let _arboristOverrideSetClassPath: string | undefined
export function getArboristOverrideSetClassPath() {
  if (_arboristOverrideSetClassPath === undefined) {
    _arboristOverrideSetClassPath = path.join(
      getArboristPackagePath(),
      'lib/override-set.js'
    )
  }
  return _arboristOverrideSetClassPath
}
