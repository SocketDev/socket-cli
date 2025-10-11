/**
 * Static constants that don't require any runtime computation or dependencies.
 * These are safe to bundle and won't cause circular dependencies.
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(path.dirname(__filename)) // Go up to src/

// Re-export static constants from registry that we need
export {
  AT_LATEST,
  BUN,
  CHANGELOG_MD,
  CI,
  COLUMN_LIMIT,
  DOT_GIT_DIR,
  DOT_SOCKET_DIR,
  EMPTY_FILE,
  EMPTY_VALUE,
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
  EXT_YAML,
  EXT_YML,
  EXTENSIONS,
  EXTENSIONS_JSON,
  GITIGNORE,
  DOT_PACKAGE_LOCK_JSON,
  DOT_PACKAGE_LOCK_YML,
  DOT_PNPM_LOCK_YAML,
  INDEX,
  INDEX_JS,
  JS,
  LICENSE,
  LICENSE_MD,
  MANIFEST_JSON,
  NODE,
  NODE_MODULES,
  NODE_MODULES_GLOB_RECURSIVE,
  NPM,
  NPMIGNORE,
  NPMRC,
  NPX,
  PACKAGE,
  PACKAGE_JSON,
  PACKAGE_LOCK,
  PNPM,
  PNPM_LOCK,
  PNPM_LOCK_YAML,
  README_MD,
  ROLLUP_EXTERNAL_SUFFIX,
  SLASH_NODE_MODULES_SLASH,
  TEST,
  TS,
  TSX,
  UTF8,
  UNKNOWN_ERROR,
  UNKNOWN_VALUE,
  UNLICENCED,
  UNLICENSED,
  V,
  VITEST,
  VLT,
  WIN32,
  YARN,
  YARN_BERRY,
  YARN_CLASSIC,
  YARN_LOCK,
} from '@socketsecurity/registry/lib/constants'

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
