/** @fileoverview Central constants module that imports base constants from @socketsecurity/registry and defines CLI-specific constants. Provides paths, environment variables, and configuration shared across all commands. */

import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import registryConstants from '@socketsecurity/registry/lib/constants'
import { safeReadFileSync } from '@socketsecurity/registry/lib/fs'

import type { Agent } from './utils/package-environment.mts'
import type { Remap } from '@socketsecurity/registry/lib/objects'
import type { SpawnOptions } from '@socketsecurity/registry/lib/spawn'

const __filename = fileURLToPath(import.meta.url)
// Using `path.dirname(__filename)` to resolve `__dirname` works for both 'dist'
// AND 'src' directories because constants.js and constants.mts respectively are
// in the root of each.
const __dirname = path.dirname(__filename)

const require = createRequire(import.meta.url)

// Access constants directly from the registryConstants object.
// The registry now exports constants as a special object with lazy getters.
// Type assertion needed because TypeScript sees this as generic 'object'.
const regConsts = registryConstants as any
const AT_LATEST = regConsts.AT_LATEST
const BUN = regConsts.BUN
const CHANGELOG_MD = regConsts.CHANGELOG_MD
const CI = regConsts.CI
const COLUMN_LIMIT = regConsts.COLUMN_LIMIT
const CACHE_DIR = regConsts.CACHE_DIR
const CACHE_GITHUB_DIR = regConsts.CACHE_GITHUB_DIR
const CACHE_SOCKET_API_DIR = regConsts.CACHE_SOCKET_API_DIR
const CACHE_TTL_DIR = regConsts.CACHE_TTL_DIR
const DOT_GIT_DIR = regConsts.DOT_GIT_DIR
const DOT_PACKAGE_LOCK_JSON = regConsts.DOT_PACKAGE_LOCK_JSON
const DOT_SOCKET_DIR = regConsts.DOT_SOCKET_DIR
const EMPTY_FILE = regConsts.EMPTY_FILE
const EMPTY_VALUE = regConsts.EMPTY_VALUE
const ESLINT_CONFIG_JS = regConsts.ESLINT_CONFIG_JS
const ESNEXT = regConsts.ESNEXT
const EXTENSIONS = regConsts.EXTENSIONS
const EXTENSIONS_JSON = regConsts.EXTENSIONS_JSON
const EXT_CJS = regConsts.EXT_CJS
const EXT_CMD = regConsts.EXT_CMD
const EXT_CTS = regConsts.EXT_CTS
const EXT_DTS = regConsts.EXT_DTS
const EXT_JS = regConsts.EXT_JS
const EXT_JSON = regConsts.EXT_JSON
const EXT_LOCK = regConsts.EXT_LOCK
const EXT_LOCKB = regConsts.EXT_LOCKB
const EXT_MD = regConsts.EXT_MD
const EXT_MJS = regConsts.EXT_MJS
const EXT_MTS = regConsts.EXT_MTS
const EXT_PS1 = regConsts.EXT_PS1
const EXT_YAML = regConsts.EXT_YAML
const EXT_YML = regConsts.EXT_YML
const GITIGNORE = regConsts.GITIGNORE
const LATEST = regConsts.LATEST
const LICENSE = regConsts.LICENSE
const LICENSE_GLOB = regConsts.LICENSE_GLOB
const LICENSE_GLOB_RECURSIVE = regConsts.LICENSE_GLOB_RECURSIVE
const LICENSE_ORIGINAL = regConsts.LICENSE_ORIGINAL
const LICENSE_ORIGINAL_GLOB = regConsts.LICENSE_ORIGINAL_GLOB
const LICENSE_ORIGINAL_GLOB_RECURSIVE =
  regConsts.LICENSE_ORIGINAL_GLOB_RECURSIVE
const LOOP_SENTINEL = regConsts.LOOP_SENTINEL
const MANIFEST_JSON = regConsts.MANIFEST_JSON
const MIT = regConsts.MIT
const NODE_AUTH_TOKEN = regConsts.NODE_AUTH_TOKEN
const NODE_ENV = regConsts.NODE_ENV
const NODE_MODULES = regConsts.NODE_MODULES
const NODE_MODULES_GLOB_RECURSIVE = regConsts.NODE_MODULES_GLOB_RECURSIVE
const NODE_SEA_FUSE = regConsts.NODE_SEA_FUSE
const NPM = regConsts.NPM
const NPX = regConsts.NPX
const OVERRIDES = regConsts.OVERRIDES
const PACKAGE_DEFAULT_VERSION = regConsts.PACKAGE_DEFAULT_VERSION
const PACKAGE_JSON = regConsts.PACKAGE_JSON
const PACKAGE_LOCK_JSON = regConsts.PACKAGE_LOCK_JSON
const PNPM = regConsts.PNPM
const PNPM_LOCK_YAML = regConsts.PNPM_LOCK_YAML
const PRE_COMMIT = regConsts.PRE_COMMIT
const README_GLOB = regConsts.README_GLOB
const README_GLOB_RECURSIVE = regConsts.README_GLOB_RECURSIVE
const README_MD = regConsts.README_MD
const REGISTRY = regConsts.REGISTRY
const REGISTRY_SCOPE_DELIMITER = regConsts.REGISTRY_SCOPE_DELIMITER
const RESOLUTIONS = regConsts.RESOLUTIONS
const SOCKET_GITHUB_ORG = regConsts.SOCKET_GITHUB_ORG
const SOCKET_CLI_APP_NAME = regConsts.SOCKET_CLI_APP_NAME
const SOCKET_IPC_HANDSHAKE = regConsts.SOCKET_IPC_HANDSHAKE
const SOCKET_OVERRIDE_SCOPE = regConsts.SOCKET_OVERRIDE_SCOPE
const SOCKET_PUBLIC_API_TOKEN = regConsts.SOCKET_PUBLIC_API_TOKEN
const SOCKET_REGISTRY_NPM_ORG = regConsts.SOCKET_REGISTRY_NPM_ORG
const SOCKET_REGISTRY_PACKAGE_NAME = regConsts.SOCKET_REGISTRY_PACKAGE_NAME
const SOCKET_REGISTRY_REPO_NAME = regConsts.SOCKET_REGISTRY_REPO_NAME
const SOCKET_REGISTRY_SCOPE = regConsts.SOCKET_REGISTRY_SCOPE
const SOCKET_SECURITY_SCOPE = regConsts.SOCKET_SECURITY_SCOPE
const TSCONFIG_JSON = regConsts.TSCONFIG_JSON
const UNKNOWN_ERROR = regConsts.UNKNOWN_ERROR
const UNKNOWN_VALUE = regConsts.UNKNOWN_VALUE
const UNLICENCED = regConsts.UNLICENCED
const UNLICENSED = regConsts.UNLICENSED
const UTF8 = regConsts.UTF8
const VITEST = regConsts.VITEST
const VLT = regConsts.VLT
const YARN = regConsts.YARN
const YARN_BERRY = regConsts.YARN_BERRY
const YARN_CLASSIC = regConsts.YARN_CLASSIC
const YARN_LOCK = regConsts.YARN_LOCK
const BUN_LOCK = regConsts.BUN_LOCK
const BUN_LOCKB = regConsts.BUN_LOCKB
const NPM_SHRINKWRAP_JSON = regConsts.NPM_SHRINKWRAP_JSON
const VLT_LOCK_JSON = regConsts.VLT_LOCK_JSON

// Access internals symbol and attributes.
const kInternalsSymbol = regConsts.kInternalsSymbol
const registryConstantsAttribs =
  regConsts[kInternalsSymbol as unknown as 'Symbol(kInternalsSymbol)']
    .attributes
const createConstantsObject =
  regConsts[kInternalsSymbol as unknown as 'Symbol(kInternalsSymbol)']
    .createConstantsObject
const getIpc =
  regConsts[kInternalsSymbol as unknown as 'Symbol(kInternalsSymbol)'].getIpc

export type RegistryEnv = typeof regConsts.ENV

export type RegistryInternals = (typeof regConsts)['Symbol(kInternalsSymbol)']

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

export type ENV = RegistryEnv &
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
    INLINED_SOCKET_CLI_PYTHON_VERSION: string
    INLINED_SOCKET_CLI_PYTHON_BUILD_TAG: string
    INLINED_SOCKET_CLI_HOMEPAGE: string
    INLINED_SOCKET_CLI_LEGACY_BUILD: string
    INLINED_SOCKET_CLI_NAME: string
    INLINED_SOCKET_CLI_PUBLISHED_BUILD: string
    INLINED_SOCKET_CLI_SENTRY_BUILD: string
    INLINED_SOCKET_CLI_VERSION: string
    INLINED_SOCKET_CLI_VERSION_HASH: string
    INLINED_SOCKET_CLI_SYNP_VERSION: string
    LOCALAPPDATA: string
    NODE_CHANNEL_FD: number
    NODE_COMPILE_CACHE: string
    NODE_EXTRA_CA_CERTS: string
    NPM_REGISTRY: string
    npm_config_cache: string
    npm_config_user_agent: string
    PATH: string
    SOCKET_CLI_DIR: string
    SOCKET_HOME: string
    SOCKET_NODE_DOWNLOAD_URL: string
    SOCKET_NPM_REGISTRY: string
    SOCKET_CLI_ACCEPT_RISKS: boolean
    SOCKET_CLI_API_BASE_URL: string
    SOCKET_CLI_API_PROXY: string
    SOCKET_CLI_API_TIMEOUT: number
    SOCKET_CLI_API_TOKEN: string
    SOCKET_CLI_BUN_PATH: string
    SOCKET_CLI_CACHE_ENABLED: string
    SOCKET_CLI_CACHE_TTL: string
    SOCKET_CLI_CDXGEN_LOCAL_PATH: string
    SOCKET_CLI_COANA_LOCAL_PATH: string
    SOCKET_CLI_CONFIG: string
    SOCKET_CLI_GIT_USER_EMAIL: string
    SOCKET_CLI_GIT_USER_NAME: string
    SOCKET_CLI_GITHUB_TOKEN: string
    SOCKET_CLI_NO_API_TOKEN: boolean
    SOCKET_CLI_NPM_PATH: string
    SOCKET_CLI_NPX_PATH: string
    SOCKET_CLI_ORG_SLUG: string
    SOCKET_CLI_PNPM_PATH: string
    SOCKET_CLI_PNPM_V8_PATH: string
    SOCKET_CLI_PNPM_V9_PATH: string
    SOCKET_CLI_PNPM_V10_PATH: string
    SOCKET_CLI_PRELOAD_PHASE: string
    SOCKET_CLI_PYTHON_PATH: string
    SOCKET_CLI_SFW_LOCAL_PATH: string
    SOCKET_CLI_VLT_PATH: string
    SOCKET_CLI_VIEW_ALL_RISKS: boolean
    SOCKET_CLI_YARN_BERRY_PATH: string
    SOCKET_CLI_YARN_CLASSIC_PATH: string
    SOCKET_CLI_YARN_PATH: string
    TERM: string
    XDG_DATA_HOME: string
  }>

export type IpcObject = Readonly<{
  SOCKET_CLI_FIX?: string | undefined
  SOCKET_CLI_OPTIMIZE?: boolean | undefined
  SOCKET_CLI_SHADOW_ACCEPT_RISKS?: boolean | undefined
  SOCKET_CLI_SHADOW_API_TOKEN?: string | undefined
  SOCKET_CLI_SHADOW_BIN?: string | undefined
  SOCKET_CLI_SHADOW_PROGRESS?: boolean | undefined
  SOCKET_CLI_SHADOW_SILENT?: boolean | undefined
  SOCKET_CLI_STUB_PATH?: string | undefined
}>

export type ProcessEnv = {
  [K in keyof ENV]?: string | undefined
}

// Socket CLI specific constants that are not in socket-registry.
const ALERT_TYPE_CRITICAL_CVE = 'criticalCVE'
const ALERT_TYPE_CVE = 'cve'
const ALERT_TYPE_MEDIUM_CVE = 'mediumCVE'
const ALERT_TYPE_MILD_CVE = 'mildCVE'
const API_V0_URL = 'https://api.socket.dev/v0/'
const CLI_DIR = 'cli'
const CONFIG_KEY_API_BASE_URL = 'apiBaseUrl'
const CONFIG_KEY_API_PROXY = 'apiProxy'
const CONFIG_KEY_API_TOKEN = 'apiToken'
const CONFIG_KEY_CACHE_ENABLED = 'cacheEnabled'
const CONFIG_KEY_CACHE_TTL = 'cacheTtl'
const CONFIG_KEY_DEFAULT_ORG = 'defaultOrg'
const CONFIG_KEY_ENFORCED_ORGS = 'enforcedOrgs'
const CONFIG_KEY_ORG = 'org'
const DOT_SOCKET_DOT_FACTS_JSON = `${DOT_SOCKET_DIR}.facts.json`
// 7 days in milliseconds.
const DLX_BINARY_CACHE_TTL = 7 * 24 * 60 * 60 * 1_000
const DRY_RUN_LABEL = '[DryRun]'
const DRY_RUN_BAILING_NOW = `${DRY_RUN_LABEL}: Bailing now`
const DRY_RUN_NOT_SAVING = `${DRY_RUN_LABEL}: Not saving`
const ENVIRONMENT_YAML = 'environment.yaml'
const ENVIRONMENT_YML = 'environment.yml'
const ERROR_NO_MANIFEST_FILES = 'No manifest files found'
const ERROR_NO_PACKAGE_JSON = 'No package.json found'
const ERROR_NO_REPO_FOUND = 'No repo found'
const ERROR_NO_SOCKET_DIR = 'No .socket directory found'
const ERROR_UNABLE_RESOLVE_ORG =
  'Unable to resolve a Socket account organization'
const FLAG_CONFIG = '--config'
const FLAG_DRY_RUN = '--dry-run'
const FLAG_HELP = '--help'
const FLAG_HELP_FULL = '--help-full'
const FLAG_ID = '--id'
const FLAG_JSON = '--json'
const FLAG_LOGLEVEL = '--loglevel'
const FLAG_MARKDOWN = '--markdown'
const FLAG_ORG = '--org'
const FLAG_PIN = '--pin'
const FLAG_PROD = '--prod'
const FLAG_QUIET = '--quiet'
const FLAG_SILENT = '--silent'
const FLAG_TEXT = '--text'
const FLAG_VERBOSE = '--verbose'
const FLAG_VERSION = '--version'
const FOLD_SETTING_FILE = 'file'
const FOLD_SETTING_NONE = 'none'
const FOLD_SETTING_PKG = 'pkg'
const FOLD_SETTING_VERSION = 'version'
const GQL_PAGE_SENTINEL = 100
const GQL_PR_STATE_CLOSED = 'CLOSED'
const GQL_PR_STATE_MERGED = 'MERGED'
const GQL_PR_STATE_OPEN = 'OPEN'
const HTTP_STATUS_BAD_REQUEST = 400
const HTTP_STATUS_FORBIDDEN = 403
const HTTP_STATUS_INTERNAL_SERVER_ERROR = 500
const HTTP_STATUS_NOT_FOUND = 404
const HTTP_STATUS_TOO_MANY_REQUESTS = 429
const HTTP_STATUS_UNAUTHORIZED = 401
const NPM_BUGGY_OVERRIDES_PATCHED_VERSION = '11.2.0'
const PYTHON_MIN_VERSION = '3.10.0'
const NPM_REGISTRY_URL = 'https://registry.npmjs.org'
const OUTPUT_JSON = 'json'
const OUTPUT_MARKDOWN = 'markdown'
const OUTPUT_TEXT = 'text'
const PNPM_WORKSPACE_YAML = 'pnpm-workspace.yaml'
const REDACTED = '<redacted>'
const REPORT_LEVEL_DEFER = 'defer'
const REPORT_LEVEL_ERROR = 'error'
const REPORT_LEVEL_IGNORE = 'ignore'
const REPORT_LEVEL_MONITOR = 'monitor'
const REPORT_LEVEL_WARN = 'warn'
const REQUIREMENTS_TXT = 'requirements.txt'
const SEA_DIR = 'sea'
const SEA_UPDATE_COMMAND = 'self-update'
const SOCKET_CLI_ACCEPT_RISKS = 'SOCKET_CLI_ACCEPT_RISKS'
const SOCKET_CLI_BIN_NAME = 'socket'
const SOCKET_CLI_GITHUB_REPO = 'socket-cli'
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
const SOCKET_YAML = 'socket.yaml'
const SOCKET_YML = 'socket.yml'
const TMP_DIR = 'tmp'
const TOKEN_PREFIX = 'sktsec_'
const TOKEN_PREFIX_LENGTH = TOKEN_PREFIX.length
const UPDATE_CHECK_TTL = 24 * 60 * 60 * 1_000
const UPDATE_NOTIFIER_TIMEOUT = 10_000
const UPDATE_STORE_DIR = '.socket/_socket'
const UPDATE_STORE_FILE_NAME = 'update-store.json'
const CLI_INSTALL_LOCK_FILE_NAME = '.install.lock'
const UPDATER_BACKUPS_DIR = 'backups'
const UPDATER_DIR = 'updater'
const UPDATER_DOWNLOADS_DIR = 'downloads'
const UPDATER_STAGING_DIR = 'staging'
const UPDATER_STATE_JSON = 'state.json'
const V1_MIGRATION_GUIDE_URL = 'https://docs.socket.dev/docs/v1-migration-guide'

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
    readonly CLI_DIR: typeof CLI_DIR
    readonly BUN: typeof BUN
    readonly BUN_LOCK: typeof BUN_LOCK
    readonly BUN_LOCKB: typeof BUN_LOCKB
    readonly CHANGELOG_MD: typeof CHANGELOG_MD
    readonly CACHE_DIR: typeof CACHE_DIR
    readonly CACHE_GITHUB_DIR: typeof CACHE_GITHUB_DIR
    readonly CACHE_SOCKET_API_DIR: typeof CACHE_SOCKET_API_DIR
    readonly CACHE_TTL_DIR: typeof CACHE_TTL_DIR
    readonly CONFIG_KEY_API_BASE_URL: typeof CONFIG_KEY_API_BASE_URL
    readonly CONFIG_KEY_API_PROXY: typeof CONFIG_KEY_API_PROXY
    readonly CONFIG_KEY_API_TOKEN: typeof CONFIG_KEY_API_TOKEN
    readonly CONFIG_KEY_CACHE_ENABLED: typeof CONFIG_KEY_CACHE_ENABLED
    readonly CONFIG_KEY_CACHE_TTL: typeof CONFIG_KEY_CACHE_TTL
    readonly CONFIG_KEY_DEFAULT_ORG: typeof CONFIG_KEY_DEFAULT_ORG
    readonly CONFIG_KEY_ENFORCED_ORGS: typeof CONFIG_KEY_ENFORCED_ORGS
    readonly CONFIG_KEY_ORG: typeof CONFIG_KEY_ORG
    readonly DLX_BINARY_CACHE_TTL: typeof DLX_BINARY_CACHE_TTL
    readonly DOT_GIT_DIR: typeof DOT_GIT_DIR
    readonly DOT_PACKAGE_LOCK_JSON: typeof DOT_PACKAGE_LOCK_JSON
    readonly DOT_SOCKET_DIR: typeof DOT_SOCKET_DIR
    readonly DOT_SOCKET_DOT_FACTS_JSON: typeof DOT_SOCKET_DOT_FACTS_JSON
    readonly DRY_RUN_BAILING_NOW: typeof DRY_RUN_BAILING_NOW
    readonly DRY_RUN_LABEL: typeof DRY_RUN_LABEL
    readonly SEA_UPDATE_COMMAND: typeof SEA_UPDATE_COMMAND
    readonly UPDATE_CHECK_TTL: typeof UPDATE_CHECK_TTL
    readonly UPDATE_NOTIFIER_TIMEOUT: typeof UPDATE_NOTIFIER_TIMEOUT
    readonly UPDATE_STORE_DIR: typeof UPDATE_STORE_DIR
    readonly UPDATE_STORE_FILE_NAME: typeof UPDATE_STORE_FILE_NAME
    readonly CLI_INSTALL_LOCK_FILE_NAME: typeof CLI_INSTALL_LOCK_FILE_NAME
    readonly UPDATER_BACKUPS_DIR: typeof UPDATER_BACKUPS_DIR
    readonly UPDATER_DIR: typeof UPDATER_DIR
    readonly UPDATER_DOWNLOADS_DIR: typeof UPDATER_DOWNLOADS_DIR
    readonly UPDATER_STAGING_DIR: typeof UPDATER_STAGING_DIR
    readonly UPDATER_STATE_JSON: typeof UPDATER_STATE_JSON
    readonly DRY_RUN_NOT_SAVING: typeof DRY_RUN_NOT_SAVING
    readonly EMPTY_VALUE: typeof EMPTY_VALUE
    readonly ENV: ENV
    readonly ENVIRONMENT_YAML: typeof ENVIRONMENT_YAML
    readonly ENVIRONMENT_YML: typeof ENVIRONMENT_YML
    readonly ERROR_NO_MANIFEST_FILES: typeof ERROR_NO_MANIFEST_FILES
    readonly ERROR_NO_PACKAGE_JSON: typeof ERROR_NO_PACKAGE_JSON
    readonly ERROR_NO_REPO_FOUND: typeof ERROR_NO_REPO_FOUND
    readonly ERROR_NO_SOCKET_DIR: typeof ERROR_NO_SOCKET_DIR
    readonly ERROR_UNABLE_RESOLVE_ORG: typeof ERROR_UNABLE_RESOLVE_ORG
    readonly EXT_LOCK: typeof EXT_LOCK
    readonly EXT_LOCKB: typeof EXT_LOCKB
    readonly EXT_YAML: typeof EXT_YAML
    readonly EXT_YML: typeof EXT_YML
    readonly FLAG_CONFIG: typeof FLAG_CONFIG
    readonly FLAG_DRY_RUN: typeof FLAG_DRY_RUN
    readonly FLAG_HELP: typeof FLAG_HELP
    readonly FLAG_HELP_FULL: typeof FLAG_HELP_FULL
    readonly FLAG_ID: typeof FLAG_ID
    readonly FLAG_JSON: typeof FLAG_JSON
    readonly FLAG_LOGLEVEL: typeof FLAG_LOGLEVEL
    readonly FLAG_MARKDOWN: typeof FLAG_MARKDOWN
    readonly FLAG_ORG: typeof FLAG_ORG
    readonly FLAG_PIN: typeof FLAG_PIN
    readonly FLAG_PROD: typeof FLAG_PROD
    readonly FLAG_QUIET: typeof FLAG_QUIET
    readonly FLAG_SILENT: typeof FLAG_SILENT
    readonly FLAG_TEXT: typeof FLAG_TEXT
    readonly FLAG_VERBOSE: typeof FLAG_VERBOSE
    readonly FLAG_VERSION: typeof FLAG_VERSION
    readonly FOLD_SETTING_FILE: typeof FOLD_SETTING_FILE
    readonly FOLD_SETTING_NONE: typeof FOLD_SETTING_NONE
    readonly FOLD_SETTING_PKG: typeof FOLD_SETTING_PKG
    readonly FOLD_SETTING_VERSION: typeof FOLD_SETTING_VERSION
    readonly GQL_PAGE_SENTINEL: typeof GQL_PAGE_SENTINEL
    readonly GQL_PR_STATE_CLOSED: typeof GQL_PR_STATE_CLOSED
    readonly GQL_PR_STATE_MERGED: typeof GQL_PR_STATE_MERGED
    readonly GQL_PR_STATE_OPEN: typeof GQL_PR_STATE_OPEN
    readonly HTTP_STATUS_BAD_REQUEST: typeof HTTP_STATUS_BAD_REQUEST
    readonly HTTP_STATUS_FORBIDDEN: typeof HTTP_STATUS_FORBIDDEN
    readonly HTTP_STATUS_INTERNAL_SERVER_ERROR: typeof HTTP_STATUS_INTERNAL_SERVER_ERROR
    readonly HTTP_STATUS_NOT_FOUND: typeof HTTP_STATUS_NOT_FOUND
    readonly HTTP_STATUS_TOO_MANY_REQUESTS: typeof HTTP_STATUS_TOO_MANY_REQUESTS
    readonly HTTP_STATUS_UNAUTHORIZED: typeof HTTP_STATUS_UNAUTHORIZED
    readonly kInternalsSymbol: typeof kInternalsSymbol
    readonly LOOP_SENTINEL: typeof LOOP_SENTINEL
    readonly NODE_MODULES: typeof NODE_MODULES
    readonly NODE_SEA_FUSE: typeof NODE_SEA_FUSE
    readonly NPM: typeof NPM
    readonly NPM_BUGGY_OVERRIDES_PATCHED_VERSION: typeof NPM_BUGGY_OVERRIDES_PATCHED_VERSION
    readonly NPM_REGISTRY_URL: typeof NPM_REGISTRY_URL
    readonly PYTHON_MIN_VERSION: typeof PYTHON_MIN_VERSION
    readonly NPM_SHRINKWRAP_JSON: typeof NPM_SHRINKWRAP_JSON
    readonly NPX: typeof NPX
    readonly OUTPUT_JSON: typeof OUTPUT_JSON
    readonly OUTPUT_MARKDOWN: typeof OUTPUT_MARKDOWN
    readonly OUTPUT_TEXT: typeof OUTPUT_TEXT
    readonly OVERRIDES: typeof OVERRIDES
    readonly PACKAGE_JSON: typeof PACKAGE_JSON
    readonly PACKAGE_LOCK_JSON: typeof PACKAGE_LOCK_JSON
    readonly PNPM: typeof PNPM
    readonly PNPM_LOCK_YAML: typeof PNPM_LOCK_YAML
    readonly PNPM_WORKSPACE_YAML: typeof PNPM_WORKSPACE_YAML
    readonly REDACTED: typeof REDACTED
    readonly REPORT_LEVEL_DEFER: typeof REPORT_LEVEL_DEFER
    readonly REPORT_LEVEL_ERROR: typeof REPORT_LEVEL_ERROR
    readonly REPORT_LEVEL_IGNORE: typeof REPORT_LEVEL_IGNORE
    readonly REPORT_LEVEL_MONITOR: typeof REPORT_LEVEL_MONITOR
    readonly REPORT_LEVEL_WARN: typeof REPORT_LEVEL_WARN
    readonly REQUIREMENTS_TXT: typeof REQUIREMENTS_TXT
    readonly SEA_DIR: typeof SEA_DIR
    readonly RESOLUTIONS: typeof RESOLUTIONS
    readonly SOCKET_CLI_APP_NAME: typeof SOCKET_CLI_APP_NAME
    readonly SOCKET_CLI_ACCEPT_RISKS: typeof SOCKET_CLI_ACCEPT_RISKS
    readonly SOCKET_CLI_BIN_NAME: typeof SOCKET_CLI_BIN_NAME
    readonly SOCKET_CLI_GITHUB_REPO: typeof SOCKET_CLI_GITHUB_REPO
    readonly SOCKET_CLI_ISSUES_URL: typeof SOCKET_CLI_ISSUES_URL
    readonly SOCKET_CLI_SHADOW_ACCEPT_RISKS: typeof SOCKET_CLI_SHADOW_ACCEPT_RISKS
    readonly SOCKET_CLI_SHADOW_API_TOKEN: typeof SOCKET_CLI_SHADOW_API_TOKEN
    readonly SOCKET_CLI_SHADOW_BIN: typeof SOCKET_CLI_SHADOW_BIN
    readonly SOCKET_CLI_SHADOW_PROGRESS: typeof SOCKET_CLI_SHADOW_PROGRESS
    readonly SOCKET_CLI_SHADOW_SILENT: typeof SOCKET_CLI_SHADOW_SILENT
    readonly SOCKET_CLI_VIEW_ALL_RISKS: typeof SOCKET_CLI_VIEW_ALL_RISKS
    readonly SOCKET_DEFAULT_BRANCH: typeof SOCKET_DEFAULT_BRANCH
    readonly SOCKET_DEFAULT_REPOSITORY: typeof SOCKET_DEFAULT_REPOSITORY
    readonly SOCKET_GITHUB_ORG: typeof SOCKET_GITHUB_ORG
    readonly SOCKET_IPC_HANDSHAKE: typeof SOCKET_IPC_HANDSHAKE
    readonly SOCKET_JSON: typeof SOCKET_JSON
    readonly SOCKET_PUBLIC_API_TOKEN: typeof SOCKET_PUBLIC_API_TOKEN
    readonly SOCKET_WEBSITE_URL: typeof SOCKET_WEBSITE_URL
    readonly SOCKET_YAML: typeof SOCKET_YAML
    readonly SOCKET_YML: typeof SOCKET_YML
    readonly TMP_DIR: typeof TMP_DIR
    readonly TOKEN_PREFIX: typeof TOKEN_PREFIX
    readonly TOKEN_PREFIX_LENGTH: typeof TOKEN_PREFIX_LENGTH
    readonly TSCONFIG_JSON: typeof TSCONFIG_JSON
    readonly UNKNOWN_ERROR: typeof UNKNOWN_ERROR
    readonly UNKNOWN_VALUE: typeof UNKNOWN_VALUE
    readonly V1_MIGRATION_GUIDE_URL: typeof V1_MIGRATION_GUIDE_URL
    readonly VLT: typeof VLT
    readonly VLT_LOCK_JSON: typeof VLT_LOCK_JSON
    readonly YARN: typeof YARN
    readonly YARN_BERRY: typeof YARN_BERRY
    readonly YARN_CLASSIC: typeof YARN_CLASSIC
    readonly YARN_LOCK: typeof YARN_LOCK
    readonly bashRcPath: string
    readonly binCliPath: string
    readonly binPath: string
    readonly distCliPath: string
    readonly distPath: string
    readonly externalPath: string
    readonly githubCachePath: string
    readonly homePath: string
    readonly preloadSentryPath: string
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
    readonly shadowNpmPreloadArboristPath: string
    readonly shadowNpxBinPath: string
    readonly shadowPnpmBinPath: string
    readonly socketAppDataPath: string
    readonly socketCachePath: string
    readonly socketRegistryPath: string
    readonly zshRcPath: string
    readonly DARWIN: boolean
    readonly WIN32: boolean
    readonly nodeNoWarningsFlags: string[]
    readonly spinner: any
    readonly abortSignal: AbortSignal
    readonly execPath: string
    readonly maintainedNodeVersions: readonly string[]
    readonly npmExecPath: string
    readonly pnpmExecPath: string
    readonly SUPPORTS_NODE_PERMISSION_FLAG: boolean
  }
>

let _Sentry: Sentry | undefined

let _npmStdioPipeOptions: SpawnOptions | undefined
function getNpmStdioPipeOptions() {
  if (_npmStdioPipeOptions === undefined) {
    _npmStdioPipeOptions = {
      cwd: process.cwd(),
      // On Windows, npm is often a .cmd file that requires shell execution.
      // The spawn function from @socketsecurity/registry will handle this properly
      // when shell is true.
      shell: constants.WIN32,
    }
  }
  return _npmStdioPipeOptions
}

// Inline implementation of getConfigValueOrUndef('apiBaseUrl') to avoid circular dependency.
// This reads the base64-encoded config file and extracts the apiBaseUrl value.
function getApiBaseUrlFromConfig(): string | undefined {
  const socketAppDataPath = lazySocketAppDataPath()
  if (!socketAppDataPath) {
    return undefined
  }
  try {
    const raw = safeReadFileSync(socketAppDataPath)
    if (!raw) {
      return undefined
    }
    const config = JSON.parse(
      Buffer.from(
        typeof raw === 'string' ? raw : raw.toString(),
        'base64',
      ).toString(),
    )
    return config?.['apiBaseUrl']
  } catch {
    return undefined
  }
}

const LAZY_ENV = () => {
  const { env } = process
  const envHelpers = /*@__PURE__*/ require('@socketsecurity/registry/lib/env')
  const envAsBoolean = envHelpers.envAsBoolean
  const envAsNumber = envHelpers.envAsNumber
  const envAsString = envHelpers.envAsString
  const GITHUB_TOKEN = envAsString(env['GITHUB_TOKEN'])
  const INLINED_SOCKET_CLI_NAME = envAsString(
    process.env['INLINED_SOCKET_CLI_NAME'],
  )
  const INLINED_SOCKET_CLI_PUBLISHED_BUILD = envAsBoolean(
    process.env['INLINED_SOCKET_CLI_PUBLISHED_BUILD'],
  )
  // We inline some environment values so that they CANNOT be influenced by user
  // provided environment variables.
  const ENV = Object.freeze({
    __proto__: null,
    // Lazily access registryConstants.ENV.
    ...regConsts.ENV,
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
    // Comp-time inlined Python version for python-build-standalone.
    // The '@rollup/plugin-replace' will replace "process.env['INLINED_SOCKET_CLI_PYTHON_VERSION']".
    INLINED_SOCKET_CLI_PYTHON_VERSION: envAsString(
      process.env['INLINED_SOCKET_CLI_PYTHON_VERSION'],
    ),
    // Comp-time inlined Python build tag for python-build-standalone releases.
    // The '@rollup/plugin-replace' will replace "process.env['INLINED_SOCKET_CLI_PYTHON_BUILD_TAG']".
    INLINED_SOCKET_CLI_PYTHON_BUILD_TAG: envAsString(
      process.env['INLINED_SOCKET_CLI_PYTHON_BUILD_TAG'],
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
    INLINED_SOCKET_CLI_NAME,
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
    // IPC channel file descriptor set by Node.js when spawning with IPC (stdio includes 'ipc').
    NODE_CHANNEL_FD: envAsNumber(env['NODE_CHANNEL_FD']),
    // Enable the module compile cache for the Node.js instance.
    // https://nodejs.org/api/cli.html#node_compile_cachedir
    NODE_COMPILE_CACHE: regConsts.SUPPORTS_NODE_COMPILE_CACHE_ENV_VAR
      ? constants.socketCachePath
      : '',
    // Redefine registryConstants.ENV['NODE_ENV'] to account for the
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
    // npm cache directory path. Used to detect if running from npm's npx cache
    // for temporary execution contexts.
    npm_config_cache: envAsString(env['npm_config_cache']),
    // Package manager user agent string that identifies which package manager
    // is executing commands. Used to detect temporary execution contexts like
    // npx, pnpm dlx, or yarn dlx.
    // Expected values:
    // - npm: 'npm/version node/version os arch' (e.g., 'npm/10.0.0 node/v20.0.0 darwin x64')
    // - npx: Similar to npm but may include 'npx' or 'exec' in the string
    // - yarn: 'yarn/version npm/? node/version os arch' (e.g., 'yarn/1.22.0 npm/? node/v20.0.0 darwin x64')
    // - pnpm: 'pnpm/version node/version os arch' (Note: Not set for pnpm dlx/create/init)
    // - When running via exec/npx/dlx, the string may contain 'exec', 'npx', or 'dlx'
    npm_config_user_agent: envAsString(env['npm_config_user_agent']),
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
      getApiBaseUrlFromConfig() ||
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
    // Enable Socket API response caching.
    SOCKET_CLI_CACHE_ENABLED: envAsString(env['SOCKET_CLI_CACHE_ENABLED']),
    // Socket API response cache TTL in milliseconds.
    SOCKET_CLI_CACHE_TTL: envAsString(env['SOCKET_CLI_CACHE_TTL']),
    // Local path to cdxgen binary for development/testing.
    SOCKET_CLI_CDXGEN_LOCAL_PATH: envAsString(
      env['SOCKET_CLI_CDXGEN_LOCAL_PATH'],
    ),
    // Local path to Coana CLI binary for development/testing.
    SOCKET_CLI_COANA_LOCAL_PATH: envAsString(
      env['SOCKET_CLI_COANA_LOCAL_PATH'],
    ),
    // A JSON stringified Socket configuration object.
    SOCKET_CLI_CONFIG: envAsString(env['SOCKET_CLI_CONFIG']),
    // The git config user.email used by Socket CLI.
    SOCKET_CLI_GIT_USER_EMAIL:
      envAsString(env['SOCKET_CLI_GIT_USER_EMAIL']) ||
      '94589996+socket-bot@users.noreply.github.com',
    // The git config user.name used by Socket CLI.
    SOCKET_CLI_GIT_USER_NAME:
      envAsString(env['SOCKET_CLI_GIT_USER_NAME']) ||
      envAsString(env['SOCKET_CLI_GIT_USERNAME']) ||
      'Socket Bot',
    // Change the base URL for GitHub REST API calls.
    // https://docs.github.com/en/rest
    // Note: Cannot use readOrDefaultSocketJson() here due to circular dependency.
    SOCKET_CLI_GITHUB_API_URL:
      envAsString(env['SOCKET_CLI_GITHUB_API_URL']) || 'https://api.github.com',
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
    // Flag to signal the preload phase of Node (for yao-pkg/SEA subprocesses).
    SOCKET_CLI_PRELOAD_PHASE: envAsBoolean(
      env['SOCKET_CLI_PRELOAD_PHASE'],
    ),
    // Local path to synp/fork-write binary for development/testing.
    SOCKET_CLI_SFW_LOCAL_PATH: envAsString(env['SOCKET_CLI_SFW_LOCAL_PATH']),
    // View all risks of a Socket wrapped npm/npx run.
    SOCKET_CLI_VIEW_ALL_RISKS: envAsBoolean(env[SOCKET_CLI_VIEW_ALL_RISKS]),
    // NPM registry URL.
    NPM_REGISTRY: envAsString(env['NPM_REGISTRY']),
    // Socket CLI directory.
    SOCKET_CLI_DIR: envAsString(env['SOCKET_CLI_DIR']),
    // Socket home directory.
    SOCKET_HOME: envAsString(env['SOCKET_HOME']),
    // Socket Node.js download URL.
    SOCKET_NODE_DOWNLOAD_URL: envAsString(env['SOCKET_NODE_DOWNLOAD_URL']),
    // Socket npm registry URL.
    SOCKET_NPM_REGISTRY: envAsString(env['SOCKET_NPM_REGISTRY']),
    // Specifies the type of terminal or terminal emulator being used by the process.
    TERM: envAsString(env['TERM']),
    // Redefine registryConstants.ENV['VITEST'] to account for the
    // INLINED_SOCKET_CLI_PUBLISHED_BUILD environment variable.
    VITEST: INLINED_SOCKET_CLI_PUBLISHED_BUILD
      ? false
      : envAsBoolean(process.env['VITEST']),
  })

  // Guard: Detect build/test mode mismatch.
  const runtimeVitestValue = envAsBoolean(env['VITEST'])
  const builtForTesting = ENV.VITEST
  if (
    INLINED_SOCKET_CLI_NAME === 'socket' &&
    !INLINED_SOCKET_CLI_PUBLISHED_BUILD &&
    !builtForTesting &&
    runtimeVitestValue
  ) {
    // Check if running as SEA binary (inline to avoid require issues after bundling).
    let isSea = false
    try {
      const seaModule = require('node:sea')
      isSea = seaModule.isSea()
    } catch {
      // Node.js < 24 or SEA not available
      isSea = false
    }

    if (!isSea) {
      const { logger } = require('@socketsecurity/registry/lib/logger')
      logger.warn(
        'Build/test mode mismatch! Built without VITEST=1 but running in test mode.',
      )
      logger.warn(
        'This causes snapshot failures. Rebuild with: pnpm run pretest:unit',
      )
    }
  }

  return ENV
}

const lazyBashRcPath = () => path.join(constants.homePath, '.bashrc')

const lazyBinPath = () => path.join(constants.rootPath, 'bin')

const lazyBinCliPath = () => path.join(constants.binPath, 'cli.js')

const lazyDistCliPath = () => path.join(constants.distPath, 'cli.js')

const lazyDistPath = () => path.join(constants.rootPath, 'dist')

const lazyExternalPath = () => path.join(constants.distPath, 'external')

const lazyGithubCachePath = () => path.join(constants.socketCachePath, 'github')

const lazyHomePath = () => {
  // Try to get home directory with multiple fallbacks
  try {
    const home = os.homedir()
    if (home) {return home}
  } catch {
    // os.homedir() can throw in some environments
  }

  // Fallback to environment variables
  const homeEnv = process.env['HOME'] || process.env['USERPROFILE']
  if (homeEnv) {return homeEnv}

  // Last resort: use temp directory as a fallback
  // This ensures the CLI can still run in containerized/restricted environments
  const tmpHome = path.join(os.tmpdir(), '.socket-cli-home')
  console.warn(`Warning: Using temporary directory as home: ${tmpHome}`)
  return tmpHome
}

const lazyPreloadSentryPath = () =>
  path.join(constants.distPath, 'preload-sentry.js')

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
  constants.ENV['SOCKET_CLI_DEBUG']
    ? ['--trace-uncaught', '--trace-warnings']
    : []

// Redefine registryConstants.nodeHardenFlags to account for the
// INLINED_SOCKET_CLI_SENTRY_BUILD environment variable.
const lazyNodeHardenFlags = () =>
  Object.freeze(
    // Harden Node security.
    // https://nodejs.org/en/learn/getting-started/security-best-practices
    constants.ENV['INLINED_SOCKET_CLI_SENTRY_BUILD'] || constants.WIN32
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
  // Memory limit flags commented out - no defaults applied
  // const flags = /*@__PURE__*/ require(
  //   path.join(constants.rootPath, 'dist/flags.js'),
  // )
  // const getMaxOldSpaceSizeFlag = flags.getMaxOldSpaceSizeFlag
  // const getMaxSemiSpaceSizeFlag = flags.getMaxSemiSpaceSizeFlag
  // return Object.freeze([
  //   `--max-old-space-size=${getMaxOldSpaceSizeFlag()}`,
  //   `--max-semi-space-size=${getMaxSemiSpaceSizeFlag()}`,
  // ])
  // Return empty array - no memory flags.
  return Object.freeze([])
}

const lazyNpmCachePath = () => {
  const spawnHelpers = /*@__PURE__*/ require('@socketsecurity/registry/lib/spawn')
  const spawnSync = spawnHelpers.spawnSync
  return spawnSync(
    regConsts.npmExecPath,
    ['config', 'get', 'cache'],
    getNpmStdioPipeOptions(),
  ).stdout.toString()
}

const lazyNpmGlobalPrefix = () => {
  const spawnHelpers = /*@__PURE__*/ require('@socketsecurity/registry/lib/spawn')
  const spawnSync = spawnHelpers.spawnSync
  return spawnSync(
    regConsts.npmExecPath,
    ['prefix', '-g'],
    getNpmStdioPipeOptions(),
  ).stdout.toString()
}

const lazyNpmNmNodeGypPath = () =>
  path.join(
    regConsts.npmRealExecPath,
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

const lazyShadowNpmPreloadArboristPath = () =>
  path.join(constants.distPath, 'shadow-npm-preload-arborist.js')

const lazyShadowNpxBinPath = () =>
  path.join(constants.distPath, 'shadow-npx-bin.js')

const lazyShadowPnpmBinPath = () =>
  path.join(constants.distPath, 'shadow-pnpm-bin.js')

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
    ? regConsts.ENV['LOCALAPPDATA']
    : regConsts.ENV['XDG_DATA_HOME']
  if (!dataHome) {
    if (WIN32) {
      const logger = /*@__PURE__*/ require('@socketsecurity/registry/lib/logger')
      logger.warn(`Missing %LOCALAPPDATA%.`)
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
  path.join(constants.externalPath, '@socketsecurity/registry/dist')

const lazyZshRcPath = () => path.join(constants.homePath, '.zshrc')

const constants: Constants = createConstantsObject(
  {
    ...registryConstantsAttribs.props,
    // Override execPath since registry v1.3.0 has a bug accessing it.
    execPath: process.execPath,
    ALERT_TYPE_CRITICAL_CVE,
    ALERT_TYPE_CVE,
    ALERT_TYPE_MEDIUM_CVE,
    ALERT_TYPE_MILD_CVE,
    API_V0_URL,
    CLI_DIR,
    BUN,
    CACHE_DIR,
    CACHE_GITHUB_DIR,
    CACHE_SOCKET_API_DIR,
    CACHE_TTL_DIR,
    CONFIG_KEY_API_BASE_URL,
    CONFIG_KEY_API_PROXY,
    CONFIG_KEY_API_TOKEN,
    CONFIG_KEY_CACHE_ENABLED,
    CONFIG_KEY_CACHE_TTL,
    CONFIG_KEY_DEFAULT_ORG,
    CONFIG_KEY_ENFORCED_ORGS,
    CONFIG_KEY_ORG,
    DOT_GIT_DIR,
    DOT_SOCKET_DIR,
    DOT_SOCKET_DOT_FACTS_JSON,
    DRY_RUN_BAILING_NOW,
    DRY_RUN_LABEL,
    DRY_RUN_NOT_SAVING,
    ENV: undefined,
    ENVIRONMENT_YAML,
    ENVIRONMENT_YML,
    ERROR_NO_MANIFEST_FILES,
    ERROR_NO_PACKAGE_JSON,
    ERROR_NO_REPO_FOUND,
    ERROR_NO_SOCKET_DIR,
    ERROR_UNABLE_RESOLVE_ORG,
    EXT_YAML,
    EXT_YML,
    FLAG_CONFIG,
    FLAG_DRY_RUN,
    FLAG_HELP,
    FLAG_HELP_FULL,
    FLAG_ID,
    FLAG_JSON,
    FLAG_LOGLEVEL,
    FLAG_MARKDOWN,
    FLAG_ORG,
    FLAG_PIN,
    FLAG_PROD,
    FLAG_QUIET,
    FLAG_SILENT,
    FLAG_TEXT,
    FLAG_VERBOSE,
    FLAG_VERSION,
    FOLD_SETTING_FILE,
    FOLD_SETTING_NONE,
    FOLD_SETTING_PKG,
    FOLD_SETTING_VERSION,
    GQL_PAGE_SENTINEL,
    GQL_PR_STATE_CLOSED,
    GQL_PR_STATE_MERGED,
    GQL_PR_STATE_OPEN,
    HTTP_STATUS_BAD_REQUEST,
    HTTP_STATUS_FORBIDDEN,
    HTTP_STATUS_INTERNAL_SERVER_ERROR,
    HTTP_STATUS_NOT_FOUND,
    HTTP_STATUS_TOO_MANY_REQUESTS,
    HTTP_STATUS_UNAUTHORIZED,
    NODE_MODULES,
    NPM_BUGGY_OVERRIDES_PATCHED_VERSION,
    NPM_REGISTRY_URL,
    PYTHON_MIN_VERSION,
    NPX,
    OUTPUT_JSON,
    OUTPUT_MARKDOWN,
    OUTPUT_TEXT,
    PACKAGE_JSON,
    PACKAGE_LOCK_JSON,
    PNPM,
    PNPM_LOCK_YAML,
    PNPM_WORKSPACE_YAML,
    REDACTED,
    REPORT_LEVEL_DEFER,
    REPORT_LEVEL_ERROR,
    REPORT_LEVEL_IGNORE,
    REPORT_LEVEL_MONITOR,
    REPORT_LEVEL_WARN,
    REQUIREMENTS_TXT,
    SEA_DIR,
    SOCKET_CLI_APP_NAME,
    SOCKET_CLI_ACCEPT_RISKS,
    SOCKET_CLI_BIN_NAME,
    SOCKET_CLI_GITHUB_REPO,
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
    SOCKET_YAML,
    SOCKET_YML,
    TMP_DIR,
    TOKEN_PREFIX,
    TOKEN_PREFIX_LENGTH,
    TSCONFIG_JSON,
    UNKNOWN_ERROR,
    UNKNOWN_VALUE,
    UPDATER_BACKUPS_DIR,
    UPDATER_DIR,
    UPDATER_DOWNLOADS_DIR,
    UPDATER_STAGING_DIR,
    UPDATER_STATE_JSON,
    V1_MIGRATION_GUIDE_URL,
    VLT,
    YARN,
    YARN_BERRY,
    YARN_CLASSIC,
    bashRcPath: undefined,
    binPath: undefined,
    binCliPath: undefined,
    distCliPath: undefined,
    distPath: undefined,
    externalPath: undefined,
    githubCachePath: undefined,
    homePath: undefined,
    preloadSentryPath: undefined,
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
    shadowNpmPreloadArboristPath: undefined,
    shadowNpmBinPath: undefined,
    shadowPnpmBinPath: undefined,
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
      distCliPath: lazyDistCliPath,
      distPath: lazyDistPath,
      externalPath: lazyExternalPath,
      githubCachePath: lazyGithubCachePath,
      homePath: lazyHomePath,
      preloadSentryPath: lazyPreloadSentryPath,
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
      shadowNpmPreloadArboristPath: lazyShadowNpmPreloadArboristPath,
      shadowNpxBinPath: lazyShadowNpxBinPath,
      shadowPnpmBinPath: lazyShadowPnpmBinPath,
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
  // Re-exported from socket-registry.
  AT_LATEST,
  BUN,
  CHANGELOG_MD,
  CI,
  COLUMN_LIMIT,
  DOT_GIT_DIR,
  DOT_PACKAGE_LOCK_JSON,
  DOT_SOCKET_DIR,
  EMPTY_FILE,
  EMPTY_VALUE,
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
  EXT_YAML,
  EXT_YML,
  GITIGNORE,
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
  NODE_SEA_FUSE,
  NPM,
  NPX,
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
  REGISTRY,
  REGISTRY_SCOPE_DELIMITER,
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
  TSCONFIG_JSON,
  UNKNOWN_ERROR,
  UNKNOWN_VALUE,
  UNLICENCED,
  UNLICENSED,
  UTF8,
  VITEST,
  VLT,
  YARN,
  YARN_BERRY,
  YARN_CLASSIC,
  YARN_LOCK,
  BUN_LOCK,
  BUN_LOCKB,
  NPM_SHRINKWRAP_JSON,
  VLT_LOCK_JSON,
  // Socket CLI specific constants.
  ALERT_TYPE_CRITICAL_CVE,
  ALERT_TYPE_CVE,
  ALERT_TYPE_MEDIUM_CVE,
  ALERT_TYPE_MILD_CVE,
  API_V0_URL,
  CACHE_DIR,
  CACHE_GITHUB_DIR,
  CACHE_SOCKET_API_DIR,
  CACHE_TTL_DIR,
  CONFIG_KEY_API_BASE_URL,
  CONFIG_KEY_API_PROXY,
  CONFIG_KEY_API_TOKEN,
  CONFIG_KEY_CACHE_ENABLED,
  CONFIG_KEY_CACHE_TTL,
  CONFIG_KEY_DEFAULT_ORG,
  CONFIG_KEY_ENFORCED_ORGS,
  CONFIG_KEY_ORG,
  DLX_BINARY_CACHE_TTL,
  DOT_SOCKET_DOT_FACTS_JSON,
  DRY_RUN_BAILING_NOW,
  DRY_RUN_LABEL,
  DRY_RUN_NOT_SAVING,
  ENVIRONMENT_YAML,
  SEA_UPDATE_COMMAND,
  UPDATE_CHECK_TTL,
  UPDATE_NOTIFIER_TIMEOUT,
  UPDATE_STORE_DIR,
  UPDATE_STORE_FILE_NAME,
  CLI_INSTALL_LOCK_FILE_NAME,
  ENVIRONMENT_YML,
  ERROR_NO_MANIFEST_FILES,
  ERROR_NO_PACKAGE_JSON,
  ERROR_NO_REPO_FOUND,
  ERROR_NO_SOCKET_DIR,
  ERROR_UNABLE_RESOLVE_ORG,
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_HELP_FULL,
  FLAG_ID,
  FLAG_JSON,
  FLAG_LOGLEVEL,
  FLAG_MARKDOWN,
  FLAG_ORG,
  FLAG_PIN,
  FLAG_PROD,
  FLAG_QUIET,
  FLAG_SILENT,
  FLAG_TEXT,
  FLAG_VERBOSE,
  FLAG_VERSION,
  FOLD_SETTING_FILE,
  FOLD_SETTING_NONE,
  FOLD_SETTING_PKG,
  FOLD_SETTING_VERSION,
  GQL_PAGE_SENTINEL,
  GQL_PR_STATE_CLOSED,
  GQL_PR_STATE_MERGED,
  GQL_PR_STATE_OPEN,
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_FORBIDDEN,
  HTTP_STATUS_INTERNAL_SERVER_ERROR,
  HTTP_STATUS_NOT_FOUND,
  HTTP_STATUS_TOO_MANY_REQUESTS,
  HTTP_STATUS_UNAUTHORIZED,
  NPM_BUGGY_OVERRIDES_PATCHED_VERSION,
  NPM_REGISTRY_URL,
  PYTHON_MIN_VERSION,
  OUTPUT_JSON,
  OUTPUT_MARKDOWN,
  OUTPUT_TEXT,
  PNPM_WORKSPACE_YAML,
  REDACTED,
  REPORT_LEVEL_DEFER,
  REPORT_LEVEL_ERROR,
  REPORT_LEVEL_IGNORE,
  REPORT_LEVEL_MONITOR,
  REPORT_LEVEL_WARN,
  REQUIREMENTS_TXT,
  CLI_DIR,
  SEA_DIR,
  TMP_DIR,
  UPDATER_BACKUPS_DIR,
  UPDATER_DIR,
  UPDATER_DOWNLOADS_DIR,
  UPDATER_STAGING_DIR,
  UPDATER_STATE_JSON,
  SOCKET_CLI_APP_NAME,
  SOCKET_CLI_ACCEPT_RISKS,
  SOCKET_CLI_BIN_NAME,
  SOCKET_CLI_GITHUB_REPO,
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
  SOCKET_YAML,
  SOCKET_YML,
  TOKEN_PREFIX,
  TOKEN_PREFIX_LENGTH,
  V1_MIGRATION_GUIDE_URL,
}

export default constants
