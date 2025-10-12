/**
 * Static constants that don't require any runtime computation or dependencies.
 * These are safe to bundle and won't cause circular dependencies.
 */

import path from 'node:path'

import registryConstants from '@socketsecurity/registry/lib/constants'

// Map the new constants structure to the old names for compatibility
const c = registryConstants as any
export const AT_LATEST = c.AT_LATEST ?? '@latest'
export const LATEST = 'latest'
export const BUN = c.BUN ?? 'bun'
export const CHANGELOG_MD = c.CHANGELOG_MD ?? 'CHANGELOG.md'
export const CI = c.CI ?? false
export const COLUMN_LIMIT = c.COLUMN_LIMIT ?? 80
export const DOT_GIT_DIR = c.DOT_GIT_DIR ?? '.git'
export const DOT_SOCKET_DIR = c.DOT_SOCKET_DIR ?? '.socket'
export const EMPTY_FILE = c.EMPTY_FILE ?? ''
export const EMPTY_VALUE = c.EMPTY_VALUE ?? ''
export const ESLINT_CONFIG_JS = c.ESLINT_CONFIG_JS ?? 'eslint.config.js'
export const ESNEXT = c.ESNEXT ?? 'esnext'
export const EXT_CJS = c.EXT_CJS ?? '.cjs'
export const EXT_CMD = c.EXT_CMD ?? '.cmd'
export const EXT_CTS = c.EXT_CTS ?? '.cts'
export const EXT_DTS = c.EXT_DTS ?? '.d.ts'
export const EXT_JS = c.EXT_JS ?? '.js'
export const EXT_JSON = c.EXT_JSON ?? '.json'
export const EXT_LOCK = c.EXT_LOCK ?? '.lock'
export const EXT_LOCKB = c.EXT_LOCKB ?? '.lockb'
export const EXT_MD = c.EXT_MD ?? '.md'
export const EXT_MJS = c.EXT_MJS ?? '.mjs'
export const EXT_MTS = c.EXT_MTS ?? '.mts'
export const EXT_PS1 = c.EXT_PS1 ?? '.ps1'
export const EXT_YAML = c.EXT_YAML ?? '.yaml'
export const EXT_YML = c.EXT_YML ?? '.yml'
export const EXTENSIONS = {
  CJS: EXT_CJS,
  CTS: EXT_CTS,
  DTS: EXT_DTS,
  JS: EXT_JS,
  JSON: EXT_JSON,
  LOCK: EXT_LOCK,
  LOCKB: EXT_LOCKB,
  MD: EXT_MD,
  MJS: EXT_MJS,
  MTS: EXT_MTS,
  YAML: EXT_YAML,
  YML: EXT_YML,
}
export const EXTENSIONS_JSON = c.EXTENSIONS_JSON ?? 'extensions.json'
export const GITIGNORE = c.GITIGNORE ?? '.gitignore'
export const DOT_PACKAGE_LOCK_JSON =
  c.DOT_PACKAGE_LOCK_JSON ?? '.package-lock.json'
export const DOT_PACKAGE_LOCK_YML = '.package-lock.yml'
export const DOT_PNPM_LOCK_YAML = c.DOT_PNPM_LOCK_YAML ?? '.pnpm-lock.yaml'
export const INDEX = 'index'
export const INDEX_JS = 'index.js'
export const JS = 'js'
export const LICENSE = c.LICENSE ?? 'LICENSE'
export const LICENSE_MD = 'LICENSE.md'
export const MANIFEST_JSON = c.MANIFEST_JSON ?? 'manifest.json'
export const NODE = 'node'
export const NODE_MODULES = c.NODE_MODULES ?? 'node_modules'
export const NODE_MODULES_GLOB_RECURSIVE =
  c.NODE_MODULES_GLOB_RECURSIVE ?? '**/node_modules/**'
export const NPM = c.NPM ?? 'npm'
export const NPMIGNORE = '.npmignore'
export const NPMRC = '.npmrc'
export const NPX = c.NPX ?? 'npx'
export const PACKAGE = 'package'
export const PACKAGE_JSON = c.PACKAGE_JSON ?? 'package.json'
export const PACKAGE_LOCK = 'package-lock'
export const PACKAGE_LOCK_JSON = c.PACKAGE_LOCK_JSON ?? 'package-lock.json'
export const PNPM = c.PNPM ?? 'pnpm'
export const PNPM_LOCK = 'pnpm-lock'
export const PNPM_LOCK_YAML = c.PNPM_LOCK_YAML ?? 'pnpm-lock.yaml'
export const README_MD = c.README_MD ?? 'README.md'
export const ROLLUP_EXTERNAL_SUFFIX = '.external.js'
export const SLASH_NODE_MODULES_SLASH = '/node_modules/'
export const TEST = 'test'
export const TS = 'ts'
export const TSX = 'tsx'
export const UTF8 = 'utf8'
export const UNKNOWN_ERROR = 'Unknown error'
export const UNKNOWN_VALUE = 'unknown'
export const UNLICENCED = 'UNLICENCED'
export const UNLICENSED = 'UNLICENSED'
export const V = 'v'
export const VITEST = 'vitest'
export const VLT = c.VLT ?? 'vlt'
export const WIN32 = 'win32'
export const YARN = c.YARN ?? 'yarn'
export const YARN_BERRY = 'yarn_berry'
export const YARN_CLASSIC = 'yarn_classic'
export const YARN_LOCK = c.YARN_LOCK ?? 'yarn.lock'

// Socket CLI specific static constants
export const BLESSED = 'blessed'
export const BLESSED_CONTRIB = 'blessed-contrib'
export const FLAGS = 'flags'
export const SENTRY_NODE = '@sentry/node'
export const SOCKET_DESCRIPTION = 'CLI for Socket.dev'
export const SOCKET_DESCRIPTION_WITH_SENTRY = `${SOCKET_DESCRIPTION}, includes Sentry error handling`
export const SOCKET_SECURITY_REGISTRY = '@socketsecurity/registry'
export const UTILS = 'utils'
export const VENDOR = 'vendor'

// Inline environment variable names
export const INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION =
  'INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION'
export const INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION =
  'INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION'
export const INLINED_SOCKET_CLI_HOMEPAGE = 'INLINED_SOCKET_CLI_HOMEPAGE'
export const INLINED_SOCKET_CLI_LEGACY_BUILD = 'INLINED_SOCKET_CLI_LEGACY_BUILD'
export const INLINED_SOCKET_CLI_NAME = 'INLINED_SOCKET_CLI_NAME'
export const INLINED_SOCKET_CLI_PUBLISHED_BUILD =
  'INLINED_SOCKET_CLI_PUBLISHED_BUILD'
export const INLINED_SOCKET_CLI_PYTHON_BUILD_TAG =
  'INLINED_SOCKET_CLI_PYTHON_BUILD_TAG'
export const INLINED_SOCKET_CLI_PYTHON_VERSION =
  'INLINED_SOCKET_CLI_PYTHON_VERSION'
export const INLINED_SOCKET_CLI_SENTRY_BUILD = 'INLINED_SOCKET_CLI_SENTRY_BUILD'
export const INLINED_SOCKET_CLI_SYNP_VERSION = 'INLINED_SOCKET_CLI_SYNP_VERSION'
export const INLINED_SOCKET_CLI_UNIFIED_BUILD =
  'INLINED_SOCKET_CLI_UNIFIED_BUILD'
export const INLINED_SOCKET_CLI_VERSION = 'INLINED_SOCKET_CLI_VERSION'
export const INLINED_SOCKET_CLI_VERSION_HASH = 'INLINED_SOCKET_CLI_VERSION_HASH'

// Socket CLI binary names
export const SOCKET_CLI_BIN_NAME = 'socket'
export const SOCKET_CLI_BIN_NAME_ALIAS = 'socket-dev'
export const SOCKET_CLI_LEGACY_PACKAGE_NAME = 'socket-npm'
export const SOCKET_CLI_NPM_BIN_NAME = 'socket-npm'
export const SOCKET_CLI_NPX_BIN_NAME = 'socket-npx'
export const SOCKET_CLI_PACKAGE_NAME = 'socket'
export const SOCKET_CLI_PNPM_BIN_NAME = 'socket-pnpm'
export const SOCKET_CLI_SENTRY_BIN_NAME = '@socketsecurity/cli-with-sentry'
export const SOCKET_CLI_SENTRY_BIN_NAME_ALIAS = 'socket-dev-with-sentry'
export const SOCKET_CLI_SENTRY_NPM_BIN_NAME =
  '@socketsecurity/cli-with-sentry-npm'
export const SOCKET_CLI_SENTRY_NPX_BIN_NAME =
  '@socketsecurity/cli-with-sentry-npx'
export const SOCKET_CLI_SENTRY_PACKAGE_NAME = '@socketsecurity/cli-with-sentry'
export const SOCKET_CLI_SENTRY_PNPM_BIN_NAME =
  '@socketsecurity/cli-with-sentry-pnpm'
export const SOCKET_CLI_SENTRY_YARN_BIN_NAME =
  '@socketsecurity/cli-with-sentry-yarn'
export const SOCKET_CLI_YARN_BIN_NAME = 'socket-yarn'

// Shadow names
export const INSTRUMENT_WITH_SENTRY = 'instrument-with-sentry'
export const SHADOW_NPM_BIN = 'shadow-npm-bin'
export const SHADOW_NPM_INJECT = 'shadow-npm-inject'
export const SHADOW_NPX_BIN = 'shadow-npx-bin'
export const SHADOW_PNPM_BIN = 'shadow-pnpm-bin'
export const SHADOW_YARN_BIN = 'shadow-yarn-bin'

// API constants
export const SOCKET_PUBLIC_API_KEY =
  'sktsec_t_--RAN5U5t8GT6xwmMqPRjVBCzGId7PXTdoc0pXsDTrE_'

// Static paths (relative to src/)
export const distPath = path.join(__dirname, '..', 'dist')
export const rootPath = path.join(__dirname, '..')
export const srcPath = __dirname
export const configPath = path.join(rootPath, '.config')
export const externalPath = path.join(rootPath, 'external')

// Stat mode constants
export const S_IXGRP = 0o010
export const S_IXOTH = 0o001
export const S_IXUSR = 0o100

// Command constants
export const CONSTANTS = 'constants'
