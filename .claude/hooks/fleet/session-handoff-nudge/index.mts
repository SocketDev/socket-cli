#!/usr/bin/env node
// Claude Code Stop hook — session-handoff-nudge.
//
// Flags assistant text that offloads context/session-management onto the user:
// "I'm deep in this session's context", "best done with fresh context", "your
// call to continue or stop here", "risk a half-finished", "running low on
// context", etc. Session/context budget is the assistant's plumbing, not the
// user's decision — surfacing it makes the user manage the model's limits.
//
// What to do instead (the nudge): when deep / near a limit, handle continuation
// seamlessly — write a handoff doc to <repo>/.claude/plans/<name>.md capturing
// done/pending/next-step state, save decisions to memory, and continue (or let
// compaction / a fresh session resume from the doc). Don't narrate it.
//
// Reminder-only (never blocks): sometimes the phrase is legitimate (e.g.
// quoting the user). Exception: if a recent user turn explicitly said
// "stop"/"pause"/"we're done", the assistant is just acknowledging — skip.

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import {
  readLastAssistantText,
  readUserText,
  stripCodeFences,
} from '../_shared/transcript.mts'

const BURDEN_PATTERNS: ReadonlyArray<{ label: string; regex: RegExp }> = [
  {
    label: 'deep in context / session',
    // "I'm (very) deep in this session('s) context", "deep in context".
    regex:
      /\b(?:deep\s+in\s+(?:this\s+)?(?:session(?:'?s)?\s+)?context|deep\s+in\s+(?:this\s+)?session)\b/i,
  },
  {
    label: 'fresh / new context or session',
    // "best done with fresh context", "start a new session", "fresh session".
    regex:
      /\b(?:(?:with|in|needs?|deserves?|best\s+(?:done|built)\s+(?:in|with))\s+(?:a\s+)?(?:fresh|new)\s+(?:context|session)|start(?:ing)?\s+a\s+(?:fresh|new)\s+session|fresh\s+session)\b/i,
  },
  {
    label: 'your call to continue / stop',
    // "your call to continue", "your call on whether to stop", "up to you to continue".
    regex:
      /\b(?:your\s+call\s+(?:to|on|whether)|up\s+to\s+you\s+(?:to|whether))\b[^.?!\n]{0,40}\b(?:continue|stop|proceed|keep\s+going)\b/i,
  },
  {
    label: 'stop here cleanly / keep grinding or stop',
    regex:
      /\b(?:stop\s+here\s+cleanly|keep\s+(?:grinding|going)[^.?!\n]{0,30}\bor\s+stop)\b/i,
  },
  {
    label: 'context budget / running low on context',
    // "running low on context", "out of context", "context window/budget/limit".
    regex:
      /\b(?:running\s+(?:low|out)\s+(?:on|of)\s+context|out\s+of\s+context|context\s+(?:window|budget|limit|runway)\b[^.?!\n]{0,30}(?:low|left|remaining|exhaust|tight))\b/i,
  },
  {
    label: 'risk a half-finished / context exhaustion',
    regex:
      /\b(?:risk(?:ing)?\s+a\s+half-?finished|context\s+exhaustion|before\s+(?:I\s+)?(?:run\s+out|exhaust)\b[^.?!\n]{0,20}context)\b/i,
  },
]

export function matchContextBurden(
  text: string,
): { label: string } | undefined {
  for (let i = 0, { length } = BURDEN_PATTERNS; i < length; i += 1) {
    const entry = BURDEN_PATTERNS[i]!
    if (entry.regex.test(text)) {
      return { label: entry.label }
    }
  }
  return undefined
}

// User turns that mean "the user themselves chose to stop" — then any
// continuation phrasing is acknowledgement, not offloading. Skip.
const USER_STOP_RE =
  /\b(?:stop|pause|we'?re\s+done|that'?s\s+enough|enough\s+for\s+now|hold\s+(?:on|off)|wrap\s+up)\b/i

export const check = (payload: ToolCallPayload): GuardResult => {
  const rawText = readLastAssistantText(payload.transcript_path)
  if (!rawText) {
    return undefined
  }
  const match = matchContextBurden(stripCodeFences(rawText))
  if (!match) {
    return undefined
  }
  // If the user just told us to stop/pause, the phrasing is acknowledgement.
  const recentUserText = readUserText(payload.transcript_path, 2)
  if (recentUserText && USER_STOP_RE.test(recentUserText)) {
    return undefined
  }
  return notify(
    [
      `⚠  session-handoff-nudge: your reply offloads context/session-management onto the user (“${match.label}”).`,
      '',
      "  Context/session budget is YOUR plumbing, not the user's call. Don't ask",
      '  them to decide continue-vs-stop or narrate "deep in context".',
      '',
      '  Instead, handle continuation seamlessly: write a handoff doc to',
      '  <repo>/.claude/plans/<name>.md (done / pending / next-step state +',
      '  pointers to any workflow-output designs), save decisions to memory, and',
      '  continue — or let compaction / a fresh session resume from the doc.',
      '',
    ].join('\n'),
  )
}

export const hook = defineHook({
  check,
  event: 'Stop',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
