#!/usr/bin/env node
// Claude Code PreToolUse hook — waiting-discipline-nudge.
//
// A foreground Bash command about to block on a long `sleep` — bare, or
// chained with a poll like `sleep 540 && gh api …/runs` — buys silence, not
// information. An orchestrator once watched a background workflow with
// nine-minute blocking sleep-poll cycles, zero interim output per cycle, for
// a run whose completion the workflow system already delivers as a
// notification.
//
// The rule (WAITING_DISCIPLINE_GUIDANCE in `_shared/waiting-discipline.mts`):
//   1. A job that notifies on completion is never watched with a blocking
//      sleep — background it, say what is running and what event comes next,
//      end the turn.
//   2. When polling is genuinely required because nothing notifies, cap each
//      silent interval at 60-90s and emit an interim one-liner every cycle.
//   3. Status updates name concrete progress — a result count, a
//      last-activity age — never a bare "still running".
//
// Fires BEFORE the silence starts: any foreground Bash command whose longest
// single `sleep` invocation totals WAIT_SLEEP_NUDGE_SECONDS (120s) or more.
// Skips detached commands (`run_in_background: true`) — a background shell
// does not silence the turn. Reminder only; never blocks.

import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import {
  maxBlockingSleepSeconds,
  WAIT_SLEEP_NUDGE_SECONDS,
  WAITING_DISCIPLINE_GUIDANCE,
} from '../_shared/waiting-discipline.mts'

/**
 * The nudge text for a blocking sleep of `seconds`. Pure.
 */
export function formatWaitingNudge(seconds: number): string {
  return [
    `[waiting-discipline-nudge] This command blocks the foreground on a ~${Math.round(seconds)}s \`sleep\`.`,
    '',
    'That long a silent wait adds silence, not information.',
    ...WAITING_DISCIPLINE_GUIDANCE,
    'Reminder-only; not a block.',
  ].join('\n')
}

export const check = bashGuard((command, payload) => {
  if (payload.tool_input?.run_in_background === true) {
    return undefined
  }
  const seconds = maxBlockingSleepSeconds(command)
  if (seconds < WAIT_SLEEP_NUDGE_SECONDS) {
    return undefined
  }
  return notify(formatWaitingNudge(seconds))
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'nudge',
})

void runHook(hook, import.meta.url)
