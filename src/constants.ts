import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'

import { envAsBoolean } from '@socketsecurity/registry/lib/env'
import constants from '@socketsecurity/registry/lib/constants'
import semver from 'semver'

const { PACKAGE_JSON } = constants

export const API_V0_URL = 'https://api.socket.dev/v0'

export const ENV = Object.freeze({
  // Flag set by the optimize command to bypass the packagesHaveRiskyIssues check.
  UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE: envAsBoolean(
    process.env['UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE']
  )
})

export const SUPPORTS_SYNC_ESM = semver.satisfies(
  process.versions.node,
  '>=22.12'
)

export const rootPath = (() => {
  let oldPath
  let currPath = realpathSync(__dirname)
  while (currPath !== oldPath) {
    const pkgJsonPath = path.join(currPath, PACKAGE_JSON)
    if (existsSync(pkgJsonPath)) {
      try {
        // SOCKET_PACKAGE_NAME is replaced by .config/rollup.base.config.mjs
        // with either 'socket' or '@socketsecurity/cli'.
        if (require(pkgJsonPath)?.name === 'SOCKET_PACKAGE_NAME') {
          return currPath
        }
      } catch {}
    }
    oldPath = currPath
    currPath = path.dirname(currPath)
  }
  throw new TypeError('rootPath cannot be resolved.')
})()
export const rootDistPath = path.join(rootPath, 'dist')
export const rootBinPath = path.join(rootPath, 'bin')
export const rootPkgJsonPath = path.join(rootPath, PACKAGE_JSON)
export const nmBinPath = path.join(rootPath, 'node_modules/.bin')
export const cdxgenBinPath = path.join(nmBinPath, 'cdxgen')
export const distPath = path.join(
  rootDistPath,
  SUPPORTS_SYNC_ESM ? 'module-sync' : 'require'
)
export const shadowBinPath = path.join(
  rootPath,
  'shadow',
  SUPPORTS_SYNC_ESM ? 'module-sync' : 'require'
)
export const synpBinPath = path.join(nmBinPath, 'synp')
