'use strict'

const path = require('node:path')

const registryConstants = require('@socketsecurity/registry/lib/constants')
const {
  kInternalsSymbol,
  PACKAGE_JSON,
  [kInternalsSymbol]: { createConstantsObject }
} = registryConstants

const ROLLUP_ENTRY_SUFFIX = '?commonjs-entry'
const ROLLUP_EXTERNAL_SUFFIX = '?commonjs-external'
const SLASH_NODE_MODULES_SLASH = '/node_modules/'

const rootPath = path.resolve(__dirname, '..')
const rootConfigPath = path.join(rootPath, '.config')
const rootDistPath = path.join(rootPath, 'dist')
const rootPackageJsonPath = path.join(rootPath, PACKAGE_JSON)
const rootSrcPath = path.join(rootPath, 'src')

const babelConfigPath = path.join(rootConfigPath, 'babel.config.js')
const depStatsPath = path.join(rootPath, '.dep-stats.json')
const tsconfigPath = path.join(rootConfigPath, 'tsconfig.rollup.json')

const LAZY_DIST_TYPE = () =>
  registryConstants.SUPPORTS_NODE_REQUIRE_MODULE ? 'module-sync' : 'require'

const lazyDistPath = () => path.join(rootDistPath, constants.DIST_TYPE)

const constants = createConstantsObject(
  {
    DIST_TYPE: undefined,
    ROLLUP_ENTRY_SUFFIX,
    ROLLUP_EXTERNAL_SUFFIX,
    SLASH_NODE_MODULES_SLASH,
    babelConfigPath,
    depStatsPath,
    distPath: undefined,
    rootConfigPath,
    rootDistPath,
    rootPackageJsonPath,
    rootPath,
    rootSrcPath,
    tsconfigPath
  },
  {
    getters: {
      DIST_TYPE: LAZY_DIST_TYPE,
      distPath: lazyDistPath
    },
    mixin: registryConstants
  }
)
module.exports = constants
