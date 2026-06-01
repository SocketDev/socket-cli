#!/usr/bin/env node
// Claude Code Stop hook — prose-antipattern-reminder.
//
// Flags AI-writing antipatterns in the most-recent assistant turn —
// the prose Claude drafts for commit bodies, PR descriptions, CHANGELOG
// entries, README sections, and docs. The fleet rule (CLAUDE.md "Prose
// authoring", .claude/skills/fleet/prose/SKILL.md): run human-facing prose
// through the prose skill before it lands, which strips throat-clearing
// openers, "not X, it's Y" contrasts, em-dash chains, and vague hedging
// adverbs.
//
// Fires informationally to stderr; never blocks (a Stop hook fires after
// the turn is written — blocking would truncate the response).
//
// Disable via SOCKET_PROSE_ANTIPATTERN_REMINDER_DISABLED.

import { PROSE_PATTERNS } from './patterns.mts'
import { runStopReminder } from '../_shared/stop-reminder.mts'

await runStopReminder({
  name: 'prose-antipattern-reminder',
  disabledEnvVar: 'SOCKET_PROSE_ANTIPATTERN_REMINDER_DISABLED',
  patterns: PROSE_PATTERNS,
  closingHint:
    'Per CLAUDE.md "Prose authoring": run commit bodies, PR descriptions, CHANGELOG entries, README sections, and docs through the `prose` skill before they land.',
})
