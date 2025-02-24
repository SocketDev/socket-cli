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

const CONSTANTS = 'constants'
const MODULE_SYNC = 'module-sync'
const REQUIRE = 'require'
const ROLLUP_ENTRY_SUFFIX = '?commonjs-entry'
const ROLLUP_EXTERNAL_SUFFIX = '?commonjs-external'
const SOCKET_IS_PUBLISHED = 'SOCKET_IS_PUBLISHED'
const SOCKET_WITH_SENTRY = 'SOCKET_WITH_SENTRY'
const SLASH_NODE_MODULES_SLASH = '/node_modules/'
const TAP = 'TAP'
const VENDOR = 'vendor'

const LAZY_ENV = () =>
  Object.freeze({
    // Lazily access registryConstants.ENV.
    ...registryConstants.ENV,
    // Flag set to determine if this is the published package build.
    [SOCKET_IS_PUBLISHED]: envAsBoolean(process.env[SOCKET_IS_PUBLISHED]),
    // Flag set to determine if this is the Sentry build.
    [SOCKET_WITH_SENTRY]: envAsBoolean(process.env[SOCKET_WITH_SENTRY]),
    // Flag set when running in Node-tap.
    [TAP]: envAsBoolean(process.env[TAP])
  })

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
    CONSTANTS,
    ENV: undefined,
    MODULE_SYNC,
    REQUIRE,
    ROLLUP_ENTRY_SUFFIX,
    ROLLUP_EXTERNAL_SUFFIX,
    SLASH_NODE_MODULES_SLASH,
    SOCKET_IS_PUBLISHED,
    SOCKET_WITH_SENTRY,
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
