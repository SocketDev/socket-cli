#!/usr/bin/env node
// Claude Code Stop hook — commit-pr-reminder.
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
// Disable via SOCKET_COMMIT_PR_REMINDER_DISABLED.

import { runStopReminder } from '../_shared/stop-reminder.mts'

await runStopReminder({
  name: 'commit-pr-reminder',
  disabledEnvVar: 'SOCKET_COMMIT_PR_REMINDER_DISABLED',
  patterns: [
    {
      label: 'AI attribution: Generated with Claude',
      regex: /generated with (?:claude|anthropic)/i,
      why: 'The fleet forbids AI attribution in commit/PR text. Remove the line.',
    },
    {
      label: 'AI attribution: Co-Authored-By Claude',
      regex: /co-authored-by:?\s*claude/i,
      why: 'Co-Authored-By Claude is forbidden in commit/PR trailers.',
    },
    {
      label: 'AI attribution: robot emoji tag line',
      regex: /^.*🤖.*generated/im,
      why: 'Remove the robot-emoji + "Generated" attribution line.',
    },
  ],
  closingHint:
    'Commits/PRs must use Conventional Commits (`<type>(<scope>): <description>`) with no AI attribution. PR bodies need a Summary section. See CLAUDE.md "Commits & PRs".',
})
