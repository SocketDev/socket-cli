#!/usr/bin/env node
// Claude Code Stop hook — comment-tone-reminder.
//
// Flags teacher-tone phrases in the most-recent assistant turn that
// suggest comments written in code edits will read condescendingly.
// CLAUDE.md "Code style → Comments" says: audience is a junior dev,
// explain the constraint, not the obvious. No "First, we'll …" /
// "Note that …" / "It's important …" / "As you can see …" tone.
//
// Fires informationally to stderr; never blocks.
//
// Disable via SOCKET_COMMENT_TONE_REMINDER_DISABLED.

import { runStopReminder } from '../_shared/stop-reminder.mts'

await runStopReminder({
  name: 'comment-tone-reminder',
  disabledEnvVar: 'SOCKET_COMMENT_TONE_REMINDER_DISABLED',
  patterns: [
    {
      label: 'first, we (will|are)',
      regex: /\bfirst,? we (will|are|need|should)\b/i,
      why: 'Teacher-tone narration. Drop the step-by-step framing in comments.',
    },
    {
      label: 'note that',
      regex: /\bnote that\b/i,
      why: 'Tutorial filler. If the note is load-bearing, state it directly without the preamble.',
    },
    {
      label: 'it[\'’]?s important to',
      regex: /\bit'?s important to\b/i,
      why: 'Teacher-tone. State the constraint, don\'t announce that it\'s important.',
    },
    {
      label: 'as you can see',
      regex: /\bas you can see\b/i,
      why: 'Presupposes reader engagement. Drop the phrase.',
    },
    {
      label: 'remember that',
      regex: /\bremember (that|to)\b/i,
      why: 'Teacher-tone. The reader doesn\'t need to be reminded — state the rule.',
    },
    {
      label: 'in order to',
      regex: /\bin order to\b/i,
      why: 'Wordy. "To X" is sufficient unless contrasting with another path.',
    },
  ],
  closingHint:
    'These phrases in code comments age into noise. Per CLAUDE.md "Comments": audience is a junior dev — explain the constraint, the hidden invariant. Default to no comment.',
})
