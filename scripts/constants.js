'use strict'

const path = require('node:path')

const registryConstants = require('@socketsecurity/registry/lib/constants')
const { envAsBoolean } = require('@socketsecurity/registry/lib/env')

const {
  PACKAGE_JSON,
  PACKAGE_LOCK_JSON,
  SOCKET_SECURITY_SCOPE,
  kInternalsSymbol,
  [kInternalsSymbol]: { createConstantsObject }
} = registryConstants

const CLI = 'cli'
const CONSTANTS = 'constants'
const INLINED_CYCLONEDX_CDXGEN_VERSION = 'INLINED_CYCLONEDX_CDXGEN_VERSION'
const INLINED_SOCKET_CLI_HOMEPAGE = 'INLINED_SOCKET_CLI_HOMEPAGE'
const INLINED_SOCKET_CLI_LEGACY_BUILD = 'INLINED_SOCKET_CLI_LEGACY_BUILD'
const INLINED_SOCKET_CLI_NAME = 'INLINED_SOCKET_CLI_NAME'
const INLINED_SOCKET_CLI_PUBLISHED_BUILD = 'INLINED_SOCKET_CLI_PUBLISHED_BUILD'
const INLINED_SOCKET_CLI_SENTRY_BUILD = 'INLINED_SOCKET_CLI_SENTRY_BUILD'
const INLINED_SOCKET_CLI_VERSION = 'INLINED_SOCKET_CLI_VERSION'
const INLINED_SOCKET_CLI_VERSION_HASH = 'INLINED_SOCKET_CLI_VERSION_HASH'
const INLINED_SYNP_VERSION = 'INLINED_SYNP_VERSION'
const INSTRUMENT_WITH_SENTRY = 'instrument-with-sentry'
const ROLLUP_EXTERNAL_SUFFIX = '?commonjs-external'
const SHADOW_NPM_BIN = 'shadow-bin'
const SHADOW_NPM_INJECT = 'shadow-npm-inject'
const SHADOW_NPM_PATHS = 'shadow-npm-paths'
const SLASH_NODE_MODULES_SLASH = '/node_modules/'
const SOCKET = 'socket'
const SOCKET_CLI_BIN_NAME = 'socket'
const SOCKET_CLI_BIN_NAME_ALIAS = 'cli'
const SOCKET_CLI_SENTRY_BIN_NAME_ALIAS = 'cli-with-sentry'
const SOCKET_CLI_LEGACY_PACKAGE_NAME = `${SOCKET_SECURITY_SCOPE}/cli`
const SOCKET_CLI_NPM_BIN_NAME = 'socket-npm'
const SOCKET_CLI_NPX_BIN_NAME = 'socket-npx'
const SOCKET_CLI_PACKAGE_NAME = 'socket'
const SOCKET_CLI_SENTRY_BIN_NAME = 'socket-with-sentry'
const SOCKET_CLI_SENTRY_NPM_BIN_NAME = 'socket-npm-with-sentry'
const SOCKET_CLI_SENTRY_NPX_BIN_NAME = 'socket-npx-with-sentry'
const SOCKET_CLI_SENTRY_PACKAGE_NAME = `${SOCKET_SECURITY_SCOPE}/cli-with-sentry`
const VENDOR = 'vendor'
const WITH_SENTRY = 'with-sentry'

const LAZY_ENV = () => {
  const { env } = process
  return Object.freeze({
    // Lazily access registryConstants.ENV.
    ...registryConstants.ENV,
    // Flag set to determine if this is the Legacy build.
    [INLINED_SOCKET_CLI_LEGACY_BUILD]: envAsBoolean(
      env[INLINED_SOCKET_CLI_LEGACY_BUILD]
    ),
    // Flag set to determine if this is a published build.
    [INLINED_SOCKET_CLI_PUBLISHED_BUILD]: envAsBoolean(
      env[INLINED_SOCKET_CLI_PUBLISHED_BUILD]
    ),
    // Flag set to determine if this is the Sentry build.
    [INLINED_SOCKET_CLI_SENTRY_BUILD]: envAsBoolean(
      env[INLINED_SOCKET_CLI_SENTRY_BUILD]
    )
  })
}

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
  path.join(constants.rootPath, PACKAGE_LOCK_JSON)

const lazyRootPath = () => path.resolve(__dirname, '..')

const lazyRootSrcPath = () =>
  // Lazily access constants.rootPath.
  path.join(constants.rootPath, 'src')

const constants = createConstantsObject(
  {
    CLI,
    CONSTANTS,
    ENV: undefined,
    INLINED_CYCLONEDX_CDXGEN_VERSION,
    INLINED_SOCKET_CLI_HOMEPAGE,
    INLINED_SOCKET_CLI_LEGACY_BUILD,
    INLINED_SOCKET_CLI_NAME,
    INLINED_SOCKET_CLI_PUBLISHED_BUILD,
    INLINED_SOCKET_CLI_SENTRY_BUILD,
    INLINED_SOCKET_CLI_VERSION,
    INLINED_SOCKET_CLI_VERSION_HASH,
    INLINED_SYNP_VERSION,
    INSTRUMENT_WITH_SENTRY,
    ROLLUP_EXTERNAL_SUFFIX,
    SHADOW_NPM_BIN,
    SHADOW_NPM_INJECT,
    SHADOW_NPM_PATHS,
    SLASH_NODE_MODULES_SLASH,
    SOCKET,
    SOCKET_CLI_BIN_NAME,
    SOCKET_CLI_BIN_NAME_ALIAS,
    SOCKET_CLI_LEGACY_PACKAGE_NAME,
    SOCKET_CLI_NPM_BIN_NAME,
    SOCKET_CLI_NPX_BIN_NAME,
    SOCKET_CLI_PACKAGE_NAME,
    SOCKET_CLI_SENTRY_BIN_NAME,
    SOCKET_CLI_SENTRY_BIN_NAME_ALIAS,
    SOCKET_CLI_SENTRY_NPM_BIN_NAME,
    SOCKET_CLI_SENTRY_NPX_BIN_NAME,
    SOCKET_CLI_SENTRY_PACKAGE_NAME,
    VENDOR,
    WITH_SENTRY,
    rootConfigPath: undefined,
    rootDistPath: undefined,
    rootPackageJsonPath: undefined,
    rootPath: undefined,
    rootSrcPath: undefined
  },
  {
    getters: {
      ENV: LAZY_ENV,
      rootConfigPath: lazyRootConfigPath,
      rootDistPath: lazyRootDistPath,
      rootPackageJsonPath: lazyRootPackageJsonPath,
      rootPackageLockPath: lazyRootPackageLockPath,
      rootPath: lazyRootPath,
      rootSrcPath: lazyRootSrcPath
    },
    mixin: registryConstants
  }
)
module.exports = constants
