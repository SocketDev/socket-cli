/**
 * Type definitions for constants module.
 */

import type { ENV } from './env.mts'

// Re-export platform constants from registry
export { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
export type { Remap } from '@socketsecurity/lib-stable/objects/types'
export type { SpawnOptions } from '@socketsecurity/lib-stable/process/spawn/types'
export type { Agent } from '../util/ecosystem/environment.mjs'

export type RegistryEnv = typeof ENV

export type ProcessEnv = {
  [K in keyof typeof ENV]?: string | undefined
}
