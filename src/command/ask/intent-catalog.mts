/**
 * Pattern matching rules for natural language.
 */
export const ASK_PATTERNS = {
  __proto__: null,
  // Fix patterns (highest priority - action words).
  fix: {
    keywords: ['fix', 'resolve', 'repair', 'remediate', 'update', 'upgrade'],
    command: ['fix'],
    explanation: 'Applying package updates to fix GitHub security alerts',
    priority: 3,
  },
  // Issues patterns (lowest priority - descriptive words).
  issues: {
    keywords: ['problem', 'alert', 'warning', 'concern'],
    command: ['scan', 'create'],
    explanation: 'Finding issues in your dependencies',
    priority: 1,
  },
  // Optimize patterns (high priority - action words).
  optimize: {
    keywords: [
      'optimize',
      'enhance',
      'improve',
      'replace',
      'alternative',
      'better',
    ],
    command: ['optimize'],
    explanation: 'Replacing dependencies with Socket registry alternatives',
    priority: 3,
  },
  // Package safety patterns, medium priority.
  package: {
    keywords: [
      'safe',
      'trust',
      'score',
      'rating',
      'quality',
      'package',
      'dependency',
    ],
    command: ['package', 'score'],
    explanation: 'Checking package security score',
    priority: 2,
  },
  // Patch patterns (high priority - specific action).
  patch: {
    keywords: ['patch', 'apply patch'],
    command: ['patch'],
    explanation: 'Directly patching code to remove CVEs',
    priority: 3,
  },
  // Scan patterns, medium priority.
  scan: {
    keywords: [
      'scan',
      'check',
      'vulnerabilit',
      'audit',
      'analyze',
      'inspect',
      'review',
    ],
    command: ['scan', 'create'],
    explanation: 'Scanning your project for security vulnerabilities',
    priority: 2,
  },
} as const

export type AskPattern = (typeof ASK_PATTERNS)[Exclude<
  keyof typeof ASK_PATTERNS,
  '__proto__'
>]

// Widened view of ASK_PATTERNS for dynamic action strings from the semantic
// matchers — plain assignment widening, no assertion needed. `null` appears in
// the value union only because TS models the literal's `__proto__: null`
// prototype marker as a property; lookupAskPattern folds it away.
const ASK_PATTERNS_BY_ACTION: Record<string, AskPattern | null | undefined> =
  ASK_PATTERNS

export function lookupAskPattern(action: string): AskPattern | undefined {
  return ASK_PATTERNS_BY_ACTION[action] ?? undefined
}

export const ASK_CANDIDATES = Object.entries(ASK_PATTERNS).flatMap(
  ([id, pattern]) =>
    pattern && id !== 'issues'
      ? [{ id, description: pattern.explanation }]
      : [],
)
