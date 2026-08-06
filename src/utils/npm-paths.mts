import { existsSync } from 'node:fs'
import Module from 'node:module'
import path from 'node:path'

import { resolveBinPathSync } from '@socketsecurity/registry/lib/bin'
import { logger } from '@socketsecurity/registry/lib/logger'

import constants, { NODE_MODULES, NPM } from '../constants.mts'
import { findBinPathDetailsSync, findNpmDirPathSync } from './path-resolve.mts'

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

// Find a binary next to the running node binary (process.execPath).
// This avoids picking up a project-local binary from node_modules/.bin
// on PATH, e.g. the standalone "npx" package which bundles npm@5.1.0
// that is incompatible with Node 22+.
function findBinNextToNode(binName: string): string | undefined {
  const nodeDir = path.dirname(process.execPath)
  const binPath = path.join(nodeDir, binName)
  if (existsSync(binPath)) {
    try {
      return resolveBinPathSync(binPath)
    } catch {
      return undefined
    }
  }
  return undefined
}

const JS_ENTRY_EXTENSIONS = new Set(['.cjs', '.js', '.mjs'])

/**
 * Resolve a package manager bin path to a JavaScript entry `node` can run.
 *
 * Some version managers ship `npm` as a shell script instead of the usual shim
 * that points at npm's JavaScript entry. mise writes a bash wrapper so it can
 * run `mise reshim` after a global install. resolveBinPathSync only recognizes
 * npm's own shim, by the `NPM_CLI_JS=` assignment inside it, and passes anything
 * else through untouched, so the wrapper reaches us unchanged. We then hand it
 * to `node` as the main module and the shell syntax throws a SyntaxError before
 * npm ever starts (issue #946).
 *
 * When the resolved path is not JavaScript, fall back to the CLI entry inside
 * npm's install directory, which findNpmDirPathSync already knows how to locate
 * for this layout. A path we cannot map keeps its current value, so an
 * unrecognized layout behaves exactly as it does today.
 */
export function resolveBinPathToJsEntry(
  binPath: string,
  cliEntryName: string,
): string {
  if (JS_ENTRY_EXTENSIONS.has(path.extname(binPath).toLowerCase())) {
    return binPath
  }
  const npmDirPath = findNpmDirPathSync(binPath)
  if (!npmDirPath) {
    return binPath
  }
  const jsEntryPath = path.join(npmDirPath, 'bin', cliEntryName)
  return existsSync(jsEntryPath) ? jsEntryPath : binPath
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
    // First try to find npm next to the node binary to avoid picking up
    // a project-local npm from node_modules/.bin on PATH.
    const npmNextToNode = findBinNextToNode(NPM)
    const details = npmNextToNode
      ? { name: NPM, path: npmNextToNode, shadowed: false }
      : findBinPathDetailsSync(NPM)
    _npmBinPathDetails = details.path
      ? {
          ...details,
          path: resolveBinPathToJsEntry(details.path, 'npm-cli.js'),
        }
      : details
  }
  return _npmBinPathDetails
}

let _npmDirPath: string | undefined
export function getNpmDirPath() {
  if (_npmDirPath === undefined) {
    const npmBinPath = getNpmBinPath()
    _npmDirPath = npmBinPath ? findNpmDirPathSync(npmBinPath) : undefined
    if (!_npmDirPath) {
      _npmDirPath = constants.ENV.SOCKET_CLI_NPM_PATH || undefined
    }
    if (!_npmDirPath) {
      let message = 'Unable to find npm CLI install directory.'
      if (npmBinPath) {
        message += `\nSearched parent directories of ${path.dirname(npmBinPath)}.`
      }
      message +=
        '\n\nThis is may be a bug with socket-npm related to changes to the npm CLI.'
      message += `\nPlease report to ${constants.SOCKET_CLI_ISSUES_URL}.`
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
    // First try to find npx next to the node binary to avoid picking up
    // a project-local npx from node_modules/.bin on PATH (e.g., the
    // standalone npx package which bundles npm@5.1.0, incompatible
    // with Node 22+).
    const npxNextToNode = findBinNextToNode('npx')
    const details = npxNextToNode
      ? { name: 'npx', path: npxNextToNode, shadowed: false }
      : findBinPathDetailsSync('npx')
    _npxBinPathDetails = details.path
      ? {
          ...details,
          path: resolveBinPathToJsEntry(details.path, 'npx-cli.js'),
        }
      : details
  }
  return _npxBinPathDetails
}

export function isNpmBinPathShadowed() {
  return getNpmBinPathDetails().shadowed
}

export function isNpxBinPathShadowed() {
  return getNpxBinPathDetails().shadowed
}
