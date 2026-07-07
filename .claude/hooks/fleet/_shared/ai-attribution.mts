/**
 * @file Canonical AI-attribution pattern list. Both the commit-message-format
 *   guard (PreToolUse, blocks) and the commit-pr reminder (Stop, nudges) match
 *   against this one source so a string blocked at one gate is flagged at the
 *   other. Each entry carries a `why` the reminder surfaces; the guard uses the
 *   `label` only. The fleet forbids AI attribution anywhere in commit/PR text.
 */

export interface AiAttributionPattern {
  readonly label: string
  readonly regex: RegExp
  readonly why: string
}

export const AI_ATTRIBUTION_PATTERNS: readonly AiAttributionPattern[] = [
  {
    label: 'Generated with Claude/Anthropic',
    regex: /generated with (?:anthropic|claude)/i,
    why: 'The fleet forbids AI attribution in commit/PR text. Remove the line.',
  },
  {
    label: 'Co-Authored-By: Claude',
    regex: /co-authored-by:?\s*claude/i,
    why: 'Co-Authored-By Claude is forbidden in commit/PR trailers.',
  },
  {
    // Bare emoji match (not `🤖.*generated`): the emoji alone is the
    // attribution signal, and a partial form must not slip past one gate
    // while failing the other.
    label: 'Robot emoji (🤖) tag line',
    regex: /🤖/,
    why: 'Remove the robot-emoji attribution line.',
  },
  {
    label: 'noreply@anthropic.com footer',
    regex: /<noreply@anthropic\.com>/i,
    why: 'Remove the noreply@anthropic.com attribution footer.',
  },
  {
    // The `Claude-Session:` trailer Claude Code auto-appends — a
    // `Key: value` git-trailer line carrying a session permalink. Match
    // the trailer key (anchored to its own line) OR the session-URL
    // shape, so a partial form can't slip past one gate while failing
    // another. The hyphenated `Claude-Session:` key never appears in
    // legitimate prose, so this does not over-match a sentence that
    // merely mentions a Claude session.
    label: 'Claude-Session: trailer',
    regex: /^[ \t]*Claude-Session:\s*\S|claude\.ai\/code\/session_/im,
    why: 'Remove the auto-appended Claude-Session trailer.',
  },
]
