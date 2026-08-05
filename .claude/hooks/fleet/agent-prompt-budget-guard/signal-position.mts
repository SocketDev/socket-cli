/*
 * @file Where an open-ended signal has to SIT before it counts as one, for
 *   agent-prompt-budget-guard.
 *
 *   Two narrowings live here. `maskQuotedAndCodeSpans` blanks the regions of a
 *   brief that QUOTE rather than instruct — a fenced block, an inline span, a
 *   quoted phrase — so a command in a snippet, a path in quotes, or somebody
 *   else's sentence never reads as this brief's own plan. `usedAsVerb` then
 *   holds the words that double as fleet nouns to a VERB position, the same
 *   discipline the command scanners use when they anchor at the command token
 *   instead of matching anywhere in a line.
 *
 *   Both are one-directional: they only ever turn a hit OFF. A brief that
 *   states its open-ended work in plain prose still carries every signal it
 *   started with.
 */

// A fenced block carries commands and snippets, so its words are an example,
// never this brief's instruction. Both fence spellings are masked, and the lazy
// body stops at the closing fence.
export const FENCED_BACKTICK_RE = /```[\s\S]*?```/gu

// The tilde spelling of the same fence.
export const FENCED_TILDE_RE = /~~~[\s\S]*?~~~/gu

// An inline span holds one identifier, path, key, or flag.
export const INLINE_CODE_RE = /`[^`\n]*`/gu

// A quoted phrase is a title or somebody else's words: an incident title, a
// sentence lifted from an upstream issue.
export const DOUBLE_QUOTED_RE = /"[^"\n]*"/gu

// The curly spelling, which is what pasted text usually carries.
export const CURLY_QUOTED_RE = /“[^”\n]*”/gu

// A single-quoted phrase counts as a quote only when the opening mark starts a
// token and the closing mark ends one. Without those boundaries the apostrophe
// in `don't` would open a span and the next one would close it, swallowing the
// sentence between them.
export const SINGLE_QUOTED_RE = /(?<=^|[\s([{])'[^'\n]*'(?=$|[\s!),.:;?\]}])/gu

// Applied in this order, so a fence is masked before its own backticks can look
// like an inline span.
export const QUOTED_AND_CODE_PATTERNS: readonly RegExp[] = [
  FENCED_BACKTICK_RE,
  FENCED_TILDE_RE,
  INLINE_CODE_RE,
  DOUBLE_QUOTED_RE,
  CURLY_QUOTED_RE,
  SINGLE_QUOTED_RE,
]

/**
 * `text` with every quoted or code span replaced by as many spaces as it spans.
 * Offsets survive, and a blanked span still separates the words around it, so
 * "the `catalog` audit" reads as a noun phrase instead of one long token.
 */
export function maskQuotedAndCodeSpans(text: string): string {
  let masked = text
  for (let i = 0, { length } = QUOTED_AND_CODE_PATTERNS; i < length; i += 1) {
    masked = masked.replace(QUOTED_AND_CODE_PATTERNS[i]!, span =>
      ' '.repeat(span.length),
    )
  }
  return masked
}

// A determiner, possessive, or tool name immediately before the word makes it a
// noun: "the catalog", "pnpm audit", "its inventory", "a sweep".
export const NOUN_LEAD_RE =
  /(?:^|\s)(?:a|an|another|each|every|fleet|its|my|no|npm|one|our|per|pnpm|that|the|their|these|this|those|whose|your)\s+$/u

// An owner directly before the word owns it, which makes the word that owner's
// thing rather than a request: "the repo's audit", "the pins' inventory".
export const POSSESSIVE_LEAD_RE = /[a-z0-9]['’]s?\s+$/u

// A path, flag, or identifier neighbor on the left: "scripts/fleet/audit-x",
// "--audit", "run_audit", "runner.audit".
export const SEGMENT_LEAD_RE = /[-./_]$/u

// A trailing `:` is a YAML or JSON key, `catalog:`. A trailing `.<ext>`, `/`,
// or `(` is a path or a call: `catalog.mts`, `audit/`, `explore()`. A `-` or `_`
// plus a letter opens a compound or an identifier: `audit-driven`, `sweep_log`.
// A quote mark closes a quoted token.
export const NOUN_TRAIL_RE = /^(?:-[a-z]|['"`]|\(|\.[a-z0-9]|\/|\s*:|_[a-z])/u

// A colon after the signal reads as a YAML or JSON key, which is why
// NOUN_TRAIL_RE stands the signal down for it. A LABEL is the other reading of
// the same punctuation: a line that opens with the signal and then runs on in
// prose — "Audit: every consumer of the dep" — is this brief's own instruction
// with a colon after its verb. A key never does that, since it ends its line or
// carries a value, so two prose words after the colon on the SAME line separate
// the two readings. The horizontal-whitespace class is what holds it to one
// line: `\s` would span the newline after a key's value and read the next
// line's first word as the second prose word.
export const LABEL_TRAIL_RE = /^:[\t ]+[a-z]+[\t ]+[a-z']+/u

// Only whitespace or a list marker sits between the start of the line and the
// signal, so the signal opens the line.
export const LINE_START_LEAD_RE = /(?:^|\n)[\s*>-]*$/u

// The word AFTER the signal settles some cases the left side cannot, which is
// how a noun opening a sentence is caught: nothing precedes it to mark it. A
// report or artifact noun makes the pair a noun phrase — "sweep results",
// "audit trail", "research notes" — and a copula makes the signal the
// sentence's subject: "inventory is stale". Neither asks for the work to be
// done.
export const NOUN_PHRASE_TRAIL_RE =
  /^\s+(?:are|entries|entry|findings|is|log|logs|note|notes|output|report|reports|result|results|summary|table|trail|was|were|will)\b/u

/**
 * True when `signal` appears in `lower` as a VERB at least once — not as a
 * noun, a YAML key, a path segment, or a compound modifier.
 *
 * Every occurrence is examined, so one noun use never masks a real verb use
 * later in the same brief: "the catalog pin … then catalog every consumer".
 *
 * `lower` is expected to be lowercased and already run through
 * {@link maskQuotedAndCodeSpans}.
 */
export function usedAsVerb(lower: string, signal: string): boolean {
  let from = 0
  for (;;) {
    const at = lower.indexOf(signal, from)
    if (at === -1) {
      return false
    }
    from = at + signal.length
    // A longer word containing the signal is a different word entirely, which
    // is what keeps "audits", "auditing", and "explorer" out.
    const before = lower[at - 1]
    const after = lower[from]
    const boundedLeft = at === 0 || !/[a-z0-9]/u.test(before ?? '')
    const boundedRight = !/[a-z0-9]/u.test(after ?? '')
    if (!boundedLeft || !boundedRight) {
      continue
    }
    const lead = lower.slice(0, at)
    if (
      SEGMENT_LEAD_RE.test(lead) ||
      NOUN_LEAD_RE.test(lead) ||
      POSSESSIVE_LEAD_RE.test(lead)
    ) {
      continue
    }
    const trail = lower.slice(from)
    if (LINE_START_LEAD_RE.test(lead) && LABEL_TRAIL_RE.test(trail)) {
      return true
    }
    if (NOUN_TRAIL_RE.test(trail) || NOUN_PHRASE_TRAIL_RE.test(trail)) {
      continue
    }
    return true
  }
}
