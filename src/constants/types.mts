/**
 * Type definitions for constants module.
 */

import type ENV from './env.mts'

export type { Remap } from '@socketsecurity/registry/lib/objects'
export type { SpawnOptions } from '@socketsecurity/registry/lib/spawn'
export type { Agent } from '../utils/ecosystem/environment.mjs'

// Re-export platform constants from registry
export { WIN32 } from '@socketsecurity/registry/constants/platform'

export type RegistryEnv = typeof ENV

export type RegistryInternals = {
  getIpc?: () => IpcObject | undefined
  getSentry?: () => Sentry | undefined
  setSentry?: (sentry: Sentry) => void
}

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
