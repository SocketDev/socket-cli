/**
 * @file Release-pipeline state store. One JSON file under
 *   `node_modules/.cache/socket-release-pipeline/` (runtime state NEVER lives
 *   in the tracked tree) records a receipt per completed stage so a pipeline
 *   run is resumable: a re-run skips stages whose receipts are still current
 *   and picks up at the first missing/stale one. Pure helpers
 *   (`recordReceipt`, `parseState`) are separated from the fs edges
 *   (`loadState`, `saveState`) so tests round-trip against a temp dir.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

import type { StageId } from './stages.mts'

/**
 * Receipt statuses a stage can record. `deferred` = intentionally not run
 * (e.g. CI on an unpushed head: "local-only, CI deferred").
 */
export type ReceiptStatus = 'deferred' | 'failed' | 'passed'

export interface StageReceipt {
  /**
   * ISO timestamp the receipt was written.
   */
  at: string
  /**
   * Human-readable evidence line (what ran, what it saw).
   */
  detail: string
  /**
   * True when the stage ran under --dry-run (a dry receipt never satisfies a
   * real run).
   */
  dryRun: boolean
  /**
   * Currency key — HEAD sha for tree stages, target version for release
   * stages (see stages.mts `stageKeyKind`).
   */
  key: string
  status: ReceiptStatus
}

export interface PipelineState {
  /**
   * Package name at pipeline start (drift check on resume).
   */
  packageName: string
  /**
   * ISO timestamp of pipeline creation.
   */
  startedAt: string
  stages: Partial<Record<StageId, StageReceipt>>
  /**
   * User-named release version, set once `--version X.Y.Z` resumes past the
   * bump hard-stop. NEVER chosen by the pipeline.
   */
  targetVersion?: string | undefined
  /**
   * State-file schema version.
   */
  version: 1
}

export const STATE_DIR_NAME = 'socket-release-pipeline'
export const STATE_FILE_NAME = 'state.json'

/**
 * Resolve the state file path for a repo root.
 */
export function statePath(repoRoot: string): string {
  return path.join(
    repoRoot,
    'node_modules',
    '.cache',
    STATE_DIR_NAME,
    STATE_FILE_NAME,
  )
}

/**
 * Fresh, empty pipeline state.
 */
export function newState(
  packageName: string,
  startedAt: string,
): PipelineState {
  return {
    packageName,
    stages: {},
    startedAt,
    targetVersion: undefined,
    version: 1,
  }
}

/**
 * Parse raw state-file text. Returns undefined on any shape mismatch — an
 * unreadable state file starts a fresh pipeline instead of crashing it.
 * Pure — exported for tests.
 */
export function parseState(raw: string): PipelineState | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object') {
    return undefined
  }
  const s = parsed as Partial<PipelineState>
  if (
    s.version !== 1 ||
    typeof s.packageName !== 'string' ||
    typeof s.startedAt !== 'string' ||
    !s.stages ||
    typeof s.stages !== 'object'
  ) {
    return undefined
  }
  return {
    packageName: s.packageName,
    stages: s.stages,
    startedAt: s.startedAt,
    targetVersion:
      typeof s.targetVersion === 'string' ? s.targetVersion : undefined,
    version: 1,
  }
}

/**
 * Immutably record a stage receipt. Pure — exported for tests.
 */
export function recordReceipt(
  state: PipelineState,
  stage: StageId,
  receipt: StageReceipt,
): PipelineState {
  return {
    ...state,
    stages: { ...state.stages, [stage]: receipt },
  }
}

/**
 * Immutably set the user-named target version. Pure.
 */
export function withTargetVersion(
  state: PipelineState,
  targetVersion: string,
): PipelineState {
  return { ...state, targetVersion }
}

/**
 * Load state from disk, or undefined when absent or unparseable.
 */
export function loadState(filePath: string): PipelineState | undefined {
  if (!existsSync(filePath)) {
    return undefined
  }
  return parseState(readFileSync(filePath, 'utf8'))
}

/**
 * Persist state (mkdir -p the cache dir first).
 */
export function saveState(filePath: string, state: PipelineState): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

/**
 * Clear the state file (`--reset`). Tolerates a missing file.
 */
export function resetState(filePath: string): void {
  safeDeleteSync(filePath)
}
