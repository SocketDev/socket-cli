/**
 * Main constants module that re-exports from modular constant files.
 * This maintains backward compatibility while using the new modular structure.
 */

import registryConstants from '@socketsecurity/registry/lib/constants'

// Re-export all static constants.
export * from './constants/static.mts'

// Import and re-export lazy constants.
import { lazyConstants } from './constants/lazy.mts'

// Import ENV module.
import ENV from './constants/env.mts'

// Import static constants that we need to reference.
import { DOT_SOCKET_DIR } from './constants/static.mts'

// Export individual lazy constants for backward compatibility.
export const bashRcPath = lazyConstants.bashRcPath
export const binCliPath = lazyConstants.binCliPath
export const binPath = lazyConstants.binPath
export const blessedContribPath = lazyConstants.blessedContribPath
export const blessedOptions = lazyConstants.blessedOptions
export const blessedPath = lazyConstants.blessedPath
export const distBinPath = lazyConstants.distBinPath
export const distPackageJsonPath = lazyConstants.distPackageJsonPath
export const distPath = lazyConstants.distPath
export const externalPath = lazyConstants.externalPath
export const nmBunPath = lazyConstants.nmBunPath
export const nmNodeGypPath = lazyConstants.nmNodeGypPath
export const nmNpmPath = lazyConstants.nmNpmPath
export const nmPnpmPath = lazyConstants.nmPnpmPath
export const nmYarnPath = lazyConstants.nmYarnPath
export const packageJsonPath = lazyConstants.packageJsonPath
export const rootPath = lazyConstants.rootPath
export const shadowBinPath = lazyConstants.shadowBinPath
export const shadowNpmBinPath = lazyConstants.shadowNpmBinPath
export const shadowNpmInjectPath = lazyConstants.shadowNpmInjectPath
export const shadowNpxBinPath = lazyConstants.shadowNpxBinPath
export const shadowPnpmBinPath = lazyConstants.shadowPnpmBinPath
export const shadowYarnBinPath = lazyConstants.shadowYarnBinPath
export const socketAppDataPath = lazyConstants.socketAppDataPath
export const socketCachePath = lazyConstants.socketCachePath
export const socketRegistryPath = lazyConstants.socketRegistryPath
export const srcPath = lazyConstants.srcPath
export const zshRcPath = lazyConstants.zshRcPath

// Re-export internals symbol.
export const kInternalsSymbol = registryConstants.kInternalsSymbol
export const registryConstantsAttribs =
  registryConstants[kInternalsSymbol as unknown as 'Symbol(kInternalsSymbol)']
    .attributes

// Additional Socket CLI specific constants.
export const ALERT_TYPE_CRITICAL_CVE = 'criticalCVE'
export const ALERT_TYPE_CVE = 'cve'
export const ALERT_TYPE_MEDIUM_CVE = 'mediumCVE'
export const ALERT_TYPE_MILD_CVE = 'mildCVE'
export const API_V0_URL = 'https://api.socket.dev/v0/'
export const CONFIG_KEY_API_BASE_URL = 'apiBaseUrl'
export const CONFIG_KEY_API_PROXY = 'apiProxy'
export const CONFIG_KEY_API_TOKEN = 'apiToken'
export const CONFIG_KEY_DEFAULT_ORG = 'defaultOrg'
export const CONFIG_KEY_ENFORCED_ORGS = 'enforcedOrgs'
export const CONFIG_KEY_ORG = 'org'
export const DOT_SOCKET_DOT_FACTS_JSON = `${DOT_SOCKET_DIR}.facts.json`
export const DLX_BINARY_CACHE_TTL = 7 * 24 * 60 * 60 * 1_000
export const DRY_RUN_LABEL = '[DryRun]'
export const DRY_RUN_BAILING_NOW = `${DRY_RUN_LABEL}: Bailing now`
export const DRY_RUN_NOT_SAVING = `${DRY_RUN_LABEL}: Not saving`
export const ENVIRONMENT_YAML = 'environment.yaml'
export const ENVIRONMENT_YML = 'environment.yml'
export const ERROR_NO_MANIFEST_FILES = 'No manifest files found'
export const ERROR_NO_PACKAGE_JSON = 'No package.json found'
export const ERROR_NO_REPO_FOUND = 'No repo found'
export const ERROR_NO_SOCKET_DIR = 'No .socket directory found'
export const ERROR_UNABLE_RESOLVE_ORG =
  'Unable to resolve a Socket account organization'
export const FLAG_CONFIG = '--config'
export const FLAG_DRY_RUN = '--dry-run'
export const FLAG_HELP = '--help'
export const FLAG_HELP_FULL = '--help-full'
export const FLAG_ID = '--id'
export const FLAG_JSON = '--json'
export const FLAG_LOGLEVEL = '--loglevel'
export const FLAG_MARKDOWN = '--markdown'
export const FLAG_ORG = '--org'
export const FLAG_PIN = '--pin'
export const FLAG_PROD = '--prod'
export const FLAG_QUIET = '--quiet'
export const FLAG_SILENT = '--silent'
export const FLAG_TEXT = '--text'
export const FLAG_VERBOSE = '--verbose'
export const FLAG_VERSION = '--version'
export const FOLD_SETTING_FILE = 'file'
export const FOLD_SETTING_NONE = 'none'
export const FOLD_SETTING_PKG = 'pkg'
export const FOLD_SETTING_VERSION = 'version'
export const GQL_PAGE_SENTINEL = 100
export const GQL_PR_STATE_CLOSED = 'CLOSED'
export const GQL_PR_STATE_MERGED = 'MERGED'
export const GQL_PR_STATE_OPEN = 'OPEN'
export const HTTP_STATUS_BAD_REQUEST = 400
export const HTTP_STATUS_FORBIDDEN = 403
export const HTTP_STATUS_INTERNAL_SERVER_ERROR = 500
export const HTTP_STATUS_NOT_FOUND = 404
export const HTTP_STATUS_TOO_MANY_REQUESTS = 429
export const HTTP_STATUS_UNAUTHORIZED = 401
export const NPM_BUGGY_OVERRIDES_PATCHED_VERSION = '11.2.0'
export const NPM_REGISTRY_URL = 'https://registry.npmjs.org'
export const OUTPUT_JSON = 'json'
export const OUTPUT_MARKDOWN = 'markdown'
export const OUTPUT_TEXT = 'text'
export const PNPM_WORKSPACE_YAML = 'pnpm-workspace.yaml'
export const REDACTED = '<redacted>'
export const REPORT_LEVEL_DEFER = 'defer'
export const REPORT_LEVEL_ERROR = 'error'
export const REPORT_LEVEL_IGNORE = 'ignore'
export const REPORT_LEVEL_MONITOR = 'monitor'
export const REPORT_LEVEL_WARN = 'warn'
export const REQUIREMENTS_TXT = 'requirements.txt'
export const SEA_UPDATE_COMMAND = 'self-update'
export const SOCKET_CLI_ACCEPT_RISKS = 'SOCKET_CLI_ACCEPT_RISKS'
export const SOCKET_CLI_GITHUB_REPO = 'socket-cli'
export const SOCKET_CLI_ISSUES_URL =
  'https://github.com/SocketDev/socket-cli/issues'
export const SOCKET_CLI_SHADOW_ACCEPT_RISKS = 'SOCKET_CLI_SHADOW_ACCEPT_RISKS'
export const SOCKET_CLI_SHADOW_API_TOKEN = 'SOCKET_CLI_SHADOW_API_TOKEN'
export const SOCKET_CLI_SHADOW_BIN = 'SOCKET_CLI_SHADOW_BIN'
export const SOCKET_CLI_SHADOW_PROGRESS = 'SOCKET_CLI_SHADOW_PROGRESS'
export const SOCKET_CLI_SHADOW_SILENT = 'SOCKET_CLI_SHADOW_SILENT'
export const SOCKET_CLI_VIEW_ALL_RISKS = 'SOCKET_CLI_VIEW_ALL_RISKS'
export const SOCKET_DEFAULT_BRANCH = 'socket-default-branch'
export const SOCKET_DEFAULT_REPOSITORY = 'socket-default-repository'
export const SOCKET_JSON = 'socket.json'
export const SOCKET_WEBSITE_URL = 'https://socket.dev'
export const SOCKET_YAML = 'socket.yaml'
export const SOCKET_YML = 'socket.yml'
export const TOKEN_PREFIX = 'sktsec_'
export const TOKEN_PREFIX_LENGTH = TOKEN_PREFIX.length
export const UPDATE_CHECK_TTL = 24 * 60 * 60 * 1_000
export const UPDATE_NOTIFIER_TIMEOUT = 10_000
export const UPDATE_STORE_DIR = '.socket/_socket'
export const UPDATE_STORE_FILE_NAME = 'update-store.json'
export const V1_MIGRATION_GUIDE_URL =
  'https://docs.socket.dev/docs/v1-migration-guide'

// Export ENV.
export { ENV }

// Type exports.
export type { Agent } from './utils/package-environment.mts'
export type { Remap } from '@socketsecurity/registry/lib/objects'
export type { SpawnOptions } from '@socketsecurity/registry/lib/spawn'

export type RegistryEnv = typeof registryConstants.ENV
export type RegistryInternals =
  (typeof registryConstants)['Symbol(kInternalsSymbol)']

export type Sentry = any

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
  [K in keyof typeof ENV]?: string | undefined
}

// Default export for backward compatibility.
const constants = {
  ...registryConstants,
  ...lazyConstants,
  // Override with Socket CLI specific constants.
  ALERT_TYPE_CRITICAL_CVE,
  ALERT_TYPE_CVE,
  ALERT_TYPE_MEDIUM_CVE,
  ALERT_TYPE_MILD_CVE,
  API_V0_URL,
  CONFIG_KEY_API_BASE_URL,
  CONFIG_KEY_API_PROXY,
  CONFIG_KEY_API_TOKEN,
  CONFIG_KEY_DEFAULT_ORG,
  CONFIG_KEY_ENFORCED_ORGS,
  CONFIG_KEY_ORG,
  DOT_SOCKET_DOT_FACTS_JSON,
  DLX_BINARY_CACHE_TTL,
  DRY_RUN_BAILING_NOW,
  DRY_RUN_LABEL,
  DRY_RUN_NOT_SAVING,
  ENV,
  ENVIRONMENT_YAML,
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
  SEA_UPDATE_COMMAND,
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
  UPDATE_CHECK_TTL,
  UPDATE_NOTIFIER_TIMEOUT,
  UPDATE_STORE_DIR,
  UPDATE_STORE_FILE_NAME,
  V1_MIGRATION_GUIDE_URL,
}

export default constants
