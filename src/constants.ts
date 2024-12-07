import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'

import { envAsBoolean } from '@socketsecurity/registry/lib/env'
import constants from '@socketsecurity/registry/lib/constants'
import semver from 'semver'

const { PACKAGE_JSON } = constants

export const SUPPORTS_SYNC_ESM = semver.satisfies(
  process.versions.node,
  '>=22.12'
)

export const API_V0_URL = 'https://api.socket.dev/v0'

export const DIST_TYPE = SUPPORTS_SYNC_ESM ? 'module-sync' : 'require'

export const LOOP_SENTINEL = 1_000_000

export const NPM_REGISTRY_URL = 'https://registry.npmjs.org'

export const SOCKET_CLI_ISSUES_URL =
  'https://github.com/SocketDev/socket-cli/issues'

export const UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE =
  'UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE'

export const ENV = Object.freeze({
  // Flag set by the optimize command to bypass the packagesHaveRiskyIssues check.
  [UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE]: envAsBoolean(
    process.env[UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE]
  )
})

// Dynamically detect the rootPath so constants.ts can be used in tests.
export const rootPath = (() => {
  let oldPath
  let currPath = realpathSync(__dirname)
  // Dirname stops when at the filepath root, e.g. '/' for posix and 'C:\\' for win32,
  // so `currPath` equal `oldPath`.
  while (currPath !== oldPath) {
    const pkgJsonPath = path.join(currPath, PACKAGE_JSON)
    if (existsSync(pkgJsonPath)) {
      try {
        // Content matching REPLACED_WITH_SOCKET_PACKAGE_NAME is replaced by
        // the @rollup/plugin-replace plugin used in .config/rollup.base.config.mjs
        // with either 'socket' or '@socketsecurity/cli'.
        if (
          require(pkgJsonPath)?.name === 'REPLACED_WITH_SOCKET_PACKAGE_NAME'
        ) {
          return currPath
        }
      } catch {}
    }
    oldPath = currPath
    currPath = path.dirname(currPath)
  }
  throw new TypeError(
    `Socket CLI initialization error: rootPath cannot be resolved.\n\nPlease report to ${SOCKET_CLI_ISSUES_URL}.`
  )
})()
export const rootDistPath = path.join(rootPath, 'dist')
export const rootBinPath = path.join(rootPath, 'bin')
export const rootPkgJsonPath = path.join(rootPath, PACKAGE_JSON)
export const nmBinPath = path.join(rootPath, 'node_modules/.bin')
export const cdxgenBinPath = path.join(nmBinPath, 'cdxgen')
export const distPath = path.join(rootDistPath, DIST_TYPE)
export const shadowBinPath = path.join(rootPath, 'shadow', DIST_TYPE)
export const synpBinPath = path.join(nmBinPath, 'synp')
