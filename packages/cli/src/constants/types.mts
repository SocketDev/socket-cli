/**
 * Type definitions for constants module.
 */

import type ENV from './env.mts'

// Re-export platform constants from registry
export { WIN32 } from '@socketsecurity/lib/constants/platform'
export type { Remap } from '@socketsecurity/lib/objects'
export type { SpawnOptions } from '@socketsecurity/lib/spawn'
export type { Agent } from '../utils/ecosystem/environment.mjs'

export type RegistryEnv = typeof ENV

export type ProcessEnv = {
  [K in keyof typeof ENV]?: string | undefined
}
