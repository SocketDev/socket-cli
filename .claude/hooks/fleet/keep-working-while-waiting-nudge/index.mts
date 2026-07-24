#!/usr/bin/env node
// Claude Code Stop hook — keep-working-while-waiting-nudge.
//
// Fires at turn-end. When the session has an in-flight blocker it is about to
// idle on — a remote CI job it launched to watch, a background shell command, a
// spawned Workflow, or background agents — this nudge points out that waiting is
// not the same as being blocked: the task QUEUE almost always has other work
// that does NOT depend on that result. Advance a different queued todo, or take
// the wait window to tidy the task list, instead of sitting idle until the
// result lands. Only work TRULY blocked on the pending result should pause.
//
// Detection is a scan of the recent assistant tool-use blocks for wait signals:
//   • a Bash tool call with `run_in_background: true` (a detached job still running)
//   • a Bash command that watches/polls remote CI (`gh run watch`, `gh pr checks
//     --watch`, a `gh api …/runs` poll, a bare `sleep` delay)
//   • a `Workflow` tool call (background orchestration in flight)
//   • an `Agent` tool call not explicitly foregrounded (agents run detached by default)
//
// Verdict: notify (never blocks). A Stop hook fires after the turn ended, so
// there is no tool call to refuse — this is a reminder for the next turn.

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import type { ToolUseEvent } from '../_shared/transcript.mts'
import {
  readLastAssistantToolUses,
  readPriorAssistantToolUses,
} from '../_shared/transcript.mts'

// How many prior assistant turns to scan alongside the latest one. A launched
// job typically shows in the last turn or two; a small window keeps the scan
// cheap on long transcripts.
const LOOKBACK_TURNS = 3

// A Bash command that watches or polls a remote CI result. Each branch is a
// distinct wait shape: `gh run watch` / `gh run view` tail a run; `gh pr checks`
// with `--watch` blocks on PR checks; `gh api …/runs` is a hand-rolled poll; a
// bare `sleep` between polls is the classic busy-wait. Kept broad on purpose —
// a false positive only shows an advisory reminder.
const CI_WAIT_RE =
  /\bgh\s+(?:api[^\n]*\/runs|pr\s+checks?.*--watch|run\s+(?:view|watch))\b|(?:^|\s)sleep\s+\d/

/**
 * Inspect a set of recent tool-use events for an in-flight blocker the session
 * is about to idle on. Returns the human-readable reason for the first signal
 * found, or undefined when nothing is waiting.
 */
export function detectWaitSignal(
  toolUses: readonly ToolUseEvent[],
): string | undefined {
  for (let i = 0, { length } = toolUses; i < length; i += 1) {
    const { input, name } = toolUses[i]!
    if (name === 'Workflow') {
      return 'a background Workflow is in flight'
    }
    if (name === 'Agent' && input['run_in_background'] !== false) {
      return 'spawned agents are running in the background'
    }
    if (name === 'Bash') {
      if (input['run_in_background'] === true) {
        return 'a background shell job is still running'
      }
      const command =
        typeof input['command'] === 'string' ? input['command'] : ''
      if (CI_WAIT_RE.test(command)) {
        return 'a remote CI job is being watched/polled'
      }
    }
  }
  return undefined
}

export const check = (payload: ToolCallPayload): GuardResult => {
  const transcriptPath = payload.transcript_path
  const recent: ToolUseEvent[] = [
    ...readLastAssistantToolUses(transcriptPath),
    ...readPriorAssistantToolUses(transcriptPath, LOOKBACK_TURNS),
  ]
  const reason = detectWaitSignal(recent)
  if (!reason) {
    return undefined
  }
  return notify(
    `[keep-working-while-waiting-nudge] Looks like ${reason}. Waiting is not the same as being blocked:\n` +
      '  • Advance a DIFFERENT queued todo that does not depend on that result.\n' +
      '  • Or use the wait window to tidy the task list (drop stale items, split big ones).\n' +
      '  • Pause only for work that is TRULY blocked on the pending result.\n' +
      'Reminder-only; not a block.',
  )
}

export const hook = defineHook({
  check,
  event: 'Stop',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
