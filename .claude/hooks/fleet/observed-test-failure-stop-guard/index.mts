#!/usr/bin/env node
// Claude Code Stop hook — observed-test-failure-stop-guard.
//
// Fires at turn-end. Blocks the stop while a test scope this checkout ran is
// still recorded red in `.cache/fleet/socket-failing-tests/`.
//
// The hole it closes, observed live: the pre-commit test gate runs the STAGED
// scope. A session that runs a broader suite, watches a test fail in a file it
// did not stage, then commits its own files sails straight through — the gate
// never re-runs the failure, so nothing objects and the red is left for the
// next session to find. The fleet rule ("fix a lint/type/test error in your
// reading window in a sibling commit") had no code behind it at exactly the
// moment it mattered.
//
// A scope leaves the ledger only when the SAME scope runs green, so re-running
// it is the one way out. There is deliberately no acknowledge-and-move-on path:
// that is the behavior this exists to stop.
//
// Pre-existing versus mine is NOT a question the guard asks. A red test in the
// reading window is the turn's problem whoever wrote it — sorting ownership is
// how the failure gets deferred instead of fixed.

import { readFailingScopes } from '../_shared/failing-tests-ledger.mts'
import { block, defineHook, notify, runHook } from '../_shared/guard.mts'
import { resolveProjectDir } from '../_shared/project-dir.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'
import { verdictLine } from '../_shared/verdict.mts'

import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

const BYPASS_PHRASE = 'Allow failing-test bypass'

/**
 * The labels of every scope still recorded red.
 */
export function redScopes(projectDir: string): string[] {
  return readFailingScopes(projectDir).map(s => s.label)
}

/**
 * The verdict text for a non-empty `labels`.
 */
export function message(labels: readonly string[]): string {
  const list = labels.map(l => `\`${l}\``).join(', ')
  const plural = labels.length === 1 ? 'scope is' : 'scopes are'
  return `${labels.length} test ${plural} still red in this checkout: ${list}. Re-run and fix — a passing run of the SAME scope is what clears this. Pre-existing or not, a red test in your reading window is yours to fix (bypass response "${BYPASS_PHRASE}")`
}

export const check = (payload: ToolCallPayload): GuardResult => {
  const labels = redScopes(resolveProjectDir())
  if (!labels.length) {
    return undefined
  }
  const line = verdictLine(
    'block',
    'observed-test-failure-stop-guard',
    message(labels),
  )
  // Same shape as dirty-worktree-stop-guard: fire at most once per turn, and
  // let the bypass degrade the block to a notice rather than to silence.
  // `stop_hook_active` is a Stop-payload field absent from ToolCallPayload.
  const stopHookActive =
    (payload as { stop_hook_active?: unknown | undefined }).stop_hook_active ===
    true
  const bypassPresent = bypassPhrasePresent(
    payload.transcript_path,
    BYPASS_PHRASE,
    undefined,
    { optionalSuffix: true },
  )
  if (stopHookActive || bypassPresent) {
    return notify(line)
  }
  return block(line)
}

export const hook = defineHook({
  bypass: ['failing-test'],
  bypassMode: 'manual',
  bypassOptional: true,
  check,
  event: 'Stop',
  type: 'guard',
})

void runHook(hook, import.meta.url)
