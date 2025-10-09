/** @fileoverview Build constants for Socket CLI project configuration and paths. */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Simple helpers
const normalizePath = (p) => p.replace(/\\/g, '/')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = normalizePath(path.resolve(__dirname, '..'))

// Build paths
const configPath = normalizePath(path.join(rootPath, '.config'))
const distPath = normalizePath(path.join(rootPath, 'dist'))
const externalPath = normalizePath(path.join(distPath, 'external'))
const srcPath = normalizePath(path.join(rootPath, 'src'))
const rootNodeModulesBinPath = normalizePath(path.join(rootPath, 'node_modules', '.bin'))

// Common constants
const constants = {
  // Paths
  rootPath,
  configPath,
  distPath,
  externalPath,
  srcPath,
  rootNodeModulesBinPath,
  rootPackageJsonPath: normalizePath(path.join(rootPath, 'package.json')),
  rootPackageLockPath: normalizePath(path.join(rootPath, 'pnpm-lock.yaml')),

  // Platform
  WIN32: process.platform === 'win32',

  // Environment variables
  ENV: process.env,

  // Package names and paths
  PACKAGE_JSON: 'package.json',
  PNPM_LOCK_YAML: 'pnpm-lock.yaml',
  NODE_MODULES: 'node_modules',
  SOCKET_REGISTRY_PACKAGE_NAME: '@socketsecurity/registry',

  // Socket CLI constants
  SOCKET_CLI_BIN_NAME: 'socket',
  SOCKET_CLI_BIN_NAME_ALIAS: 'cli',
  SOCKET_CLI_NPM_BIN_NAME: 'socket-npm',
  SOCKET_CLI_NPX_BIN_NAME: 'socket-npx',
  SOCKET_CLI_PNPM_BIN_NAME: 'socket-pnpm',
  SOCKET_CLI_YARN_BIN_NAME: 'socket-yarn',
  SOCKET_CLI_PACKAGE_NAME: 'socket',
  SOCKET_CLI_LEGACY_PACKAGE_NAME: '@socketsecurity/cli',

  // Sentry-related constants
  SOCKET_CLI_SENTRY_BIN_NAME: 'socket-with-sentry',
  SOCKET_CLI_SENTRY_BIN_NAME_ALIAS: 'cli-with-sentry',
  SOCKET_CLI_SENTRY_NPM_BIN_NAME: 'socket-npm-with-sentry',
  SOCKET_CLI_SENTRY_NPX_BIN_NAME: 'socket-npx-with-sentry',
  SOCKET_CLI_SENTRY_PNPM_BIN_NAME: 'socket-pnpm-with-sentry',
  SOCKET_CLI_SENTRY_YARN_BIN_NAME: 'socket-yarn-with-sentry',
  SOCKET_CLI_SENTRY_PACKAGE_NAME: '@socketsecurity/cli-with-sentry',

  // Inlined constants
  INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION: 'INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION',
  INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION: 'INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION',
  INLINED_SOCKET_CLI_PYTHON_VERSION: 'INLINED_SOCKET_CLI_PYTHON_VERSION',
  INLINED_SOCKET_CLI_PYTHON_BUILD_TAG: 'INLINED_SOCKET_CLI_PYTHON_BUILD_TAG',
  INLINED_SOCKET_CLI_HOMEPAGE: 'INLINED_SOCKET_CLI_HOMEPAGE',
  INLINED_SOCKET_CLI_LEGACY_BUILD: 'INLINED_SOCKET_CLI_LEGACY_BUILD',
  INLINED_SOCKET_CLI_NAME: 'INLINED_SOCKET_CLI_NAME',
  INLINED_SOCKET_CLI_PUBLISHED_BUILD: 'INLINED_SOCKET_CLI_PUBLISHED_BUILD',
  INLINED_SOCKET_CLI_SENTRY_BUILD: 'INLINED_SOCKET_CLI_SENTRY_BUILD',
  INLINED_SOCKET_CLI_SYNP_VERSION: 'INLINED_SOCKET_CLI_SYNP_VERSION',
  INLINED_SOCKET_CLI_VERSION: 'INLINED_SOCKET_CLI_VERSION',
  INLINED_SOCKET_CLI_VERSION_HASH: 'INLINED_SOCKET_CLI_VERSION_HASH',

  // Shadow bins
  SHADOW_NPM_BIN: 'shadow-npm-bin',
  SHADOW_NPM_INJECT: 'shadow-npm-inject',
  SHADOW_NPX_BIN: 'shadow-npx-bin',
  SHADOW_PNPM_BIN: 'shadow-pnpm-bin',
  SHADOW_YARN_BIN: 'shadow-yarn-bin',

  // Other
  CONSTANTS: 'constants',
  INSTRUMENT_WITH_SENTRY: 'instrument-with-sentry',
  ROLLUP_EXTERNAL_SUFFIX: '?commonjs-external',
  SLASH_NODE_MODULES_SLASH: '/node_modules/',

  // Socket registry path
  socketRegistryPath: normalizePath(path.join(externalPath, '@socketsecurity/registry', 'dist'))
}

export default constants