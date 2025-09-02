'use strict'

const path = require('node:path')

const registryConstants = require('@socketsecurity/registry/lib/constants')

const {
  kInternalsSymbol,
  [kInternalsSymbol]: {
    attributes: registryConstantsAttribs,
    createConstantsObject,
  },
} = registryConstants

const CONSTANTS = 'constants'
const INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION =
  'INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION'
const INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION =
  'INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION'
const INLINED_SOCKET_CLI_HOMEPAGE = 'INLINED_SOCKET_CLI_HOMEPAGE'
const INLINED_SOCKET_CLI_LEGACY_BUILD = 'INLINED_SOCKET_CLI_LEGACY_BUILD'
const INLINED_SOCKET_CLI_NAME = 'INLINED_SOCKET_CLI_NAME'
const INLINED_SOCKET_CLI_PUBLISHED_BUILD = 'INLINED_SOCKET_CLI_PUBLISHED_BUILD'
const INLINED_SOCKET_CLI_SENTRY_BUILD = 'INLINED_SOCKET_CLI_SENTRY_BUILD'
const INLINED_SOCKET_CLI_SYNP_VERSION = 'INLINED_SOCKET_CLI_SYNP_VERSION'
const INLINED_SOCKET_CLI_VERSION = 'INLINED_SOCKET_CLI_VERSION'
const INLINED_SOCKET_CLI_VERSION_HASH = 'INLINED_SOCKET_CLI_VERSION_HASH'
const INSTRUMENT_WITH_SENTRY = 'instrument-with-sentry'
const ROLLUP_EXTERNAL_SUFFIX = '?commonjs-external'
const SHADOW_NPM_BIN = 'shadow-npm-bin'
const SHADOW_NPM_INJECT = 'shadow-npm-inject'
const SLASH_NODE_MODULES_SLASH = '/node_modules/'
const SOCKET_CLI_BIN_NAME = 'socket'
const SOCKET_CLI_BIN_NAME_ALIAS = 'cli'
const SOCKET_CLI_SENTRY_BIN_NAME_ALIAS = 'cli-with-sentry'
const SOCKET_CLI_LEGACY_PACKAGE_NAME = '@socketsecurity/cli'
const SOCKET_CLI_NPM_BIN_NAME = 'socket-npm'
const SOCKET_CLI_NPX_BIN_NAME = 'socket-npx'
const SOCKET_CLI_PACKAGE_NAME = 'socket'
const SOCKET_CLI_SENTRY_BIN_NAME = 'socket-with-sentry'
const SOCKET_CLI_SENTRY_NPM_BIN_NAME = 'socket-npm-with-sentry'
const SOCKET_CLI_SENTRY_NPX_BIN_NAME = 'socket-npx-with-sentry'
const SOCKET_CLI_SENTRY_PACKAGE_NAME = '@socketsecurity/cli-with-sentry'

const LAZY_ENV = () => {
  const { envAsBoolean } = require('@socketsecurity/registry/lib/env')
  const { env } = process
  return Object.freeze({
    // Lazily access registryConstants.ENV.
    ...registryConstants.ENV,
    // Flag set to determine if this is the Legacy build.
    [INLINED_SOCKET_CLI_LEGACY_BUILD]: envAsBoolean(
      env[INLINED_SOCKET_CLI_LEGACY_BUILD],
    ),
    // Flag set to determine if this is a published build.
    [INLINED_SOCKET_CLI_PUBLISHED_BUILD]: envAsBoolean(
      env[INLINED_SOCKET_CLI_PUBLISHED_BUILD],
    ),
    // Flag set to determine if this is the Sentry build.
    [INLINED_SOCKET_CLI_SENTRY_BUILD]: envAsBoolean(
      env[INLINED_SOCKET_CLI_SENTRY_BUILD],
    ),
  })
}

const lazyBlessedContribPath = () =>
  path.join(constants.externalPath, 'blessed-contrib')

const lazyBlessedPath = () => path.join(constants.externalPath, 'blessed')

const lazyConfigPath = () => path.join(constants.rootPath, '.config')

const lazyDistPath = () => path.join(constants.rootPath, 'dist')

const lazyExternalPath = () => path.join(constants.rootPath, 'external')

const lazyRootPackageJsonPath = () =>
  path.join(constants.rootPath, 'package.json')

const lazyRootPackageLockPath = () =>
  path.join(constants.rootPath, 'package-lock.json')

const lazyRootPath = () => path.resolve(__dirname, '..')

const lazySocketRegistryPath = () =>
  path.join(constants.externalPath, '@socketsecurity/registry')

const lazySrcPath = () => path.join(constants.rootPath, 'src')

const constants = createConstantsObject(
  {
    ...registryConstantsAttribs.props,
    CONSTANTS,
    ENV: undefined,
    INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION,
    INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION,
    INLINED_SOCKET_CLI_HOMEPAGE,
    INLINED_SOCKET_CLI_LEGACY_BUILD,
    INLINED_SOCKET_CLI_NAME,
    INLINED_SOCKET_CLI_PUBLISHED_BUILD,
    INLINED_SOCKET_CLI_SENTRY_BUILD,
    INLINED_SOCKET_CLI_SYNP_VERSION,
    INLINED_SOCKET_CLI_VERSION,
    INLINED_SOCKET_CLI_VERSION_HASH,
    INSTRUMENT_WITH_SENTRY,
    ROLLUP_EXTERNAL_SUFFIX,
    SHADOW_NPM_BIN,
    SHADOW_NPM_INJECT,
    SLASH_NODE_MODULES_SLASH,
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
    blessedContribPath: undefined,
    blessedOptions: undefined,
    blessedPath: undefined,
    configPath: undefined,
    distPath: undefined,
    externalPath: undefined,
    rootPackageJsonPath: undefined,
    rootPath: undefined,
    socketRegistryPath: undefined,
    srcPath: undefined,
  },
  {
    getters: {
      ...registryConstantsAttribs.getters,
      ENV: LAZY_ENV,
      blessedContribPath: lazyBlessedContribPath,
      blessedPath: lazyBlessedPath,
      configPath: lazyConfigPath,
      distPath: lazyDistPath,
      externalPath: lazyExternalPath,
      rootPackageJsonPath: lazyRootPackageJsonPath,
      rootPackageLockPath: lazyRootPackageLockPath,
      rootPath: lazyRootPath,
      socketRegistryPath: lazySocketRegistryPath,
      srcPath: lazySrcPath,
    },
  },
)
module.exports = constants
