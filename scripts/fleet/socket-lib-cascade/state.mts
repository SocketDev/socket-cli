/**
 * @file The socket-lib cascade's STATE model: the receipt + state shapes, the
 *   state-file path, the tolerant parser, the immutable updaters, the fs
 *   load/save/reset trio, the resume plan, and the downstream release-pipeline
 *   summariser. Every decision here is pure over its inputs so the resume logic
 *   is unit-tested without a network. Backs `../socket-lib-cascade.mts`.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

import { writeThroughMirrorLock } from '../_shared/mirror-lock.mts'
import { CASCADE_STAGE_ORDER, LIB_PKG } from './stages.mts'

import type { CascadeStageId } from './stages.mts'

export type ReceiptStatus = 'blocked' | 'deferred' | 'failed' | 'passed'

export interface StageReceipt {
  /**
   * ISO timestamp the receipt was written.
   */
  at: string
  /**
   * Human-readable evidence line — what the stage saw or did.
   */
  detail: string
  /**
   * True when written under --dry-run; a dry receipt never satisfies a real
   * run.
   */
  dryRun: boolean
  /**
   * Currency key — the target @socketsecurity/lib version this cascade drives.
   * A new socket-lib release changes the key and starts the cascade fresh.
   */
  key: string
  /**
   * Stage wall time in milliseconds. Absent on receipts written before the
   * field existed; rendering tolerates that.
   */
  ms?: number | undefined
  status: ReceiptStatus
}

export interface CascadeState {
  /**
   * Registry latest for each produced package at cascade start. A stage's
   * `advance` gate compares the current latest against its baseline here.
   */
  baselineVersions: Record<string, string>
  /**
   * Package name identity for the drift check on resume — always the socket-lib
   * package this orchestrator drives.
   */
  packageName: string
  stages: Partial<Record<CascadeStageId, StageReceipt>>
  /**
   * ISO timestamp of cascade creation.
   */
  startedAt: string
  /**
   * The ALREADY-PUBLISHED @socketsecurity/lib version this cascade absorbs.
   * Read from the registry or pinned with --version; never chosen here.
   */
  targetLibVersion: string | undefined
  /**
   * State-file schema version.
   */
  version: 1
}

export const STATE_DIR_NAME = 'socket-lib-cascade'
export const STATE_FILE_NAME = 'state.json'

// A downstream repo's own release-pipeline state lives under this cache segment;
// the orchestrator reads it to detect an in-flight release driven elsewhere.
export const DOWNSTREAM_PIPELINE_DIR = 'socket-release-pipeline'

/**
 * Resolve the cascade state-file path for a repo root.
 */
export function statePath(repoRoot: string): string {
  return path.join(repoRoot, '.cache', 'fleet', STATE_DIR_NAME, STATE_FILE_NAME)
}

/**
 * Fresh, empty cascade state.
 */
export function newState(startedAt: string): CascadeState {
  return {
    baselineVersions: {},
    packageName: LIB_PKG,
    stages: {},
    startedAt,
    targetLibVersion: undefined,
    version: 1,
  }
}

/**
 * Parse raw state-file text. Returns undefined on any shape mismatch so an
 * unreadable state file starts a fresh cascade instead of crashing it. Pure.
 */
export function parseState(raw: string): CascadeState | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object') {
    return undefined
  }
  const s = parsed as Partial<CascadeState>
  if (
    s.version !== 1 ||
    typeof s.packageName !== 'string' ||
    typeof s.startedAt !== 'string' ||
    !s.stages ||
    typeof s.stages !== 'object' ||
    !s.baselineVersions ||
    typeof s.baselineVersions !== 'object'
  ) {
    return undefined
  }
  return {
    baselineVersions: s.baselineVersions,
    packageName: s.packageName,
    stages: s.stages,
    startedAt: s.startedAt,
    targetLibVersion:
      typeof s.targetLibVersion === 'string' ? s.targetLibVersion : undefined,
    version: 1,
  }
}

/**
 * Immutably record a stage receipt. Pure.
 */
export function recordReceipt(
  state: CascadeState,
  stage: CascadeStageId,
  receipt: StageReceipt,
): CascadeState {
  return { ...state, stages: { ...state.stages, [stage]: receipt } }
}

/**
 * Immutably set the target socket-lib version. Pure.
 */
export function withTargetLibVersion(
  state: CascadeState,
  targetLibVersion: string,
): CascadeState {
  return { ...state, targetLibVersion }
}

/**
 * Immutably stash the advance-gate baselines. Pure.
 */
export function withBaselineVersions(
  state: CascadeState,
  baselineVersions: Record<string, string>,
): CascadeState {
  return { ...state, baselineVersions }
}

/**
 * Load state from disk, or undefined when absent or unparseable.
 */
export function loadState(filePath: string): CascadeState | undefined {
  if (!existsSync(filePath)) {
    return undefined
  }
  return parseState(readFileSync(filePath, 'utf8'))
}

/**
 * Persist state, creating the cache dir first.
 */
export function saveState(filePath: string, state: CascadeState): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeThroughMirrorLock(filePath, `${JSON.stringify(state, null, 2)}\n`)
}

/**
 * Clear the state file. Tolerates a missing file.
 */
export function resetState(filePath: string): void {
  safeDeleteSync(filePath)
}

/**
 * Whether a receipt marks its stage DONE for resume purposes: a real passed
 * receipt. A deferred, blocked, failed, or dry-run receipt never advances the
 * cascade. Pure.
 */
export function isStageComplete(receipt: StageReceipt | undefined): boolean {
  return receipt?.status === 'passed' && !receipt.dryRun
}

export interface CascadePlan {
  /**
   * The first incomplete stage — the one a run resumes at — or undefined when
   * every stage is complete.
   */
  current: CascadeStageId | undefined
  /**
   * Stages already satisfied by a real passed receipt, in order.
   */
  satisfied: CascadeStageId[]
  /**
   * Stages that still need to run, in order.
   */
  toRun: CascadeStageId[]
}

/**
 * Partition the stages into satisfied and still-to-run, in strict order. The
 * run loop walks `toRun` and halts at the first stage whose gate is not clear.
 * Pure.
 */
export function planCascade(state: CascadeState): CascadePlan {
  const satisfied: CascadeStageId[] = []
  const toRun: CascadeStageId[] = []
  for (let i = 0, { length } = CASCADE_STAGE_ORDER; i < length; i += 1) {
    const id = CASCADE_STAGE_ORDER[i]!
    if (isStageComplete(state.stages[id])) {
      satisfied.push(id)
    } else {
      toRun.push(id)
    }
  }
  return { current: toRun[0], satisfied, toRun }
}

/**
 * The minimal read of a downstream repo's own release-pipeline state — enough
 * to tell whether a release is in flight there.
 */
export interface DownstreamActivity {
  releaseComplete: boolean
  targetVersion: string | undefined
}

/**
 * Summarize a downstream repo's release-pipeline `state.json` text: the named
 * target version and whether its release stage has passed. Returns undefined
 * when the text is absent or unparseable — no evidence of activity. Pure.
 */
export function summarizeDownstreamPipeline(
  raw: string,
): DownstreamActivity | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object') {
    return undefined
  }
  const s = parsed as {
    stages?:
      | { release?: { status?: unknown | undefined } | undefined }
      | undefined
    targetVersion?: unknown | undefined
  }
  return {
    releaseComplete: s.stages?.release?.status === 'passed',
    targetVersion:
      typeof s.targetVersion === 'string' ? s.targetVersion : undefined,
  }
}

/**
 * A downstream repo's release-pipeline state-file path. Pure.
 */
export function downstreamStatePath(repoDir: string): string {
  return path.join(
    repoDir,
    '.cache',
    'fleet',
    DOWNSTREAM_PIPELINE_DIR,
    STATE_FILE_NAME,
  )
}
