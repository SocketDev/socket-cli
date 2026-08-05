/*
 * @file The directive-shape patterns that name agent-directed instructions
 *   embedded in UNTRUSTED content — an issue body, a PR/review comment, a
 *   fetched page, a vendored file. Detection is by SHAPE, not by a denylist of
 *   vendors, grouped into four precise families:
 *
 *   1. AUDIENCE — text that addresses an automated reader, whether hidden in an
 *      HTML comment (invisible on the rendered page, fully visible to whatever
 *      reads the raw body) or standing on its own.
 *   2. CODE EMISSION — a directive to emit a verification / acknowledgement
 *      code, to reply with "exactly the following", or to post a code with
 *      nothing else around it.
 *   3. MACHINE-ONLY DISCLAIMER — a "human contributors may skip this"
 *      disclaimer, which is the tell that the surrounding block was aimed only
 *      at machines.
 *   4. HONEYPOT MARKER — the one literal vendor marker worth keying on, since it
 *      names the mechanism outright.
 *
 *   Order across the families is load-bearing: the scan dedups findings by
 *   label, so `DIRECTIVE_PATTERNS` concatenates the families in a fixed order.
 */

export interface DirectivePattern {
  readonly label: string
  readonly re: RegExp
  // False → skip the whitespace-folded whole-text pass. That pass turns
  // newlines into spaces, which disables the `[^.\n]` proximity brake the
  // looser patterns rely on, so two innocent adjacent lines could read as one
  // sentence. Those patterns stay per-line.
  readonly wholeText?: boolean | undefined
}

// Text that speaks to a machine rather than to the person reading the rendered
// page.
const AUDIENCE_PATTERNS: readonly DirectivePattern[] = [
  {
    label: 'HTML comment addressed to an automated reader',
    // `<!--` then, within 400 characters, a phrase that speaks to a machine
    // rather than to the person reading the rendered page. The lazy
    // `[\s\S]{0,400}?` lets the phrase sit anywhere in a multi-line comment.
    re: /<!--[\s\S]{0,400}?(?:automated\s+contributors?|if\s+you(?:'re|\s+are)\s+(?:an?\s+)?(?:a\.?i\.?|agent|automated|language\s+model|llms?)|llms?\s+reading\s+this|message_for_llms|notice\s+for\s+automated\s+(?:agents?|contributors?))/i,
  },
  {
    label: 'notice addressed to automated readers',
    // The same machine-addressed phrases standing on their own, outside any
    // HTML comment — a plain-text block, a fenced snippet, a fetched page.
    re: /message_for_llms|\bnotice\s+for\s+automated\s+(?:agents?|contributors?)\b|\bautomated\s+contributors?\b|\bllms?\s+reading\s+this\b|\bif\s+you(?:'re|\s+are)\s+an?\s+ai\s+agent\b/i,
  },
]

// A directive to emit a code, to echo a literal verbatim, or to reply with a
// code and nothing else.
const CODE_EMISSION_PATTERNS: readonly DirectivePattern[] = [
  {
    label: 'directive to emit a verification code',
    // An emit-style verb, then within 96 characters a
    // verification/confirmation/acknowledgement code. The `[^\n]` window keeps
    // the two halves in the same neighbourhood.
    re: /\b(?:emit|include|paste|post|repeat|reply|respond|return|send|write)\b[^\n]{0,96}\b(?:acknowledge?ment|confirmation|validation|verification)\s+code\b/i,
  },
  {
    label: 'directive to reply with an exact literal',
    // "must consist of exactly the following", "reply with exactly the text
    // below" — an instruction to echo a literal verbatim.
    re: /\b(?:be|consist\s+of|contain|reply\s+with|respond\s+with)\s+(?:only\s+)?exactly\s+the\s+(?:code|following|string|text)\b/i,
  },
  {
    label: 'directive to post a code and nothing else',
    // A code/token noun within 40 characters of "and nothing else" (either
    // order) — the bait's signature demand that the reply carry the code alone.
    re: /\b(?:code|string|token|value|word)\b[^.\n]{0,40}\band\s+nothing\s+else\b|\band\s+nothing\s+else\b[^.\n]{0,40}\b(?:code|string|token|value|word)\b/i,
    wholeText: false,
  },
]

// A line excusing people from following the block it sits in — the tell that
// the block was aimed only at machines.
const MACHINE_ONLY_DISCLAIMER_PATTERNS: readonly DirectivePattern[] = [
  {
    label: 'disclaimer marking the block as machine-only',
    // A line excusing people from following the block it sits in. A block that
    // waves off human readers was written for machines.
    re: /\bhuman\s+(?:contributors?|maintainers?|readers?|reviewers?|users?)\b[^.\n]{0,80}\b(?:disregard|do(?:es)?\s+not\s+apply|ignore|skip)\b/i,
    wholeText: false,
  },
]

// The one literal vendor marker worth keying on.
const HONEYPOT_MARKER_PATTERNS: readonly DirectivePattern[] = [
  {
    label: 'honeypot marker literal',
    // The vendor marker that names the mechanism outright.
    re: /agentscan-honeypot/i,
  },
]

// Order is load-bearing: the scan dedups by label, so the families concatenate
// in a fixed order.
export const DIRECTIVE_PATTERNS: readonly DirectivePattern[] = [
  ...AUDIENCE_PATTERNS,
  ...CODE_EMISSION_PATTERNS,
  ...MACHINE_ONLY_DISCLAIMER_PATTERNS,
  ...HONEYPOT_MARKER_PATTERNS,
]
