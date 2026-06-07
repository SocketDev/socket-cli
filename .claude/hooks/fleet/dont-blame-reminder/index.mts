#!/usr/bin/env node
// Claude Code Stop hook — dont-blame-reminder.
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

import { runStopReminder } from '../_shared/stop-reminder.mts'

await runStopReminder({
  name: 'dont-blame-reminder',
  blocking: true,
  // Strip quoted spans so the hook doesn't self-fire when the
  // assistant *describes* the phrases it detects (e.g. when this
  // doc-comment is itself paraphrased in a turn summary).
  stripQuotedSpans: true,
  patterns: [
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
  ],
  closingHint:
    'If you have hard evidence the user reverted the change (a quoted user message, a manual `git reflog` entry), restate the evidence inline. Otherwise resume the investigation into the actual cause — your own script, or a parallel session (check `git log --oneline -8` for a recent commit that isn\'t yours).',
})
