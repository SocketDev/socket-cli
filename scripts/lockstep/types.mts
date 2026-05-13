/**
 * @fileoverview Report types and shared aliases for the lockstep harness.
 *
 * Each row kind in the manifest produces a typed report row — the dispatcher
 * in `cli.mts` is exhaustively typed on the `Report` union below so the
 * formatter can read each kind's payload without `any` casts.
 *
 * `Severity` is the tri-state every report carries: `ok` (no drift),
 * `drift` (consumer needs to look), `error` (manifest is broken). Exit
 * codes map 0 / 2 / 1 respectively.
 */

import type { PortStatus, LockstepManifest } from './schema.mts'

export type Manifest = LockstepManifest

// ---------------------------------------------------------------------------
// Report types — one per kind so dispatcher output is typed precisely.
// ---------------------------------------------------------------------------

export type Severity = 'ok' | 'drift' | 'error'

export interface ReportBase {
  area: string
  id: string
  severity: Severity
  messages: string[]
}

export interface DriftCommit {
  sha: string
  summary: string
}

export interface FileForkReport extends ReportBase {
  kind: 'file-fork'
  local: string
  upstream: string
  upstream_path: string
  forked_at_sha: string
  drift: DriftCommit[]
}

export interface VersionPinReport extends ReportBase {
  kind: 'version-pin'
  upstream: string
  pinned_sha: string
  pinned_tag: string | undefined
  upgrade_policy: string
  head_sha: string | undefined
  drift_count: number
}

export interface FeatureParityReport extends ReportBase {
  kind: 'feature-parity'
  upstream: string
  local_area: string
  criticality: number
  code_score: number
  test_score: number
  fixture_score: number
  total_score: number
}

export interface SpecConformanceReport extends ReportBase {
  kind: 'spec-conformance'
  upstream: string
  local_impl: string
  spec_version: string
  spec_path: string | undefined
}

export interface LangParityReport extends ReportBase {
  kind: 'lang-parity'
  category: string
  ports: Record<string, PortStatus>
}

export type Report =
  | FileForkReport
  | VersionPinReport
  | FeatureParityReport
  | SpecConformanceReport
  | LangParityReport
