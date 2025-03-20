import { realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import registryConstants from '@socketsecurity/registry/lib/constants'
import { envAsBoolean } from '@socketsecurity/registry/lib/env'

import type { Agent } from './utils/package-environment'
import type { Remap } from '@socketsecurity/registry/lib/objects'

const {
  NODE_MODULES,
  NPM,
  SOCKET_SECURITY_SCOPE,
  kInternalsSymbol,
  [kInternalsSymbol as unknown as 'Symbol(kInternalsSymbol)']: {
    createConstantsObject,
    getIpc
  }
} = registryConstants

type RegistryEnv = typeof registryConstants.ENV

type RegistryInternals = (typeof registryConstants)['Symbol(kInternalsSymbol)']

type Sentry = any

type Internals = Remap<
  Omit<RegistryInternals, 'getIpc'> &
    Readonly<{
      getIpc: {
        (): Promise<IPC>
        <K extends keyof IPC | undefined>(
          key?: K | undefined
        ): Promise<K extends keyof IPC ? IPC[K] : IPC>
      }
      getSentry: () => Sentry
      setSentry(Sentry: Sentry): boolean
    }>
>

type ENV = Remap<
  RegistryEnv &
    Readonly<{
      SOCKET_CLI_DEBUG: boolean
      SOCKET_CLI_NO_API_TOKEN: boolean
    }>
>

type IPC = Readonly<{
  SOCKET_CLI_FIX?: string | undefined
  SOCKET_CLI_OPTIMIZE?: boolean | undefined
  SOCKET_CLI_SAFE_WRAPPER?: string | undefined
}>

type Constants = Remap<
  Omit<typeof registryConstants, 'Symbol(kInternalsSymbol)' | 'ENV' | 'IPC'> & {
    readonly 'Symbol(kInternalsSymbol)': Internals
    readonly ALERT_FIX_TYPE_CVE: 'cve'
    readonly ALERT_FIX_TYPE_UPGRADE: 'upgrade'
    readonly ALERT_TYPE_CRITICAL_CVE: 'criticalCVE'
    readonly ALERT_TYPE_CVE: 'cve'
    readonly ALERT_TYPE_MEDIUM_CVE: 'mediumCVE'
    readonly ALERT_TYPE_MILD_CVE: 'mildCVE'
    readonly API_V0_URL: 'https://api.socket.dev/v0/'
    readonly BINARY_LOCK_EXT: '.lockb'
    readonly BUN: 'bun'
    readonly CLI: 'cli'
    readonly CVE_ALERT_PROPS_FIRST_PATCHED_VERSION_IDENTIFIER: 'firstPatchedVersionIdentifier'
    readonly ENV: ENV
    readonly DIST_TYPE: 'module-sync' | 'require'
    readonly DRY_RUN_LABEL: '[DryRun]'
    readonly DRY_RUN_BAIL_TEXT: '[DryRun] Bailing now'
    readonly INLINED_SOCKET_CLI_LEGACY_BUILD: 'INLINED_SOCKET_CLI_LEGACY_BUILD'
    readonly INLINED_SOCKET_CLI_PUBLISHED_BUILD: 'INLINED_SOCKET_CLI_PUBLISHED_BUILD'
    readonly INLINED_SOCKET_CLI_SENTRY_BUILD: 'INLINED_SOCKET_CLI_SENTRY_BUILD'
    readonly IPC: IPC
    readonly LOCK_EXT: '.lock'
    readonly MODULE_SYNC: 'module-sync'
    readonly NPM_BUGGY_OVERRIDES_PATCHED_VERSION: '11.2.0'
    readonly NPM_REGISTRY_URL: 'https://registry.npmjs.org'
    readonly PNPM: 'pnpm'
    readonly REDACTED: '<redacted>'
    readonly REQUIRE: 'require'
    readonly SHADOW_NPM_BIN: 'shadow-bin'
    readonly SHADOW_NPM_INJECT: 'shadow-npm-inject'
    readonly SHADOW_NPM_PATHS: 'shadow-npm-paths'
    readonly SOCKET: 'socket'
    readonly SOCKET_CLI_BIN_NAME: 'socket'
    readonly SOCKET_CLI_BIN_NAME_ALIAS: 'cli'
    readonly SOCKET_CLI_DEBUG: 'SOCKET_CLI_DEBUG'
    readonly SOCKET_CLI_FIX: 'SOCKET_CLI_FIX'
    readonly SOCKET_CLI_ISSUES_URL: 'https://github.com/SocketDev/socket-cli/issues'
    readonly SOCKET_CLI_SENTRY_BIN_NAME_ALIAS: 'cli-with-sentry'
    readonly SOCKET_CLI_LEGACY_PACKAGE_NAME: '@socketsecurity/cli'
    readonly SOCKET_CLI_NO_API_TOKEN: 'SOCKET_CLI_NO_API_TOKEN'
    readonly SOCKET_CLI_NPM_BIN_NAME: 'socket-npm'
    readonly SOCKET_CLI_NPX_BIN_NAME: 'socket-npx'
    readonly SOCKET_CLI_OPTIMIZE: 'SOCKET_CLI_OPTIMIZE'
    readonly SOCKET_CLI_PACKAGE_NAME: 'socket'
    readonly SOCKET_CLI_SAFE_WRAPPER: 'SOCKET_CLI_SAFE_WRAPPER'
    readonly SOCKET_CLI_SENTRY_BIN_NAME: 'socket-with-sentry'
    readonly SOCKET_CLI_SENTRY_NPM_BIN_NAME: 'socket-npm-with-sentry'
    readonly SOCKET_CLI_SENTRY_NPX_BIN_NAME: 'socket-npx-with-sentry'
    readonly SOCKET_CLI_SENTRY_PACKAGE_NAME: '@socketsecurity/cli-with-sentry'
    readonly VLT: 'vlt'
    readonly WITH_SENTRY: 'with-sentry'
    readonly YARN: 'yarn'
    readonly YARN_BERRY: 'yarn/berry'
    readonly YARN_CLASSIC: 'yarn/classic'
    readonly YARN_LOCK: 'yarn.lock'
    readonly bashRcPath: string
    readonly distCliPath: string
    readonly distInstrumentWithSentryPath: string
    readonly distPath: string
    readonly distShadowNpmBinPath: string
    readonly distShadowNpmInjectPath: string
    readonly homePath: string
    readonly minimumVersionByAgent: Map<Agent, string>
    readonly nmBinPath: string
    readonly nodeHardenFlags: string[]
    readonly rootBinPath: string
    readonly rootDistPath: string
    readonly rootPath: string
    readonly shadowBinPath: string
    readonly zshRcPath: string
  }
>

const SOCKET = 'socket'
const WITH_SENTRY = 'with-sentry'

const ALERT_FIX_TYPE_CVE = 'cve'
const ALERT_FIX_TYPE_UPGRADE = 'upgrade'
const ALERT_TYPE_CRITICAL_CVE = 'criticalCVE'
const ALERT_TYPE_CVE = 'cve'
const ALERT_TYPE_MEDIUM_CVE = 'mediumCVE'
const ALERT_TYPE_MILD_CVE = 'mildCVE'
const API_V0_URL = 'https://api.socket.dev/v0/'
const BINARY_LOCK_EXT = '.lockb'
const BUN = 'bun'
const CLI = 'cli'
const CVE_ALERT_PROPS_FIRST_PATCHED_VERSION_IDENTIFIER =
  'firstPatchedVersionIdentifier'
const DRY_RUN_LABEL = '[DryRun]'
const DRY_RUN_BAIL_TEXT = `${DRY_RUN_LABEL}: Bailing now`
const INLINED_SOCKET_CLI_LEGACY_BUILD = 'INLINED_SOCKET_CLI_LEGACY_BUILD'
const INLINED_SOCKET_CLI_PUBLISHED_BUILD = 'INLINED_SOCKET_CLI_PUBLISHED_BUILD'
const INLINED_SOCKET_CLI_SENTRY_BUILD = 'INLINED_SOCKET_CLI_SENTRY_BUILD'
const LOCK_EXT = '.lock'
const MODULE_SYNC = 'module-sync'
const NPM_BUGGY_OVERRIDES_PATCHED_VERSION = '11.2.0'
const NPM_REGISTRY_URL = 'https://registry.npmjs.org'
const PNPM = 'pnpm'
const REDACTED = '<redacted>'
const REQUIRE = 'require'
const SHADOW_NPM_BIN = 'shadow-bin'
const SHADOW_NPM_INJECT = 'shadow-npm-inject'
const SHADOW_NPM_PATHS = 'shadow-npm-paths'
const SOCKET_CLI_BIN_NAME = 'socket'
const SOCKET_CLI_BIN_NAME_ALIAS = 'cli'
const SOCKET_CLI_DEBUG = 'SOCKET_CLI_DEBUG'
const SOCKET_CLI_FIX = 'SOCKET_CLI_FIX'
const SOCKET_CLI_ISSUES_URL = 'https://github.com/SocketDev/socket-cli/issues'
const SOCKET_CLI_LEGACY_PACKAGE_NAME = `${SOCKET_SECURITY_SCOPE}/cli`
const SOCKET_CLI_NO_API_TOKEN = 'SOCKET_CLI_NO_API_TOKEN'
const SOCKET_CLI_OPTIMIZE = 'SOCKET_CLI_OPTIMIZE'
const SOCKET_CLI_NPM_BIN_NAME = 'socket-npm'
const SOCKET_CLI_NPX_BIN_NAME = 'socket-npx'
const SOCKET_CLI_PACKAGE_NAME = 'socket'
const SOCKET_CLI_SAFE_WRAPPER = 'SOCKET_CLI_SAFE_WRAPPER'
const SOCKET_CLI_SENTRY_BIN_NAME = 'socket-with-sentry'
const SOCKET_CLI_SENTRY_BIN_NAME_ALIAS = 'cli-with-sentry'
const SOCKET_CLI_SENTRY_NPM_BIN_NAME = 'socket-npm-with-sentry'
const SOCKET_CLI_SENTRY_NPX_BIN_NAME = 'socket-npx-with-sentry'
const SOCKET_CLI_SENTRY_PACKAGE_NAME = `${SOCKET_SECURITY_SCOPE}/cli-with-sentry`
const VLT = 'vlt'
const YARN = 'yarn'
const YARN_BERRY = 'yarn/berry'
const YARN_CLASSIC = 'yarn/classic'
const YARN_LOCK = 'yarn.lock'

let _Sentry: any

const LAZY_DIST_TYPE = () =>
  registryConstants.SUPPORTS_NODE_REQUIRE_MODULE ? MODULE_SYNC : REQUIRE

const LAZY_ENV = () => {
  const { env } = process
  // We inline some environment values so that they CANNOT be influenced by user
  // provided environment variables.
  return Object.freeze({
    // Lazily access registryConstants.ENV.
    ...registryConstants.ENV,
    // Inlined flag set to determine if this is the Legacy build.
    // The '@rollup/plugin-replace' will replace "process.env[INLINED_SOCKET_CLI_LEGACY_BUILD]".
    INLINED_SOCKET_CLI_LEGACY_BUILD:
      process.env['INLINED_SOCKET_CLI_LEGACY_BUILD'],
    // Inlined flag set to determine if this is a published build.
    // The '@rollup/plugin-replace' will replace "process.env[INLINED_SOCKET_CLI_PUBLISHED_BUILD]".
    INLINED_SOCKET_CLI_PUBLISHED_BUILD:
      process.env['INLINED_SOCKET_CLI_PUBLISHED_BUILD'],
    // Inlined flag set to determine if this is the Sentry build.
    // The '@rollup/plugin-replace' will replace "process.env[INLINED_SOCKET_CLI_SENTRY_BUILD]".
    INLINED_SOCKET_CLI_SENTRY_BUILD:
      process.env['INLINED_SOCKET_CLI_SENTRY_BUILD'],
    // Flag set to help debug Socket CLI.
    SOCKET_CLI_DEBUG: envAsBoolean(env['SOCKET_CLI_DEBUG']),
    // Flag set to make the default API token `undefined`.
    SOCKET_CLI_NO_API_TOKEN: envAsBoolean(env['SOCKET_CLI_NO_API_TOKEN'])
  })
}

const lazyBashRcPath = () =>
  // Lazily access constants.homePath.
  path.join(constants.homePath, '.bashrc')

const lazyDistCliPath = () =>
  // Lazily access constants.distPath.
  path.join(constants.distPath, 'cli.js')

const lazyDistInstrumentWithSentryPath = () =>
  // Lazily access constants.rootDistPath.
  path.join(constants.rootDistPath, 'instrument-with-sentry.js')

const lazyDistPath = () =>
  // Lazily access constants.rootDistPath and constants.DIST_TYPE.
  path.join(constants.rootDistPath, constants.DIST_TYPE)

const lazyDistShadowNpmBinPath = () =>
  // Lazily access constants.distPath.
  path.join(constants.distPath, `${SHADOW_NPM_BIN}.js`)

const lazyDistShadowNpmInjectPath = () =>
  // Lazily access constants.distPath.
  path.join(constants.distPath, `${SHADOW_NPM_INJECT}.js`)

const lazyHomePath = () => os.homedir()

const lazyMinimumVersionByAgent = () =>
  new Map([
    // Bun >=1.1.39 supports the text-based lockfile.
    // https://bun.sh/blog/bun-lock-text-lockfile
    [BUN, '1.1.39'],
    // The npm version bundled with Node 18.
    // https://nodejs.org/en/about/previous-releases#looking-for-the-latest-release-of-a-version-branch
    [NPM, '10.8.2'],
    // 8.x is the earliest version to support Node 18.
    // https://pnpm.io/installation#compatibility
    // https://www.npmjs.com/package/pnpm?activeTab=versions
    [PNPM, '8.15.9'],
    // 4.x supports >= Node 18.12.0
    // https://github.com/yarnpkg/berry/blob/%40yarnpkg/core/4.1.0/CHANGELOG.md#400
    [YARN_BERRY, '4.0.0'],
    // Latest 1.x.
    // https://www.npmjs.com/package/yarn?activeTab=versions
    [YARN_CLASSIC, '1.22.22'],
    // vlt does not support overrides so we don't gate on it.
    [VLT, '*']
  ])

const lazyNmBinPath = () =>
  // Lazily access constants.rootPath.
  path.join(constants.rootPath, `${NODE_MODULES}/.bin`)

// Redefine registryConstants.nodeHardenFlags to account for the
// INLINED_SOCKET_CLI_SENTRY_BUILD environment variable.
const lazyNodeHardenFlags = () =>
  // The '@rollup/plugin-replace' will replace "process.env[INLINED_SOCKET_CLI_SENTRY_BUILD]".
  // Lazily access constants.WIN32.
  process.env['INLINED_SOCKET_CLI_SENTRY_BUILD'] || constants.WIN32
    ? []
    : // Harden Node security.
      // https://nodejs.org/en/learn/getting-started/security-best-practices
      // We have contributed the following patches to our dependencies to make
      // Node's --frozen-intrinsics workable.
      // √ https://github.com/SBoudrias/Inquirer.js/pull/1683
      // √ https://github.com/pnpm/components/pull/23
      ['--disable-proto', 'delete', '--frozen-intrinsics', '--no-deprecation']

const lazyRootBinPath = () =>
  // Lazily access constants.rootPath.
  path.join(constants.rootPath, 'bin')

const lazyRootDistPath = () =>
  // Lazily access constants.rootPath.
  path.join(constants.rootPath, 'dist')

const lazyRootPath = () =>
  // The '@rollup/plugin-replace' will replace "process.env['INLINED_SOCKET_CLI_TEST_DIST_BUILD']".
  path.join(
    realpathSync.native(__dirname),
    process.env['INLINED_SOCKET_CLI_TEST_DIST_BUILD'] ? '../..' : '..'
  )

const lazyShadowBinPath = () =>
  // Lazily access constants.rootPath.
  path.join(constants.rootPath, SHADOW_NPM_BIN)

const lazyZshRcPath = () =>
  // Lazily access constants.homePath.
  path.join(constants.homePath, '.zshrc')

const constants = createConstantsObject(
  {
    ALERT_FIX_TYPE_CVE,
    ALERT_FIX_TYPE_UPGRADE,
    ALERT_TYPE_CRITICAL_CVE,
    ALERT_TYPE_CVE,
    ALERT_TYPE_MEDIUM_CVE,
    ALERT_TYPE_MILD_CVE,
    API_V0_URL,
    BINARY_LOCK_EXT,
    BUN,
    CLI,
    CVE_ALERT_PROPS_FIRST_PATCHED_VERSION_IDENTIFIER,
    // Lazily defined values are initialized as `undefined` to keep their key order.
    DIST_TYPE: undefined,
    DRY_RUN_LABEL,
    DRY_RUN_BAIL_TEXT,
    ENV: undefined,
    INLINED_SOCKET_CLI_LEGACY_BUILD,
    INLINED_SOCKET_CLI_PUBLISHED_BUILD,
    INLINED_SOCKET_CLI_SENTRY_BUILD,
    LOCK_EXT,
    MODULE_SYNC,
    NPM_BUGGY_OVERRIDES_PATCHED_VERSION,
    NPM_REGISTRY_URL,
    PNPM,
    REDACTED,
    REQUIRE,
    SHADOW_NPM_BIN,
    SHADOW_NPM_INJECT,
    SHADOW_NPM_PATHS,
    SOCKET,
    SOCKET_CLI_BIN_NAME,
    SOCKET_CLI_BIN_NAME_ALIAS,
    SOCKET_CLI_DEBUG,
    SOCKET_CLI_FIX,
    SOCKET_CLI_ISSUES_URL,
    SOCKET_CLI_SENTRY_BIN_NAME_ALIAS,
    SOCKET_CLI_LEGACY_PACKAGE_NAME,
    SOCKET_CLI_NO_API_TOKEN,
    SOCKET_CLI_NPM_BIN_NAME,
    SOCKET_CLI_NPX_BIN_NAME,
    SOCKET_CLI_OPTIMIZE,
    SOCKET_CLI_PACKAGE_NAME,
    SOCKET_CLI_SAFE_WRAPPER,
    SOCKET_CLI_SENTRY_BIN_NAME,
    SOCKET_CLI_SENTRY_NPM_BIN_NAME,
    SOCKET_CLI_SENTRY_NPX_BIN_NAME,
    SOCKET_CLI_SENTRY_PACKAGE_NAME,
    VLT,
    WITH_SENTRY,
    YARN,
    YARN_BERRY,
    YARN_CLASSIC,
    YARN_LOCK,
    bashRcPath: undefined,
    distCliPath: undefined,
    distInstrumentWithSentryPath: undefined,
    distPath: undefined,
    distShadowNpmBinPath: undefined,
    distShadowNpmInjectPath: undefined,
    homePath: undefined,
    minimumVersionByAgent: undefined,
    nmBinPath: undefined,
    nodeHardenFlags: undefined,
    rootBinPath: undefined,
    rootDistPath: undefined,
    rootPath: undefined,
    shadowBinPath: undefined,
    zshRcPath: undefined
  },
  {
    getters: {
      DIST_TYPE: LAZY_DIST_TYPE,
      ENV: LAZY_ENV,
      bashRcPath: lazyBashRcPath,
      distCliPath: lazyDistCliPath,
      distInstrumentWithSentryPath: lazyDistInstrumentWithSentryPath,
      distPath: lazyDistPath,
      distShadowNpmBinPath: lazyDistShadowNpmBinPath,
      distShadowNpmInjectPath: lazyDistShadowNpmInjectPath,
      homePath: lazyHomePath,
      minimumVersionByAgent: lazyMinimumVersionByAgent,
      nmBinPath: lazyNmBinPath,
      nodeHardenFlags: lazyNodeHardenFlags,
      rootBinPath: lazyRootBinPath,
      rootDistPath: lazyRootDistPath,
      rootPath: lazyRootPath,
      shadowBinPath: lazyShadowBinPath,
      zshRcPath: lazyZshRcPath
    },
    internals: {
      getIpc,
      getSentry() {
        return _Sentry
      },
      setSentry(Sentry: Sentry): boolean {
        if (_Sentry === undefined) {
          _Sentry = Sentry
          return true
        }
        return false
      }
    },
    mixin: registryConstants
  }
) as Constants

export default constants
