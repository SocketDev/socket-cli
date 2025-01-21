import { realpathSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import registryConstants from '@socketsecurity/registry/lib/constants'
import { envAsBoolean } from '@socketsecurity/registry/lib/env'

type RegistryEnv = typeof registryConstants.ENV

type IPCObject = {
  SOCKET_CLI_FIX_PACKAGE_LOCK_FILE: boolean
  SOCKET_CLI_UPDATE_OVERRIDES_IN_PACKAGE_LOCK_FILE: boolean
  [key: string]: any
}

type Constants = {
  readonly API_V0_URL: 'https://api.socket.dev/v0'
  readonly BABEL_RUNTIME: '@babel/runtime'
  readonly BINARY_LOCK_EXT: '.lockb'
  readonly BUN: 'bun'
  readonly ENV: RegistryEnv & {
    SOCKET_CLI_DEBUG: boolean
  }
  readonly DIST_TYPE: 'module-sync' | 'require'
  readonly IPC: IPCObject
  readonly LOCK_EXT: '.lock'
  readonly MODULE_SYNC: 'module-sync'
  readonly NPM_REGISTRY_URL: 'https://registry.npmjs.org'
  readonly NPX: 'npx'
  readonly PNPM: 'pnpm'
  readonly REQUIRE: 'require'
  readonly SOCKET_CLI_DEBUG: 'SOCKET_CLI_DEBUG'
  readonly SOCKET_CLI_FIX_PACKAGE_LOCK_FILE: 'SOCKET_CLI_FIX_PACKAGE_LOCK_FILE'
  readonly SOCKET_CLI_ISSUES_URL: 'https://github.com/SocketDev/socket-cli/issues'
  readonly SOCKET_CLI_UPDATE_OVERRIDES_IN_PACKAGE_LOCK_FILE: 'SOCKET_CLI_UPDATE_OVERRIDES_IN_PACKAGE_LOCK_FILE'
  readonly VLT: 'vlt'
  readonly YARN_BERRY: 'yarn/berry'
  readonly YARN_CLASSIC: 'yarn/classic'
  readonly cdxgenBinPath: string
  readonly distPath: string
  readonly nmBinPath: string
  readonly rootBinPath: string
  readonly rootDistPath: string
  readonly rootPath: string
  readonly rootPkgJsonPath: string
  readonly shadowBinPath: string
  readonly synpBinPath: string
} & typeof registryConstants

const {
  PACKAGE_JSON,
  kInternalsSymbol,
  [kInternalsSymbol as unknown as 'Symbol(kInternalsSymbol)']: {
    createConstantsObject
  }
} = registryConstants

const API_V0_URL = 'https://api.socket.dev/v0'
const BABEL_RUNTIME = '@babel/runtime'
const BINARY_LOCK_EXT = '.lockb'
const BUN = 'bun'
const LOCK_EXT = '.lock'
const MODULE_SYNC = 'module-sync'
const NPM_REGISTRY_URL = 'https://registry.npmjs.org'
const NPX = 'npx'
const PNPM = 'pnpm'
const REQUIRE = 'require'
const SOCKET_CLI_DEBUG = 'SOCKET_CLI_DEBUG'
const SOCKET_CLI_FIX_PACKAGE_LOCK_FILE = 'SOCKET_CLI_FIX_PACKAGE_LOCK_FILE'
const SOCKET_CLI_ISSUES_URL = 'https://github.com/SocketDev/socket-cli/issues'
const SOCKET_CLI_UPDATE_OVERRIDES_IN_PACKAGE_LOCK_FILE =
  'SOCKET_CLI_UPDATE_OVERRIDES_IN_PACKAGE_LOCK_FILE'
const VLT = 'vlt'
const YARN_BERRY = 'yarn/berry'
const YARN_CLASSIC = 'yarn/classic'

const LAZY_DIST_TYPE = () =>
  registryConstants.SUPPORTS_NODE_REQUIRE_MODULE ? MODULE_SYNC : REQUIRE

const LAZY_ENV = () =>
  Object.freeze({
    // Lazily access registryConstants.ENV.
    ...registryConstants.ENV,
    // Flag set to help debug Socket CLI.
    [SOCKET_CLI_DEBUG]: envAsBoolean(process.env[SOCKET_CLI_DEBUG])
  })

const lazyCdxgenBinPath = () =>
  // Lazily access constants.nmBinPath.
  path.join(constants.nmBinPath, 'cdxgen')

const lazyDistPath = () =>
  // Lazily access constants.rootDistPath and constants.DIST_TYPE.
  path.join(constants.rootDistPath, constants.DIST_TYPE)

const lazyNmBinPath = () =>
  // Lazily access constants.rootPath.
  path.join(constants.rootPath, 'node_modules/.bin')

const lazyRootBinPath = () =>
  // Lazily access constants.rootPath.
  path.join(constants.rootPath, 'bin')

const lazyRootDistPath = () =>
  // Lazily access constants.rootPath.
  path.join(constants.rootPath, 'dist')

const lazyRootPath = () =>
  // The '@rollup/plugin-replace' will replace 'process.env.TAP' with `false` and
  // it will be dead code eliminated by Rollup.
  path.resolve(
    realpathSync.native(__dirname),
    process.env['TAP'] ? '../..' : '..'
  )

const lazyRootPkgJsonPath = () =>
  // Lazily access constants.rootPath.
  path.join(constants.rootPath, PACKAGE_JSON)

const lazyShadowBinPath = () =>
  // Lazily access constants.rootPath.
  path.join(constants.rootPath, 'shadow-bin')

const lazySynpBinPath = () =>
  // Lazily access constants.nmBinPath.
  path.join(constants.nmBinPath, 'synp')

const constants = <Constants>createConstantsObject(
  {
    API_V0_URL,
    BABEL_RUNTIME,
    BINARY_LOCK_EXT,
    BUN,
    // Lazily defined values are initialized as `undefined` to keep their key order.
    DIST_TYPE: undefined,
    ENV: undefined,
    LOCK_EXT,
    MODULE_SYNC,
    NPM_REGISTRY_URL,
    NPX,
    PNPM,
    REQUIRE,
    SOCKET_CLI_DEBUG,
    SOCKET_CLI_FIX_PACKAGE_LOCK_FILE,
    SOCKET_CLI_ISSUES_URL,
    SOCKET_CLI_UPDATE_OVERRIDES_IN_PACKAGE_LOCK_FILE,
    VLT,
    YARN_BERRY,
    YARN_CLASSIC,
    cdxgenBinPath: undefined,
    distPath: undefined,
    nmBinPath: undefined,
    rootBinPath: undefined,
    rootDistPath: undefined,
    rootPath: undefined,
    rootPkgJsonPath: undefined,
    shadowBinPath: undefined,
    synpBinPath: undefined
  },
  {
    getters: {
      DIST_TYPE: LAZY_DIST_TYPE,
      ENV: LAZY_ENV,
      distPath: lazyDistPath,
      cdxgenBinPath: lazyCdxgenBinPath,
      nmBinPath: lazyNmBinPath,
      rootBinPath: lazyRootBinPath,
      rootDistPath: lazyRootDistPath,
      rootPath: lazyRootPath,
      rootPkgJsonPath: lazyRootPkgJsonPath,
      shadowBinPath: lazyShadowBinPath,
      synpBinPath: lazySynpBinPath
    },
    mixin: registryConstants
  }
)

export default constants
