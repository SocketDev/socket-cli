// Tier routing for the delegating-execution cycle: big-brain plans and reviews,
// the floor executes and follows up. Consumed by .mts callers;
// .claude/workflows/delegating-execution.js hardcodes a mirror (workflows
// cannot import repo TS).

import type { TierPhase, TierRoute, TierSensitivity } from './types.mts'

// ASCII-sorted.
export const PHASES = ['execute', 'followup', 'plan', 'review'] as const
export const SENSITIVITIES = ['benign', 'security'] as const

// plan/review + benign → Fable with NO effort (adaptive-only — an effort key on
// a Fable spawn violates fable-fallback rule 2). plan/review + security →
// Opus 4.8 directly and NEVER Fable: its classifiers false-positive on benign
// security work and the refusal→Opus fallback is pending upstream socket-lib
// (see fable-fallback.md). execute/followup → the floor executor
// (sonnet/medium) — a written plan bounds the reasoning.
export const TIER_TABLE: Record<
  TierPhase,
  Record<TierSensitivity, TierRoute>
> = {
  execute: {
    benign: { effort: 'medium', model: 'claude-sonnet-4-6' },
    security: { effort: 'medium', model: 'claude-sonnet-4-6' },
  },
  followup: {
    benign: { effort: 'medium', model: 'claude-sonnet-4-6' },
    security: { effort: 'medium', model: 'claude-sonnet-4-6' },
  },
  plan: {
    benign: { effort: undefined, model: 'claude-fable-5' },
    security: { effort: 'high', model: 'claude-opus-4-8' },
  },
  review: {
    benign: { effort: undefined, model: 'claude-fable-5' },
    security: { effort: 'high', model: 'claude-opus-4-8' },
  },
}

// The floor tier: cheapest model + lowest effort (mirrors
// scripts/fleet/check/ai-spawns-have-paired-effort.mts FLOOR_*). A provably
// mechanical execute/followup step — a cascade, a bulk rename, applying an
// enumerated finding list — needs no judgment the plan didn't already supply,
// so it routes here instead of the sonnet/medium executor. This is the ONE live
// cost lever while Fable is suspended (plan/review already pin the apex); the
// full complexity classifier is deferred (see eval-auto-model-effort-routing).
export const MECHANICAL_ROUTE: TierRoute = {
  effort: 'low',
  model: 'claude-haiku-4-5',
}

// Phases the `mechanical` flag downgrades. plan/review are judgment work at the
// apex tier — `mechanical` is meaningless there and is ignored. ASCII-sorted.
export const MECHANICAL_PHASES = ['execute', 'followup'] as const

export interface TierRouteOptions {
  readonly phase: TierPhase
  readonly sensitivity: TierSensitivity
  // When true AND the phase is execute/followup, route to the haiku/low floor
  // instead of the sonnet/medium executor. Caller-set, explicit — no inference.
  readonly mechanical?: boolean | undefined
}

export function routeTierForTask(options: TierRouteOptions): TierRoute {
  const opts: TierRouteOptions = {
    __proto__: null,
    ...options,
  } as TierRouteOptions
  if (!PHASES.includes(opts.phase)) {
    throw new Error(
      `routeTierForTask: unknown phase. Where: options.phase. Saw: ${String(opts.phase)}. Wanted one of: ${PHASES.join(', ')}. Fix: pass a PHASES member.`,
    )
  }
  if (!SENSITIVITIES.includes(opts.sensitivity)) {
    throw new Error(
      `routeTierForTask: unknown sensitivity. Where: options.sensitivity. Saw: ${String(opts.sensitivity)}. Wanted one of: ${SENSITIVITIES.join(', ')}. Fix: pass a SENSITIVITIES member; when unsure use 'security' (fail-safe away from Fable refusals).`,
    )
  }
  if (
    opts.mechanical === true &&
    (opts.phase === 'execute' || opts.phase === 'followup')
  ) {
    return MECHANICAL_ROUTE
  }
  return TIER_TABLE[opts.phase][opts.sensitivity]
}
