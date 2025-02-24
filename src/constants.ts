import { realpathSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import registryConstants from '@socketsecurity/registry/lib/constants'
import { envAsBoolean } from '@socketsecurity/registry/lib/env'

import type { Remap } from '@socketsecurity/registry/lib/objects'

const {
  PACKAGE_JSON,
  kInternalsSymbol,
  [kInternalsSymbol as unknown as 'Symbol(kInternalsSymbol)']: {
    createConstantsObject
  }
} = registryConstants

type RegistryEnv = typeof registryConstants.ENV

type RegistryInternals = (typeof registryConstants)['Symbol(kInternalsSymbol)']

type Sentry = any

type Internals = Remap<
  Omit<RegistryInternals, 'getIPC'> &
    Readonly<{
      getIPC: {
        (): Promise<IPC>
        <K extends keyof IPC | undefined>(
          key?: K
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
    }>
>

type IPC = Readonly<{
  SOCKET_CLI_FIX?: string
  SOCKET_CLI_OPTIMIZE?: boolean
  SOCKET_CLI_SAFE_WRAPPER?: boolean
}>

type Constants = Remap<
  Omit<typeof registryConstants, 'Symbol(kInternalsSymbol)' | 'ENV' | 'IPC'> & {
    readonly 'Symbol(kInternalsSymbol)': Internals
    readonly ALERT_TYPE_CRITICAL_CVE: 'criticalCVE'
    readonly ALERT_TYPE_CVE: 'cve'
    readonly ALERT_TYPE_MEDIUM_CVE: 'mediumCVE'
    readonly ALERT_TYPE_MILD_CVE: 'mildCVE'
    readonly ALERT_TYPE_SOCKET_UPGRADE_AVAILABLE: 'socketUpgradeAvailable'
    readonly API_V0_URL: 'https://api.socket.dev/v0'
    readonly BABEL_RUNTIME: '@babel/runtime'
    readonly BATCH_PURL_ENDPOINT: 'https://api.socket.dev/v0/purl?alerts=true&compact=true'
    readonly BINARY_LOCK_EXT: '.lockb'
    readonly BUN: 'bun'
    readonly CVE_ALERT_PROPS_FIRST_PATCHED_VERSION_IDENTIFIER: 'firstPatchedVersionIdentifier'
    readonly CVE_ALERT_PROPS_VULNERABLE_VERSION_RANGE: 'vulnerableVersionRange'
    readonly ENV: ENV
    readonly DIST_TYPE: 'module-sync' | 'require'
    readonly IPC: IPC
    readonly LOCK_EXT: '.lock'
    readonly MODULE_SYNC: 'module-sync'
    readonly NPM_REGISTRY_URL: 'https://registry.npmjs.org'
    readonly NPX: 'npx'
    readonly PNPM: 'pnpm'
    readonly REQUIRE: 'require'
    readonly SOCKET_CLI_DEBUG: 'SOCKET_CLI_DEBUG'
    readonly SOCKET_CLI_FIX: 'SOCKET_CLI_FIX'
    readonly SOCKET_CLI_ISSUES_URL: 'https://github.com/SocketDev/socket-cli/issues'
    readonly SOCKET_CLI_OPTIMIZE: 'SOCKET_CLI_OPTIMIZE'
    readonly SOCKET_CLI_SAFE_WRAPPER: 'SOCKET_CLI_SAFE_WRAPPER'
    readonly VLT: 'vlt'
    readonly YARN: 'yarn'
    readonly YARN_BERRY: 'yarn/berry'
    readonly YARN_CLASSIC: 'yarn/classic'
    readonly cdxgenBinPath: string
    readonly distPath: string
    readonly instrumentWithSentryPath: string
    readonly nmBinPath: string
    readonly rootBinPath: string
    readonly rootDistPath: string
    readonly rootPath: string
    readonly rootPkgJsonPath: string
    readonly shadowBinPath: string
    readonly synpBinPath: string
  }
>

const ALERT_TYPE_CRITICAL_CVE = 'criticalCVE'
const ALERT_TYPE_CVE = 'cve'
const ALERT_TYPE_MEDIUM_CVE = 'mediumCVE'
const ALERT_TYPE_MILD_CVE = 'mildCVE'
const ALERT_TYPE_SOCKET_UPGRADE_AVAILABLE = 'socketUpgradeAvailable'
const API_V0_URL = 'https://api.socket.dev/v0'
const BABEL_RUNTIME = '@babel/runtime'
const BINARY_LOCK_EXT = '.lockb'
const BUN = 'bun'
const CVE_ALERT_PROPS_FIRST_PATCHED_VERSION_IDENTIFIER =
  'firstPatchedVersionIdentifier'
const CVE_ALERT_PROPS_VULNERABLE_VERSION_RANGE = 'vulnerableVersionRange'
const LOCK_EXT = '.lock'
const MODULE_SYNC = 'module-sync'
const NPM_REGISTRY_URL = 'https://registry.npmjs.org'
const NPX = 'npx'
const PNPM = 'pnpm'
const REQUIRE = 'require'
const SOCKET_CLI_DEBUG = 'SOCKET_CLI_DEBUG'
const SOCKET_CLI_FIX = 'SOCKET_CLI_FIX'
const SOCKET_CLI_ISSUES_URL = 'https://github.com/SocketDev/socket-cli/issues'
const SOCKET_CLI_OPTIMIZE = 'SOCKET_CLI_OPTIMIZE'
const SOCKET_CLI_SAFE_WRAPPER = 'SOCKET_CLI_SAFE_WRAPPER'
const VLT = 'vlt'
const YARN = 'yarn'
const YARN_BERRY = `${YARN}/berry`
const YARN_CLASSIC = `${YARN}/classic`

let _Sentry: any

const LAZY_BATCH_PURL_ENDPOINT = () => {
  const query = new URLSearchParams()
  query.append('alerts', 'true')
  query.append('compact', 'true')
  return `${API_V0_URL}/purl?${query}`
}

const LAZY_DIST_TYPE = () =>
  registryConstants.SUPPORTS_NODE_REQUIRE_MODULE ? MODULE_SYNC : REQUIRE

const LAZY_ENV = () =>
  Object.freeze({
    // Lazily access registryConstants.ENV.
    ...registryConstants.ENV,
    // Flag set to help debug Socket CLI.
    [SOCKET_CLI_DEBUG]: envAsBoolean(process.env[SOCKET_CLI_DEBUG])
  })

const lazyCdxgenBinPath = () =>
  // Lazily access constants.nmBinPath.
  path.join(constants.nmBinPath, 'cdxgen')

const lazyDistPath = () =>
  // Lazily access constants.rootDistPath and constants.DIST_TYPE.
  path.join(constants.rootDistPath, constants.DIST_TYPE)

const lazyNmBinPath = () =>
  // Lazily access constants.rootPath.
  path.join(constants.rootPath, 'node_modules/.bin')

const lazyRootBinPath = () =>
  // Lazily access constants.rootPath.
  path.join(constants.rootPath, 'bin')

const lazyRootDistPath = () =>
  // Lazily access constants.rootPath.
  path.join(constants.rootPath, 'dist')

const lazyRootPath = () =>
  // The '@rollup/plugin-replace' will replace 'process.env.TAP'.
  path.resolve(
    realpathSync.native(__dirname),
    process.env['TAP'] ? '../..' : '..'
  )

const lazyRootPkgJsonPath = () =>
  // Lazily access constants.rootPath.
  path.join(constants.rootPath, PACKAGE_JSON)

const lazyInstrumentWithSentryPath = () =>
  // Lazily access constants.rootDistPath.
  path.join(constants.rootDistPath, 'instrument-with-sentry.js')

const lazyShadowBinPath = () =>
  // Lazily access constants.rootPath.
  path.join(constants.rootPath, 'shadow-bin')

const lazySynpBinPath = () =>
  // Lazily access constants.nmBinPath.
  path.join(constants.nmBinPath, 'synp')

const constants = <Constants>createConstantsObject(
  {
    ALERT_TYPE_CRITICAL_CVE,
    ALERT_TYPE_CVE,
    ALERT_TYPE_MEDIUM_CVE,
    ALERT_TYPE_MILD_CVE,
    ALERT_TYPE_SOCKET_UPGRADE_AVAILABLE,
    API_V0_URL,
    BABEL_RUNTIME,
    // Lazily defined values are initialized as `undefined` to keep their key order.
    BATCH_PURL_ENDPOINT: undefined,
    BINARY_LOCK_EXT,
    BUN,
    CVE_ALERT_PROPS_FIRST_PATCHED_VERSION_IDENTIFIER,
    CVE_ALERT_PROPS_VULNERABLE_VERSION_RANGE,
    DIST_TYPE: undefined,
    ENV: undefined,
    LOCK_EXT,
    MODULE_SYNC,
    NPM_REGISTRY_URL,
    NPX,
    PNPM,
    REQUIRE,
    SOCKET_CLI_DEBUG,
    SOCKET_CLI_FIX,
    SOCKET_CLI_ISSUES_URL,
    SOCKET_CLI_OPTIMIZE,
    SOCKET_CLI_SAFE_WRAPPER,
    VLT,
    YARN,
    YARN_BERRY,
    YARN_CLASSIC,
    cdxgenBinPath: undefined,
    distPath: undefined,
    instrumentWithSentryPath: undefined,
    nmBinPath: undefined,
    rootBinPath: undefined,
    rootDistPath: undefined,
    rootPath: undefined,
    rootPkgJsonPath: undefined,
    shadowBinPath: undefined,
    synpBinPath: undefined
  },
  {
    getters: {
      BATCH_PURL_ENDPOINT: LAZY_BATCH_PURL_ENDPOINT,
      DIST_TYPE: LAZY_DIST_TYPE,
      ENV: LAZY_ENV,
      distPath: lazyDistPath,
      cdxgenBinPath: lazyCdxgenBinPath,
      instrumentWithSentryPath: lazyInstrumentWithSentryPath,
      nmBinPath: lazyNmBinPath,
      rootBinPath: lazyRootBinPath,
      rootDistPath: lazyRootDistPath,
      rootPath: lazyRootPath,
      rootPkgJsonPath: lazyRootPkgJsonPath,
      shadowBinPath: lazyShadowBinPath,
      synpBinPath: lazySynpBinPath
    },
    internals: {
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
)

export default constants
