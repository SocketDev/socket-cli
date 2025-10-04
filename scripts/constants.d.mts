/** @fileoverview Type definitions for build constants. */

import type registryConstants from '@socketsecurity/registry/lib/constants'

type Constants = typeof registryConstants & {
  readonly CONSTANTS: 'constants'
  readonly ENV: typeof registryConstants.ENV & {
    readonly INLINED_SOCKET_CLI_LEGACY_BUILD: boolean
    readonly INLINED_SOCKET_CLI_PUBLISHED_BUILD: boolean
    readonly INLINED_SOCKET_CLI_SENTRY_BUILD: boolean
  }
  readonly INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION: string
  readonly INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION: string
  readonly INLINED_SOCKET_CLI_PYTHON_VERSION: string
  readonly INLINED_SOCKET_CLI_PYTHON_BUILD_TAG: string
  readonly INLINED_SOCKET_CLI_HOMEPAGE: string
  readonly INLINED_SOCKET_CLI_LEGACY_BUILD: string
  readonly INLINED_SOCKET_CLI_NAME: string
  readonly INLINED_SOCKET_CLI_PUBLISHED_BUILD: string
  readonly INLINED_SOCKET_CLI_SENTRY_BUILD: string
  readonly INLINED_SOCKET_CLI_SYNP_VERSION: string
  readonly INLINED_SOCKET_CLI_VERSION: string
  readonly INLINED_SOCKET_CLI_VERSION_HASH: string
  readonly INSTRUMENT_WITH_SENTRY: 'instrument-with-sentry'
  readonly ROLLUP_EXTERNAL_SUFFIX: '?commonjs-external'
  readonly SHADOW_NPM_BIN: 'shadow-npm-bin'
  readonly SHADOW_NPM_INJECT: 'shadow-npm-inject'
  readonly SHADOW_NPX_BIN: 'shadow-npx-bin'
  readonly SHADOW_PNPM_BIN: 'shadow-pnpm-bin'
  readonly SHADOW_YARN_BIN: 'shadow-yarn-bin'
  readonly SLASH_NODE_MODULES_SLASH: '/node_modules/'
  readonly SOCKET_CLI_BIN_NAME: 'socket'
  readonly SOCKET_CLI_BIN_NAME_ALIAS: 'cli'
  readonly SOCKET_CLI_SENTRY_BIN_NAME_ALIAS: 'cli-with-sentry'
  readonly SOCKET_CLI_LEGACY_PACKAGE_NAME: '@socketsecurity/cli'
  readonly SOCKET_CLI_NPM_BIN_NAME: 'socket-npm'
  readonly SOCKET_CLI_NPX_BIN_NAME: 'socket-npx'
  readonly SOCKET_CLI_PNPM_BIN_NAME: 'socket-pnpm'
  readonly SOCKET_CLI_YARN_BIN_NAME: 'socket-yarn'
  readonly SOCKET_CLI_PACKAGE_NAME: 'socket'
  readonly SOCKET_CLI_SENTRY_BIN_NAME: 'socket-with-sentry'
  readonly SOCKET_CLI_SENTRY_NPM_BIN_NAME: 'socket-npm-with-sentry'
  readonly SOCKET_CLI_SENTRY_NPX_BIN_NAME: 'socket-npx-with-sentry'
  readonly SOCKET_CLI_SENTRY_PNPM_BIN_NAME: 'socket-pnpm-with-sentry'
  readonly SOCKET_CLI_SENTRY_YARN_BIN_NAME: 'socket-yarn-with-sentry'
  readonly SOCKET_CLI_SENTRY_PACKAGE_NAME: '@socketsecurity/cli-with-sentry'
  readonly configPath: string
  readonly distPath: string
  readonly externalPath: string
  readonly rootPackageJsonPath: string
  readonly rootPackageLockPath: string
  readonly rootNodeModulesBinPath: string
  readonly rootPath: string
  readonly socketRegistryPath: string
  readonly srcPath: string
}

declare const constants: Constants

export default constants
