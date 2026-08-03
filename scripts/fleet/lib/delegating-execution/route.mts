// Tier routing for the delegating-execution cycle: big-brain plans and reviews,
// the floor executes and follows up. Consumed by .mts callers;
// .claude/workflows/delegating-execution.js hardcodes a mirror (workflows
// cannot import repo TS).

import { AI_TIER } from '@socketsecurity/lib-stable/ai/tier'

import type { TierPhase, TierRoute, TierSensitivity } from './types.mts'

// ASCII-sorted.
export const PHASES = ['execute', 'followup', 'plan', 'review'] as const
export const SENSITIVITIES = ['benign', 'security'] as const

// The three routes, each an AI_TIER ladder row (socket-lib's canonical
// model+effort source — a model-generation roll lands there once and this
// table follows). The benign brain takes the fable MODEL only, with NO effort:
// Fable is adaptive-only, and an effort knob on a Fable spawn violates
// fable-fallback rule 2 (the ladder row's 'xhigh' is for effort-accepting
// surfaces, not a claude spawn).
const EXECUTOR_ROUTE: TierRoute = {
  effort: AI_TIER.sonnet.effort,
  model: AI_TIER.sonnet.model,
}
const BENIGN_BRAIN_ROUTE: TierRoute = {
  effort: undefined,
  model: AI_TIER.fable.model,
}
const SECURITY_BRAIN_ROUTE: TierRoute = {
  effort: AI_TIER.opus.effort,
  model: AI_TIER.opus.model,
}

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
    benign: EXECUTOR_ROUTE,
    security: EXECUTOR_ROUTE,
  },
  followup: {
    benign: EXECUTOR_ROUTE,
    security: EXECUTOR_ROUTE,
  },
  plan: {
    benign: BENIGN_BRAIN_ROUTE,
    security: SECURITY_BRAIN_ROUTE,
  },
  review: {
    benign: BENIGN_BRAIN_ROUTE,
    security: SECURITY_BRAIN_ROUTE,
  },
}

// The floor tier: the cheapest AI_TIER row (haiku/low — the same row
// scripts/fleet/check/ai-spawns-have-paired-effort.mts derives FLOOR_* from).
// A provably mechanical execute/followup step — a cascade, a bulk rename,
// applying an enumerated finding list — needs no judgment the plan didn't
// already supply, so it routes here instead of the sonnet/medium executor.
// This is the ONE live cost lever while Fable is suspended (plan/review
// already pin the apex); the full complexity classifier is deferred (see
// eval-auto-model-effort-routing).
export const MECHANICAL_ROUTE: TierRoute = {
  effort: AI_TIER.haiku.effort,
  model: AI_TIER.haiku.model,
}

// Phases the `mechanical` flag downgrades. plan/review are judgment work at the
// apex tier — `mechanical` is meaningless there and is ignored. ASCII-sorted.
export const MECHANICAL_PHASES = ['execute', 'followup'] as const

export interface TierRouteConfig {
  readonly phase: TierPhase
  readonly sensitivity: TierSensitivity
  // When true AND the phase is execute/followup, route to the haiku/low floor
  // instead of the sonnet/medium executor. Caller-set, explicit — no inference.
  readonly mechanical?: boolean | undefined
}

export function routeTierForTask(config: TierRouteConfig): TierRoute {
  const cfg: TierRouteConfig = {
    __proto__: null,
    ...config,
  } as TierRouteConfig
  if (!PHASES.includes(cfg.phase)) {
    throw new Error(
      `routeTierForTask: unknown phase. Where: options.phase. Saw: ${String(cfg.phase)}. Wanted one of: ${PHASES.join(', ')}. Fix: pass a PHASES member.`,
    )
  }
  if (!SENSITIVITIES.includes(cfg.sensitivity)) {
    throw new Error(
      `routeTierForTask: unknown sensitivity. Where: options.sensitivity. Saw: ${String(cfg.sensitivity)}. Wanted one of: ${SENSITIVITIES.join(', ')}. Fix: pass a SENSITIVITIES member; when unsure use 'security' (fail-safe away from Fable refusals).`,
    )
  }
  if (
    cfg.mechanical === true &&
    (cfg.phase === 'execute' || cfg.phase === 'followup')
  ) {
    return MECHANICAL_ROUTE
  }
  return TIER_TABLE[cfg.phase][cfg.sensitivity]
}
