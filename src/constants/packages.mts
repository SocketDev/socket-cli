/**
 * Package and binary name constants for Socket CLI.
 */

// Re-export lockfile constants from registry
export { PNPM_LOCK_YAML, YARN_LOCK, PACKAGE_LOCK_JSON } from '@socketsecurity/lib/constants/agents'

// Package manifest files
export const PACKAGE_JSON = 'package.json'

// Directory names
export const NODE_MODULES = 'node_modules'

// File extensions
export const EXT_LOCK = '.lock'
export const EXT_LOCKB = '.lockb'

// NPM Package Versions (CLI-specific)
export const NPM_BUGGY_OVERRIDES_PATCHED_VERSION = '11.2.0'

// External Package Names
export const BLESSED = 'blessed'
export const BLESSED_CONTRIB = 'blessed-contrib'
export const SENTRY_NODE = '@sentry/node'
export const SOCKET_SECURITY_REGISTRY = '@socketsecurity/registry'

// Socket CLI Package Names
export const SOCKET_CLI_PACKAGE_NAME = 'socket'
export const SOCKET_CLI_LEGACY_PACKAGE_NAME = 'socket-npm'
export const SOCKET_CLI_SENTRY_PACKAGE_NAME = '@socketsecurity/cli-with-sentry'

// Socket CLI Binary Names
export const SOCKET_CLI_BIN_NAME = 'socket'
export const SOCKET_CLI_BIN_NAME_ALIAS = 'socket-dev'
export const SOCKET_CLI_NPM_BIN_NAME = 'socket-npm'
export const SOCKET_CLI_NPX_BIN_NAME = 'socket-npx'
export const SOCKET_CLI_PNPM_BIN_NAME = 'socket-pnpm'
export const SOCKET_CLI_YARN_BIN_NAME = 'socket-yarn'

// Socket CLI Sentry Binary Names
export const SOCKET_CLI_SENTRY_BIN_NAME = '@socketsecurity/cli-with-sentry'
export const SOCKET_CLI_SENTRY_BIN_NAME_ALIAS = 'socket-dev-with-sentry'
export const SOCKET_CLI_SENTRY_NPM_BIN_NAME =
  '@socketsecurity/cli-with-sentry-npm'
export const SOCKET_CLI_SENTRY_NPX_BIN_NAME =
  '@socketsecurity/cli-with-sentry-npx'
export const SOCKET_CLI_SENTRY_PNPM_BIN_NAME =
  '@socketsecurity/cli-with-sentry-pnpm'
export const SOCKET_CLI_SENTRY_YARN_BIN_NAME =
  '@socketsecurity/cli-with-sentry-yarn'

// Descriptions
export const SOCKET_DESCRIPTION = 'CLI for Socket.dev'
export const SOCKET_DESCRIPTION_WITH_SENTRY = `${SOCKET_DESCRIPTION}, includes Sentry error handling`

// Python minimum version.
export const PYTHON_MIN_VERSION = '3.9.0'
