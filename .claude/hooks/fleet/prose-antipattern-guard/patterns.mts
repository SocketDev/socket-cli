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

// CHANGELOG-only antipatterns: a changelog states user-visible behavior
// (the API or commands that changed), never the implementation that
// delivered it. Dependency bumps, internal mechanism names, and
// "resolved by upgrading X" tails are noise to a reader who just wants to
// know what changed for them. Scoped to CHANGELOG.md by the caller.
export const CHANGELOG_IMPL_PATTERNS: readonly ProsePattern[] = [
  {
    label: 'dependency mention',
    // Scoped package names + the words deps carry. A user-facing entry
    // describes behavior, not which library moved.
    regex:
      /@[a-z0-9-]+\/[a-z0-9-]+|\bdependenc(?:y|ies)\b|\blockfile\b|\btransitive\b/i,
    why: 'Dependency/lockfile mention — implementation detail. Describe the user-visible behavior that changed, not which package moved.',
  },
  {
    label: 'version-bump phrasing',
    regex:
      /\b(?:bump(?:ed|s|ing)?|upgrad(?:e|ed|ing)|pin(?:ned)?)\b[^\n]*\bto\b\s*v?\d+\.\d+/i,
    why: 'Version-bump phrasing — implementation detail. State what the user can now do or what stopped breaking, not the version delta.',
  },
  {
    label: '"resolved by" / mechanism tail',
    regex:
      /\bresolved by\b|\bfixed by (?:upgrad|bump|pin)|\bby (?:upgrad|bump|pin)/i,
    why: 'The "resolved by upgrading X" tail explains the how. Cut it — the reader cares what changed, not the mechanism.',
  },
  {
    label: 'internal mechanism token',
    // Wire/transport/internal-API tokens that surface the plumbing rather
    // than the observable behavior.
    regex:
      /\b(?:content-encoding|decodeBody|brotli|gzip|httpRequest|OIDC|job_workflow_ref|reusable workflow)\b/i,
    why: 'Internal mechanism token — implementation detail. Describe the observable outcome, not the plumbing.',
  },
]

/**
 * Scan a CHANGELOG `content` block for implementation-detail antipatterns.
 * Returns the matched patterns (empty when clean). Caller restricts this to
 * CHANGELOG.md writes.
 */
export function findChangelogImplDetail(content: string): ProsePattern[] {
  const hits: ProsePattern[] = []
  for (let i = 0, { length } = CHANGELOG_IMPL_PATTERNS; i < length; i += 1) {
    const pattern = CHANGELOG_IMPL_PATTERNS[i]!
    if (pattern.regex.test(content)) {
      hits.push(pattern)
    }
  }
  return hits
}
