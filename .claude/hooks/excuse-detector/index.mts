#!/usr/bin/env node
// Claude Code Stop hook — excuse-detector.
//
// Scans the assistant's most recent turn for excuse-shaped phrases
// that violate CLAUDE.md's "No 'pre-existing' excuse" and "Fix > defer"
// rules. Stop hooks are informational only — the warning fires AFTER
// the assistant's output so the user can call it out before the next
// turn.
//
// Disabled via SOCKET_EXCUSE_DETECTOR_DISABLED env var.

import { runStopReminder } from '../_shared/stop-reminder.mts'

await runStopReminder({
  name: 'excuse-detector',
  disabledEnvVar: 'SOCKET_EXCUSE_DETECTOR_DISABLED',
  patterns: [
    {
      label: 'pre-existing',
      regex: /\bpre[- ]?existing\b/i,
      why: 'CLAUDE.md "No pre-existing excuse": if you see a lint error, type error, test failure, broken comment, or stale comment anywhere in your reading window — fix it.',
    },
    {
      label: 'not related to my',
      regex: /\b(not |un)?related to my\b/i,
      why: 'CLAUDE.md "Unrelated issues are critical": an unrelated bug is not a reason to defer — it is a reason to treat it as critical and fix it immediately.',
    },
    {
      label: 'unrelated to the task',
      regex: /\bunrelated to (the |this )?task\b/i,
      why: 'CLAUDE.md "Unrelated issues are critical": same as above.',
    },
    {
      label: 'out of scope',
      regex: /\b(out of|outside)( (the|this))? scope\b/i,
      why: 'CLAUDE.md "No pre-existing excuse": the only exceptions are genuinely large refactors (state the trade-off and ask) or files belonging to another session.',
    },
    {
      label: 'separate concern',
      regex: /\bseparate concern\b/i,
      why: 'CLAUDE.md "Unrelated issues are critical": fix the unrelated bug first, in its own commit, then resume the original task.',
    },
    {
      label: 'leave it for later',
      regex: /\bleave (it|that|this) for later\b/i,
      why: 'CLAUDE.md "Completion": never leave TODO/FIXME/XXX/shims/stubs/placeholders — finish 100%.',
    },
    {
      label: 'not my issue',
      regex: /\bnot my (issue|problem|bug)\b/i,
      why: 'CLAUDE.md "Unrelated issues are critical": same as "unrelated".',
    },
    {
      label: 'which direction do you want',
      regex: /\bwhich direction do you want\b/i,
      why: 'CLAUDE.md "Fix > defer": don\'t offer fix-vs-defer as a binary choice. Pick the fix path and execute.',
    },
    {
      label: 'should I implement … or accept',
      regex: /\bshould (i|we) (implement|fix|do|build) [^.?!\n]+(or|,)\s+(accept|defer|document|skip|leave|treat)\b/i,
      why: 'CLAUDE.md "Fix > defer": this is a choice-architecture masquerading as a question. Fix it.',
    },
    {
      label: 'accept … as (a) (known )?gap',
      regex:
        /\baccept (this|it|that|[^.?!\n]{1,40}) as (a |an )?(known |documented |expected )?(gap|drift|limitation)\b/i,
      why: 'CLAUDE.md "Fix > defer": gap-acceptance is the rationalization branch. The fix is the answer unless the user explicitly asked for the trade-off.',
    },
    {
      label: 'two paths/options: fix … or',
      regex:
        /\b(two|three) (paths|options|choices)[^.?!\n]{0,40}(fix|implement)[^.?!\n]{0,80}(or|,)\s+(accept|defer|document|skip|leave|treat)\b/i,
      why: 'CLAUDE.md "Fix > defer": collapsing the menu — pick the fix path, start the first sub-step.',
    },
    {
      label: 'document(ed)? (it )?as a known (gap|drift|limitation)',
      regex:
        /\bdocument(ed)?\b[^.?!\n]{0,40}\bas a known (gap|drift|limitation)\b/i,
      why: 'CLAUDE.md "Fix > defer": "document as known gap" is the deferral euphemism. Fix it instead.',
    },
    {
      label: 'want me to fix … or',
      regex:
        /\bwant me to (fix|implement|do|build|address) [^.?!\n]+(or|,)\s+(skip|defer|document|treat|accept|leave|move on)\b/i,
      why: 'CLAUDE.md "Fix > defer": same pattern — re-litigating the fix decision. The user already said yes by virtue of asking.',
    },
  ],
  closingHint:
    'These phrases usually precede a deferral. Read the surrounding text and decide: is the fix actually out of scope (rare), or is the assistant rationalizing avoiding work? If the latter, push back and demand the fix in the next turn.',
})
