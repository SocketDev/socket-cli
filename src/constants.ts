import { realpathSync } from 'node:fs'
import path from 'node:path'

import { envAsBoolean } from '@socketsecurity/registry/lib/env'
import registryConstants from '@socketsecurity/registry/lib/constants'

type RegistryEnv = typeof registryConstants.ENV

type Constants = {
  readonly API_V0_URL: 'https://api.socket.dev/v0'
  readonly BABEL_RUNTIME: '@babel/runtime'
  readonly CDXGEN: 'cdxgen'
  readonly CYCLONEDX_CDXGEN: '@cyclonedx/cdxgen'
  readonly ENV: RegistryEnv & {
    UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE: boolean
  }
  readonly DIST_TYPE: 'module-sync' | 'require'
  readonly NPM_REGISTRY_URL: 'https://registry.npmjs.org'
  readonly SOCKET_CLI_ISSUES_URL: 'https://github.com/SocketDev/socket-cli/issues'
  readonly SYNP: 'synp'
  readonly UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE: 'UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE'
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
  kInternalsSymbol,
  PACKAGE_JSON,
  [kInternalsSymbol as unknown as 'Symbol(kInternalsSymbol)']: {
    createConstantsObject
  }
} = registryConstants

const API_V0_URL = 'https://api.socket.dev/v0'
const BABEL_RUNTIME = '@babel/runtime'
const CDXGEN = 'cdxgen'
const CYCLONEDX_CDXGEN = `@cyclonedx/${CDXGEN}`
const NPM_REGISTRY_URL = 'https://registry.npmjs.org'
const SOCKET_CLI_ISSUES_URL = 'https://github.com/SocketDev/socket-cli/issues'
const SYNP = 'synp'
const UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE =
  'UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE'
const ENV: Constants['ENV'] = Object.freeze({
  ...registryConstants.ENV,
  // Flag set by the optimize command to bypass the packagesHaveRiskyIssues check.
  [UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE]: envAsBoolean(
    process.env[UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE]
  )
})

const rootPath = path.resolve(realpathSync(__dirname), '..')
const rootDistPath = path.join(rootPath, 'dist')
const rootBinPath = path.join(rootPath, 'bin')
const rootPkgJsonPath = path.join(rootPath, PACKAGE_JSON)
const nmBinPath = path.join(rootPath, 'node_modules/.bin')
const cdxgenBinPath = path.join(nmBinPath, CDXGEN)
const shadowBinPath = path.join(rootPath, 'shadow-bin')
const synpBinPath = path.join(nmBinPath, SYNP)

const LAZY_DIST_TYPE = () =>
  registryConstants.SUPPORTS_NODE_REQUIRE_MODULE ? 'module-sync' : 'require'

const lazyDistPath = () => path.join(rootDistPath, constants.DIST_TYPE)

const constants = <Constants>createConstantsObject(
  {
    API_V0_URL,
    BABEL_RUNTIME,
    CDXGEN,
    CYCLONEDX_CDXGEN,
    ENV,
    // Lazily defined values are initialized as `undefined` to keep their key order.
    DIST_TYPE: undefined,
    NPM_REGISTRY_URL,
    SOCKET_CLI_ISSUES_URL,
    SYNP,
    UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE,
    cdxgenBinPath,
    distPath: undefined,
    nmBinPath,
    rootBinPath,
    rootDistPath,
    rootPath,
    rootPkgJsonPath,
    shadowBinPath,
    synpBinPath
  },
  {
    getters: {
      DIST_TYPE: LAZY_DIST_TYPE,
      distPath: lazyDistPath
    },
    mixin: registryConstants
  }
)

export default constants
