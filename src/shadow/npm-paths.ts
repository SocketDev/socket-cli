import { realpathSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import constants from '../constants'
import { findNpmPath } from '../utils/path-resolve'

const { NODE_MODULES, SOCKET_CLI_ISSUES_URL } = constants

const npmEntrypoint = realpathSync.native(process.argv[1]!)
const npmPath = findNpmPath(npmEntrypoint)
if (npmPath === undefined) {
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

export const npmNmPath = path.join(npmPath, NODE_MODULES)
export const arboristPkgPath = path.join(npmNmPath, '@npmcli/arborist')
export const arboristClassPath = path.join(
  arboristPkgPath,
  'lib/arborist/index.js'
)
export const arboristDepValidPath = path.join(
  arboristPkgPath,
  'lib/dep-valid.js'
)
export const arboristEdgeClassPath = path.join(arboristPkgPath, 'lib/edge.js')
export const arboristNodeClassPath = path.join(arboristPkgPath, 'lib/node.js')
export const arboristOverrideSetClassPath = path.join(
  arboristPkgPath,
  'lib/override-set.js'
)
