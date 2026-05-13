#!/usr/bin/env node
// Claude Code Stop hook — identifying-users-reminder.
//
// Flags assistant text that refers to the user as "the user" instead
// of by name. CLAUDE.md "Identifying users":
//
//   Identify users by git credentials and use their actual name.
//   Use "you/your" when speaking directly; use names when referencing
//   contributions.
//
// What this hook catches:
//
//   - "The user" / "this user" / "user wants" in non-quoted context.
//     These are markers that the assistant is talking ABOUT the user
//     rather than TO them, which usually means a missed name lookup.
//
//   - "Someone" / "the developer" / "the engineer" as a generic
//     third-party reference where naming would be appropriate.
//
// What this hook does NOT catch:
//
//   - "you" / "your" — those are direct address, the right shape.
//   - "users" (plural) — talking about user populations, not a specific
//     person.
//   - "the user can" / "if a user types" — generic API/UX description.
//
// The distinction: "the user wants X" (singular, definite, about a
// specific person) gets flagged; "if a user types X" (singular,
// indefinite, generic role) does not.
//
// Disable via SOCKET_IDENTIFYING_USERS_REMINDER_DISABLED.

import { runStopReminder } from '../_shared/stop-reminder.mts'
import type { RuleViolation } from '../_shared/stop-reminder.mts'

const PATTERNS: readonly RuleViolation[] = [
  {
    label: 'the user wants/needs/asked/said',
    // Match `the user` followed by an action verb that implies a
    // specific person's intent. The verb-list is intentionally narrow
    // — generic API docs say "the user can call X" which is fine.
    regex: /\b[Tt]he\s+user\s+(wants|needs|asked|said|requested|prefers|likes|wrote|chose|picked|decided)\b/i,
    why: 'Refers to a specific person\'s intent. Use their name from `git config user.name`, or "you" if speaking directly.',
  },
  {
    label: 'this user (singular reference)',
    regex: /\b[Tt]his\s+user\b/i,
    why: 'Same — naming or "you" is the right shape.',
  },
  {
    label: 'someone (singular human reference)',
    regex: /^Someone\s+(wants|needs|asked|said|requested|prefers|wrote)\b/im,
    why: '"Someone" hedges around naming. If you have access to git config, use the name.',
  },
  {
    label: 'the developer / the engineer (third-party framing)',
    regex: /\b[Tt]he\s+(developer|engineer)\s+(wants|needs|asked|said|prefers|wrote)\b/i,
    why: 'Same — name them if known, "you" if direct.',
  },
]

await runStopReminder({
  name: 'identifying-users-reminder',
  disabledEnvVar: 'SOCKET_IDENTIFYING_USERS_REMINDER_DISABLED',
  patterns: PATTERNS,
  closingHint:
    'CLAUDE.md "Identifying users": use the name from `git config user.name` when referencing what someone did or wants. Use "you/your" when speaking directly. "The user" reads as bureaucratic distance.',
})
