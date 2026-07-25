#!/usr/bin/env node
// Claude Code Stop hook — honesty-framing-guard.
//
// The honesty family ("honest"/"honestly"/"honesty", line-start "Frankly,",
// "papered over") is a BANNED-WORD VERDICT on chat replies. The heuristic
// patterns stay in reply-prose-nudge (advisory — they can over-fire), but a
// honesty match is always wrong: claiming honesty implies the rest is not.
// This guard blocks turn-end once so the reply gets rewritten, degrading to
// a notice when `stop_hook_active` is set (no Stop loops). Origin: the
// nudge-only surface let a "Post-push CI, honestly:" reply ship after the
// word joined the shared matcher — the teeth live here now, consuming the
// same `_shared/honesty-framing.mts` source every prose surface shares.
// Bypass: none — rewrite the sentence.

import { block, defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import {
  HONESTY_FRAMING_RE,
  HONESTY_LABEL,
  HONESTY_WHY,
} from '../_shared/honesty-framing.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import {
  formatReminderBlock,
  scanReminderText,
} from '../_shared/stop-nudge.mts'
import {
  readLastAssistantTurnText,
  stripCodeFences,
} from '../_shared/transcript.mts'

const NAME = 'honesty-framing-guard'

export const check = async (payload: ToolCallPayload): Promise<GuardResult> => {
  const rawText = readLastAssistantTurnText(payload.transcript_path)
  if (!rawText) {
    return undefined
  }
  const hits = await scanReminderText(stripCodeFences(rawText), [
    { label: HONESTY_LABEL, regex: HONESTY_FRAMING_RE, why: HONESTY_WHY },
  ])
  if (hits.length === 0) {
    return undefined
  }
  const message = formatReminderBlock(NAME, hits, HONESTY_WHY)
  // Degrade to a notice when a Stop block is already being retried, so two
  // Stop guards can never trap the turn in a loop.
  const stopHookActive =
    (payload as { stop_hook_active?: unknown | undefined }).stop_hook_active ===
    true
  if (stopHookActive) {
    return notify(message)
  }
  return block(
    message +
      '\nRewrite the reply without the banned framing — this match is a verdict, not a heuristic.',
  )
}

export const hook = defineHook({
  check,
  event: 'Stop',
  type: 'guard',
})
void runHook(hook, import.meta.url)
