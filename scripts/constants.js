'use strict'

const path = require('node:path')

const registryConstants = require('@socketsecurity/registry/lib/constants')
const {
  PACKAGE_JSON,
  kInternalsSymbol,
  [kInternalsSymbol]: { createConstantsObject }
} = registryConstants

const CONSTANTS = 'constants'
const MODULE_SYNC = 'module-sync'
const REQUIRE = 'require'
const ROLLUP_ENTRY_SUFFIX = '?commonjs-entry'
const ROLLUP_EXTERNAL_SUFFIX = '?commonjs-external'
const SLASH_NODE_MODULES_SLASH = '/node_modules/'
const VENDOR = 'vendor'

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
    MODULE_SYNC,
    REQUIRE,
    ROLLUP_ENTRY_SUFFIX,
    ROLLUP_EXTERNAL_SUFFIX,
    SLASH_NODE_MODULES_SLASH,
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
      babelConfigPath: lazyBabelConfigPath,
      depStatsPath: lazyDepStatsPath,
      rootConfigPath: lazyRootConfigPath,
      rootDistPath: lazyRootDistPath,
      rootPackageJsonPath: lazyRootPackageJsonPath,
      rootPath: lazyRootPath,
      rootSrcPath: lazyRootSrcPath,
      tsconfigPath: lazyTsconfigPath
    },
    mixin: registryConstants
  }
)
module.exports = constants
