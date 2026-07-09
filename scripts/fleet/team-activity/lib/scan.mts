/**
 * @file One full scan pass, composed from the discovery, review-state, and
 *   follow-up stages. Pure orchestration over an injected `GhRunner`, so a test
 *   drives the whole pass with a scripted runner and no spawn. Mutates
 *   `state.reactions` (the reaction memo); the caller stamps `state.scannedAt`
 *   after the pass so `since` stays the previous tick.
 */

import { discoverCandidates } from './discover.mts'
import { assessItems } from './filter.mts'
import { scanFollowUps } from './follow-ups.mts'

import type {
  GhRunner,
  ScanReport,
  ScanState,
  TeamActivityConfig,
} from './types.mts'

export function runScan(
  config: TeamActivityConfig,
  state: ScanState,
  gh: GhRunner,
): ScanReport {
  const discovered = discoverCandidates(config, gh)
  const assessed = assessItems(discovered.candidates, gh, config)
  const follow = scanFollowUps(config, state, gh)
  const newItems = assessed.items.toSorted(
    (a, b) => a.repo.localeCompare(b.repo) || a.number - b.number,
  )
  return {
    closedDups: follow.closedDups,
    errors: [...discovered.errors, ...assessed.errors, ...follow.errors],
    newItems,
    reactionChanges: follow.reactionChanges,
    replies: follow.replies,
  }
}
