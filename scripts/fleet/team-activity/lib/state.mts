/**
 * @file Script-owned scan state (sibling `<config>.state.json`). Holds the last
 *   scan time and per-watch reaction totals so "new since last tick" is a real
 *   diff, not a re-report. A torn/absent state file yields a fresh state — the
 *   worst case is one tick that re-reports recent activity, never a crash.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { statePathFor } from './paths.mts'

import type { ScanState } from './types.mts'

// Load state for a config path, seeding `scannedAt` with `nowIso` on first run.
export function loadState(configPath: string, nowIso: string): ScanState {
  const statePath = statePathFor(configPath)
  if (existsSync(statePath)) {
    try {
      const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as ScanState
      if (parsed && typeof parsed === 'object' && parsed.scannedAt) {
        return {
          reactions: parsed.reactions ?? {},
          scannedAt: parsed.scannedAt,
        }
      }
    } catch {
      // Fall through to a fresh state — a torn file must not stop the scan.
    }
  }
  return { reactions: {}, scannedAt: nowIso }
}

// Persist state next to its config file, creating the umbrella dir if needed.
export function writeState(configPath: string, state: ScanState): void {
  const statePath = statePathFor(configPath)
  mkdirSync(path.dirname(statePath), { recursive: true })
  writeFileSync(statePath, JSON.stringify(state, undefined, 1))
}
