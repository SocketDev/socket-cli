/**
 * Static constants that don't require any runtime computation or dependencies.
 * These are safe to bundle and won't cause circular dependencies.
 */

import path from 'node:path'

import {
  dirs,
  env,
  extensions,
  files,
  packageManagers,
  paths,
  socket,
} from '@socketsecurity/registry/lib/constants'

// Map the new constants structure to the old names for compatibility
export const AT_LATEST = '@latest'
export const LATEST = 'latest'
export const BUN = packageManagers.bun.name
export const CHANGELOG_MD = files.CHANGELOG_MD
export const CI = env.CI
export const COLUMN_LIMIT = 80
export const DOT_GIT_DIR = dirs.DOT_GIT
export const DOT_SOCKET_DIR = dirs.DOT_SOCKET
export const EMPTY_FILE = ''
export const EMPTY_VALUE = ''
export const ESLINT_CONFIG_JS = files.ESLINT_CONFIG_JS
export const ESNEXT = 'esnext'
export const EXT_CJS = extensions.CJS
export const EXT_CMD = '.cmd'
export const EXT_CTS = extensions.CTS
export const EXT_DTS = extensions.DTS
export const EXT_JS = extensions.JS
export const EXT_JSON = extensions.JSON
export const EXT_LOCK = extensions.LOCK
export const EXT_LOCKB = extensions.LOCKB
export const EXT_MD = extensions.MD
export const EXT_MJS = extensions.MJS
export const EXT_MTS = extensions.MTS
export const EXT_PS1 = '.ps1'
export const EXT_YAML = extensions.YAML
export const EXT_YML = extensions.YML
export const EXTENSIONS = extensions
export const EXTENSIONS_JSON = files.EXTENSIONS_JSON
export const GITIGNORE = files.GITIGNORE
export const DOT_PACKAGE_LOCK_JSON = files.PACKAGE_LOCK_JSON
export const DOT_PACKAGE_LOCK_YML = '.package-lock.yml'
export const DOT_PNPM_LOCK_YAML = files.PNPM_LOCK_YAML
export const INDEX = 'index'
export const INDEX_JS = 'index.js'
export const JS = 'js'
export const LICENSE = files.LICENSE
export const LICENSE_MD = 'LICENSE.md'
export const MANIFEST_JSON = files.MANIFEST_JSON
export const NODE = 'node'
export const NODE_MODULES = dirs.NODE_MODULES
export const NODE_MODULES_GLOB_RECURSIVE = paths.NODE_MODULES_GLOB
export const NPM = packageManagers.npm.name
export const NPMIGNORE = '.npmignore'
export const NPMRC = '.npmrc'
export const NPX = 'npx'
export const PACKAGE = 'package'
export const PACKAGE_JSON = files.PACKAGE_JSON
export const PACKAGE_LOCK = 'package-lock'
export const PACKAGE_LOCK_JSON = 'package-lock.json'
export const PNPM = packageManagers.pnpm.name
export const PNPM_LOCK = 'pnpm-lock'
export const PNPM_LOCK_YAML = files.PNPM_LOCK_YAML
export const README_MD = files.README_MD
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
export const VLT = packageManagers.vlt.name
export const WIN32 = 'win32'
export const YARN = packageManagers.yarn.name
export const YARN_BERRY = 'yarn_berry'
export const YARN_CLASSIC = 'yarn_classic'
export const YARN_LOCK = files.YARN_LOCK

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
