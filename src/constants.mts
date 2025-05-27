import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import registryConstants from '@socketsecurity/registry/lib/constants'

import type { Agent } from './utils/package-environment.mts'
import type { Remap } from '@socketsecurity/registry/lib/objects'

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const {
  kInternalsSymbol,
  [kInternalsSymbol as unknown as 'Symbol(kInternalsSymbol)']: {
    attributes: registryConstantsAttribs,
    createConstantsObject,
    getIpc,
  },
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
          key?: K | undefined,
        ): Promise<K extends keyof IPC ? IPC[K] : IPC>
      }
      getSentry: () => Sentry
      setSentry(Sentry: Sentry): boolean
    }>
>

type ENV = Remap<
  RegistryEnv &
    Readonly<{
      DISABLE_GITHUB_CACHE: boolean
      GITHUB_ACTIONS: boolean
      GITHUB_REF_NAME: string
      GITHUB_REF_TYPE: string
      GITHUB_REPOSITORY: string
      GITHUB_TOKEN: string
      INLINED_CYCLONEDX_CDXGEN_VERSION: string
      INLINED_SOCKET_CLI_HOMEPAGE: string
      INLINED_SOCKET_CLI_LEGACY_BUILD: string
      INLINED_SOCKET_CLI_NAME: string
      INLINED_SOCKET_CLI_PUBLISHED_BUILD: string
      INLINED_SOCKET_CLI_SENTRY_BUILD: string
      INLINED_SOCKET_CLI_VERSION: string
      INLINED_SOCKET_CLI_VERSION_HASH: string
      INLINED_SYNP_VERSION: string
      LOCALAPPDATA: string
      NODE_COMPILE_CACHE: string
      PATH: string
      SOCKET_CLI_ACCEPT_RISKS: boolean
      SOCKET_CLI_API_BASE_URL: string
      SOCKET_CLI_API_PROXY: string
      SOCKET_CLI_API_TOKEN: string
      SOCKET_CLI_CONFIG: string
      SOCKET_CLI_DEBUG: boolean
      SOCKET_CLI_GIT_USER_EMAIL: string
      SOCKET_CLI_GIT_USER_NAME: string
      SOCKET_CLI_GITHUB_TOKEN: string
      SOCKET_CLI_NO_API_TOKEN: boolean
      SOCKET_CLI_VIEW_ALL_RISKS: boolean
      TERM: string
      XDG_DATA_HOME: string
    }>
>

type IPC = Readonly<{
  SOCKET_CLI_FIX?: string | undefined
  SOCKET_CLI_OPTIMIZE?: boolean | undefined
  SOCKET_CLI_SAFE_BIN?: string | undefined
  SOCKET_CLI_SAFE_PROGRESS?: boolean | undefined
}>

type Constants = Remap<
  Omit<typeof registryConstants, 'Symbol(kInternalsSymbol)' | 'ENV' | 'IPC'> & {
    readonly 'Symbol(kInternalsSymbol)': Internals
    readonly ALERT_TYPE_CRITICAL_CVE: 'criticalCVE'
    readonly ALERT_TYPE_CVE: 'cve'
    readonly ALERT_TYPE_MEDIUM_CVE: 'mediumCVE'
    readonly ALERT_TYPE_MILD_CVE: 'mildCVE'
    readonly API_V0_URL: 'https://api.socket.dev/v0/'
    readonly BINARY_LOCK_EXT: '.lockb'
    readonly BUN: 'bun'
    readonly ENV: ENV
    readonly DRY_RUN_LABEL: '[DryRun]'
    readonly DRY_RUN_BAILING_NOW: '[DryRun] Bailing now'
    readonly DRY_RUN_NOT_SAVING: '[DryRun] Not saving'
    readonly IPC: IPC
    readonly LOCK_EXT: '.lock'
    readonly NPM_BUGGY_OVERRIDES_PATCHED_VERSION: '11.2.0'
    readonly NPM_REGISTRY_URL: 'https://registry.npmjs.org'
    readonly PNPM: 'pnpm'
    readonly REDACTED: '<redacted>'
    readonly SHADOW_BIN: 'shadow-bin'
    readonly SHADOW_INJECT: 'shadow-inject'
    readonly SOCKET: 'socket'
    readonly SOCKET_CLI_ACCEPT_RISKS: 'SOCKET_CLI_ACCEPT_RISKS'
    readonly SOCKET_CLI_BIN_NAME: 'socket'
    readonly SOCKET_CLI_BIN_NAME_ALIAS: 'cli'
    readonly SOCKET_CLI_CONFIG: 'SOCKET_CLI_CONFIG'
    readonly SOCKET_CLI_FIX: 'SOCKET_CLI_FIX'
    readonly SOCKET_CLI_ISSUES_URL: 'https://github.com/SocketDev/socket-cli/issues'
    readonly SOCKET_CLI_SENTRY_BIN_NAME_ALIAS: 'cli-with-sentry'
    readonly SOCKET_CLI_LEGACY_PACKAGE_NAME: '@socketsecurity/cli'
    readonly SOCKET_CLI_NPM_BIN_NAME: 'socket-npm'
    readonly SOCKET_CLI_NPX_BIN_NAME: 'socket-npx'
    readonly SOCKET_CLI_OPTIMIZE: 'SOCKET_CLI_OPTIMIZE'
    readonly SOCKET_CLI_PACKAGE_NAME: 'socket'
    readonly SOCKET_CLI_SAFE_BIN: 'SOCKET_CLI_SAFE_BIN'
    readonly SOCKET_CLI_SAFE_PROGRESS: 'SOCKET_CLI_SAFE_PROGRESS'
    readonly SOCKET_CLI_SENTRY_BIN_NAME: 'socket-with-sentry'
    readonly SOCKET_CLI_SENTRY_NPM_BIN_NAME: 'socket-npm-with-sentry'
    readonly SOCKET_CLI_SENTRY_NPX_BIN_NAME: 'socket-npx-with-sentry'
    readonly SOCKET_CLI_SENTRY_PACKAGE_NAME: '@socketsecurity/cli-with-sentry'
    readonly SOCKET_CLI_VIEW_ALL_RISKS: 'SOCKET_CLI_VIEW_ALL_RISKS'
    readonly SOCKET_WEBSITE_URL: 'https://socket.dev'
    readonly VLT: 'vlt'
    readonly WITH_SENTRY: 'with-sentry'
    readonly YARN: 'yarn'
    readonly YARN_BERRY: 'yarn/berry'
    readonly YARN_CLASSIC: 'yarn/classic'
    readonly YARN_LOCK: 'yarn.lock'
    readonly bashRcPath: string
    readonly binCliPath: string
    readonly binPath: string
    readonly blessedOptions: {
      smartCSR: boolean
      term: string
      useBCE: boolean
    }
    readonly distCliPath: string
    readonly distInstrumentWithSentryPath: string
    readonly distPath: string
    readonly distShadowBinPath: string
    readonly distShadowInjectPath: string
    readonly githubCachePath: string
    readonly homePath: string
    readonly minimumVersionByAgent: Map<Agent, string>
    readonly nmBinPath: string
    readonly nodeHardenFlags: string[]
    readonly rootPath: string
    readonly shadowBinPath: string
    readonly socketAppDataPath: string
    readonly socketCachePath: string
    readonly zshRcPath: string
  }
>

const ALERT_TYPE_CRITICAL_CVE = 'criticalCVE'
const ALERT_TYPE_CVE = 'cve'
const ALERT_TYPE_MEDIUM_CVE = 'mediumCVE'
const ALERT_TYPE_MILD_CVE = 'mildCVE'
const API_V0_URL = 'https://api.socket.dev/v0/'
const BINARY_LOCK_EXT = '.lockb'
const BUN = 'bun'
const DRY_RUN_LABEL = '[DryRun]'
const DRY_RUN_BAILING_NOW = `${DRY_RUN_LABEL}: Bailing now`
const DRY_RUN_NOT_SAVING = `${DRY_RUN_LABEL}: Not saving`
const LOCALAPPDATA = 'LOCALAPPDATA'
const LOCK_EXT = '.lock'
const NPM_BUGGY_OVERRIDES_PATCHED_VERSION = '11.2.0'
const NPM_REGISTRY_URL = 'https://registry.npmjs.org'
const PNPM = 'pnpm'
const REDACTED = '<redacted>'
const SHADOW_BIN = 'shadow-bin'
const SHADOW_INJECT = 'shadow-inject'
const SOCKET = 'socket'
const SOCKET_CLI_ACCEPT_RISKS = 'SOCKET_CLI_ACCEPT_RISKS'
const SOCKET_CLI_BIN_NAME = 'socket'
const SOCKET_CLI_BIN_NAME_ALIAS = 'cli'
const SOCKET_CLI_FIX = 'SOCKET_CLI_FIX'
const SOCKET_CLI_ISSUES_URL = 'https://github.com/SocketDev/socket-cli/issues'
const SOCKET_CLI_LEGACY_PACKAGE_NAME = '@socketsecurity/cli'
const SOCKET_CLI_OPTIMIZE = 'SOCKET_CLI_OPTIMIZE'
const SOCKET_CLI_NPM_BIN_NAME = 'socket-npm'
const SOCKET_CLI_NPX_BIN_NAME = 'socket-npx'
const SOCKET_CLI_PACKAGE_NAME = 'socket'
const SOCKET_CLI_SAFE_BIN = 'SOCKET_CLI_SAFE_BIN'
const SOCKET_CLI_SAFE_PROGRESS = 'SOCKET_CLI_SAFE_PROGRESS'
const SOCKET_CLI_SENTRY_BIN_NAME = 'socket-with-sentry'
const SOCKET_CLI_SENTRY_BIN_NAME_ALIAS = 'cli-with-sentry'
const SOCKET_CLI_SENTRY_NPM_BIN_NAME = 'socket-npm-with-sentry'
const SOCKET_CLI_SENTRY_NPX_BIN_NAME = 'socket-npx-with-sentry'
const SOCKET_CLI_SENTRY_PACKAGE_NAME = '@socketsecurity/cli-with-sentry'
const SOCKET_CLI_VIEW_ALL_RISKS = 'SOCKET_CLI_VIEW_ALL_RISKS'
const SOCKET_WEBSITE_URL = 'https://socket.dev'
const VLT = 'vlt'
const WITH_SENTRY = 'with-sentry'
const YARN = 'yarn'
const YARN_BERRY = 'yarn/berry'
const YARN_CLASSIC = 'yarn/classic'
const YARN_LOCK = 'yarn.lock'

let _Sentry: any

const LAZY_ENV = () => {
  const {
    envAsBoolean,
    envAsString,
  } = require('@socketsecurity/registry/lib/env')
  const { env } = process
  const GITHUB_TOKEN = envAsString(env['GITHUB_TOKEN'])
  // We inline some environment values so that they CANNOT be influenced by user
  // provided environment variables.
  return Object.freeze({
    __proto__: null,
    // Lazily access registryConstants.ENV.
    ...registryConstants.ENV,
    // Flag to disable using GitHub's workflow actions/cache.
    // https://github.com/actions/cache
    DISABLE_GITHUB_CACHE: envAsBoolean(env['DISABLE_GITHUB_CACHE']),
    // Always set to true when GitHub Actions is running the workflow. This variable
    // can be used to differentiate when tests are being run locally or by GitHub Actions.
    // https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/store-information-in-variables#default-environment-variables
    GITHUB_ACTIONS: envAsBoolean(env['GITHUB_ACTIONS']),
    // The short ref name of the branch or tag that triggered the GitHub workflow
    // run. This value matches the branch or tag name shown on GitHub. For example,
    // feature-branch-1. For pull requests, the format is <pr_number>/merge.
    // https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/store-information-in-variables#default-environment-variables
    GITHUB_REF_NAME: envAsString(env['GITHUB_REF_NAME']),
    // The type of ref that triggered the workflow run. Valid values are branch or tag.
    // https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/store-information-in-variables#default-environment-variables
    GITHUB_REF_TYPE: envAsString(env['GITHUB_REF_TYPE']),
    // The owner and repository name. For example, octocat/Hello-World.
    // https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/store-information-in-variables#default-environment-variables
    GITHUB_REPOSITORY: envAsString(env['GITHUB_REPOSITORY']),
    // The GITHUB_TOKEN secret is a GitHub App installation access token.
    // The token's permissions are limited to the repository that contains the
    // workflow.
    // https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication#about-the-github_token-secret
    GITHUB_TOKEN,
    // Comp-time inlined @cyclonedx/cdxgen package version.
    // The '@rollup/plugin-replace' will replace "process.env['INLINED_CYCLONEDX_CDXGEN_VERSION']".
    INLINED_CYCLONEDX_CDXGEN_VERSION: envAsString(
      process.env['INLINED_CYCLONEDX_CDXGEN_VERSION'],
    ),
    // Comp-time inlined Socket package homepage.
    // The '@rollup/plugin-replace' will replace "process.env['INLINED_SOCKET_CLI_HOMEPAGE']".
    INLINED_SOCKET_CLI_HOMEPAGE: envAsString(
      process.env['INLINED_SOCKET_CLI_HOMEPAGE'],
    ),
    // Comp-time inlined flag to determine if this is the Legacy build.
    // The '@rollup/plugin-replace' will replace "process.env['INLINED_SOCKET_CLI_LEGACY_BUILD']".
    INLINED_SOCKET_CLI_LEGACY_BUILD: envAsBoolean(
      process.env['INLINED_SOCKET_CLI_LEGACY_BUILD'],
    ),
    // Comp-time inlined Socket package name.
    // The '@rollup/plugin-replace' will replace "process.env['INLINED_SOCKET_CLI_NAME']".
    INLINED_SOCKET_CLI_NAME: envAsString(
      process.env['INLINED_SOCKET_CLI_NAME'],
    ),
    // Comp-time inlined flag to determine if this is a published build.
    // The '@rollup/plugin-replace' will replace "process.env['INLINED_SOCKET_CLI_PUBLISHED_BUILD']".
    INLINED_SOCKET_CLI_PUBLISHED_BUILD: envAsBoolean(
      process.env['INLINED_SOCKET_CLI_PUBLISHED_BUILD'],
    ),
    // Comp-time inlined flag to determine if this is the Sentry build.
    // The '@rollup/plugin-replace' will replace "process.env['INLINED_SOCKET_CLI_SENTRY_BUILD']".
    INLINED_SOCKET_CLI_SENTRY_BUILD: envAsBoolean(
      process.env['INLINED_SOCKET_CLI_SENTRY_BUILD'],
    ),
    // Comp-time inlined Socket package version.
    // The '@rollup/plugin-replace' will replace "process.env['INLINED_SOCKET_CLI_VERSION']".
    INLINED_SOCKET_CLI_VERSION: envAsString(
      process.env['INLINED_SOCKET_CLI_VERSION'],
    ),
    // Comp-time inlined Socket package version hash.
    // The '@rollup/plugin-replace' will replace "process.env['INLINED_SOCKET_CLI_VERSION_HASH']".
    INLINED_SOCKET_CLI_VERSION_HASH: envAsString(
      process.env['INLINED_SOCKET_CLI_VERSION_HASH'],
    ),
    // Comp-time inlined synp package version.
    // The '@rollup/plugin-replace' will replace "process.env['INLINED_SYNP_VERSION']".
    INLINED_SYNP_VERSION: envAsString(process.env['INLINED_SYNP_VERSION']),
    // The location of the %localappdata% folder on Windows used to store user-specific,
    // non-roaming application data, like temporary files, cached data, and program
    // settings, that are specific to the current machine and user.
    LOCALAPPDATA: envAsString(env[LOCALAPPDATA]),
    // Flag to enable the module compile cache for the Node.js instance.
    // https://nodejs.org/api/cli.html#node_compile_cachedir
    NODE_COMPILE_CACHE:
      // Lazily access constants.SUPPORTS_NODE_COMPILE_CACHE_ENV_VAR.
      constants.SUPPORTS_NODE_COMPILE_CACHE_ENV_VAR
        ? // Lazily access constants.socketCachePath.
          constants.socketCachePath
        : '',
    // PATH is an environment variable that lists directories where executable
    // programs are located. When a command is run, the system searches these
    // directories to find the executable.
    PATH: envAsString(env['PATH']),
    // Flag to accepts risks of safe-npm and safe-npx run.
    SOCKET_CLI_ACCEPT_RISKS: envAsBoolean(env[SOCKET_CLI_ACCEPT_RISKS]),
    // Flag to change the base URL for all API-calls.
    // https://github.com/SocketDev/socket-cli?tab=readme-ov-file#environment-variables-for-development
    SOCKET_CLI_API_BASE_URL:
      envAsString(env['SOCKET_CLI_API_BASE_URL']) ||
      envAsString(env['SOCKET_SECURITY_API_BASE_URL']),
    // Flag to set the proxy all requests are routed through.
    // https://github.com/SocketDev/socket-cli?tab=readme-ov-file#environment-variables-for-development
    SOCKET_CLI_API_PROXY:
      envAsString(env['SOCKET_CLI_API_PROXY']) ||
      envAsString(env['SOCKET_SECURITY_API_PROXY']),
    // Flag to set the API token.
    // https://github.com/SocketDev/socket-cli?tab=readme-ov-file#environment-variables
    SOCKET_CLI_API_TOKEN:
      envAsString(env['SOCKET_CLI_API_TOKEN']) ||
      envAsString(env['SOCKET_CLI_API_KEY']) ||
      envAsString(env['SOCKET_SECURITY_API_TOKEN']) ||
      envAsString(env['SOCKET_SECURITY_API_KEY']),
    // Flag containing a JSON stringified Socket configuration object.
    SOCKET_CLI_CONFIG: envAsString(env['SOCKET_CLI_CONFIG']),
    // Flag to help debug Socket CLI.
    SOCKET_CLI_DEBUG: envAsBoolean(env['SOCKET_CLI_DEBUG']),
    // The git config user.email used by Socket CLI.
    SOCKET_CLI_GIT_USER_EMAIL:
      envAsString(env['SOCKET_CLI_GIT_USER_EMAIL']) ||
      `github-actions[bot]@users.noreply.github.com`,
    // The git config user.name used by Socket CLI.
    SOCKET_CLI_GIT_USER_NAME:
      envAsString(env['SOCKET_CLI_GIT_USER_NAME']) ||
      envAsString(env['SOCKET_CLI_GIT_USERNAME']) ||
      'github-actions[bot]',
    // A classic GitHub personal access token with the "repo" scope or a
    // fine-grained access token with at least read/write permissions set for
    // "Contents" and "Pull Request".
    // https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
    SOCKET_CLI_GITHUB_TOKEN:
      envAsString(env['SOCKET_CLI_GITHUB_TOKEN']) ||
      envAsString(env['SOCKET_SECURITY_GITHUB_PAT']) ||
      GITHUB_TOKEN,
    // Flag to make the default API token `undefined`.
    SOCKET_CLI_NO_API_TOKEN: envAsBoolean(env['SOCKET_CLI_NO_API_TOKEN']),
    // Flag to view all risks of safe-npm and safe-npx run.
    SOCKET_CLI_VIEW_ALL_RISKS: envAsBoolean(env[SOCKET_CLI_VIEW_ALL_RISKS]),
    // Specifies the type of terminal or terminal emulator being used by the process.
    TERM: envAsString(env['TERM']),
    // The location of the base directory on Linux and MacOS used to store
    // user-specific data files, defaulting to $HOME/.local/share if not set or empty.
    XDG_DATA_HOME: envAsString(env['XDG_DATA_HOME']),
  })
}

const lazyBashRcPath = () =>
  // Lazily access constants.homePath.
  path.join(constants.homePath, '.bashrc')

const lazyBinPath = () =>
  // Lazily access constants.rootPath.
  path.join(constants.rootPath, 'bin')

const lazyBinCliPath = () =>
  // Lazily access constants.binPath.
  path.join(constants.binPath, 'cli.js')

const lazyBlessedOptions = () =>
  Object.freeze({
    smartCSR: true,
    // Lazily access constants.WIN32.
    term: constants.WIN32 ? 'windows-ansi' : 'xterm',
    useBCE: true,
  })

const lazyDistPath = () =>
  // Lazily access constants.rootPath.
  path.join(constants.rootPath, 'dist')

const lazyDistCliPath = () =>
  // Lazily access constants.distPath.
  path.join(constants.distPath, 'cli.js')

const lazyDistInstrumentWithSentryPath = () =>
  // Lazily access constants.distPath.
  path.join(constants.distPath, 'instrument-with-sentry.js')

const lazyDistShadowBinPath = () =>
  // Lazily access constants.distPath.
  path.join(constants.distPath, `${SHADOW_BIN}.js`)

const lazyDistShadowInjectPath = () =>
  // Lazily access constants.distPath.
  path.join(constants.distPath, `${SHADOW_INJECT}.js`)

const lazyGithubCachePath = () =>
  // Lazily access constants.socketCachePath.
  path.join(constants.socketCachePath, 'github')

const lazyHomePath = () => os.homedir()

const lazyMinimumVersionByAgent = () =>
  new Map([
    // Bun >=1.1.39 supports the text-based lockfile.
    // https://bun.sh/blog/bun-lock-text-lockfile
    [BUN, '1.1.39'],
    // The npm version bundled with Node 18.
    // https://nodejs.org/en/about/previous-releases#looking-for-the-latest-release-of-a-version-branch
    ['npm', '10.8.2'],
    // 8.x is the earliest version to support Node 18.
    // https://pnpm.io/installation#compatibility
    // https://www.npmjs.com/package/pnpm?activeTab=versions
    [PNPM, '8.15.7'],
    // 4.x supports >= Node 18.12.0
    // https://github.com/yarnpkg/berry/blob/%40yarnpkg/core/4.1.0/CHANGELOG.md#400
    [YARN_BERRY, '4.0.0'],
    // Latest 1.x.
    // https://www.npmjs.com/package/yarn?activeTab=versions
    [YARN_CLASSIC, '1.22.22'],
    // vlt does not support overrides so we don't gate on it.
    [VLT, '*'],
  ])

const lazyNmBinPath = () =>
  // Lazily access constants.rootPath.
  path.join(constants.rootPath, 'node_modules/.bin')

// Redefine registryConstants.nodeHardenFlags to account for the
// INLINED_SOCKET_CLI_SENTRY_BUILD environment variable.
const lazyNodeHardenFlags = () =>
  Object.freeze(
    // Lazily access constants.ENV.INLINED_SOCKET_CLI_SENTRY_BUILD.
    constants.ENV.INLINED_SOCKET_CLI_SENTRY_BUILD ||
      // Lazily access constants.WIN32.
      constants.WIN32
      ? []
      : // Harden Node security.
        // https://nodejs.org/en/learn/getting-started/security-best-practices
        [
          '--disable-proto',
          'throw',
          // We have contributed the following patches to our dependencies to make
          // Node's --frozen-intrinsics workable.
          // √ https://github.com/SBoudrias/Inquirer.js/pull/1683
          // √ https://github.com/pnpm/components/pull/23
          '--frozen-intrinsics',
          '--no-deprecation',
        ],
  )

const lazyRootPath = () => path.join(realpathSync.native(__dirname), '..')

const lazySocketAppDataPath = (): string | undefined => {
  // Get the OS app data folder:
  // - Win: %LOCALAPPDATA% or fail?
  // - Mac: %XDG_DATA_HOME% or fallback to "~/Library/Application Support/"
  // - Linux: %XDG_DATA_HOME% or fallback to "~/.local/share/"
  // Note: LOCALAPPDATA is typically: C:\Users\USERNAME\AppData
  // Note: XDG stands for "X Desktop Group", nowadays "freedesktop.org"
  //       On most systems that path is: $HOME/.local/share
  // Then append `socket/settings`, so:
  // - Win: %LOCALAPPDATA%\socket\settings or return undefined
  // - Mac: %XDG_DATA_HOME%/socket/settings or "~/Library/Application Support/socket/settings"
  // - Linux: %XDG_DATA_HOME%/socket/settings or "~/.local/share/socket/settings"

  // Lazily access constants.WIN32.
  const { WIN32 } = constants
  let dataHome: string | undefined = WIN32
    ? // Lazily access constants.ENV.LOCALAPPDATA
      constants.ENV.LOCALAPPDATA
    : // Lazily access constants.ENV.XDG_DATA_HOME
      constants.ENV.XDG_DATA_HOME
  if (!dataHome) {
    if (WIN32) {
      const logger = require('@socketsecurity/registry/lib/logger')
      logger.warn(`Missing %${LOCALAPPDATA}%`)
    } else {
      dataHome = path.join(
        // Lazily access constants.homePath.
        constants.homePath,
        // Lazily access constants.DARWIN.
        constants.DARWIN ? 'Library/Application Support' : '.local/share',
      )
    }
  }
  return dataHome ? path.join(dataHome, 'socket/settings') : undefined
}

const lazySocketCachePath = () =>
  // Lazily access constants.rootPath.
  path.join(constants.rootPath, '.cache')

const lazyShadowBinPath = () =>
  // Lazily access constants.rootPath.
  path.join(constants.rootPath, SHADOW_BIN)

const lazyZshRcPath = () =>
  // Lazily access constants.homePath.
  path.join(constants.homePath, '.zshrc')

const constants: Constants = createConstantsObject(
  {
    ...registryConstantsAttribs.props,
    ALERT_TYPE_CRITICAL_CVE,
    ALERT_TYPE_CVE,
    ALERT_TYPE_MEDIUM_CVE,
    ALERT_TYPE_MILD_CVE,
    API_V0_URL,
    BINARY_LOCK_EXT,
    BUN,
    DRY_RUN_LABEL,
    DRY_RUN_BAILING_NOW,
    DRY_RUN_NOT_SAVING,
    ENV: undefined,
    LOCK_EXT,
    NPM_BUGGY_OVERRIDES_PATCHED_VERSION,
    NPM_REGISTRY_URL,
    PNPM,
    REDACTED,
    SHADOW_BIN,
    SHADOW_INJECT,
    SOCKET,
    SOCKET_CLI_ACCEPT_RISKS,
    SOCKET_CLI_BIN_NAME,
    SOCKET_CLI_BIN_NAME_ALIAS,
    SOCKET_CLI_FIX,
    SOCKET_CLI_ISSUES_URL,
    SOCKET_CLI_SENTRY_BIN_NAME_ALIAS,
    SOCKET_CLI_LEGACY_PACKAGE_NAME,
    SOCKET_CLI_NPM_BIN_NAME,
    SOCKET_CLI_NPX_BIN_NAME,
    SOCKET_CLI_OPTIMIZE,
    SOCKET_CLI_PACKAGE_NAME,
    SOCKET_CLI_SAFE_BIN,
    SOCKET_CLI_SAFE_PROGRESS,
    SOCKET_CLI_SENTRY_BIN_NAME,
    SOCKET_CLI_SENTRY_NPM_BIN_NAME,
    SOCKET_CLI_SENTRY_NPX_BIN_NAME,
    SOCKET_CLI_SENTRY_PACKAGE_NAME,
    SOCKET_CLI_VIEW_ALL_RISKS,
    SOCKET_WEBSITE_URL,
    VLT,
    WITH_SENTRY,
    YARN,
    YARN_BERRY,
    YARN_CLASSIC,
    YARN_LOCK,
    bashRcPath: undefined,
    binPath: undefined,
    binCliPath: undefined,
    blessedOptions: undefined,
    distCliPath: undefined,
    distInstrumentWithSentryPath: undefined,
    distPath: undefined,
    distShadowBinPath: undefined,
    distShadowInjectPath: undefined,
    githubCachePath: undefined,
    homePath: undefined,
    minimumVersionByAgent: undefined,
    nmBinPath: undefined,
    nodeHardenFlags: undefined,
    rootPath: undefined,
    shadowBinPath: undefined,
    socketAppDataPath: undefined,
    socketCachePath: undefined,
    zshRcPath: undefined,
  },
  {
    getters: {
      ...registryConstantsAttribs.getters,
      ENV: LAZY_ENV,
      bashRcPath: lazyBashRcPath,
      binCliPath: lazyBinCliPath,
      binPath: lazyBinPath,
      blessedOptions: lazyBlessedOptions,
      distCliPath: lazyDistCliPath,
      distInstrumentWithSentryPath: lazyDistInstrumentWithSentryPath,
      distPath: lazyDistPath,
      distShadowBinPath: lazyDistShadowBinPath,
      distShadowInjectPath: lazyDistShadowInjectPath,
      githubCachePath: lazyGithubCachePath,
      homePath: lazyHomePath,
      minimumVersionByAgent: lazyMinimumVersionByAgent,
      nmBinPath: lazyNmBinPath,
      nodeHardenFlags: lazyNodeHardenFlags,
      rootPath: lazyRootPath,
      shadowBinPath: lazyShadowBinPath,
      socketAppDataPath: lazySocketAppDataPath,
      socketCachePath: lazySocketCachePath,
      zshRcPath: lazyZshRcPath,
    },
    internals: {
      ...registryConstantsAttribs.internals,
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
      },
    },
  },
) as Constants

export default constants
