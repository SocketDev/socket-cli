import { realpathSync } from 'node:fs'
import path from 'node:path'

import registryConstants from '@socketsecurity/registry/lib/constants'
import { envAsBoolean } from '@socketsecurity/registry/lib/env'

type RegistryEnv = typeof registryConstants.ENV

type Constants = {
  readonly API_V0_URL: 'https://api.socket.dev/v0'
  readonly BABEL_RUNTIME: '@babel/runtime'
  readonly BINARY_LOCK_EXT: '.lockb'
  readonly BUN: 'bun'
  readonly ENV: RegistryEnv & {
    SOCKET_CLI_DEBUG: boolean
    SOCKET_CLI_FIX_PACKAGE_LOCK_FILE: boolean
    SOCKET_CLI_UPDATE_OVERRIDES_IN_PACKAGE_LOCK_FILE: boolean
  }
  readonly DIST_TYPE: 'module-sync' | 'require'
  readonly LOCK_EXT: '.lock'
  readonly NPM_REGISTRY_URL: 'https://registry.npmjs.org'
  readonly NPX: 'npx'
  readonly PNPM: 'pnpm'
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
const NPM_REGISTRY_URL = 'https://registry.npmjs.org'
const NPX = 'npx'
const PNPM = 'pnpm'
const SOCKET_CLI_DEBUG = 'SOCKET_CLI_DEBUG'
const SOCKET_CLI_FIX_PACKAGE_LOCK_FILE = 'SOCKET_CLI_FIX_PACKAGE_LOCK_FILE'
const SOCKET_CLI_ISSUES_URL = 'https://github.com/SocketDev/socket-cli/issues'
const SOCKET_CLI_UPDATE_OVERRIDES_IN_PACKAGE_LOCK_FILE =
  'SOCKET_CLI_UPDATE_OVERRIDES_IN_PACKAGE_LOCK_FILE'
const VLT = 'vlt'
const YARN_BERRY = 'yarn/berry'
const YARN_CLASSIC = 'yarn/classic'

const LAZY_DIST_TYPE = () =>
  registryConstants.SUPPORTS_NODE_REQUIRE_MODULE ? 'module-sync' : 'require'

const LAZY_ENV = () =>
  Object.freeze({
    // Lazily access registryConstants.ENV.
    ...registryConstants.ENV,
    // Flag set to help debug Socket CLI.
    [SOCKET_CLI_DEBUG]: envAsBoolean(process.env[SOCKET_CLI_DEBUG]),
    // Flag set by the "fix" command to accept the package alerts prompt with
    // "Y(es)" in the SafeArborist reify method.
    [SOCKET_CLI_FIX_PACKAGE_LOCK_FILE]: envAsBoolean(
      process.env[SOCKET_CLI_FIX_PACKAGE_LOCK_FILE]
    ),
    // Flag set by the "optimize" command to bypass the package alerts check
    // in the SafeArborist reify method.
    [SOCKET_CLI_UPDATE_OVERRIDES_IN_PACKAGE_LOCK_FILE]: envAsBoolean(
      process.env[SOCKET_CLI_UPDATE_OVERRIDES_IN_PACKAGE_LOCK_FILE]
    )
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

const lazyRootPath = () => path.resolve(realpathSync(__dirname), '..')

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
    ENV: undefined,
    // Lazily defined values are initialized as `undefined` to keep their key order.
    DIST_TYPE: undefined,
    LOCK_EXT,
    NPM_REGISTRY_URL,
    NPX,
    PNPM,
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
