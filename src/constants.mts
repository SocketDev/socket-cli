import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import registryConstants from '@socketsecurity/registry/lib/constants'

import type { Agent } from './utils/package-environment.mts'
import type { Remap } from '@socketsecurity/registry/lib/objects'
import type { SpawnOptions } from '@socketsecurity/registry/lib/spawn'

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
// Using `path.dirname(__filename)` to resolve `__dirname` works for both 'dist'
// AND 'src' directories because constants.js and constants.mts respectively are
// in the root of each.
const __dirname = path.dirname(__filename)

const {
  AT_LATEST,
  BIOME_JSON,
  CI,
  COLUMN_LIMIT,
  EMPTY_FILE,
  ESLINT_CONFIG_JS,
  ESNEXT,
  EXT_CJS,
  EXT_CMD,
  EXT_CTS,
  EXT_DTS,
  EXT_JS,
  EXT_JSON,
  EXT_LOCK,
  EXT_LOCKB,
  EXT_MD,
  EXT_MJS,
  EXT_MTS,
  EXT_PS1,
  EXTENSIONS,
  EXTENSIONS_JSON,
  GITIGNORE,
  HIDDEN_PACKAGE_LOCK_JSON,
  LATEST,
  LICENSE,
  LICENSE_GLOB,
  LICENSE_GLOB_RECURSIVE,
  LICENSE_ORIGINAL,
  LICENSE_ORIGINAL_GLOB,
  LICENSE_ORIGINAL_GLOB_RECURSIVE,
  LOOP_SENTINEL,
  MANIFEST_JSON,
  MIT,
  NODE_AUTH_TOKEN,
  NODE_ENV,
  NODE_MODULES,
  NODE_MODULES_GLOB_RECURSIVE,
  NODE_WORKSPACES,
  NPM,
  NPX,
  OVERRIDES,
  PACKAGE_DEFAULT_VERSION,
  PACKAGE_JSON,
  PACKAGE_LOCK_JSON,
  PNPM,
  PRE_COMMIT,
  README_GLOB,
  README_GLOB_RECURSIVE,
  REGISTRY_SCOPE_DELIMITER,
  README_MD,
  REGISTRY,
  RESOLUTIONS,
  SOCKET_GITHUB_ORG,
  SOCKET_IPC_HANDSHAKE,
  SOCKET_OVERRIDE_SCOPE,
  SOCKET_PUBLIC_API_TOKEN,
  SOCKET_REGISTRY_NPM_ORG,
  SOCKET_REGISTRY_PACKAGE_NAME,
  SOCKET_REGISTRY_REPO_NAME,
  SOCKET_REGISTRY_SCOPE,
  SOCKET_SECURITY_SCOPE,
  UNLICENCED,
  UNLICENSED,
  UTF8,
  VITEST,
  YARN_LOCK,
  kInternalsSymbol,
  [kInternalsSymbol as unknown as 'Symbol(kInternalsSymbol)']: {
    attributes: registryConstantsAttribs,
    createConstantsObject,
    getIpc,
  },
} = registryConstants

export type RegistryEnv = typeof registryConstants.ENV

export type RegistryInternals =
  (typeof registryConstants)['Symbol(kInternalsSymbol)']

export type Sentry = any

export type Internals = Remap<
  Omit<RegistryInternals, 'getIpc'> &
    Readonly<{
      getIpc: {
        (): Promise<IpcObject>
        <K extends keyof IpcObject | undefined>(
          key?: K | undefined,
        ): Promise<K extends keyof IpcObject ? IpcObject[K] : IpcObject>
      }
      getSentry: () => Sentry
      setSentry(Sentry: Sentry): boolean
    }>
>

export type ENV = Remap<
  RegistryEnv &
    Readonly<{
      DISABLE_GITHUB_CACHE: boolean
      GITHUB_API_URL: string
      GITHUB_BASE_REF: string
      GITHUB_REF_NAME: string
      GITHUB_REF_TYPE: string
      GITHUB_REPOSITORY: string
      GITHUB_SERVER_URL: string
      GITHUB_TOKEN: string
      INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION: string
      INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION: string
      INLINED_SOCKET_CLI_HOMEPAGE: string
      INLINED_SOCKET_CLI_LEGACY_BUILD: string
      INLINED_SOCKET_CLI_NAME: string
      INLINED_SOCKET_CLI_PUBLISHED_BUILD: string
      INLINED_SOCKET_CLI_SENTRY_BUILD: string
      INLINED_SOCKET_CLI_VERSION: string
      INLINED_SOCKET_CLI_VERSION_HASH: string
      INLINED_SOCKET_CLI_SYNP_VERSION: string
      LOCALAPPDATA: string
      NODE_COMPILE_CACHE: string
      NODE_EXTRA_CA_CERTS: string
      PATH: string
      SOCKET_CLI_ACCEPT_RISKS: boolean
      SOCKET_CLI_API_BASE_URL: string
      SOCKET_CLI_API_PROXY: string
      SOCKET_CLI_API_TIMEOUT: number
      SOCKET_CLI_API_TOKEN: string
      SOCKET_CLI_CONFIG: string
      SOCKET_CLI_GIT_USER_EMAIL: string
      SOCKET_CLI_GIT_USER_NAME: string
      SOCKET_CLI_GITHUB_TOKEN: string
      SOCKET_CLI_NO_API_TOKEN: boolean
      SOCKET_CLI_NPM_PATH: string
      SOCKET_CLI_ORG_SLUG: string
      SOCKET_CLI_VIEW_ALL_RISKS: boolean
      TERM: string
      XDG_DATA_HOME: string
    }>
>

export type IpcObject = Readonly<{
  SOCKET_CLI_FIX?: string | undefined
  SOCKET_CLI_OPTIMIZE?: boolean | undefined
  SOCKET_CLI_SHADOW_ACCEPT_RISKS?: boolean | undefined
  SOCKET_CLI_SHADOW_API_TOKEN?: string | undefined
  SOCKET_CLI_SHADOW_BIN?: string | undefined
  SOCKET_CLI_SHADOW_PROGRESS?: boolean | undefined
  SOCKET_CLI_SHADOW_SILENT?: boolean | undefined
}>

export type ProcessEnv = {
  [K in keyof ENV]?: string
}

const ALERT_TYPE_CRITICAL_CVE = 'criticalCVE'
const ALERT_TYPE_CVE = 'cve'
const ALERT_TYPE_MEDIUM_CVE = 'mediumCVE'
const ALERT_TYPE_MILD_CVE = 'mildCVE'
const API_V0_URL = 'https://api.socket.dev/v0/'
const BUN = 'bun'
const DOT_SOCKET = '.socket'
const DOT_SOCKET_DOT_FACTS_JSON = `${DOT_SOCKET}.facts.json`
const DRY_RUN_LABEL = '[DryRun]'
const DRY_RUN_BAILING_NOW = `${DRY_RUN_LABEL}: Bailing now`
const DRY_RUN_NOT_SAVING = `${DRY_RUN_LABEL}: Not saving`
const EMPTY_VALUE = '<empty>'
const ENVIRONMENT_YAML = 'environment.yaml'
const ENVIRONMENT_YML = 'environment.yml'
const FOLD_SETTING_FILE = 'file'
const FOLD_SETTING_NONE = 'none'
const FOLD_SETTING_PKG = 'pkg'
const FOLD_SETTING_VERSION = 'version'
const GQL_PAGE_SENTINEL = 100
const GQL_PR_STATE_CLOSED = 'CLOSED'
const GQL_PR_STATE_MERGED = 'MERGED'
const GQL_PR_STATE_OPEN = 'OPEN'
const LOCALAPPDATA = 'LOCALAPPDATA'
const NPM_BUGGY_OVERRIDES_PATCHED_VERSION = '11.2.0'
const NPM_REGISTRY_URL = 'https://registry.npmjs.org'
const OUTPUT_JSON = 'json'
const OUTPUT_MARKDOWN = 'markdown'
const OUTPUT_TEXT = 'text'
const PNPM_LOCK_YAML = 'pnpm-lock.yaml'
const REDACTED = '<redacted>'
const REPORT_LEVEL_DEFER = 'defer'
const REPORT_LEVEL_ERROR = 'error'
const REPORT_LEVEL_IGNORE = 'ignore'
const REPORT_LEVEL_MONITOR = 'monitor'
const REPORT_LEVEL_WARN = 'warn'
const REQUIREMENTS_TXT = 'requirements.txt'
const SOCKET_CLI_ACCEPT_RISKS = 'SOCKET_CLI_ACCEPT_RISKS'
const SOCKET_CLI_BIN_NAME = 'socket'
const SOCKET_CLI_ISSUES_URL = 'https://github.com/SocketDev/socket-cli/issues'
const SOCKET_CLI_SHADOW_ACCEPT_RISKS = 'SOCKET_CLI_SHADOW_ACCEPT_RISKS'
const SOCKET_CLI_SHADOW_API_TOKEN = 'SOCKET_CLI_SHADOW_API_TOKEN'
const SOCKET_CLI_SHADOW_BIN = 'SOCKET_CLI_SHADOW_BIN'
const SOCKET_CLI_SHADOW_PROGRESS = 'SOCKET_CLI_SHADOW_PROGRESS'
const SOCKET_CLI_SHADOW_SILENT = 'SOCKET_CLI_SHADOW_SILENT'
const SOCKET_CLI_VIEW_ALL_RISKS = 'SOCKET_CLI_VIEW_ALL_RISKS'
const SOCKET_DEFAULT_BRANCH = 'socket-default-branch'
const SOCKET_DEFAULT_REPOSITORY = 'socket-default-repository'
const SOCKET_JSON = 'socket.json'
const SOCKET_WEBSITE_URL = 'https://socket.dev'
const UNKNOWN_ERROR = 'Unknown error'
const UNKNOWN_VALUE = '<unknown>'
const V1_MIGRATION_GUIDE_URL = 'https://docs.socket.dev/docs/v1-migration-guide'
const VLT = 'vlt'
const YARN = 'yarn'
const YARN_BERRY = 'yarn/berry'
const YARN_CLASSIC = 'yarn/classic'

export type Constants = Remap<
  Omit<
    typeof registryConstants,
    'Symbol(kInternalsSymbol)' | 'ENV' | 'ipcObject'
  > & {
    readonly 'Symbol(kInternalsSymbol)': Internals
    readonly ALERT_TYPE_CRITICAL_CVE: typeof ALERT_TYPE_CRITICAL_CVE
    readonly ALERT_TYPE_CVE: typeof ALERT_TYPE_CVE
    readonly ALERT_TYPE_MEDIUM_CVE: typeof ALERT_TYPE_MEDIUM_CVE
    readonly ALERT_TYPE_MILD_CVE: typeof ALERT_TYPE_MILD_CVE
    readonly API_V0_URL: typeof API_V0_URL
    readonly BUN: typeof BUN
    readonly EMPTY_VALUE: typeof EMPTY_VALUE
    readonly ENV: ENV
    readonly DOT_SOCKET: typeof DOT_SOCKET
    readonly DOT_SOCKET_DOT_FACTS_JSON: typeof DOT_SOCKET_DOT_FACTS_JSON
    readonly DRY_RUN_LABEL: typeof DRY_RUN_LABEL
    readonly DRY_RUN_BAILING_NOW: typeof DRY_RUN_BAILING_NOW
    readonly DRY_RUN_NOT_SAVING: typeof DRY_RUN_NOT_SAVING
    readonly ENVIRONMENT_YAML: typeof ENVIRONMENT_YAML
    readonly ENVIRONMENT_YML: typeof ENVIRONMENT_YML
    readonly FOLD_SETTING_FILE: typeof FOLD_SETTING_FILE
    readonly FOLD_SETTING_NONE: typeof FOLD_SETTING_NONE
    readonly FOLD_SETTING_PKG: typeof FOLD_SETTING_PKG
    readonly FOLD_SETTING_VERSION: typeof FOLD_SETTING_VERSION
    readonly GQL_PAGE_SENTINEL: typeof GQL_PAGE_SENTINEL
    readonly GQL_PR_STATE_CLOSED: typeof GQL_PR_STATE_CLOSED
    readonly GQL_PR_STATE_MERGED: typeof GQL_PR_STATE_MERGED
    readonly GQL_PR_STATE_OPEN: typeof GQL_PR_STATE_OPEN
    readonly NODE_MODULES: typeof NODE_MODULES
    readonly NPM_BUGGY_OVERRIDES_PATCHED_VERSION: typeof NPM_BUGGY_OVERRIDES_PATCHED_VERSION
    readonly NPM_REGISTRY_URL: typeof NPM_REGISTRY_URL
    readonly NPM: typeof NPM
    readonly NPX: typeof NPX
    readonly OUTPUT_JSON: typeof OUTPUT_JSON
    readonly OUTPUT_MARKDOWN: typeof OUTPUT_MARKDOWN
    readonly OUTPUT_TEXT: typeof OUTPUT_TEXT
    readonly PACKAGE_JSON: typeof PACKAGE_JSON
    readonly PACKAGE_LOCK_JSON: typeof PACKAGE_LOCK_JSON
    readonly PNPM: typeof PNPM
    readonly PNPM_LOCK_YAML: typeof PNPM_LOCK_YAML
    readonly REDACTED: typeof REDACTED
    readonly REPORT_LEVEL_DEFER: typeof REPORT_LEVEL_DEFER
    readonly REPORT_LEVEL_ERROR: typeof REPORT_LEVEL_ERROR
    readonly REPORT_LEVEL_IGNORE: typeof REPORT_LEVEL_IGNORE
    readonly REPORT_LEVEL_MONITOR: typeof REPORT_LEVEL_MONITOR
    readonly REPORT_LEVEL_WARN: typeof REPORT_LEVEL_WARN
    readonly REQUIREMENTS_TXT: typeof REQUIREMENTS_TXT
    readonly SOCKET_CLI_ACCEPT_RISKS: typeof SOCKET_CLI_ACCEPT_RISKS
    readonly SOCKET_CLI_BIN_NAME: typeof SOCKET_CLI_BIN_NAME
    readonly SOCKET_CLI_ISSUES_URL: typeof SOCKET_CLI_ISSUES_URL
    readonly SOCKET_CLI_SHADOW_ACCEPT_RISKS: typeof SOCKET_CLI_SHADOW_ACCEPT_RISKS
    readonly SOCKET_CLI_SHADOW_API_TOKEN: typeof SOCKET_CLI_SHADOW_API_TOKEN
    readonly SOCKET_CLI_SHADOW_BIN: typeof SOCKET_CLI_SHADOW_BIN
    readonly SOCKET_CLI_SHADOW_PROGRESS: typeof SOCKET_CLI_SHADOW_PROGRESS
    readonly SOCKET_CLI_SHADOW_SILENT: typeof SOCKET_CLI_SHADOW_SILENT
    readonly SOCKET_CLI_VIEW_ALL_RISKS: typeof SOCKET_CLI_VIEW_ALL_RISKS
    readonly SOCKET_DEFAULT_BRANCH: typeof SOCKET_DEFAULT_BRANCH
    readonly SOCKET_DEFAULT_REPOSITORY: typeof SOCKET_DEFAULT_REPOSITORY
    readonly SOCKET_JSON: typeof SOCKET_JSON
    readonly SOCKET_WEBSITE_URL: typeof SOCKET_WEBSITE_URL
    readonly UNKNOWN_ERROR: typeof UNKNOWN_ERROR
    readonly UNKNOWN_VALUE: typeof UNKNOWN_VALUE
    readonly V1_MIGRATION_GUIDE_URL: typeof V1_MIGRATION_GUIDE_URL
    readonly VLT: typeof VLT
    readonly YARN: typeof YARN
    readonly YARN_BERRY: typeof YARN_BERRY
    readonly YARN_CLASSIC: typeof YARN_CLASSIC
    readonly bashRcPath: string
    readonly binCliPath: string
    readonly binPath: string
    readonly blessedContribPath: string
    readonly blessedOptions: {
      smartCSR: boolean
      term: string
      useBCE: boolean
    }
    readonly blessedPath: string
    readonly distCliPath: string
    readonly distPath: string
    readonly externalPath: string
    readonly githubCachePath: string
    readonly homePath: string
    readonly instrumentWithSentryPath: string
    readonly ipcObject: IpcObject
    readonly minimumVersionByAgent: Map<Agent, string>
    readonly nmBinPath: string
    readonly nodeDebugFlags: string[]
    readonly nodeHardenFlags: string[]
    readonly nodeMemoryFlags: string[]
    readonly npmCachePath: string
    readonly npmGlobalPrefix: string
    readonly npmNmNodeGypPath: string
    readonly processEnv: ProcessEnv
    readonly rootPath: string
    readonly shadowBinPath: string
    readonly shadowNpmBinPath: string
    readonly shadowNpmInjectPath: string
    readonly shadowPnpmBinPath: string
    readonly shadowYarnBinPath: string
    readonly socketAppDataPath: string
    readonly socketCachePath: string
    readonly socketRegistryPath: string
    readonly zshRcPath: string
  }
>

let _Sentry: any

let _npmStdioPipeOptions: SpawnOptions | undefined
function getNpmStdioPipeOptions() {
  if (_npmStdioPipeOptions === undefined) {
    _npmStdioPipeOptions = {
      cwd: process.cwd(),
      shell: constants.WIN32,
    }
  }
  return _npmStdioPipeOptions
}

const LAZY_ENV = () => {
  const { env } = process
  const envHelpers = /*@__PURE__*/ require('@socketsecurity/registry/lib/env')
  const utils = /*@__PURE__*/ require(
    path.join(constants.rootPath, 'dist/utils.js'),
  )
  const envAsBoolean = envHelpers.envAsBoolean
  const envAsNumber = envHelpers.envAsNumber
  const envAsString = envHelpers.envAsString
  const getConfigValueOrUndef = utils.getConfigValueOrUndef
  const readOrDefaultSocketJson = utils.readOrDefaultSocketJson
  const GITHUB_TOKEN = envAsString(env['GITHUB_TOKEN'])
  const INLINED_SOCKET_CLI_PUBLISHED_BUILD = envAsBoolean(
    process.env['INLINED_SOCKET_CLI_PUBLISHED_BUILD'],
  )
  // We inline some environment values so that they CANNOT be influenced by user
  // provided environment variables.
  return Object.freeze({
    __proto__: null,
    // Lazily access registryConstants.ENV.
    ...registryConstants.ENV,
    // Disable using GitHub's workflow actions/cache.
    // https://github.com/actions/cache
    DISABLE_GITHUB_CACHE: envAsBoolean(env['DISABLE_GITHUB_CACHE']),
    // The API URL. For example, https://api.github.com.
    // https://docs.github.com/en/codespaces/developing-in-a-codespace/default-environment-variables-for-your-codespace#list-of-default-environment-variables
    GITHUB_API_URL:
      envAsString(env['GITHUB_API_URL']) || 'https://api.github.com',
    // The name of the base ref or target branch of the pull request in a workflow
    // run. This is only set when the event that triggers a workflow run is either
    // pull_request or pull_request_target. For example, main.
    // https://docs.github.com/en/codespaces/developing-in-a-codespace/default-environment-variables-for-your-codespace#list-of-default-environment-variables
    GITHUB_BASE_REF: envAsString(env['GITHUB_BASE_REF']),
    // The short ref name of the branch or tag that triggered the GitHub workflow
    // run. This value matches the branch or tag name shown on GitHub. For example,
    // feature-branch-1. For pull requests, the format is <pr_number>/merge.
    // https://docs.github.com/en/codespaces/developing-in-a-codespace/default-environment-variables-for-your-codespace#list-of-default-environment-variables
    GITHUB_REF_NAME: envAsString(env['GITHUB_REF_NAME']),
    // The type of ref that triggered the workflow run. Valid values are branch or tag.
    // https://docs.github.com/en/codespaces/developing-in-a-codespace/default-environment-variables-for-your-codespace#list-of-default-environment-variables
    GITHUB_REF_TYPE: envAsString(env['GITHUB_REF_TYPE']),
    // The owner and repository name. For example, octocat/Hello-World.
    // https://docs.github.com/en/codespaces/developing-in-a-codespace/default-environment-variables-for-your-codespace#list-of-default-environment-variables
    GITHUB_REPOSITORY: envAsString(env['GITHUB_REPOSITORY']),
    // The URL of the GitHub server. For example, https://github.com.
    // https://docs.github.com/en/codespaces/developing-in-a-codespace/default-environment-variables-for-your-codespace#list-of-default-environment-variables
    GITHUB_SERVER_URL:
      envAsString(env['GITHUB_SERVER_URL']) || 'https://github.com',
    // The GITHUB_TOKEN secret is a GitHub App installation access token.
    // The token's permissions are limited to the repository that contains the
    // workflow.
    // https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication#about-the-github_token-secret
    GITHUB_TOKEN,
    // Comp-time inlined @coana-tech/cli package version.
    // The '@rollup/plugin-replace' will replace "process.env['INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION']".
    INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION: envAsString(
      process.env['INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION'],
    ),
    // Comp-time inlined @cyclonedx/cdxgen package version.
    // The '@rollup/plugin-replace' will replace "process.env['INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION']".
    INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION: envAsString(
      process.env['INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION'],
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
    INLINED_SOCKET_CLI_PUBLISHED_BUILD,
    // Comp-time inlined flag to determine if this is the Sentry build.
    // The '@rollup/plugin-replace' will replace "process.env['INLINED_SOCKET_CLI_SENTRY_BUILD']".
    INLINED_SOCKET_CLI_SENTRY_BUILD: envAsBoolean(
      process.env['INLINED_SOCKET_CLI_SENTRY_BUILD'],
    ),
    // Comp-time inlined synp package version.
    // The '@rollup/plugin-replace' will replace "process.env['INLINED_SOCKET_CLI_SYNP_VERSION']".
    INLINED_SOCKET_CLI_SYNP_VERSION: envAsString(
      process.env['INLINED_SOCKET_CLI_SYNP_VERSION'],
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
    // The absolute location of the %localappdata% folder on Windows used to store
    // user-specific, non-roaming application data, like temporary files, cached
    // data, and program settings, that are specific to the current machine and user.
    LOCALAPPDATA: envAsString(env[LOCALAPPDATA]),
    // Enable the module compile cache for the Node.js instance.
    // https://nodejs.org/api/cli.html#node_compile_cachedir
    NODE_COMPILE_CACHE: constants.SUPPORTS_NODE_COMPILE_CACHE_ENV_VAR
      ? constants.socketCachePath
      : '',
    // Redefine registryConstants.ENV.NODE_ENV to account for the
    // INLINED_SOCKET_CLI_PUBLISHED_BUILD environment variable.
    NODE_ENV:
      envAsString(env['NODE_ENV']).toLowerCase() === 'production'
        ? 'production'
        : INLINED_SOCKET_CLI_PUBLISHED_BUILD
          ? ''
          : 'development',
    // Well known "root" CAs (like VeriSign) will be extended with the extra
    // certificates in file. The file should consist of one or more trusted
    // certificates in PEM format.
    // https://nodejs.org/api/cli.html#node_extra_ca_certsfile
    NODE_EXTRA_CA_CERTS:
      envAsString(env['NODE_EXTRA_CA_CERTS']) ||
      // Commonly used environment variable to specify the path to a single
      // PEM-encoded certificate file.
      envAsString(env['SSL_CERT_FILE']),
    // PATH is an environment variable that lists directories where executable
    // programs are located. When a command is run, the system searches these
    // directories to find the executable.
    PATH: envAsString(env['PATH']),
    // Accept risks of a Socket wrapped npm/npx run.
    SOCKET_CLI_ACCEPT_RISKS: envAsBoolean(env[SOCKET_CLI_ACCEPT_RISKS]),
    // Change the base URL for Socket API calls.
    // https://github.com/SocketDev/socket-cli?tab=readme-ov-file#environment-variables-for-development
    SOCKET_CLI_API_BASE_URL:
      envAsString(env['SOCKET_CLI_API_BASE_URL']) ||
      // TODO: Remove legacy environment variable name.
      envAsString(env['SOCKET_SECURITY_API_BASE_URL']) ||
      getConfigValueOrUndef('apiBaseUrl') ||
      API_V0_URL,
    // Set the proxy that all requests are routed through.
    // https://github.com/SocketDev/socket-cli?tab=readme-ov-file#environment-variables-for-development
    SOCKET_CLI_API_PROXY:
      envAsString(env['SOCKET_CLI_API_PROXY']) ||
      // TODO: Remove legacy environment variable name.
      envAsString(env['SOCKET_SECURITY_API_PROXY']) ||
      // Commonly used environment variables to specify routing requests through
      // a proxy server.
      envAsString(env['HTTPS_PROXY']) ||
      envAsString(env['https_proxy']) ||
      envAsString(env['HTTP_PROXY']) ||
      envAsString(env['http_proxy']),
    // Set the timeout in milliseconds for Socket API requests.
    // https://nodejs.org/api/http.html#httprequesturl-options-callback
    SOCKET_CLI_API_TIMEOUT: envAsNumber(env['SOCKET_CLI_API_TIMEOUT']),
    // Set the Socket API token.
    // https://github.com/SocketDev/socket-cli?tab=readme-ov-file#environment-variables
    SOCKET_CLI_API_TOKEN:
      envAsString(env['SOCKET_CLI_API_TOKEN']) ||
      // TODO: Remove legacy environment variable names.
      envAsString(env['SOCKET_CLI_API_KEY']) ||
      envAsString(env['SOCKET_SECURITY_API_TOKEN']) ||
      envAsString(env['SOCKET_SECURITY_API_KEY']),
    // A JSON stringified Socket configuration object.
    SOCKET_CLI_CONFIG: envAsString(env['SOCKET_CLI_CONFIG']),
    // The git config user.email used by Socket CLI.
    SOCKET_CLI_GIT_USER_EMAIL:
      envAsString(env['SOCKET_CLI_GIT_USER_EMAIL']) ||
      'github-actions[bot]@users.noreply.github.com',
    // The git config user.name used by Socket CLI.
    SOCKET_CLI_GIT_USER_NAME:
      envAsString(env['SOCKET_CLI_GIT_USER_NAME']) ||
      envAsString(env['SOCKET_CLI_GIT_USERNAME']) ||
      'github-actions[bot]',
    // Change the base URL for GitHub REST API calls.
    // https://docs.github.com/en/rest
    SOCKET_CLI_GITHUB_API_URL:
      envAsString(env['SOCKET_CLI_GITHUB_API_URL']) ||
      readOrDefaultSocketJson(process.cwd())?.defaults?.scan?.github
        ?.githubApiUrl ||
      'https://api.github.com',
    // A classic GitHub personal access token with the "repo" scope or a
    // fine-grained access token with at least read/write permissions set for
    // "Contents" and "Pull Request".
    // https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
    SOCKET_CLI_GITHUB_TOKEN:
      envAsString(env['SOCKET_CLI_GITHUB_TOKEN']) ||
      // TODO: Remove undocumented legacy environment variable name.
      envAsString(env['SOCKET_SECURITY_GITHUB_PAT']) ||
      GITHUB_TOKEN,
    // Make the default API token `undefined`.
    SOCKET_CLI_NO_API_TOKEN: envAsBoolean(env['SOCKET_CLI_NO_API_TOKEN']),
    // The absolute location of the npm directory.
    SOCKET_CLI_NPM_PATH: envAsString(env['SOCKET_CLI_NPM_PATH']),
    // Specify the Socket organization slug.
    SOCKET_CLI_ORG_SLUG:
      envAsString(env['SOCKET_CLI_ORG_SLUG']) ||
      // Coana CLI accepts the SOCKET_ORG_SLUG environment variable.
      envAsString(env['SOCKET_ORG_SLUG']),
    // View all risks of a Socket wrapped npm/npx run.
    SOCKET_CLI_VIEW_ALL_RISKS: envAsBoolean(env[SOCKET_CLI_VIEW_ALL_RISKS]),
    // Specifies the type of terminal or terminal emulator being used by the process.
    TERM: envAsString(env['TERM']),
    // The location of the base directory on Linux and MacOS used to store
    // user-specific data files, defaulting to $HOME/.local/share if not set or empty.
    XDG_DATA_HOME: envAsString(env['XDG_DATA_HOME']),
  })
}

const lazyBashRcPath = () => path.join(constants.homePath, '.bashrc')

const lazyBinPath = () => path.join(constants.rootPath, 'bin')

const lazyBinCliPath = () => path.join(constants.binPath, 'cli.js')

const lazyBlessedContribPath = () =>
  path.join(constants.externalPath, 'blessed-contrib')

const lazyBlessedOptions = () =>
  Object.freeze({
    smartCSR: true,
    term: constants.WIN32 ? 'windows-ansi' : 'xterm',
    useBCE: true,
  })

const lazyBlessedPath = () => path.join(constants.externalPath, 'blessed')

const lazyDistCliPath = () => path.join(constants.distPath, 'cli.js')

const lazyDistPath = () => path.join(constants.rootPath, 'dist')

const lazyExternalPath = () => path.join(constants.rootPath, 'external')

const lazyGithubCachePath = () => path.join(constants.socketCachePath, 'github')

const lazyHomePath = () => os.homedir()

const lazyInstrumentWithSentryPath = () =>
  path.join(constants.distPath, 'instrument-with-sentry.js')

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

const lazyNmBinPath = () => path.join(constants.rootPath, 'node_modules/.bin')

const lazyNodeDebugFlags = () =>
  constants.ENV.SOCKET_CLI_DEBUG ? ['--trace-uncaught', '--trace-warnings'] : []

// Redefine registryConstants.nodeHardenFlags to account for the
// INLINED_SOCKET_CLI_SENTRY_BUILD environment variable.
const lazyNodeHardenFlags = () =>
  Object.freeze(
    // Harden Node security.
    // https://nodejs.org/en/learn/getting-started/security-best-practices
    constants.ENV.INLINED_SOCKET_CLI_SENTRY_BUILD || constants.WIN32
      ? [
          // https://nodejs.org/api/cli.html#--disallow-code-generation-from-strings
          // '--disallow-code-generation-from-strings'
        ]
      : [
          // '--disallow-code-generation-from-strings',
          // https://nodejs.org/api/cli.html#--disable-protomode
          // '--disable-proto',
          // 'throw',
          // https://nodejs.org/api/cli.html#--frozen-intrinsics
          // We have contributed the following patches to our dependencies to make
          // Node's --frozen-intrinsics workable.
          // √ https://github.com/SBoudrias/Inquirer.js/pull/1683
          // √ https://github.com/pnpm/components/pull/23
          // '--frozen-intrinsics',
          // https://nodejs.org/api/cli.html#--no-deprecation
          // '--no-deprecation',
        ],
  )

const lazyNodeMemoryFlags = () => {
  const flags = /*@__PURE__*/ require(
    path.join(constants.rootPath, 'dist/flags.js'),
  )
  const getMaxOldSpaceSizeFlag = flags.getMaxOldSpaceSizeFlag
  const getMaxSemiSpaceSizeFlag = flags.getMaxSemiSpaceSizeFlag
  return Object.freeze([
    `--max-old-space-size=${getMaxOldSpaceSizeFlag()}`,
    `--max-semi-space-size=${getMaxSemiSpaceSizeFlag()}`,
  ])
}

const lazyNpmCachePath = () => {
  const spawnHelpers = /*@__PURE__*/ require('@socketsecurity/registry/lib/spawn')
  const spawnSync = spawnHelpers.spawnSync
  return spawnSync(
    constants.npmExecPath,
    ['config', 'get', 'cache'],
    getNpmStdioPipeOptions(),
  ).stdout
}

const lazyNpmGlobalPrefix = () => {
  const spawnHelpers = /*@__PURE__*/ require('@socketsecurity/registry/lib/spawn')
  const spawnSync = spawnHelpers.spawnSync
  return spawnSync(
    constants.npmExecPath,
    ['prefix', '-g'],
    getNpmStdioPipeOptions(),
  ).stdout
}

const lazyNpmNmNodeGypPath = () =>
  path.join(
    constants.npmRealExecPath,
    '../../node_modules/node-gyp/bin/node-gyp.js',
  )

const lazyProcessEnv = () =>
  Object.setPrototypeOf(
    Object.fromEntries(
      Object.entries(constants.ENV).reduce(
        (entries, entry) => {
          const { 0: key, 1: value } = entry
          if (key.startsWith('INLINED_SOCKET_CLI_')) {
            return entries
          }
          if (typeof value === 'string') {
            if (value) {
              entries.push(entry as [string, string])
            }
          } else if (typeof value === 'boolean' && value) {
            entries.push([key, '1'])
          }
          return entries
        },
        [] as Array<[string, string]>,
      ),
    ),
    null,
  )

const lazyRootPath = () => path.join(realpathSync.native(__dirname), '..')

const lazyShadowBinPath = () => path.join(constants.rootPath, 'shadow-npm-bin')

const lazyShadowNpmBinPath = () =>
  path.join(constants.distPath, 'shadow-npm-bin.js')

const lazyShadowNpmInjectPath = () =>
  path.join(constants.distPath, 'shadow-npm-inject.js')

const lazyShadowPnpmBinPath = () =>
  path.join(constants.distPath, 'shadow-pnpm-bin.js')

const lazyShadowYarnBinPath = () =>
  path.join(constants.distPath, 'shadow-yarn-bin.js')

const lazySocketAppDataPath = (): string | undefined => {
  // Get the OS app data directory:
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
  const { WIN32 } = constants
  let dataHome: string | undefined = WIN32
    ? constants.ENV.LOCALAPPDATA
    : constants.ENV.XDG_DATA_HOME
  if (!dataHome) {
    if (WIN32) {
      const logger = /*@__PURE__*/ require('@socketsecurity/registry/lib/logger')
      logger.warn(`Missing %${LOCALAPPDATA}%.`)
    } else {
      dataHome = path.join(
        constants.homePath,
        constants.DARWIN ? 'Library/Application Support' : '.local/share',
      )
    }
  }
  return dataHome ? path.join(dataHome, 'socket/settings') : undefined
}

const lazySocketCachePath = () => path.join(constants.rootPath, '.cache')

const lazySocketRegistryPath = () =>
  path.join(constants.externalPath, '@socketsecurity/registry')

const lazyZshRcPath = () => path.join(constants.homePath, '.zshrc')

const constants: Constants = createConstantsObject(
  {
    ...registryConstantsAttribs.props,
    ALERT_TYPE_CRITICAL_CVE,
    ALERT_TYPE_CVE,
    ALERT_TYPE_MEDIUM_CVE,
    ALERT_TYPE_MILD_CVE,
    API_V0_URL,
    BUN,
    DOT_SOCKET,
    DOT_SOCKET_DOT_FACTS_JSON,
    DRY_RUN_LABEL,
    DRY_RUN_BAILING_NOW,
    DRY_RUN_NOT_SAVING,
    EMPTY_VALUE,
    ENVIRONMENT_YAML,
    ENVIRONMENT_YML,
    ENV: undefined,
    FOLD_SETTING_FILE,
    FOLD_SETTING_NONE,
    FOLD_SETTING_PKG,
    FOLD_SETTING_VERSION,
    GQL_PAGE_SENTINEL,
    GQL_PR_STATE_CLOSED,
    GQL_PR_STATE_MERGED,
    GQL_PR_STATE_OPEN,
    NODE_MODULES,
    NPM_BUGGY_OVERRIDES_PATCHED_VERSION,
    NPM_REGISTRY_URL,
    NPX,
    OUTPUT_JSON,
    OUTPUT_MARKDOWN,
    OUTPUT_TEXT,
    PACKAGE_JSON,
    PACKAGE_LOCK_JSON,
    PNPM,
    PNPM_LOCK_YAML,
    REDACTED,
    REPORT_LEVEL_DEFER,
    REPORT_LEVEL_ERROR,
    REPORT_LEVEL_IGNORE,
    REPORT_LEVEL_MONITOR,
    REPORT_LEVEL_WARN,
    REQUIREMENTS_TXT,
    SOCKET_CLI_ACCEPT_RISKS,
    SOCKET_CLI_BIN_NAME,
    SOCKET_CLI_ISSUES_URL,
    SOCKET_CLI_SHADOW_ACCEPT_RISKS,
    SOCKET_CLI_SHADOW_API_TOKEN,
    SOCKET_CLI_SHADOW_BIN,
    SOCKET_CLI_SHADOW_PROGRESS,
    SOCKET_CLI_SHADOW_SILENT,
    SOCKET_CLI_VIEW_ALL_RISKS,
    SOCKET_DEFAULT_BRANCH,
    SOCKET_DEFAULT_REPOSITORY,
    SOCKET_JSON,
    SOCKET_WEBSITE_URL,
    UNKNOWN_ERROR,
    UNKNOWN_VALUE,
    V1_MIGRATION_GUIDE_URL,
    VLT,
    YARN,
    YARN_BERRY,
    YARN_CLASSIC,
    bashRcPath: undefined,
    binPath: undefined,
    binCliPath: undefined,
    blessedContribPath: undefined,
    blessedOptions: undefined,
    blessedPath: undefined,
    distCliPath: undefined,
    distPath: undefined,
    externalPath: undefined,
    githubCachePath: undefined,
    homePath: undefined,
    instrumentWithSentryPath: undefined,
    minimumVersionByAgent: undefined,
    nmBinPath: undefined,
    nodeHardenFlags: undefined,
    nodeDebugFlags: undefined,
    nodeMemoryFlags: undefined,
    npmCachePath: undefined,
    npmGlobalPrefix: undefined,
    npmNmNodeGypPath: undefined,
    processEnv: undefined,
    rootPath: undefined,
    shadowBinPath: undefined,
    shadowNpmInjectPath: undefined,
    shadowNpmBinPath: undefined,
    shadowPnpmBinPath: undefined,
    shadowYarnBinPath: undefined,
    socketAppDataPath: undefined,
    socketCachePath: undefined,
    socketRegistryPath: undefined,
    zshRcPath: undefined,
  },
  {
    getters: {
      ...registryConstantsAttribs.getters,
      ENV: LAZY_ENV,
      bashRcPath: lazyBashRcPath,
      binCliPath: lazyBinCliPath,
      binPath: lazyBinPath,
      blessedContribPath: lazyBlessedContribPath,
      blessedOptions: lazyBlessedOptions,
      blessedPath: lazyBlessedPath,
      distCliPath: lazyDistCliPath,
      distPath: lazyDistPath,
      externalPath: lazyExternalPath,
      githubCachePath: lazyGithubCachePath,
      homePath: lazyHomePath,
      instrumentWithSentryPath: lazyInstrumentWithSentryPath,
      minimumVersionByAgent: lazyMinimumVersionByAgent,
      nmBinPath: lazyNmBinPath,
      nodeDebugFlags: lazyNodeDebugFlags,
      nodeHardenFlags: lazyNodeHardenFlags,
      nodeMemoryFlags: lazyNodeMemoryFlags,
      npmCachePath: lazyNpmCachePath,
      npmGlobalPrefix: lazyNpmGlobalPrefix,
      npmNmNodeGypPath: lazyNpmNmNodeGypPath,
      processEnv: lazyProcessEnv,
      rootPath: lazyRootPath,
      shadowBinPath: lazyShadowBinPath,
      shadowNpmBinPath: lazyShadowNpmBinPath,
      shadowNpmInjectPath: lazyShadowNpmInjectPath,
      shadowPnpmBinPath: lazyShadowPnpmBinPath,
      shadowYarnBinPath: lazyShadowYarnBinPath,
      socketAppDataPath: lazySocketAppDataPath,
      socketCachePath: lazySocketCachePath,
      socketRegistryPath: lazySocketRegistryPath,
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

export {
  ALERT_TYPE_CRITICAL_CVE,
  ALERT_TYPE_CVE,
  ALERT_TYPE_MEDIUM_CVE,
  ALERT_TYPE_MILD_CVE,
  API_V0_URL,
  AT_LATEST,
  BIOME_JSON,
  BUN,
  CI,
  COLUMN_LIMIT,
  DOT_SOCKET,
  DOT_SOCKET_DOT_FACTS_JSON,
  DRY_RUN_BAILING_NOW,
  DRY_RUN_LABEL,
  DRY_RUN_NOT_SAVING,
  EMPTY_FILE,
  EMPTY_VALUE,
  ENVIRONMENT_YAML,
  ENVIRONMENT_YML,
  ESLINT_CONFIG_JS,
  ESNEXT,
  EXTENSIONS,
  EXTENSIONS_JSON,
  EXT_CJS,
  EXT_CMD,
  EXT_CTS,
  EXT_DTS,
  EXT_JS,
  EXT_JSON,
  EXT_LOCK,
  EXT_LOCKB,
  EXT_MD,
  EXT_MJS,
  EXT_MTS,
  EXT_PS1,
  FOLD_SETTING_FILE,
  FOLD_SETTING_NONE,
  FOLD_SETTING_PKG,
  FOLD_SETTING_VERSION,
  GITIGNORE,
  GQL_PAGE_SENTINEL,
  GQL_PR_STATE_CLOSED,
  GQL_PR_STATE_MERGED,
  GQL_PR_STATE_OPEN,
  HIDDEN_PACKAGE_LOCK_JSON,
  LATEST,
  LICENSE,
  LICENSE_GLOB,
  LICENSE_GLOB_RECURSIVE,
  LICENSE_ORIGINAL,
  LICENSE_ORIGINAL_GLOB,
  LICENSE_ORIGINAL_GLOB_RECURSIVE,
  LOCALAPPDATA,
  LOOP_SENTINEL,
  MANIFEST_JSON,
  MIT,
  NODE_AUTH_TOKEN,
  NODE_ENV,
  NODE_MODULES,
  NODE_MODULES_GLOB_RECURSIVE,
  NODE_WORKSPACES,
  NPM,
  NPM_BUGGY_OVERRIDES_PATCHED_VERSION,
  NPM_REGISTRY_URL,
  NPX,
  OUTPUT_JSON,
  OUTPUT_MARKDOWN,
  OUTPUT_TEXT,
  OVERRIDES,
  PACKAGE_DEFAULT_VERSION,
  PACKAGE_JSON,
  PACKAGE_LOCK_JSON,
  PNPM,
  PNPM_LOCK_YAML,
  PRE_COMMIT,
  README_GLOB,
  README_GLOB_RECURSIVE,
  README_MD,
  REDACTED,
  REGISTRY,
  REGISTRY_SCOPE_DELIMITER,
  REPORT_LEVEL_DEFER,
  REPORT_LEVEL_ERROR,
  REPORT_LEVEL_IGNORE,
  REPORT_LEVEL_MONITOR,
  REPORT_LEVEL_WARN,
  REQUIREMENTS_TXT,
  RESOLUTIONS,
  SOCKET_CLI_ACCEPT_RISKS,
  SOCKET_CLI_BIN_NAME,
  SOCKET_CLI_ISSUES_URL,
  SOCKET_CLI_SHADOW_ACCEPT_RISKS,
  SOCKET_CLI_SHADOW_API_TOKEN,
  SOCKET_CLI_SHADOW_BIN,
  SOCKET_CLI_SHADOW_PROGRESS,
  SOCKET_CLI_SHADOW_SILENT,
  SOCKET_CLI_VIEW_ALL_RISKS,
  SOCKET_DEFAULT_BRANCH,
  SOCKET_DEFAULT_REPOSITORY,
  SOCKET_GITHUB_ORG,
  SOCKET_JSON,
  SOCKET_IPC_HANDSHAKE,
  SOCKET_OVERRIDE_SCOPE,
  SOCKET_PUBLIC_API_TOKEN,
  SOCKET_REGISTRY_NPM_ORG,
  SOCKET_REGISTRY_PACKAGE_NAME,
  SOCKET_REGISTRY_REPO_NAME,
  SOCKET_REGISTRY_SCOPE,
  SOCKET_SECURITY_SCOPE,
  SOCKET_WEBSITE_URL,
  UNKNOWN_ERROR,
  UNKNOWN_VALUE,
  UNLICENCED,
  UNLICENSED,
  UTF8,
  V1_MIGRATION_GUIDE_URL,
  VITEST,
  VLT,
  YARN,
  YARN_BERRY,
  YARN_CLASSIC,
  YARN_LOCK,
}

export default constants
