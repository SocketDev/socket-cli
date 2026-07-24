/**
 * @file Shared error-message-quality classifier. The single source for "is this
 *   a vague-only error message" — consumed by both
 *   `error-message-quality-nudge` (Stop hook, grades code blocks the
 *   assistant wrote) and the `error-messages-are-thorough` check (commit-time,
 *   grades `throw new …Error("…")` across the committed tree). Extracted so the
 *   pattern list + grading bar live in ONE place; a tweak to either lands for
 *   both surfaces at once.
 *   The bar (per CLAUDE.md "Error messages"): a message is vague when it is a
 *   short static string carrying ONLY a vague verb/noun — no "what" rule, no
 *   field/location, no saw-vs-wanted value. A message with a colon (field-path
 *   prefix), an embedded quote (a shown value), or length > 40 is presumed to
 *   carry specifics and is NOT graded.
 */

// Match any Error-suffixed class plus the legacy TemporalError name.
export const ERROR_CLASS_RE = /(?:Error|TemporalError)$/

export interface VaguePattern {
  readonly label: string
  readonly regex: RegExp
  readonly hint: string
}

export const VAGUE_MESSAGE_PATTERNS: readonly VaguePattern[] = [
  {
    label: 'bare "invalid"',
    regex:
      /^(?:invalid|invalid value|invalid input|invalid argument|invalid format)\.?$/i,
    hint: '"Invalid" describes the fallout, not the rule. Say what shape was expected: "must be lowercase", "must match /^[a-z]+$/", "must be one of X / Y / Z".',
  },
  {
    label: 'bare "failed"',
    regex:
      /^(?:action failed|failed|failure|operation failed|request failed)\.?$/i,
    hint: '"Failed" describes the symptom. Name what was attempted and what blocked it: "could not write <path>: ENOENT", "fetch <url> returned 503".',
  },
  {
    label: 'bare "error occurred"',
    // Matches "error", "an error", "error occurred", "an error occurred" with
    // an optional trailing period — the entire message is a generic noun phrase
    // with no what/where/saw-vs-wanted content.
    regex: /^(?:an? )?error(?:\s+occurred)?\.?$/i,
    hint: 'The message says nothing the reader can act on. State the rule, the location, the bad value.',
  },
  {
    label: 'bare "something went wrong"',
    regex: /^something went wrong\.?$/i,
    hint: 'Pure filler. CLAUDE.md "Error messages": the reader should fix the problem from the message alone.',
  },
  {
    label: 'bare "unable to X" / "could not X" (verb-only)',
    // Matches a negated-ability opener ("unable to", "could not", "cannot",
    // "can't") followed by exactly one word — the verb only, no object or
    // reason. "Unable to read" hits; "could not read <path>: ENOENT" does not.
    regex: /^(?:can'?t|cannot|could not|unable to)\s+\w+\.?$/i,
    hint: 'No object / no reason. "Unable to read" → "could not read <path>: <errno>".',
  },
  {
    label: 'bare "not found"',
    // Matches "not found", "not exist", "does not exist", or "missing" as the
    // entire message (with optional trailing period) — no subject, no path, no
    // context about what was looked for or where.
    regex: /^(?:does not exist|missing|not found|not\s+exist)\.?$/i,
    hint: 'Missing what? Where? Say "config file not found: <path>" with the specific path.',
  },
  {
    label: 'bare "bad" / "wrong" / "incorrect"',
    // Matches a vague quality adjective ("bad", "wrong", "incorrect", or
    // "invalid format") with an optional generic noun suffix ("argument",
    // "data", "format", "input", "value") as the full message. The noun suffix
    // names a category, not a specific field or violated constraint.
    regex:
      /^(?:bad|incorrect|invalid format|wrong)(?:\s+(?:argument|data|format|input|value))?\.?$/i,
    hint: 'Same as "invalid" — describe the rule the value violated, not how you feel about it.',
  },
]

export interface MessageGrade {
  readonly label: string
  readonly hint: string
}

/**
 * Grade a single thrown-error message string. Returns the matched vague
 * pattern, or undefined when the message clears the bar (carries a colon /
 * quoted value, is longer than 40 chars, or matches no vague-only pattern). A
 * non-string message (template literal with interpolation, an identifier) is
 * out of scope — pass an empty string and it returns undefined.
 */
export function gradeMessage(message: string): MessageGrade | undefined {
  const trimmed = message.trim()
  if (trimmed.length === 0) {
    return undefined
  }
  // A colon suggests a field-path prefix; an embedded quote/backtick suggests a
  // shown "saw vs. wanted" value. Either way, presumed specific.
  if (trimmed.includes(':') || trimmed.includes('"') || trimmed.includes('`')) {
    return undefined
  }
  if (trimmed.length > 40) {
    return undefined
  }
  for (let i = 0, { length } = VAGUE_MESSAGE_PATTERNS; i < length; i += 1) {
    const pattern = VAGUE_MESSAGE_PATTERNS[i]!
    if (pattern.regex.test(trimmed)) {
      return { label: pattern.label, hint: pattern.hint }
    }
  }
  return undefined
}
