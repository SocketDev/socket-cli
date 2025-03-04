'use strict'

const path = require('node:path')

const registryConstants = require('@socketsecurity/registry/lib/constants')
const { envAsBoolean } = require('@socketsecurity/registry/lib/env')

const {
  NPM,
  NPX,
  PACKAGE_JSON,
  PACKAGE_LOCK,
  SOCKET_SECURITY_SCOPE,
  kInternalsSymbol,
  [kInternalsSymbol]: { createConstantsObject }
} = registryConstants

const WITH_SENTRY = 'with-sentry'
const CLI = 'cli'
const CONSTANTS = 'constants'
const INSTRUMENT_WITH_SENTRY = `instrument-${WITH_SENTRY}`
const MODULE_SYNC = 'module-sync'
const REQUIRE = 'require'
const ROLLUP_ENTRY_SUFFIX = '?commonjs-entry'
const ROLLUP_EXTERNAL_SUFFIX = '?commonjs-external'
const SHADOW_NPM_BIN = 'shadow-bin'
const SHADOW_NPM_INJECT = 'shadow-npm-inject'
const SHADOW_NPM_PATHS = 'shadow-npm-paths'
const SLASH_NODE_MODULES_SLASH = '/node_modules/'
const SOCKET = 'socket'
const SOCKET_CLI_BIN_NAME = SOCKET
const SOCKET_CLI_BIN_NAME_ALIAS = CLI
const SOCKET_CLI_SENTRY_BIN_NAME_ALIAS = `${SOCKET_CLI_BIN_NAME_ALIAS}-${WITH_SENTRY}`
const SOCKET_CLI_LEGACY_BUILD = 'SOCKET_CLI_LEGACY_BUILD'
const SOCKET_CLI_LEGACY_PACKAGE_NAME = `${SOCKET_SECURITY_SCOPE}/${CLI}`
const SOCKET_CLI_NPM_BIN_NAME = `${SOCKET}-${NPM}`
const SOCKET_CLI_NPX_BIN_NAME = `${SOCKET}-${NPX}`
const SOCKET_CLI_PACKAGE_NAME = SOCKET
const SOCKET_CLI_PUBLISHED_BUILD = 'SOCKET_CLI_PUBLISHED_BUILD'
const SOCKET_CLI_SENTRY_BIN_NAME = `${SOCKET_CLI_BIN_NAME}-${WITH_SENTRY}`
const SOCKET_CLI_SENTRY_BUILD = 'SOCKET_CLI_SENTRY_BUILD'
const SOCKET_CLI_SENTRY_NPM_BIN_NAME = `${SOCKET_CLI_NPM_BIN_NAME}-${WITH_SENTRY}`
const SOCKET_CLI_SENTRY_NPX_BIN_NAME = `${SOCKET_CLI_NPX_BIN_NAME}-${WITH_SENTRY}`
const SOCKET_CLI_SENTRY_PACKAGE_NAME = `${SOCKET_CLI_LEGACY_PACKAGE_NAME}-${WITH_SENTRY}`
const SOCKET_CLI_TEST_DIST_BUILD = 'SOCKET_CLI_TEST_DIST_BUILD'
const SOCKET_CLI_VERSION_HASH = 'SOCKET_CLI_VERSION_HASH'
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
    [SOCKET_CLI_SENTRY_BUILD]: envAsBoolean(env[SOCKET_CLI_SENTRY_BUILD])
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
    INSTRUMENT_WITH_SENTRY,
    MODULE_SYNC,
    REQUIRE,
    ROLLUP_ENTRY_SUFFIX,
    ROLLUP_EXTERNAL_SUFFIX,
    SHADOW_NPM_BIN,
    SHADOW_NPM_INJECT,
    SHADOW_NPM_PATHS,
    SLASH_NODE_MODULES_SLASH,
    SOCKET,
    SOCKET_CLI_BIN_NAME,
    SOCKET_CLI_BIN_NAME_ALIAS,
    SOCKET_CLI_SENTRY_BIN_NAME_ALIAS,
    SOCKET_CLI_LEGACY_BUILD,
    SOCKET_CLI_LEGACY_PACKAGE_NAME,
    SOCKET_CLI_NPM_BIN_NAME,
    SOCKET_CLI_NPX_BIN_NAME,
    SOCKET_CLI_PACKAGE_NAME,
    SOCKET_CLI_PUBLISHED_BUILD,
    SOCKET_CLI_SENTRY_BIN_NAME,
    SOCKET_CLI_SENTRY_BUILD,
    SOCKET_CLI_SENTRY_NPM_BIN_NAME,
    SOCKET_CLI_SENTRY_NPX_BIN_NAME,
    SOCKET_CLI_SENTRY_PACKAGE_NAME,
    SOCKET_CLI_TEST_DIST_BUILD,
    SOCKET_CLI_VERSION_HASH,
    VENDOR,
    WITH_SENTRY,
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
