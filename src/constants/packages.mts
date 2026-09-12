/**
 * Package and binary name constants for Socket CLI.
 */

// Re-export lockfile constants from registry
export {
  PACKAGE_LOCK_JSON,
  PNPM_LOCK_YAML,
  YARN_LOCK,
} from '@socketsecurity/lib-stable/constants/package-managers'

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
export const SOCKET_SECURITY_REGISTRY = '@socketsecurity/registry-stable'

// Socket CLI Package Names
export const SOCKET_CLI_PACKAGE_NAME = '@socketsecurity/cli'

// Socket CLI Binary Names
export const SOCKET_CLI_BIN_NAME = 'socket'
export const SOCKET_CLI_BIN_NAME_ALIAS = 'socket-dev'
export const SOCKET_CLI_NPM_BIN_NAME = 'socket-npm'
export const SOCKET_CLI_NPX_BIN_NAME = 'socket-npx'
export const SOCKET_CLI_PNPM_BIN_NAME = 'socket-pnpm'
export const SOCKET_CLI_YARN_BIN_NAME = 'socket-yarn'

// Descriptions
export const SOCKET_DESCRIPTION = 'CLI for Socket.dev'

// Python minimum version.
export const PYTHON_MIN_VERSION = '3.9.0'
