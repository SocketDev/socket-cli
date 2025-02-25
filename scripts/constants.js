'use strict'

const path = require('node:path')

const registryConstants = require('@socketsecurity/registry/lib/constants')
const { envAsBoolean } = require('@socketsecurity/registry/lib/env')

const {
  PACKAGE_JSON,
  PACKAGE_LOCK,
  kInternalsSymbol,
  [kInternalsSymbol]: { createConstantsObject }
} = registryConstants

const CLI = 'cli'
const CONSTANTS = 'constants'
const MODULE_SYNC = 'module-sync'
const NPM_INJECTION = 'npm-injection'
const REQUIRE = 'require'
const ROLLUP_ENTRY_SUFFIX = '?commonjs-entry'
const ROLLUP_EXTERNAL_SUFFIX = '?commonjs-external'
const SHADOW_BIN = 'shadow-bin'
const SLASH_NODE_MODULES_SLASH = '/node_modules/'
const SOCKET_CLI_LEGACY_BUILD = 'SOCKET_CLI_LEGACY_BUILD'
const SOCKET_CLI_PUBLISHED_BUILD = 'SOCKET_CLI_PUBLISHED_BUILD'
const SOCKET_CLI_SENTRY_BUILD = 'SOCKET_CLI_SENTRY_BUILD'
const SOCKET_CLI_VERSION_HASH = 'SOCKET_CLI_VERSION_HASH'
const TAP = 'TAP'
const VENDOR = 'vendor'

const LAZY_ENV = () => {
  const { env } = process
  return Object.freeze({
    // Lazily access registryConstants.ENV.
    ...registryConstants.ENV,
    // Flag set to determine if this is the Legacy build.
    [SOCKET_CLI_LEGACY_BUILD]: envAsBoolean(env[SOCKET_CLI_LEGACY_BUILD]),
    // Flag set to determine if this is a published build.
    [SOCKET_CLI_PUBLISHED_BUILD]: envAsBoolean(env[SOCKET_CLI_PUBLISHED_BUILD]),
    // Flag set to determine if this is the Sentry build.
    [SOCKET_CLI_SENTRY_BUILD]: envAsBoolean(env[SOCKET_CLI_SENTRY_BUILD]),
    // Flag set when running in Node-tap.
    [TAP]: envAsBoolean(env[TAP])
  })
}

const lazyBabelConfigPath = () =>
  // Lazily access constants.rootConfigPath.
  path.join(constants.rootConfigPath, 'babel.config.js')

const lazyDepStatsPath = () =>
  // Lazily access constants.rootPath.
  path.join(constants.rootPath, '.dep-stats.json')

const lazyRootConfigPath = () =>
  // Lazily access constants.rootPath.
  path.join(constants.rootPath, '.config')

const lazyRootDistPath = () =>
  // Lazily access constants.rootPath.
  path.join(constants.rootPath, 'dist')

const lazyRootPackageJsonPath = () =>
  // Lazily access constants.rootPath.
  path.join(constants.rootPath, PACKAGE_JSON)

const lazyRootPackageLockPath = () =>
  // Lazily access constants.rootPath.
  path.join(constants.rootPath, PACKAGE_LOCK)

const lazyRootPath = () => path.resolve(__dirname, '..')

const lazyRootSrcPath = () =>
  // Lazily access constants.rootPath.
  path.join(constants.rootPath, 'src')

const lazyTsconfigPath = () =>
  // Lazily access constants.rootConfigPath.
  path.join(constants.rootConfigPath, 'tsconfig.rollup.json')

const constants = createConstantsObject(
  {
    CLI,
    CONSTANTS,
    ENV: undefined,
    MODULE_SYNC,
    NPM_INJECTION,
    REQUIRE,
    ROLLUP_ENTRY_SUFFIX,
    ROLLUP_EXTERNAL_SUFFIX,
    SHADOW_BIN,
    SLASH_NODE_MODULES_SLASH,
    SOCKET_CLI_LEGACY_BUILD,
    SOCKET_CLI_PUBLISHED_BUILD,
    SOCKET_CLI_SENTRY_BUILD,
    SOCKET_CLI_VERSION_HASH,
    TAP,
    VENDOR,
    babelConfigPath: undefined,
    depStatsPath: undefined,
    rootConfigPath: undefined,
    rootDistPath: undefined,
    rootPackageJsonPath: undefined,
    rootPath: undefined,
    rootSrcPath: undefined,
    tsconfigPath: undefined
  },
  {
    getters: {
      ENV: LAZY_ENV,
      babelConfigPath: lazyBabelConfigPath,
      depStatsPath: lazyDepStatsPath,
      rootConfigPath: lazyRootConfigPath,
      rootDistPath: lazyRootDistPath,
      rootPackageJsonPath: lazyRootPackageJsonPath,
      rootPackageLockPath: lazyRootPackageLockPath,
      rootPath: lazyRootPath,
      rootSrcPath: lazyRootSrcPath,
      tsconfigPath: lazyTsconfigPath
    },
    mixin: registryConstants
  }
)
module.exports = constants
