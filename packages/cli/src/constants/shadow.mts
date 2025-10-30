/**
 * Shadow mode and instrumentation constants for Socket CLI.
 */

import path from 'node:path'

import { distPath } from './paths.mts'

import type { RegistryInternals } from './types.mts'

// Re-export SOCKET_IPC_HANDSHAKE from registry
export { SOCKET_IPC_HANDSHAKE } from '@socketsecurity/lib/constants/socket'

// Shadow Binary Names
export const SHADOW_NPM_BIN = 'shadow-npm-bin'
export const SHADOW_NPX_BIN = 'shadow-npx-bin'
export const SHADOW_PNPM_BIN = 'shadow-pnpm-bin'
export const SHADOW_YARN_BIN = 'shadow-yarn-bin'
export const SHADOW_NPM_INJECT = 'shadow-npm-inject'
export const INSTRUMENT_WITH_SENTRY = 'instrument-with-sentry'

// Shadow Environment Variables
export const SOCKET_CLI_SHADOW_ACCEPT_RISKS = 'SOCKET_CLI_SHADOW_ACCEPT_RISKS'
export const SOCKET_CLI_SHADOW_API_TOKEN = 'SOCKET_CLI_SHADOW_API_TOKEN'
export const SOCKET_CLI_SHADOW_BIN = 'SOCKET_CLI_SHADOW_BIN'
export const SOCKET_CLI_SHADOW_PROGRESS = 'SOCKET_CLI_SHADOW_PROGRESS'
export const SOCKET_CLI_SHADOW_SILENT = 'SOCKET_CLI_SHADOW_SILENT'

// Other CLI Environment Variables
export const SOCKET_CLI_ACCEPT_RISKS = 'SOCKET_CLI_ACCEPT_RISKS'
export const SOCKET_CLI_VIEW_ALL_RISKS = 'SOCKET_CLI_VIEW_ALL_RISKS'

/**
 * Get the path to the shadow npm binary.
 */
export function getShadowNpmBinPath(): string {
  return path.join(distPath, 'shadow/npm/bin.mjs')
}

/**
 * Get the path to the shadow npx binary.
 */
export function getShadowNpxBinPath(): string {
  return path.join(distPath, 'shadow/npx/bin.mjs')
}

/**
 * Get the path to the shadow pnpm binary.
 */
export function getShadowPnpmBinPath(): string {
  return path.join(distPath, 'shadow/pnpm/bin.mjs')
}

/**
 * Get the path to the shadow yarn binary.
 */
export function getShadowYarnBinPath(): string {
  return path.join(distPath, 'shadow/yarn/bin.mjs')
}

// IpcObject type for shadow operations
export type IpcObject = Readonly<{
  SOCKET_CLI_FIX?: string | undefined
  SOCKET_CLI_OPTIMIZE?: boolean | undefined
  SOCKET_CLI_SHADOW_ACCEPT_RISKS?: boolean | undefined
  SOCKET_CLI_SHADOW_API_TOKEN?: string | undefined
  SOCKET_CLI_SHADOW_BIN?: string | undefined
  SOCKET_CLI_SHADOW_PROGRESS?: boolean | undefined
  SOCKET_CLI_SHADOW_SILENT?: boolean | undefined
}>
