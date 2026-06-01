// Prose-antipattern detection patterns for prose-antipattern-reminder.
//
// Split out from index.mts so tests can import the pattern table without
// triggering the hook's top-level `await runStopReminder(...)` (which
// blocks reading stdin). The hook's index.mts and its unit test both
// import PROSE_PATTERNS from here.

import type { RuleViolation } from '../_shared/stop-reminder.mts'

export const PROSE_PATTERNS: readonly RuleViolation[] = [
  {
    label: 'em-dash chain',
    // Two or more ` — ` spaced-em-dash spans in the same turn. A single
    // em-dash is fine; a chain is the AI-prose tell.
    regex: / — [^\n]*? — /,
    why: 'Em-dash chains read AI-generated. Break into separate sentences or use commas / parentheses.',
  },
  {
    label: 'throat-clearing opener',
    regex: /^\s*(?:Here's the thing|Let me|It's worth noting|I should note)\b/im,
    why: 'Throat-clearing preamble. Open on the substance, drop the warm-up.',
  },
  {
    label: '"not X, it\'s Y" contrast',
    regex: /\bnot\s+\w+[,.]?\s+(?:it's|it is|but rather)\b/i,
    why: 'The "not X, it\'s Y" reversal is an AI-prose tic. State the point directly.',
  },
  {
    label: 'hedging adverb',
    regex: /\b(?:basically|essentially|fundamentally|simply|just)\b/i,
    why: 'Vague hedging adverb doing no work. Cut it or replace with the concrete fact.',
  },
]
