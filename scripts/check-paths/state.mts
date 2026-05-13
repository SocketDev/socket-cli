/**
 * @fileoverview Shared findings state for the path-hygiene gate.
 *
 * Replaces the module-level `findings: Finding[]` array that lived at
 * file scope in the pre-split monolith. Every scanner imports
 * `pushFinding` (write) and the CLI entry reads via `getFindings()` so
 * the array stays a single source of truth across the helper modules.
 *
 * `clearFindings` exists for test harnesses that exercise multiple
 * runs in one process; the production CLI never resets mid-run.
 */

import type { Finding } from './types.mts'

export const findings: Finding[] = []

export function pushFinding(f: Finding): void {
  findings.push(f)
}

export function getFindings(): readonly Finding[] {
  return findings
}

export function clearFindings(): void {
  findings.length = 0
}
