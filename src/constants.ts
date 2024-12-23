import { realpathSync } from 'node:fs'
import path from 'node:path'

import { envAsBoolean } from '@socketsecurity/registry/lib/env'
import registryConstants from '@socketsecurity/registry/lib/constants'

type RegistryEnv = typeof registryConstants.ENV

type Constants = {
  readonly API_V0_URL: 'https://api.socket.dev/v0'
  readonly BABEL_RUNTIME: '@babel/runtime'
  readonly BUN: 'bun'
  readonly ENV: RegistryEnv & {
    UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE: boolean
  }
  readonly DIST_TYPE: 'module-sync' | 'require'
  readonly NPM_REGISTRY_URL: 'https://registry.npmjs.org'
  readonly NPX: 'npx'
  readonly PNPM: 'pnpm'
  readonly SOCKET_CLI_ISSUES_URL: 'https://github.com/SocketDev/socket-cli/issues'
  readonly UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE: 'UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE'
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
const BUN = 'bun'
const NPM_REGISTRY_URL = 'https://registry.npmjs.org'
const NPX = 'npx'
const PNPM = 'pnpm'
const SOCKET_CLI_ISSUES_URL = 'https://github.com/SocketDev/socket-cli/issues'
const UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE =
  'UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE'
const VLT = 'vlt'
const YARN_BERRY = 'yarn/berry'
const YARN_CLASSIC = 'yarn/classic'

const LAZY_DIST_TYPE = () =>
  registryConstants.SUPPORTS_NODE_REQUIRE_MODULE ? 'module-sync' : 'require'

const LAZY_ENV = () =>
  Object.freeze({
    // Lazily access registryConstants.ENV.
    ...registryConstants.ENV,
    // Flag set by the optimize command to bypass the packagesHaveRiskyIssues check.
    [UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE]: envAsBoolean(
      process.env[UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE]
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
    BUN,
    ENV: undefined,
    // Lazily defined values are initialized as `undefined` to keep their key order.
    DIST_TYPE: undefined,
    NPM_REGISTRY_URL,
    NPX,
    PNPM,
    SOCKET_CLI_ISSUES_URL,
    UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE,
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
