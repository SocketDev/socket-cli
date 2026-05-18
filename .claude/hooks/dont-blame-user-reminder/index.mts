#!/usr/bin/env node
// Claude Code Stop hook — dont-blame-user-reminder.
//
// Scans the assistant's most recent turn for phrases that blame the
// user (or "the linter") for state that was actually produced by the
// assistant's own scripts: pre-commit autofix, sync-scaffolding
// cascades, lint --fix passes, format-on-save.
//
// Why this exists: jdalton repeatedly saw the assistant claim "the
// user reverted my edits" / "the linter stripped my !s" / "user's
// preferred state has no assertions" when in fact the strips were
// produced by the assistant's own template canonical sources +
// sync-cascade scripts. Blaming the user instead of investigating
// the assistant's own scripts is a deferral pattern: it lets the
// assistant stop debugging without finding the actual cause.
//
// Runs in BLOCKING mode so the assistant must continue the turn and
// either (a) prove the blame is correct with evidence (a commit
// hash, a hook output, etc.) or (b) keep investigating the actual
// script that produced the reverted state. The block is suppressed
// when stop_hook_active is set, so it can fire at most once per
// stop chain.
//
// Disabled via SOCKET_DONT_BLAME_USER_DISABLED env var.

import { runStopReminder } from '../_shared/stop-reminder.mts'

await runStopReminder({
  name: 'dont-blame-user-reminder',
  disabledEnvVar: 'SOCKET_DONT_BLAME_USER_DISABLED',
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
        /\b(?:the\s+)?(?:user|linter|formatter)\s+(?:reverted|stripped|removed|undid|reformatted|rewrote|preserves?|prefers?|keeps?)\b|\buser['']s\s+(?:preferred|intentional|preserved)\s+state\b|\b(?:reverted|stripped|removed)\s+by\s+(?:the\s+)?(?:user|linter|formatter)\b|\b(?:the\s+)?(?:user|linter)\s+(?:wants|chose|picked)\s+(?:to\s+keep|to\s+strip|to\s+remove)\b/i,
      why: 'Don\'t blame the user or "the linter" for state that may have been produced by your own scripts (sync-cascade, pre-commit autofix, oxlint --fix, oxfmt, template canonical sources). Investigate WHICH script produced the state — `git log -S` the change, run pre-commit phases in isolation, check `template/` canonical sources. Only attribute the change to the user with direct evidence (a quoted user message, a `git reflog` entry).',
    },
  ],
  closingHint:
    'If you have hard evidence the user reverted the change (a quoted user message, a manual `git reflog` entry), restate the evidence inline. Otherwise resume the investigation into the actual script that produced the state.',
})
