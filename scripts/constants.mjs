/** @fileoverview Build constants for Socket CLI project configuration and paths. */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import registryConstantsModule from '@socketsecurity/registry/lib/constants'
import envUtils from '@socketsecurity/registry/lib/env'

const { envAsBoolean } = envUtils
const registryConstants =
  registryConstantsModule.default || registryConstantsModule

const {
  kInternalsSymbol,
  [kInternalsSymbol]: {
    attributes: registryConstantsAttribs,
    createConstantsObject,
  },
} = registryConstants

const BIOME_JSON = 'biome.json'
const CONSTANTS = 'constants'
const INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION =
  'INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION'
const INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION =
  'INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION'
const INLINED_SOCKET_CLI_PYTHON_VERSION = 'INLINED_SOCKET_CLI_PYTHON_VERSION'
const INLINED_SOCKET_CLI_PYTHON_BUILD_TAG =
  'INLINED_SOCKET_CLI_PYTHON_BUILD_TAG'
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
const SHADOW_NPX_BIN = 'shadow-npx-bin'
const SHADOW_PNPM_BIN = 'shadow-pnpm-bin'
const SHADOW_YARN_BIN = 'shadow-yarn-bin'
const SLASH_NODE_MODULES_SLASH = '/node_modules/'
const SOCKET_CLI_BIN_NAME = 'socket'
const SOCKET_CLI_BIN_NAME_ALIAS = 'cli'
const SOCKET_CLI_SENTRY_BIN_NAME_ALIAS = 'cli-with-sentry'
const SOCKET_CLI_LEGACY_PACKAGE_NAME = '@socketsecurity/cli'
const SOCKET_CLI_NPM_BIN_NAME = 'socket-npm'
const SOCKET_CLI_NPX_BIN_NAME = 'socket-npx'
const SOCKET_CLI_PNPM_BIN_NAME = 'socket-pnpm'
const SOCKET_CLI_YARN_BIN_NAME = 'socket-yarn'
const SOCKET_CLI_PACKAGE_NAME = 'socket'
const SOCKET_CLI_SENTRY_BIN_NAME = 'socket-with-sentry'
const SOCKET_CLI_SENTRY_NPM_BIN_NAME = 'socket-npm-with-sentry'
const SOCKET_CLI_SENTRY_NPX_BIN_NAME = 'socket-npx-with-sentry'
const SOCKET_CLI_SENTRY_PNPM_BIN_NAME = 'socket-pnpm-with-sentry'
const SOCKET_CLI_SENTRY_YARN_BIN_NAME = 'socket-yarn-with-sentry'
const SOCKET_CLI_SENTRY_PACKAGE_NAME = '@socketsecurity/cli-with-sentry'

const LAZY_ENV = () => {
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

const lazyConfigPath = () => path.join(constants.rootPath, '.config')

const lazyDistPath = () => path.join(constants.rootPath, 'dist')

const lazyExternalPath = () => path.join(constants.rootPath, 'external')

const lazyRootPackageJsonPath = () =>
  path.join(constants.rootPath, constants.PACKAGE_JSON)

const lazyRootPackageLockPath = () =>
  path.join(constants.rootPath, constants.PNPM_LOCK_YAML)

const lazyRootNodeModulesBinPath = () =>
  path.join(constants.rootPath, constants.NODE_MODULES, '.bin')

const lazyRootPath = () =>
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const lazySocketRegistryPath = () =>
  path.join(
    constants.externalPath,
    constants.SOCKET_REGISTRY_PACKAGE_NAME,
    'dist',
  )

const lazySrcPath = () => path.join(constants.rootPath, 'src')

const constants = createConstantsObject(
  {
    ...registryConstantsAttribs.props,
    BIOME_JSON,
    CONSTANTS,
    ENV: undefined,
    INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION,
    INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION,
    INLINED_SOCKET_CLI_PYTHON_VERSION,
    INLINED_SOCKET_CLI_PYTHON_BUILD_TAG,
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
    SHADOW_NPX_BIN,
    SHADOW_PNPM_BIN,
    SHADOW_YARN_BIN,
    SLASH_NODE_MODULES_SLASH,
    SOCKET_CLI_BIN_NAME,
    SOCKET_CLI_BIN_NAME_ALIAS,
    SOCKET_CLI_LEGACY_PACKAGE_NAME,
    SOCKET_CLI_NPM_BIN_NAME,
    SOCKET_CLI_NPX_BIN_NAME,
    SOCKET_CLI_PNPM_BIN_NAME,
    SOCKET_CLI_YARN_BIN_NAME,
    SOCKET_CLI_PACKAGE_NAME,
    SOCKET_CLI_SENTRY_BIN_NAME,
    SOCKET_CLI_SENTRY_BIN_NAME_ALIAS,
    SOCKET_CLI_SENTRY_NPM_BIN_NAME,
    SOCKET_CLI_SENTRY_NPX_BIN_NAME,
    SOCKET_CLI_SENTRY_PNPM_BIN_NAME,
    SOCKET_CLI_SENTRY_YARN_BIN_NAME,
    SOCKET_CLI_SENTRY_PACKAGE_NAME,
    configPath: undefined,
    distPath: undefined,
    externalPath: undefined,
    rootPackageJsonPath: undefined,
    rootNodeModulesBinPath: undefined,
    rootPath: undefined,
    socketRegistryPath: undefined,
    srcPath: undefined,
  },
  {
    getters: {
      ...registryConstantsAttribs.getters,
      ENV: LAZY_ENV,
      configPath: lazyConfigPath,
      distPath: lazyDistPath,
      externalPath: lazyExternalPath,
      rootPackageJsonPath: lazyRootPackageJsonPath,
      rootPackageLockPath: lazyRootPackageLockPath,
      rootNodeModulesBinPath: lazyRootNodeModulesBinPath,
      rootPath: lazyRootPath,
      socketRegistryPath: lazySocketRegistryPath,
      srcPath: lazySrcPath,
    },
  },
)
export default constants
