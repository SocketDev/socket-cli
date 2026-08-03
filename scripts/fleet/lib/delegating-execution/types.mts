// Shared types for the delegating-execution tier cycle. Effort + model vocab
// derive from socket-lib's canonical AI ladder types — the concrete values a
// route carries come from AI_TIER (see route.mts), never a local literal copy.
import type { TierSpawn } from '@socketsecurity/lib-stable/ai/tier'
import type { AiEffort } from '@socketsecurity/lib-stable/ai/types'

export type TierEffort = AiEffort
export type TierModel = TierSpawn['model']
export type TierPhase = 'execute' | 'followup' | 'plan' | 'review'
export interface TierRoute {
  // undefined = adaptive-only (Fable): never pass an effort knob (fable-fallback).
  readonly effort: TierEffort | undefined
  readonly model: TierModel
}
export type TierSensitivity = 'benign' | 'security'
