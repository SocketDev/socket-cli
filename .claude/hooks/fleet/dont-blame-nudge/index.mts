#!/usr/bin/env node
// Claude Code Stop hook — dont-blame-nudge.
//
// Scans the assistant's most recent turn for phrases that blame the
// user (or "the linter") for state that was actually produced by the
// assistant's own scripts (pre-commit autofix, sync-scaffolding
// cascades, lint --fix passes, format-on-save) OR by a PARALLEL
// CLAUDE SESSION editing the same checkout.
//
// Why this exists: jdalton repeatedly saw the assistant claim "the
// user reverted my edits" / "the linter stripped my !s" / "the linter
// rewrote it" when in fact the change came from the assistant's own
// template canonical sources + sync-cascade scripts, OR from a
// concurrent session committing to the shared `.git/`. Files changing
// between Read and Edit ("modified since read") and tracked content
// the assistant didn't touch getting rewritten are a parallel agent's
// fingerprint, not a linter. Blaming the user / "the linter" instead
// of investigating is a deferral pattern: it stops debugging without
// finding the actual cause.
//
// Runs in BLOCKING mode so the assistant must continue the turn and
// either (a) prove the blame is correct with evidence (a commit
// hash, a hook output, etc.) or (b) keep investigating the actual
// script that produced the reverted state. The block is suppressed
// when stop_hook_active is set, so it can fire at most once per
// stop chain.
//
// Not disableable by env var — the only escape hatch is the
// `Allow <X> bypass` phrase.

import { block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import type { RuleViolation } from '../_shared/stop-nudge.mts'
import {
  formatReminderBlock,
  scanReminderText,
} from '../_shared/stop-nudge.mts'
import {
  readLastAssistantText,
  stripCodeFences,
  stripQuotedSpans,
} from '../_shared/transcript.mts'

const NAME = 'dont-blame-nudge'

const PATTERNS: readonly RuleViolation[] = [
  {
    label: 'blaming user/linter for revert without evidence',
    // Matches phrases that attribute state to the user / linter
    // *as the cause*, with no investigation attached. The shape:
    // "user reverted X" / "linter stripped Y" / "user prefers Z".
    // These are deferral phrases when said about state produced
    // by the assistant's own scripts (sync-cascade, pre-commit
    // autofix, oxlint --fix, oxfmt).
    regex:
      /\b(?:the\s+)?(?:formatter|linter|user)\s+(?:reverted|stripped|removed|undid|reformatted|rewrote|preserves?|prefers?|keeps?)\b|\buser['']s\s+(?:intentional|preferred|preserved)\s+state\b|\b(?:removed|reverted|stripped)\s+by\s+(?:the\s+)?(?:formatter|linter|user)\b|\b(?:the\s+)?(?:user|linter)\s+(?:wants|chose|picked)\s+(?:to\s+keep|to\s+strip|to\s+remove)\b/i,
    why: 'Don\'t blame the user or "the linter" for state that may have been produced by (a) your own scripts (sync-cascade, pre-commit autofix, oxlint --fix, oxfmt, template canonical sources) OR (b) a PARALLEL CLAUDE SESSION on the same checkout. Files changing between your Read and Edit ("modified since read"), or tracked content you didn\'t touch getting rewritten, are a parallel agent\'s fingerprint — not a linter. Investigate the real cause: `git log --oneline -8` + `git log -S` the change + `git status --short` (does a recent commit that ISN\'T yours explain it?); run pre-commit phases in isolation; check `template/` canonical sources. Only attribute to the user with direct evidence (a quoted user message, a `git reflog` entry).',
  },
]

const CLOSING_HINT =
  "If you have hard evidence the user reverted the change (a quoted user message, a manual `git reflog` entry), restate the evidence inline. Otherwise resume the investigation into the actual cause — your own script, or a parallel session (check `git log --oneline -8` for a recent commit that isn't yours)."

export const check = async (
  payload: ToolCallPayload & { stop_hook_active?: boolean | undefined },
): Promise<GuardResult> => {
  // Suppress when Claude Code reports `stop_hook_active: true`, so the block
  // fires at most once per stop chain (matches the original blocking guard).
  if (payload.stop_hook_active) {
    return undefined
  }
  const rawText = readLastAssistantText(payload.transcript_path)
  if (!rawText) {
    return undefined
  }
  const fencesStripped = stripCodeFences(rawText)
  // Strip quoted spans so the hook doesn't self-fire when the assistant
  // *describes* the phrases it detects (e.g. when this doc-comment is itself
  // paraphrased in a turn summary).
  const text = stripQuotedSpans(fencesStripped)

  const hits = await scanReminderText(text, PATTERNS)
  if (hits.length === 0) {
    return undefined
  }

  const message =
    formatReminderBlock(NAME, hits, CLOSING_HINT) +
    '\nFix the underlying issue now (or, if it truly cannot be fixed in this session, ' +
    'say so explicitly with the trade-off — do not end the turn on the excuse phrase).'
  return block(message)
}

export const hook = defineHook({
  check,
  event: 'Stop',
  type: 'nudge',
})
/* c8 ignore start - standalone entrypoint; only runs when executed directly, not when imported */
void runHook(hook, import.meta.url)
/* c8 ignore stop */
