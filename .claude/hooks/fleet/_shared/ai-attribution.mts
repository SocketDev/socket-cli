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
]
