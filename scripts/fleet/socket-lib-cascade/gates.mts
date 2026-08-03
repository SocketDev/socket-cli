/**
 * @file The socket-lib cascade's GATE decisions: resolving a stage's concrete
 *   pre-gate from the stage table plus the cascade state, the published-version
 *   verdict over a registry read, and the downstream-activity classifier that
 *   keeps the orchestrator from double-driving a repo another session is
 *   already releasing. Pure over the registry read so every arm is unit-tested
 *   without a network. Backs `../socket-lib-cascade.mts`.
 */

import { compareVersionsLoose } from '../lib/release-cascade.mts'
import { CASCADE_STAGES } from './stages.mts'

import type { CascadeStageId, GateMode } from './stages.mts'
import type { CascadeState, DownstreamActivity } from './state.mts'

export interface GateSpec {
  /**
   * The baseline latest for an `advance` gate — the stage clears once the
   * package's registry latest moves past this.
   */
  baselineVersion: string | undefined
  mode: GateMode
  pkg: string
  /**
   * The exact version a `fixed` gate requires to be live.
   */
  requiredVersion: string | undefined
}

/**
 * Resolve a stage's concrete pre-gate from its spec and the cascade state: a
 * `fixed` gate binds the target socket-lib version, an `advance` gate binds the
 * baseline captured for the gated package. Pure.
 */
export function resolveGateSpec(
  stageId: CascadeStageId,
  state: CascadeState,
): GateSpec {
  const { gate } = CASCADE_STAGES[stageId]
  if (gate.mode === 'fixed') {
    return {
      baselineVersion: undefined,
      mode: 'fixed',
      pkg: gate.pkg,
      requiredVersion: state.targetLibVersion,
    }
  }
  return {
    baselineVersion: state.baselineVersions[gate.pkg],
    mode: 'advance',
    pkg: gate.pkg,
    requiredVersion: undefined,
  }
}

export type GateVerdict = 'satisfied' | 'unreachable' | 'waiting'

/**
 * The published-version gate: whether the upstream a stage waits on is live.
 * `unreachable` — the registry could not be consulted, so the run retries
 * later. `waiting` — the required version or the advance past baseline has not
 * published yet. `satisfied` — the upstream is live and the stage may proceed.
 * Pure over the registry read so the gate is unit-tested without a network.
 */
export function publishedGateVerdict(config: {
  gate: GateSpec
  reachable: boolean
  registryLatest: string | undefined
}): GateVerdict {
  const cfg = { __proto__: null, ...config } as typeof config
  if (!cfg.reachable) {
    return 'unreachable'
  }
  const { gate, registryLatest } = cfg
  if (registryLatest === undefined) {
    return 'waiting'
  }
  if (gate.mode === 'fixed') {
    if (gate.requiredVersion === undefined) {
      return 'waiting'
    }
    return compareVersionsLoose(registryLatest, gate.requiredVersion) >= 0
      ? 'satisfied'
      : 'waiting'
  }
  if (gate.baselineVersion === undefined) {
    return 'waiting'
  }
  return compareVersionsLoose(registryLatest, gate.baselineVersion) > 0
    ? 'satisfied'
    : 'waiting'
}

export type DownstreamState =
  | 'awaiting-version'
  | 'idle'
  | 'in-flight'
  | 'released'

/**
 * Classify a userGated stage's downstream repo, so the orchestrator drives the
 * deterministic trigger exactly once and never races a session that is already
 * moving. `released` — the stage's published package has advanced past the
 * baseline, so its release is done and the cascade proceeds. `in-flight` — a
 * release is already under way there with a NAMED version, not yet cut, so the
 * orchestrator waits instead of double-driving. `awaiting-version` — the
 * repo's release-pipeline is already sitting at its bump-stop with no version
 * named yet, so the trigger has already run and only the USER version gate
 * remains; the orchestrator re-prints the gate but does NOT re-run the trigger,
 * which would churn the downstream tree. `idle` — nothing is moving, so this
 * run runs the trigger and then stops at the user version gate. Pure.
 */
export function classifyDownstreamActivity(config: {
  baselineVersion: string | undefined
  pipeline: DownstreamActivity | undefined
  producedLatest: string | undefined
  reachable: boolean
}): DownstreamState {
  const cfg = { __proto__: null, ...config } as typeof config
  if (
    cfg.reachable &&
    cfg.producedLatest !== undefined &&
    cfg.baselineVersion !== undefined &&
    compareVersionsLoose(cfg.producedLatest, cfg.baselineVersion) > 0
  ) {
    return 'released'
  }
  // A present, uncut pipeline means the trigger already ran there: named →
  // someone is mid-release; unnamed → it is parked at bump-stop for the user.
  if (cfg.pipeline !== undefined && !cfg.pipeline.releaseComplete) {
    return cfg.pipeline.targetVersion !== undefined
      ? 'in-flight'
      : 'awaiting-version'
  }
  return 'idle'
}
