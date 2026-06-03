// Prose-antipattern detection patterns for prose-antipattern-guard.
//
// Split out from index.mts so tests can import the pattern table without
// triggering the hook's top-level `await withEditGuard(...)` (which blocks
// reading stdin). The hook's index.mts and its unit test both import
// PROSE_PATTERNS from here.

export interface ProsePattern {
  readonly label: string
  readonly regex: RegExp
  readonly why: string
}

export const PROSE_PATTERNS: readonly ProsePattern[] = [
  {
    label: 'em-dash chain',
    // Two or more ` — ` spaced-em-dash spans in the same paragraph. A single
    // em-dash is fine; a chain is the AI-prose tell.
    regex: / — [^\n]*? — /,
    why: 'Em-dash chains read AI-generated. Break into separate sentences or use commas / parentheses.',
  },
  {
    label: 'throat-clearing opener',
    regex:
      /^\s*(?:Here's the thing|Let me|It's worth noting|I should note)\b/im,
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

/**
 * Scan `content` for prose antipatterns. Returns the matched patterns (empty
 * when clean).
 */
export function findProseAntipatterns(content: string): ProsePattern[] {
  const hits: ProsePattern[] = []
  for (let i = 0, { length } = PROSE_PATTERNS; i < length; i += 1) {
    const pattern = PROSE_PATTERNS[i]!
    if (pattern.regex.test(content)) {
      hits.push(pattern)
    }
  }
  return hits
}
