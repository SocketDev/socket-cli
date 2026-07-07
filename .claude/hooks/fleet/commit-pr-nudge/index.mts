#!/usr/bin/env node
// Claude Code Stop hook — commit-pr-nudge.
//
// Flags assistant turns that drafted a commit message or PR body
// missing the fleet's required structure:
//
//   - Conventional Commits header (`<type>(<scope>): <description>`).
//     Anti-pattern: free-form sentences as the commit title.
//
//   - AI attribution lines ("Generated with Claude", "Co-Authored-By:
//     Claude", "🤖" tag lines). The fleet forbids these.
//
//   - PR body missing a Summary section (PRs that paste a commit log
//     without a 1-3 bullet summary).
//
// This hook only flags drafted text in the assistant turn — it doesn't
// inspect real git/gh invocations. The git/PR ones live in their own
// PreToolUse guards.
//
// Never blocks: a hit is surfaced as a stderr nudge so the next turn
// re-reads the drafted text. The blocking layer is the PreToolUse
// commit-message-format-guard at the moment a real commit fires.

import { AI_ATTRIBUTION_PATTERNS } from '../_shared/ai-attribution.mts'
import type { GuardResult } from '../_shared/guard.mts'
import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import {
  formatReminderBlock,
  scanReminderText,
} from '../_shared/stop-nudge.mts'
import {
  readLastAssistantText,
  stripCodeFences,
} from '../_shared/transcript.mts'

const NAME = 'commit-pr-nudge'

const PATTERNS = AI_ATTRIBUTION_PATTERNS.map(p => ({
  label: `AI attribution: ${p.label}`,
  regex: p.regex,
  why: p.why,
}))

const CLOSING_HINT =
  'Commits/PRs must use Conventional Commits (`<type>(<scope>): <description>`) with no AI attribution. PR bodies need a Summary section. See CLAUDE.md "Commits & PRs".'

export async function check(payload: ToolCallPayload): Promise<GuardResult> {
  const rawText = readLastAssistantText(payload.transcript_path)
  if (!rawText) {
    return undefined
  }
  const text = stripCodeFences(rawText)
  const hits = await scanReminderText(text, PATTERNS)
  if (hits.length === 0) {
    return undefined
  }
  return notify(formatReminderBlock(NAME, hits, CLOSING_HINT))
}

export const hook = defineHook({
  check,
  event: 'Stop',
  scope: 'convention',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
