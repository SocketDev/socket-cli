// Shared types for the delegating-execution tier cycle.
export type TierEffort = 'high' | 'low' | 'medium'
export type TierModel =
  | 'claude-fable-5'
  | 'claude-haiku-4-5'
  | 'claude-opus-4-8'
  | 'claude-sonnet-4-6'
export type TierPhase = 'execute' | 'followup' | 'plan' | 'review'
export interface TierRoute {
  // undefined = adaptive-only (Fable): never pass an effort knob (fable-fallback).
  readonly effort: TierEffort | undefined
  readonly model: TierModel
}
export type TierSensitivity = 'benign' | 'security'
