/**
 * @file Release-pipeline state store. One JSON file under
 *   `node_modules/.cache/fleet/socket-release-pipeline/` (runtime state NEVER
 *   lives in the tracked tree) records a receipt per completed stage so a
 *   pipeline run is resumable: a re-run skips stages whose receipts are still
 *   current and picks up at the first missing/stale one. Pure helpers
 *   (`recordReceipt`, `parseState`) are separated from the fs edges
 *   (`loadState`, `saveState`) so tests round-trip against a temp dir.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

import type { StageId } from './stages.mts'

/**
 * Receipt statuses a stage can record. `deferred` = intentionally not run
 * (e.g. CI on an unpushed head: "local-only, CI deferred"). `blocked` = the
 * stage could not gather evidence either way (e.g. verify with no npm auth:
 * an unauthenticated `pnpm stage list` parses as EMPTY, which is not a
 * verdict) — it stops the run like a failure and never satisfies a resume,
 * but records the honest "no evidence" reason instead of a false negative.
 */
export type ReceiptStatus = 'blocked' | 'deferred' | 'failed' | 'passed'

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
  /**
   * Stage wall time in milliseconds (absent on receipts written before the
   * timing field existed — rendering tolerates that).
   */
  ms?: number | undefined
  status: ReceiptStatus
}

/**
 * Release-asset checksums computed at VERIFY time (over the verified local
 * pack — the exact bytes the approve gate compared against npm staging) and
 * stashed so the release stage can create the immutable GH release WITH its
 * assets in one draft → upload → undraft shot, no post-creation upload (an
 * immutable release 422-rejects late asset uploads).
 */
export interface ReleaseChecksums {
  /**
   * Sha1 hex of the verified tarball (comparable to npm's staged shasum).
   */
  sha1: string
  /**
   * Sha512 base64 of the verified tarball (npm integrity, without the SRI
   * prefix).
   */
  sha512: string
  /**
   * The tarball filename `pnpm pack` produces (scope-stripped name-version).
   */
  tarballName: string
  /**
   * The target version the checksums were computed for — a renamed target
   * invalidates the stash.
   */
  version: string
}

export interface PipelineState {
  /**
   * Package name at pipeline start (drift check on resume).
   */
  packageName: string
  /**
   * Verify-time release-asset checksums (see ReleaseChecksums). Absent until
   * the verify stage passes for real.
   */
  releaseChecksums?: ReleaseChecksums | undefined
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
    'fleet',
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
    releaseChecksums: undefined,
    stages: {},
    startedAt,
    targetVersion: undefined,
    version: 1,
  }
}

function parseReleaseChecksums(value: unknown): ReleaseChecksums | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const c = value as Partial<ReleaseChecksums>
  return typeof c.sha1 === 'string' &&
    typeof c.sha512 === 'string' &&
    typeof c.tarballName === 'string' &&
    typeof c.version === 'string'
    ? {
        sha1: c.sha1,
        sha512: c.sha512,
        tarballName: c.tarballName,
        version: c.version,
      }
    : undefined
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
    releaseChecksums: parseReleaseChecksums(s.releaseChecksums),
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
 * Immutably stash the verify-time release-asset checksums. Pure.
 */
export function withReleaseChecksums(
  state: PipelineState,
  releaseChecksums: ReleaseChecksums,
): PipelineState {
  return { ...state, releaseChecksums }
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
